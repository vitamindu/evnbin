/**
 * 경기 한 판(서버 권위). Network 담당.
 *
 * - src/game의 Sim을 그대로 30틱/초로 돌린다(mode는 방 설정, 더미 없음).
 * - 사람: 입력 큐(InputQueue)에서 틱마다 하나. 연결이 끊긴 사람과 봇: botInput.
 * - snapshotEvery틱마다 snap(클라이언트별 ack, 직전 snap 이후 사건). 공통 부분은 한 번만 문자열로 만든다.
 * - sim.match.winner가 정해지면(또는 안전 상한 maxTicks) 마지막 snap을 보내고 끝낸다.
 */
import { getMap } from '../src/data/maps';
import { Sim } from '../src/game/sim';
import { TICK_RATE, type EntityId, type FighterInput, type MatchMode, type SimEvent, type Team, type Vec2 } from '../src/game/types';
import type { ClientMsg, MatchResult, MatchRosterEntry, MatchStartInfo, PlayerStats } from '../src/net/protocol';
import { rosterSpawns } from '../src/net/roster';
import { fromWireAim, quantizeMove, roundReplacer } from '../src/net/wire';
import { botInputFor } from './bots';
import { InputQueue, type InputQueueOptions } from './inputQueue';
import { FixedLoop } from './loop';
import type { RosterSeed } from './rooms';

export interface MatchHooks {
  /** playerId에게 문자열(JSON 메시지)을 보낸다. 연결이 없으면 무시 */
  send(playerId: string, data: string): void;
  /** 지금 이 경기에 연결돼 있는가(아니면 봇이 대신 조종) */
  isConnected(playerId: string): boolean;
  /** 경기가 끝났다(end 메시지는 호출하는 쪽이 보낸다) */
  onEnd(result: MatchResult): void;
  /** 틱 처리 중 예외 */
  onError?(err: unknown): void;
}

export interface MatchConfig {
  seed: number;
  mapId: string;
  mode: MatchMode;
  roster: RosterSeed[];
  /** 몇 틱마다 snap(기본 2 = 15회/초) */
  snapshotEvery?: number;
  /** 안전 상한(틱). 규칙이 경기를 끝내지 않아도 이 틱에서 끝낸다. 기본 5분 */
  maxTicks?: number;
  inputQueue?: InputQueueOptions;
}

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

export const DEFAULT_MAX_TICKS = TICK_RATE * 60 * 5;

export class Match {
  readonly sim: Sim;
  readonly info: MatchStartInfo;
  /** 사람 플레이어(봇 제외) */
  readonly humans: readonly MatchRosterEntry[];
  result: MatchResult | null = null;
  /** playerId → 계정 키(로그인한 사람만). 경기 결과를 계정에 반영할 때 쓴다 */
  readonly accounts = new Map<string, string>();
  /** 측정용: 마지막 snap 공통 본문 크기(바이트), 보낸 snap 수 */
  lastSnapBytes = 0;
  snapsSent = 0;
  private readonly queues = new Map<string, InputQueue>();
  private readonly roster: readonly MatchRosterEntry[];
  private readonly stats = new Map<EntityId, PlayerStats>();
  private events: SimEvent[] = [];
  /** 지금까지 부서진 벽(재접속한 사람에게 한 번에 알려준다) */
  private readonly brokenTiles = new Map<string, Vec2>();
  /** 다음 snap에 지금까지의 벽 파괴를 실어 보낼 사람(재접속) */
  private readonly needsWalls = new Set<string>();
  private readonly loop: FixedLoop;
  private readonly maxTicks: number;

  constructor(
    cfg: MatchConfig,
    private readonly hooks: MatchHooks,
  ) {
    const spawns = rosterSpawns(cfg.roster);
    this.sim = new Sim({ map: getMap(cfg.mapId), seed: cfg.seed, mode: cfg.mode, fighters: spawns, dummies: false });
    // Sim은 fighters 순서대로 파이터를 만든다
    this.roster = cfg.roster.map((r, i) => ({
      playerId: r.playerId,
      entityId: this.sim.units[i]!.id,
      name: r.name,
      team: r.team,
      fighterId: r.fighterId,
      bot: r.bot,
      ...(r.skin ? { skin: r.skin } : {}),
      ...(r.power && r.power > 1 ? { power: r.power } : {}),
    }));
    this.humans = this.roster.filter((r) => !r.bot);
    for (const r of cfg.roster) if (!r.bot && r.account) this.accounts.set(r.playerId, r.account);
    for (const h of this.humans) this.queues.set(h.playerId, new InputQueue(cfg.inputQueue));
    for (const r of this.roster) {
      this.stats.set(r.entityId, { playerId: r.playerId, name: r.name, fighterId: r.fighterId, ...(r.skin ? { skin: r.skin } : {}), team: r.team, kills: 0, deaths: 0, damage: 0 });
    }
    this.info = {
      seed: cfg.seed,
      mapId: cfg.mapId,
      mode: cfg.mode,
      roster: this.roster.map((r) => ({ ...r })),
      tickRate: TICK_RATE,
      snapshotEvery: Math.max(1, Math.round(cfg.snapshotEvery ?? 2)),
    };
    this.maxTicks = cfg.maxTicks ?? DEFAULT_MAX_TICKS;
    this.loop = new FixedLoop(1000 / TICK_RATE, () => this.safeStep());
  }

  get running(): boolean {
    return this.loop.isRunning;
  }

  /** delayMs 뒤부터 30틱/초로 진행(모두가 전투 화면을 준비할 시간) */
  start(delayMs = 0) {
    this.loop.start(delayMs);
  }

  stop() {
    this.loop.stop();
  }

  entityOf(playerId: string): EntityId | undefined {
    return this.roster.find((r) => r.playerId === playerId)?.entityId;
  }

  pushInput(playerId: string, msg: InputMsg) {
    const q = this.queues.get(playerId);
    if (!q) return;
    q.push({
      seq: msg.seq,
      move: quantizeMove(msg.move),
      ...(msg.attack !== undefined ? { attack: fromWireAim(msg.attack) } : {}),
      ...(msg.super !== undefined ? { super: fromWireAim(msg.super) } : {}),
      ...(msg.skill !== undefined ? { skill: fromWireAim(msg.skill) } : {}),
    });
  }

  /** 재접속: 이 플레이어의 입력을 처음부터(seq 0부터) 다시 받고, 다음 snap에 지금까지의 벽 파괴를 싣는다 */
  resetInput(playerId: string) {
    this.queues.get(playerId)?.reset();
    if (this.brokenTiles.size) this.needsWalls.add(playerId);
  }

  inputQueue(playerId: string): InputQueue | undefined {
    return this.queues.get(playerId);
  }

  private safeStep() {
    try {
      this.step();
    } catch (err) {
      this.hooks.onError?.(err);
      this.finish();
    }
  }

  /** 한 틱 진행(테스트에서는 직접 부른다) */
  step() {
    if (this.result) return;
    const inputs = new Map<EntityId, FighterInput>();
    for (const r of this.roster) {
      if (!r.bot && this.hooks.isConnected(r.playerId)) {
        inputs.set(r.entityId, this.queues.get(r.playerId)!.take());
      } else {
        if (!r.bot) this.queues.get(r.playerId)!.take(); // 밀린 입력은 버린다
        inputs.set(r.entityId, botInputFor(this.sim, r.entityId));
      }
    }
    const events = this.sim.step(inputs);
    this.track(events);
    for (const e of events) this.events.push(e);
    const over = this.sim.match.winner !== null || this.sim.tick >= this.maxTicks;
    if (over || this.sim.tick % this.info.snapshotEvery === 0) this.broadcastSnap();
    if (over) this.finish();
  }

  /** 지금 상태를 사람들에게 보낸다(공통 본문은 한 번만 문자열로 + 클라이언트별 ack) */
  broadcastSnap() {
    const state = {
      units: this.sim.units,
      projectiles: this.sim.projectiles,
      lobs: this.sim.lobs,
      crystals: this.sim.crystals ?? [],
      zones: this.sim.zones ?? [],
      ball: this.sim.ball ?? null,
      match: this.sim.match,
    };
    const body = JSON.stringify({ ...state, events: this.events }, roundReplacer).slice(1);
    this.lastSnapBytes = body.length + 40;
    this.snapsSent++;
    for (const h of this.humans) {
      if (!this.hooks.isConnected(h.playerId)) continue;
      const ack = this.queues.get(h.playerId)!.ack;
      let own = body;
      if (this.needsWalls.delete(h.playerId)) {
        const walls: SimEvent = { type: 'wallsBroken', tiles: [...this.brokenTiles.values()] };
        own = JSON.stringify({ ...state, events: [walls, ...this.events] }, roundReplacer).slice(1);
      }
      this.hooks.send(h.playerId, `{"t":"snap","snap":{"tick":${this.sim.tick},"ack":${ack},${own}}`);
    }
    this.events = [];
  }

  /** 경기 끝: 결과를 만들고 알린다. 규칙이 승자를 안 정했으면 점수로 */
  finish(): MatchResult {
    if (this.result) return this.result;
    this.loop.stop();
    const score: [number, number] = [this.sim.match.score[0], this.sim.match.score[1]];
    let winner = this.sim.match.winner;
    if (winner === null) winner = score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
    this.result = { winner: winner as Team | -1, score, stats: [...this.stats.values()].map((s) => ({ ...s })) };
    this.hooks.onEnd(this.result);
    return this.result;
  }

  /** 개인 기록: 피해량, 쓰러뜨린 수, 쓰러진 수 */
  private track(events: readonly SimEvent[]) {
    for (const e of events) {
      if (e.type === 'wallsBroken') for (const t of e.tiles) this.brokenTiles.set(`${t.x},${t.y}`, { x: t.x, y: t.y });
      if (e.type !== 'hit') continue;
      const src = this.stats.get(e.sourceId);
      const dst = this.stats.get(e.targetId);
      if (src && (!dst || dst.team !== src.team)) {
        src.damage += e.damage;
        if (e.killed) src.kills++;
      }
      if (dst && e.killed) dst.deaths++;
    }
  }
}
