import type { FighterId } from '../data/fighters';
import { Sim } from '../game/sim';
import { TICK_DT, type Aim, type EntityId, type Fighter, type FighterInput, type MatchMode, type MatchState, type SimEvent, type SimView, type Vec2 } from '../game/types';
import type { MapDef } from '../game/world';
import { BattleView } from '../render/battle/battleView';
import type { BattleLike } from './types';

/**
 * 전투 한 판을 진행한다. Lead 담당.
 * - 화면 프레임과 무관하게 30틱/초 고정으로 시뮬레이션을 진행하고, 사이는 보간해서 그린다.
 * - UI(조작부)는 controls.move를 매 프레임 갱신하고, 공격·궁극기는 queueAttack/queueSuper로 넣는다.
 * - 3단계(온라인)에서는 이 클래스가 서버로 입력을 보내고 서버 상태를 받는 쪽으로 바뀐다.
 */
export interface BattleOptions {
  fighterId: FighterId;
  map: MapDef;
  seed?: number;
  mode?: MatchMode;
}

export class BattleSession implements BattleLike {
  readonly kind = 'local' as const;
  readonly sim: Sim;
  readonly view: BattleView;
  readonly playerId: EntityId;
  /** 이동 입력(길이 0~1). UI가 매 프레임 쓴다 */
  readonly controls: { move: Vec2 } = { move: { x: 0, y: 0 } };
  /** 매 프레임 HUD 갱신용 */
  onFrame: (() => void) | null = null;
  /** 틱마다 나온 사건(피해 숫자, 효과음 등) */
  onEvents: ((events: readonly SimEvent[]) => void) | null = null;

  private acc = 0;
  private pendingAttack: { aim: Aim } | null = null;
  private pendingSuper: { aim: Aim } | null = null;

  constructor(opts: BattleOptions) {
    this.sim = new Sim({
      map: opts.map,
      seed: opts.seed ?? 1,
      mode: opts.mode,
      dummies: (opts.mode ?? 'training') === 'training',
      fighters: [{ fighterId: opts.fighterId, team: 0, controller: 'player', spawnIndex: 0 }],
    });
    this.playerId = this.sim.units[0]!.id;
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
    return this.sim;
  }

  get match(): MatchState {
    return this.sim.match;
  }

  get player(): Fighter {
    return this.sim.getUnit(this.playerId) as Fighter;
  }

  /** 다음 틱에 기본 공격. aim=null이면 자동 조준 */
  queueAttack(aim: Aim) {
    this.pendingAttack = { aim };
  }

  /** 다음 틱에 궁극기. aim=null이면 자동 조준 */
  queueSuper(aim: Aim) {
    this.pendingSuper = { aim };
  }

  resize(w: number, h: number) {
    this.view.resize(w, h);
  }

  update(t: number, dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_DT && steps < 5) {
      const input: FighterInput = { move: { ...this.controls.move } };
      if (this.pendingAttack) input.attack = this.pendingAttack;
      if (this.pendingSuper) input.super = this.pendingSuper;
      this.pendingAttack = null;
      this.pendingSuper = null;
      const events = this.sim.step(new Map([[this.playerId, input]]));
      this.view.snapshot(this.sim);
      this.view.applyEvents(events);
      if (events.length) this.onEvents?.(events);
      this.acc -= TICK_DT;
      steps++;
    }
    if (steps >= 5) this.acc = 0; // 너무 밀리면(탭 전환 등) 따라잡기를 포기한다
    this.view.frame(t, dt, this.acc / TICK_DT);
    this.onFrame?.();
  }

  dispose() {
    this.onFrame = null;
    this.onEvents = null;
    this.view.dispose();
  }
}
