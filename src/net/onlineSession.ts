import type { BattleLike } from '../battle/types';
import { getMap } from '../data/maps';
import { Sim } from '../game/sim';
import { TICK_DT, type Aim, type EntityId, type Fighter, type MatchState, type SimEvent, type SimView, type Vec2 } from '../game/types';
import { Grid, Tile, isInBush } from '../game/world';
import { BattleView } from '../render/battle/battleView';
import { ServerClock } from './clock';
import { Predictor } from './predict';
import type { ClientMsg, MatchResult, MatchStartInfo, Snapshot } from './protocol';
import { rosterSpawns } from './roster';
import { NetSimView, SnapshotBuffer } from './snapshots';
import { quantizeMove, toWireAim } from './wire';

/**
 * 온라인 전투 세션(BattleLike 구현). Network 담당.
 *
 * 시간 두 개를 쓴다.
 *  - 원격 시간(renderTick): 서버 틱 추정 − 보간 지연(기본 3틱 = 100ms, 지터가 크면 자동으로 늘림).
 *    다른 유닛·투사체·lob·사건은 이 시간으로 snap 사이를 보간해서 그린다.
 *  - 현재 시간: 내 캐릭터 이동은 입력 즉시 예측(Predictor)하고, snap의 ack로 보정한다.
 *    보정량과 예측↔원격 전환으로 생기는 위치 차이는 약 0.1초에 걸쳐 부드럽게 줄인다.
 *
 * 화면 갱신은 오프라인 BattleSession과 같다: 30틱/초 로컬 틱마다 view.snapshot(상태) → 사건 → 프레임마다 view.frame(보간).
 */

export interface SessionTransport {
  send(msg: ClientMsg): void;
  readonly connected: boolean;
}

export interface OnlineSessionOptions {
  /** 테스트용: 3D 화면 대신 쓸 것 */
  createView?: (grid: Grid, followId: EntityId) => BattleView;
  /** 시각(ms). 기본 performance.now */
  now?: () => number;
}

/** 이보다 크게 어긋나면 부드럽게 잇지 않고 바로 옮긴다(부활·넉백 등) */
const SMOOTH_MAX_DIST = 1.5;
/** 보정 차이를 줄이는 비율(틱마다, 시간 상수 0.1초) */
const SMOOTH_KEEP = Math.exp(-TICK_DT / 0.1);
/** 최신 snap보다 이만큼(틱)까지만 앞질러 그린다 */
const MAX_EXTRAPOLATE = 3;
/** 이보다 오래된 사건(틱)은 효과를 생략한다(탭이 멈췄다 돌아온 경우) */
const STALE_EVENT_TICKS = 30;

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

export interface NetStats {
  snaps: number;
  /** 보정이 일어난 횟수와 최대 보정 거리(타일) */
  corrections: number;
  maxCorrection: number;
  /** 지금 보간 지연(ms) */
  interpDelayMs: number;
  /** 지터 추정(ms) */
  jitterMs: number;
  /** 최신 snap을 지나 앞질러 그린 틱 수(버퍼 부족) */
  extrapolatedTicks: number;
  /** ack 안 된 입력 수 */
  pendingInputs: number;
}

export class OnlineSession implements BattleLike {
  readonly kind = 'online' as const;
  readonly view: BattleView;
  readonly playerId: EntityId;
  readonly controls: { move: Vec2 } = { move: { x: 0, y: 0 } };
  readonly info: MatchStartInfo;
  /** 클라이언트 쪽 맵(벽 파괴를 반영). 예측 충돌과 맵 렌더러가 쓴다 */
  readonly grid: Grid;
  onFrame: (() => void) | null = null;
  onEvents: ((events: readonly SimEvent[]) => void) | null = null;
  /** dispose될 때(클라이언트가 snap 전달을 멈춘다) */
  onDispose: (() => void) | null = null;
  /** end를 받았으면 결과 */
  result: MatchResult | null = null;
  disposed = false;

  private readonly transport: SessionTransport;
  private readonly now: () => number;
  private readonly buffer = new SnapshotBuffer();
  private readonly clock = new ServerClock();
  private readonly predictor: Predictor | null;
  private current: NetSimView;
  private started = false;
  private renderTick = 0;
  private acc = 0;
  private seq = 0;
  private pendingAttack: { aim: Aim } | null = null;
  private pendingSuper: { aim: Aim } | null = null;
  private readonly eventQueue: { tick: number; events: SimEvent[] }[] = [];
  private meOffset: Vec2 = { x: 0, y: 0 };
  private meShown: Vec2 | null = null;
  private meMode: 'pred' | 'remote' | null = null;
  private readonly netStats: NetStats = {
    snaps: 0,
    corrections: 0,
    maxCorrection: 0,
    interpDelayMs: 0,
    jitterMs: 0,
    extrapolatedTicks: 0,
    pendingInputs: 0,
  };

  constructor(info: MatchStartInfo, localPlayerId: string, transport: SessionTransport, opts: OnlineSessionOptions = {}) {
    this.info = info;
    this.transport = transport;
    this.now = opts.now ?? (() => performance.now());
    const map = getMap(info.mapId);
    this.grid = new Grid(map);
    const me = info.roster.find((r) => r.playerId === localPlayerId);
    this.playerId = me?.entityId ?? info.roster[0]?.entityId ?? -1;

    // 첫 snap 전에 보여줄 상태: 같은 시드·명단으로 만든 시뮬레이션의 0틱(서버와 출발 위치가 같다)
    const sim = new Sim({ map, seed: info.seed, mode: info.mode, fighters: rosterSpawns(info.roster), dummies: false });
    this.current = new NetSimView(
      0,
      sim.units.map((u) => ({ ...u, pos: { ...u.pos } })),
      [],
      [],
      { ...sim.match },
      sim.crystals.map((c) => ({ ...c })),
    );
    const meUnit = me ? sim.getUnit(me.entityId) : undefined;
    this.predictor = meUnit?.type === 'fighter' ? new Predictor(this.grid, meUnit.fighterId, meUnit.radius) : null;

    this.view = (opts.createView ?? ((g, id) => new BattleView(g, id)))(this.grid, this.playerId);
    const skins = new Map(info.roster.filter((r) => r.skin).map((r) => [r.entityId, r.skin!]));
    this.view.skinOf = (id) => skins.get(id);
    this.view.snapshot(this.current);
  }

  nameOf(id: EntityId): string | undefined {
    return this.info.roster.find((r) => r.entityId === id)?.name;
  }

  get scene() {
    return this.view.scene;
  }
  get camera() {
    return this.view.camera;
  }

  get state(): SimView {
    return this.current;
  }

  get match(): MatchState {
    return this.current.match;
  }

  get player(): Fighter {
    return this.current.getUnit(this.playerId) as Fighter;
  }

  /** 첫 snap을 받았는가(그 전에는 입력을 보내지 않는다) */
  get isStarted(): boolean {
    return this.started;
  }

  /** 동기화 상태(디버그·측정용) */
  get stats(): Readonly<NetStats> {
    this.netStats.pendingInputs = this.predictor?.pending.length ?? 0;
    return this.netStats;
  }

  queueAttack(aim: Aim) {
    this.pendingAttack = { aim };
  }

  queueSuper(aim: Aim) {
    this.pendingSuper = { aim };
  }

  resize(w: number, h: number) {
    this.view.resize(w, h);
  }

  update(t: number, dt: number) {
    if (this.disposed) return;
    if (this.started) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_DT && steps < 5) {
        this.localTick();
        this.acc -= TICK_DT;
        steps++;
      }
      if (steps >= 5) this.acc = 0;
    }
    this.view.frame(t, dt, this.started ? this.acc / TICK_DT : 1);
    this.onFrame?.();
  }

  // ───────────── 서버 → 세션 (OnlineClient가 부른다) ─────────────

  receiveSnap(snap: Snapshot) {
    if (this.disposed) return;
    const now = this.now();
    const buffered = {
      tick: snap.tick,
      units: snap.units,
      projectiles: snap.projectiles,
      lobs: snap.lobs,
      crystals: snap.crystals ?? [],
      zones: snap.zones ?? [],
      match: snap.match,
      events: snap.events,
    };
    if (!this.buffer.push(buffered)) {
      return;
    }
    this.clock.observe(snap.tick, now);
    this.netStats.snaps++;

    // 벽 파괴는 받자마자 격자에 반영(예측 충돌이 서버와 같아지도록). 부서지는 효과는 원격 시간에,
    // 이미 아는 칸(재접속 때 받는 지난 기록)은 효과 없이
    const mine: SimEvent[] = [];
    const later: SimEvent[] = [];
    for (const e of snap.events) {
      if (e.type === 'wallsBroken') {
        const fresh = e.tiles.filter((t) => this.grid.get(t.x, t.y) !== Tile.Floor);
        for (const t of fresh) this.grid.set(t.x, t.y, Tile.Floor);
        if (fresh.length) later.push({ type: 'wallsBroken', tiles: fresh });
        continue;
      }
      (this.isOwnAction(e) ? mine : later).push(e);
    }
    if (later.length) this.eventQueue.push({ tick: snap.tick, events: later });

    if (this.predictor) {
      const wasActive = this.predictor.active;
      const server = snap.units.find((u) => u.id === this.playerId);
      const corr = this.predictor.reconcile(snap.ack, server?.type === 'fighter' ? server : undefined);
      if (corr && wasActive && this.meMode === 'pred') {
        const d = Math.hypot(corr.x, corr.y);
        if (d > 1e-4) {
          this.netStats.corrections++;
          this.netStats.maxCorrection = Math.max(this.netStats.maxCorrection, d);
        }
        if (d < SMOOTH_MAX_DIST) {
          this.meOffset = { x: this.meOffset.x - corr.x, y: this.meOffset.y - corr.y };
        } else {
          this.meOffset = { x: 0, y: 0 };
        }
      }
    }

    if (!this.started) {
      this.started = true;
      this.acc = 0;
      this.renderTick = this.clock.serverTick(now) - this.interpDelayTicks();
      this.current = this.buildState();
      this.view.snapshot(this.current);
    }
    // 내 공격·궁극기 동작은 기다리지 않고 바로(내 캐릭터는 현재 시간에 그려지므로)
    if (mine.length) this.emit(mine);
  }

  /** 경기 끝(end). 입력을 멈추고, 남은 사건은 원격 시간에 맞춰 마저 보여준다 */
  end(result: MatchResult) {
    this.result = result;
  }

  /** 재접속으로 같은 경기에 다시 붙었다: 버퍼·예측을 비우고 다음 snap부터 다시 맞춘다 */
  resync() {
    this.buffer.clear();
    this.clock.reset();
    this.eventQueue.length = 0;
    this.predictor?.reset();
    this.started = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.onFrame = null;
    this.onEvents = null;
    this.view.dispose();
    const cb = this.onDispose;
    this.onDispose = null;
    cb?.();
  }

  // ───────────── 로컬 틱 ─────────────

  private localTick() {
    const now = this.now();
    const attack = this.pendingAttack;
    const sup = this.pendingSuper;
    this.pendingAttack = null;
    this.pendingSuper = null;
    if (!this.result && this.transport.connected) {
      const move = quantizeMove(this.controls.move);
      const msg: InputMsg = { t: 'input', seq: ++this.seq, move };
      if (attack) msg.attack = toWireAim(attack.aim);
      if (sup) msg.super = toWireAim(sup.aim);
      this.transport.send(msg);
      this.predictor?.applyLocal(this.seq, move);
    }

    // 원격 시간: 한 틱씩 진행하면서 목표(서버 추정 − 지연)에 천천히 맞춘다
    const target = this.clock.serverTick(now) - this.interpDelayTicks();
    this.renderTick += 1;
    const err = target - this.renderTick;
    if (Math.abs(err) > 8) this.renderTick = target;
    else this.renderTick += err * 0.1;
    const latest = this.buffer.latest;
    if (latest && this.renderTick > latest.tick) {
      this.netStats.extrapolatedTicks++;
      if (this.renderTick > latest.tick + MAX_EXTRAPOLATE) this.renderTick = latest.tick + MAX_EXTRAPOLATE;
    }

    this.current = this.buildState();
    this.view.snapshot(this.current);
    this.releaseEvents();
  }

  private interpDelayTicks(): number {
    const d = Math.min(7, Math.max(3, this.info.snapshotEvery + 1 + this.clock.jitterTicks));
    this.netStats.interpDelayMs = Math.round(d * TICK_DT * 1000);
    this.netStats.jitterMs = Math.round(this.clock.jitterTicks * TICK_DT * 1000);
    return d;
  }

  /** 원격 시간의 보간 상태 + 내 캐릭터(예측) */
  private buildState(): NetSimView {
    const s = this.buffer.sample(this.renderTick, MAX_EXTRAPOLATE);
    if (!s) return this.current;
    const remote = s.getUnit(this.playerId);
    if (remote?.type === 'fighter') s.replaceUnit(this.myUnit(remote));
    return s;
  }

  private myUnit(remote: Fighter): Fighter {
    const latest = this.buffer.latest?.units.find((u) => u.id === this.playerId);
    const latestF = latest?.type === 'fighter' ? latest : remote;
    const pred = this.predictor;
    const mode = pred?.active ? 'pred' : 'remote';
    const target = pred && mode === 'pred' ? pred.pos : remote.pos;
    if (mode !== this.meMode) {
      const shown = this.meShown;
      this.meOffset =
        shown && Math.hypot(shown.x - target.x, shown.y - target.y) < SMOOTH_MAX_DIST
          ? { x: shown.x - target.x, y: shown.y - target.y }
          : { x: 0, y: 0 };
      this.meMode = mode;
    } else {
      this.meOffset = { x: this.meOffset.x * SMOOTH_KEEP, y: this.meOffset.y * SMOOTH_KEEP };
      if (Math.hypot(this.meOffset.x, this.meOffset.y) > SMOOTH_MAX_DIST) this.meOffset = { x: 0, y: 0 };
    }
    const pos = { x: target.x + this.meOffset.x, y: target.y + this.meOffset.y };
    this.meShown = pos;
    // HUD가 쓰는 탄약·궁극기 게이지는 가장 최근 서버 값
    const base: Fighter = { ...remote, pos, ammo: latestF.ammo, superCharge: latestF.superCharge };
    if (pred && mode === 'pred') {
      base.facing = pred.facing;
      base.moving = pred.moving;
      base.inBush = isInBush(this.grid, pos);
      base.action = latestF.action;
    }
    return base;
  }

  /** 내가 한 공격·근접·탄약 없음·궁극기 준비: 바로 보여준다 */
  private isOwnAction(e: SimEvent): boolean {
    switch (e.type) {
      case 'attack':
      case 'melee':
      case 'noAmmo':
      case 'superReady':
        return e.unitId === this.playerId;
      default:
        return false;
    }
  }

  private releaseEvents() {
    while (this.eventQueue.length && this.eventQueue[0]!.tick <= this.renderTick + 1e-6) {
      const { tick, events } = this.eventQueue.shift()!;
      if (this.renderTick - tick > STALE_EVENT_TICKS) {
        const keep = events.filter((e) => e.type === 'score' || e.type === 'matchEnd');
        if (keep.length) this.onEvents?.(keep);
        continue;
      }
      this.emit(events);
    }
  }

  private emit(events: SimEvent[]) {
    this.view.applyEvents(events);
    this.onEvents?.(events);
  }
}
