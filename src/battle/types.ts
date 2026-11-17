import type { Aim, EntityId, Fighter, MatchState, SimEvent, SimView, Vec2 } from '../game/types';
import type { BattleView } from '../render/battle/battleView';
import type { View } from '../render/stage';

/**
 * 전투 화면(UI)이 쓰는 전투 세션 계약. Lead 관리.
 * - 오프라인(연습장): src/battle/session.ts 의 BattleSession
 * - 온라인(3단계): src/net/ 의 네트워크 세션
 * UI는 이 인터페이스만 쓴다(sim을 직접 만지지 않는다).
 */
export interface BattleLike extends View {
  readonly kind: 'local' | 'online';
  readonly view: BattleView;
  readonly playerId: EntityId;
  /** 현재 상태(오프라인은 시뮬레이션 그 자체, 온라인은 서버 상태를 보간한 사본) */
  readonly state: SimView;
  readonly player: Fighter;
  readonly match: MatchState;
  /** 이동 입력(길이 0~1). UI가 매 프레임 쓴다 */
  readonly controls: { move: Vec2 };
  queueAttack(aim: Aim): void;
  queueSuper(aim: Aim): void;
  onFrame: (() => void) | null;
  onEvents: ((events: readonly SimEvent[]) => void) | null;
  dispose(): void;
}
