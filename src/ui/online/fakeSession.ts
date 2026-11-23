import type { BattleLike } from '../../battle/types';
import { getMap } from '../../data/maps';
import { botInput } from '../../game/bot';
import { Sim } from '../../game/sim';
import {
  TICK_DT,
  TICK_RATE,
  type Aim,
  type EntityId,
  type Fighter,
  type FighterInput,
  type MatchState,
  type SimEvent,
  type SimView,
  type Team,
  type Vec2,
} from '../../game/types';
import type { MatchStartInfo } from '../../net/protocol';
import { BattleView } from '../../render/battle/battleView';

/**
 * 가짜 온라인 경기(?fakeonline 전용, 화면 확인용). 서버 없이 이 탭 안에서 Sim을 돌린다.
 * - 나 말고는 Gameplay의 봇(src/game/bot.ts).
 * - teamfight 규칙(점수·시간·승패)은 Sim이 아직 모르면 여기서 흉내 낸다.
 */
export interface FakeStats {
  kills: number;
  deaths: number;
  damage: number;
}


export class FakeOnlineSession implements BattleLike {
  readonly kind = 'online' as const;
  readonly view: BattleView;
  readonly playerId: EntityId;
  readonly controls: { move: Vec2 } = { move: { x: 0, y: 0 } };
  onFrame: (() => void) | null = null;
  onEvents: ((events: readonly SimEvent[]) => void) | null = null;
  /** 경기가 끝나면 한 번 */
  onFinish: ((match: MatchState, stats: Map<EntityId, FakeStats>) => void) | null = null;
  readonly stats = new Map<EntityId, FakeStats>();

  private readonly sim: Sim;
  private readonly ownRules: boolean;
  private readonly ownMatch: MatchState;
  private readonly view_: SimView;
  private readonly names = new Map<EntityId, string>();
  private acc = 0;
  private finished = false;
  private pendingAttack: { aim: Aim } | null = null;
  private pendingSuper: { aim: Aim } | null = null;

  nameOf(id: EntityId): string | undefined {
    return this.names.get(id);
  }

  constructor(info: MatchStartInfo, myEntityId: EntityId, seconds: number) {
    const perTeam: [number, number] = [0, 0];
    this.sim = new Sim({
      map: getMap(info.mapId),
      seed: info.seed,
      mode: info.mode,
      dummies: false,
      fighters: info.roster.map((r) => ({
        fighterId: r.fighterId,
        team: r.team,
        controller: r.entityId === myEntityId ? ('player' as const) : ('bot' as const),
        spawnIndex: perTeam[r.team]++,
        power: r.power,
      })),
    });
    this.playerId = myEntityId;
    info.roster.forEach((r, i) => {
      const u = this.sim.units[i];
      if (u) this.names.set(u.id, r.name);
    });
    for (const u of this.sim.units) this.stats.set(u.id, { kills: 0, deaths: 0, damage: 0 });
    // Sim이 teamfight 규칙을 이미 돌리면 그것을, 아니면 여기서 흉내 낸 것을 쓴다
    this.ownRules = this.sim.match.mode !== info.mode;
    this.ownMatch = { mode: info.mode, score: [0, 0], targetScore: 10, ticksLeft: Math.round(seconds * TICK_RATE), winner: null };
    const sim = this.sim;
    const self = this;
    this.view_ = {
      get match() {
        return self.match;
      },
      get crystals() {
        return sim.crystals;
      },
      get zones() {
        return sim.zones;
      },
      get tick() {
        return sim.tick;
      },
      get units() {
        return sim.units;
      },
      get projectiles() {
        return sim.projectiles;
      },
      get lobs() {
        return sim.lobs;
      },
      getUnit: (id) => sim.getUnit(id),
    };
    this.view = new BattleView(this.sim.grid, this.playerId);
    this.view.snapshot(this.sim);
  }

  get scene() {
    return this.view.scene;
  }
  get camera() {
    return this.view.camera;
  }
  get state(): SimView {
    return this.view_;
  }
  get match(): MatchState {
    return this.ownRules ? this.ownMatch : this.sim.match;
  }
  get player(): Fighter {
    return this.sim.getUnit(this.playerId) as Fighter;
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

  /** 지금 점수로 바로 끝낸다(스크린샷용). demo면 그럴듯한 점수·기록을 채운다 */
  finish(demo = false) {
    if (this.finished) return;
    if (demo) {
      const myTeam = this.player.team;
      this.ownMatch.score = myTeam === 0 ? [10, 7] : [7, 10];
      let i = 0;
      for (const u of this.sim.units) {
        const s = this.stats.get(u.id)!;
        const mine = u.team === myTeam;
        s.kills = mine ? [4, 3, 3][i % 3]! : [3, 2, 2][i % 3]!;
        s.deaths = mine ? [2, 3, 2][i % 3]! : [4, 3, 3][i % 3]!;
        s.damage = (mine ? 9000 : 6500) + ((i * 2371) % 4000);
        i++;
      }
    }
    const m = this.ownMatch;
    m.winner = m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1;
    if (!this.ownRules) this.sim.match = { ...m };
    this.end();
  }

  update(t: number, dt: number) {
    this.acc += dt;
    let steps = 0;
    while (!this.finished && this.acc >= TICK_DT && steps < 5) {
      const inputs = new Map<EntityId, FighterInput>();
      const mine: FighterInput = { move: { ...this.controls.move } };
      if (this.pendingAttack) mine.attack = this.pendingAttack;
      if (this.pendingSuper) mine.super = this.pendingSuper;
      this.pendingAttack = null;
      this.pendingSuper = null;
      inputs.set(this.playerId, mine);
      for (const u of this.sim.units) if (u.type === 'fighter' && u.id !== this.playerId && u.alive) inputs.set(u.id, botInput(this.sim, u.id));
      const events = this.sim.step(inputs);
      this.tally(events);
      this.view.snapshot(this.sim);
      this.view.applyEvents(events);
      if (events.length) this.onEvents?.(events);
      if (this.match.winner !== null) this.end();
      this.acc -= TICK_DT;
      steps++;
    }
    if (steps >= 5) this.acc = 0;
    this.view.frame(t, dt, this.finished ? 1 : this.acc / TICK_DT);
    this.onFrame?.();
  }

  dispose() {
    this.onFrame = null;
    this.onEvents = null;
    this.onFinish = null;
    this.finished = true;
    this.view.dispose();
  }

  private end() {
    if (this.finished) return;
    this.finished = true;
    this.onFinish?.(this.match, this.stats);
  }

  /** 기록 집계 + (Sim이 모르면) 점수·시간 규칙 */
  private tally(events: SimEvent[]) {
    const extra: SimEvent[] = [];
    for (const e of events) {
      if (e.type === 'hit') {
        const src = this.sim.getUnit(e.sourceId);
        const dst = this.sim.getUnit(e.targetId);
        if (src && dst && src.team !== dst.team) {
          this.stats.get(src.id)!.damage += e.damage;
          if (e.killed) {
            this.stats.get(src.id)!.kills++;
            if (this.ownRules) {
              const team = src.team as Team;
              this.ownMatch.score[team]++;
              extra.push({ type: 'score', team, score: [...this.ownMatch.score] as [number, number], killerId: src.id, victimId: dst.id });
            }
          }
        }
      } else if (e.type === 'death') {
        const s = this.stats.get(e.unitId);
        if (s) s.deaths++;
      }
    }
    if (this.ownRules) {
      const m = this.ownMatch;
      m.ticksLeft = Math.max(0, m.ticksLeft - 1);
      if (m.score[0] >= m.targetScore || m.score[1] >= m.targetScore || m.ticksLeft === 0) {
        m.winner = m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1;
        extra.push({ type: 'matchEnd', winner: m.winner, score: [...m.score] as [number, number] });
      }
    }
    events.push(...extra);
  }
}
