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
  /** 캐릭터 레벨(1~11). 체력·피해량 배율은 powerMult */
  power?: number;
  /** 0..maxAmmo. 소수 부분 = 다음 칸 재장전 진행도 */
  ammo: number;
  maxAmmo: number;
  /** 궁극기 게이지 0..1 */
  superCharge: number;
  /** Chainer: 기본 공격에 쓸 사슬 원형 타격 중첩 */
  passiveStacks?: number;
  /** Chainer 콤보: E1을 쓴 뒤 E2 대기('chain') → 사슬 비행('chainFlight') → 적중 뒤 W 대기('w'). 없으면 E1 단계 */
  chainSkillPhase?: 'chain' | 'chainFlight' | 'w';
  /** E2·W 대기가 끝나는 틱(넘기면 콤보 종료) */
  chainSkillUntilTick?: number;
  /** Chainer E1 재사용 가능 틱(콤보가 끝난 뒤부터 센다) */
  chainSkillReadyTick?: number;
  /** Chainer 궁극기로 복사한 파이터. 만료 때 지운다 */
  copiedSuperId?: FighterId;
  copiedSuperExpiresTick?: number;
  /** 기절 종료 틱 */
  stunnedUntilTick?: number;
  /** 수풀 안에 있는가 */
  inBush: boolean;
  /** 이 틱까지는 수풀 안이어도 적에게 보인다(공격하면 잠깐 노출) */
  revealedUntil: number;
  /** crystal: 들고 있는 크리스탈 수 */
  crystals?: number;
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
  | { kind: 'burst'; remaining: number; nextTick: number; dir: number; isSuper: boolean; superSourceId?: FighterId }
  | { kind: 'dash'; dir: number; remaining: number; speed: number; hitIds: EntityId[]; /** 없으면 궁극기(옛 스냅샷 호환) */ isSuper?: boolean; superSourceId?: FighterId }
  | { kind: 'chainDash'; dir: number; remaining: number; speed: number }
  | { kind: 'knockback'; vx: number; vy: number; untilTick: number }
  | { kind: 'leap'; from: Vec2; to: Vec2; startTick: number; endTick: number; superSourceId?: FighterId };

export interface Dummy extends UnitBase {
  type: 'dummy';
  behavior: DummyBehavior;
  /** patrol: 왕복 기준점과 진행 방향, turret: 다음 발사 틱 등 행동별 상태 */
  patrolFrom?: Vec2;
  patrolTo?: Vec2;
  patrolForward?: boolean;
  /** patrol 방향: 'x' 좌우(기본), 'y' 위아래 */
  patrolAxis?: 'x' | 'y';
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
  /** 복사한 궁극기의 출처. 후속 피해 특성(예: 흡혈)을 읽는다 */
  superSourceId?: FighterId;
  /** Chainer E 사슬: 적중 시 기절하고 W를 연다 */
  chainSkill?: boolean;
  /** Chainer 궁극기 사슬 */
  stealsSuper?: boolean;
  breaksWalls: boolean;
  /** 넉백 거리(타일), 0이면 없음 */
  knockback: number;
  /** 같은 한 번의 공격(산탄 한 번, 연사 한 번)에서 나간 탄들의 묶음 번호. 넉백은 묶음마다 한 번만 */
  groupId?: number;
  /** 거리 비례 피해: 사거리 끝까지 날아갔을 때의 피해량. 없으면 damage 고정 */
  damageFar?: number;
  /** 전체 사거리(거리 비례 피해 계산용) */
  range?: number;
  /** 관통 여부. true면 hitIds에 있는 대상은 다시 맞히지 않는다 */
  pierce: boolean;
  /** 남은 튕김 횟수. 있고 0보다 크면 벽(부서지지 않은 벽·단단한 벽·맵 끝)에서 반사되어 남은 사거리만큼 더 간다 */
  bounces?: number;
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
  /** 터지는 틱 */
  endTick: number;
  /** 땅에 떨어지는 틱(있으면 그때부터 endTick까지 바닥에서 깜빡인다). 없으면 endTick에 떨어지자마자 터진다 */
  landTick?: number;
  damage: number;
  aoeRadius: number;
  isSuper: boolean;
  superSourceId?: FighterId;
  breaksWalls: boolean;
  /** 사슬 내려치기(Chainer Q): 날아가는 탄 대신 바닥 한 지점을 내리친다. 터질 때 벽 너머는 안 맞는다 */
  slam?: boolean;
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
  /** 이번 틱에 Chainer E/W 스킬 발동 */
  skill?: { aim: Aim };
}

/** 시뮬레이션이 매 틱 내보내는 사건(렌더링·효과음·HUD용) */
export type SimEvent =
  | { type: 'attack'; unitId: EntityId; isSuper: boolean; dir: number }
  | { type: 'melee'; unitId: EntityId; isSuper: boolean; dir: number; range: number; spreadDeg: number }
  | { type: 'hit'; targetId: EntityId; sourceId: EntityId; damage: number; pos: Vec2; isSuper: boolean; killed: boolean }
  | { type: 'heal'; targetId: EntityId; amount: number; pos: Vec2 }
  | { type: 'death'; unitId: EntityId; pos: Vec2 }
  | { type: 'respawn'; unitId: EntityId }
  | { type: 'wallsBroken'; tiles: Vec2[] }
  | { type: 'explode'; pos: Vec2; radius: number; isSuper: boolean }
  | { type: 'projectileEnd'; id: EntityId; pos: Vec2; reason: 'wall' | 'range' | 'hit' }
  | { type: 'superReady'; unitId: EntityId }
  | { type: 'superCopied'; unitId: EntityId; sourceId: EntityId; fighterId: FighterId; expiresTick: number }
  | { type: 'superCopyExpired'; unitId: EntityId }
  | { type: 'stun'; unitId: EntityId; untilTick: number }
  | { type: 'noAmmo'; unitId: EntityId }
  | { type: 'score'; team: Team; score: [number, number]; killerId: EntityId; victimId: EntityId }
  | { type: 'matchEnd'; winner: Team | -1; score: [number, number] }
  | { type: 'crystalSpawn'; id: EntityId; pos: Vec2 }
  | { type: 'goal'; team: Team; score: [number, number]; scorerId: EntityId | null }
  | { type: 'ballPickup'; unitId: EntityId }
  | { type: 'ballKick'; unitId: EntityId; isSuper: boolean; dir: number }
  | { type: 'ballDrop'; unitId: EntityId; pos: Vec2 }
  | { type: 'crystalPickup'; unitId: EntityId; crystalId: EntityId; carried: number }
  | { type: 'crystalDrop'; unitId: EntityId; pos: Vec2; count: number }
  | { type: 'countdown'; team: Team | null; ticks: number };

/** 시뮬레이션 시작 설정 */
export interface SpawnFighter {
  fighterId: FighterId;
  team: Team;
  controller: ControllerKind;
  /** 맵의 팀 출발 지점 번호 */
  spawnIndex: number;
  /** 캐릭터 레벨 1~11(src/data/power.ts). 체력·피해량 배율. 없으면 1 */
  power?: number;
}

/** 경기 방식. training: 연습장(끝 없음), teamfight: 3대3 쓰러뜨리기 대결 */
export type MatchMode = 'training' | 'teamfight' | 'crystal' | 'ball';

/** 바닥에 일정 시간 남는 지대(SHARD 궁극기 등): 안의 적을 느리게 하고 초당 피해 */
export interface Zone {
  id: EntityId;
  type: 'zone';
  ownerId: EntityId;
  team: Team;
  pos: Vec2;
  radius: number;
  untilTick: number;
  /** 이동 속도 감소 비율(0~1) */
  slow: number;
  dps: number;
  superSourceId?: FighterId;
}

/**
 * 파이터 볼: 공 하나. 누군가 들고 있으면(carrierId) 그 사람과 같이 움직이고, 아니면 굴러간다(vel, 마찰로 멈춤, 벽에 튕김).
 */
export interface Ball {
  id: EntityId;
  type: 'ball';
  pos: Vec2;
  vel: Vec2;
  carrierId: EntityId | null;
  /** 이 틱 전에는 kickerId가 다시 주울 수 없다(찬 직후 바로 다시 줍지 않게) */
  noPickupUntil: number;
  kickerId: EntityId | null;
}

/** 크리스탈 러시: 바닥에 놓인 크리스탈 */
export interface Crystal {
  id: EntityId;
  type: 'crystal';
  pos: Vec2;
}

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
  /** crystal: 팀별로 들고 있는 크리스탈 합계 */
  crystals?: [number, number];
  /** crystal: 승리 카운트다운 남은 틱(-1이면 진행 안 함)과 그 팀 */
  countdownTicks?: number;
  countdownTeam?: Team | null;
  /** ball: 골이 들어간 뒤 다시 시작(킥오프)까지 남은 틱. 0보다 크면 모두 멈춘다 */
  kickoffTicks?: number;
}

/** 시뮬레이션 상태 조회(렌더러·UI는 이 인터페이스만 쓴다) */
export interface SimView {
  readonly match: MatchState;
  readonly tick: number;
  readonly units: readonly Unit[];
  readonly projectiles: readonly Projectile[];
  readonly lobs: readonly Lob[];
  /** 크리스탈 러시가 아니면 빈 배열 */
  readonly crystals: readonly Crystal[];
  /** 지대(서리 지대 등). 없으면 빈 배열 */
  readonly zones: readonly Zone[];
  /** 파이터 볼의 공(다른 모드는 null) */
  readonly ball: Ball | null;
  getUnit(id: EntityId): Unit | undefined;
}
