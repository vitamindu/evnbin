/**
 * 전투 시뮬레이션 공용 계약(Contract). Lead가 관리한다. 바꿔야 하면 Lead에게 먼저 보고한다.
 *
 * 좌표계: 평면 (x, y), 단위는 타일. x는 오른쪽, y는 화면 아래쪽(3D에서는 +z)으로 증가.
 * 각도: 라디안, +x 방향이 0, +y(화면 아래) 방향이 +π/2.
 * 시간: 틱(1/30초). 이 폴더(src/game/)는 DOM·Three.js를 import하지 않는다(서버에서도 실행).
 */
import type { FighterId } from '../data/fighters';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 0 | 1;
export type EntityId = number;

/** 누가 조종하는가 */
export type ControllerKind = 'player' | 'bot';

/** 연습용 더미의 행동 */
export type DummyBehavior = 'idle' | 'patrol' | 'turret';

/** 피해를 받을 수 있는 개체의 공통 필드 */
export interface UnitBase {
  id: EntityId;
  team: Team;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** alive=false일 때 다시 나타나는 틱 */
  respawnTick: number;
  /** 처음 나타난 위치(부활 지점) */
  spawn: Vec2;
  /** 바라보는 방향(라디안) */
  facing: number;
  /** 마지막으로 공격하거나 맞은 틱(체력 회복 판정) */
  lastCombatTick: number;
}

export interface Fighter extends UnitBase {
  type: 'fighter';
  fighterId: FighterId;
  controller: ControllerKind;
  /** 0..maxAmmo. 소수 부분 = 다음 칸 재장전 진행도 */
  ammo: number;
  maxAmmo: number;
  /** 궁극기 게이지 0..1 */
  superCharge: number;
  /** 수풀 안에 있는가 */
  inBush: boolean;
  /** 이 틱까지는 수풀 안이어도 적에게 보인다(공격하면 잠깐 노출) */
  revealedUntil: number;
  /** 이번 틱에 이동했는가(걷기 애니메이션용) */
  moving: boolean;
  /**
   * 진행 중인 행동.
   * - burst: 이동은 가능, 끝날 때까지 새 공격·궁극기 불가
   * - dash, knockback: 이동 입력 무시, 공격 불가
   * - leap: 공중 점프. 이동·공격 불가, 피해를 받지 않는다. pos는 from→to로 직선 이동(높이는 렌더러가 그림)
   */
  action: FighterAction | null;
}

export type FighterAction =
  | { kind: 'burst'; remaining: number; nextTick: number; dir: number; isSuper: boolean }
  | { kind: 'dash'; dir: number; remaining: number; speed: number; hitIds: EntityId[] }
  | { kind: 'knockback'; vx: number; vy: number; untilTick: number }
  | { kind: 'leap'; from: Vec2; to: Vec2; startTick: number; endTick: number };

export interface Dummy extends UnitBase {
  type: 'dummy';
  behavior: DummyBehavior;
  /** patrol: 왕복 기준점과 진행 방향, turret: 다음 발사 틱 등 행동별 상태 */
  patrolFrom?: Vec2;
  patrolTo?: Vec2;
  patrolForward?: boolean;
  nextFireTick?: number;
}

export type Unit = Fighter | Dummy;

/** 직선 투사체 */
export interface Projectile {
  id: EntityId;
  type: 'projectile';
  ownerId: EntityId;
  team: Team;
  pos: Vec2;
  /** 타일/초 */
  vel: Vec2;
  radius: number;
  damage: number;
  /** 남은 비행 거리(타일) */
  remaining: number;
  isSuper: boolean;
  breaksWalls: boolean;
  /** 넉백 거리(타일), 0이면 없음 */
  knockback: number;
  /** 거리 비례 피해: 사거리 끝까지 날아갔을 때의 피해량. 없으면 damage 고정 */
  damageFar?: number;
  /** 전체 사거리(거리 비례 피해 계산용) */
  range?: number;
  /** 관통 여부. true면 hitIds에 있는 대상은 다시 맞히지 않는다 */
  pierce: boolean;
  hitIds: EntityId[];
}

/** 벽을 넘는 포물선 투사체. 끝 틱에 to 지점 범위 피해 */
export interface Lob {
  id: EntityId;
  type: 'lob';
  ownerId: EntityId;
  team: Team;
  from: Vec2;
  to: Vec2;
  startTick: number;
  endTick: number;
  damage: number;
  aoeRadius: number;
  isSuper: boolean;
  breaksWalls: boolean;
}

/** 조준 입력: 길이 0~1 벡터(방향 + 사거리 비율). null이면 자동 조준 */
export type Aim = Vec2 | null;

/** 한 틱 동안 한 파이터에게 들어가는 입력 */
export interface FighterInput {
  /** 이동 방향, 길이 0~1 */
  move: Vec2;
  /** 이번 틱에 기본 공격 발동 */
  attack?: { aim: Aim };
  /** 이번 틱에 궁극기 발동 */
  super?: { aim: Aim };
}

/** 시뮬레이션이 매 틱 내보내는 사건(렌더링·효과음·HUD용) */
export type SimEvent =
  | { type: 'attack'; unitId: EntityId; isSuper: boolean; dir: number }
  | { type: 'melee'; unitId: EntityId; isSuper: boolean; dir: number; range: number; spreadDeg: number }
  | { type: 'hit'; targetId: EntityId; sourceId: EntityId; damage: number; pos: Vec2; isSuper: boolean; killed: boolean }
  | { type: 'death'; unitId: EntityId; pos: Vec2 }
  | { type: 'respawn'; unitId: EntityId }
  | { type: 'wallsBroken'; tiles: Vec2[] }
  | { type: 'explode'; pos: Vec2; radius: number; isSuper: boolean }
  | { type: 'projectileEnd'; id: EntityId; pos: Vec2; reason: 'wall' | 'range' | 'hit' }
  | { type: 'superReady'; unitId: EntityId }
  | { type: 'noAmmo'; unitId: EntityId }
  | { type: 'score'; team: Team; score: [number, number]; killerId: EntityId; victimId: EntityId }
  | { type: 'matchEnd'; winner: Team | -1; score: [number, number] };

/** 시뮬레이션 시작 설정 */
export interface SpawnFighter {
  fighterId: FighterId;
  team: Team;
  controller: ControllerKind;
  /** 맵의 팀 출발 지점 번호 */
  spawnIndex: number;
}

/** 경기 방식. training: 연습장(끝 없음), teamfight: 3대3 쓰러뜨리기 대결 */
export type MatchMode = 'training' | 'teamfight';

/** 경기 진행 상태(점수판·타이머용) */
export interface MatchState {
  mode: MatchMode;
  /** 팀별 점수. teamfight: 상대를 쓰러뜨린 수 */
  score: [number, number];
  /** 이 점수에 먼저 닿으면 승리. 0이면 없음 */
  targetScore: number;
  /** 남은 시간(틱). -1이면 무제한 */
  ticksLeft: number;
  /** 진행 중이면 null, 끝나면 이긴 팀(무승부 -1) */
  winner: Team | -1 | null;
}

/** 시뮬레이션 상태 조회(렌더러·UI는 이 인터페이스만 쓴다) */
export interface SimView {
  readonly match: MatchState;
  readonly tick: number;
  readonly units: readonly Unit[];
  readonly projectiles: readonly Projectile[];
  readonly lobs: readonly Lob[];
  getUnit(id: EntityId): Unit | undefined;
}
