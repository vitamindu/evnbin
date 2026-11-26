import type { FighterId } from '../data/fighters';
import { TICK_RATE } from './types';

/**
 * 캐릭터와 무관한 전투 규칙 수치. Gameplay 담당.
 * 캐릭터별 수치는 src/data/fighters.ts, 설명은 docs/01-core-mechanics.md · docs/03-physics-controls.md.
 * 거리는 타일, 시간은 초(틱으로 바꾼 값은 *_TICKS).
 */

/** 초 → 틱(반올림) */
export const secToTicks = (sec: number): number => Math.round(sec * TICK_RATE);

// ── 몸체 ──
/** 파이터 충돌 원 반지름(기본) */
export const FIGHTER_RADIUS = 0.4;
/** 파이터별 반지름 예외 (docs/03: BOULDER 0.45). 1칸(1타일) 통로를 지나가야 하므로 0.5보다 작아야 한다 */
export const FIGHTER_RADIUS_BY_ID: Partial<Record<FighterId, number>> = { boulder: 0.45 };
/** 어떤 파이터도 이보다 크면 안 된다(1칸 통로) */
export const MAX_FIGHTER_RADIUS = 0.46;
export const fighterRadius = (id: FighterId): number => FIGHTER_RADIUS_BY_ID[id] ?? FIGHTER_RADIUS;

// ── 투사체 ──
export const PROJECTILE_RADIUS = 0.18;
export const SUPER_PROJECTILE_RADIUS = 0.24;
/** 데이터에 속도가 없을 때 쓰는 투사체 속도 */
export const DEFAULT_PROJECTILE_SPEED = 12;
/** lob 기본 착탄 범위(데이터에 aoeRadius가 없을 때) */
export const DEFAULT_LOB_AOE = 1.2;

// ── 사망·부활 ──
export const FIGHTER_RESPAWN_TICKS = secToTicks(3);
export const DUMMY_RESPAWN_TICKS = secToTicks(2);

// ── 넉백 ──
/** 넉백으로 밀려나는 시간. 이 동안 이동·공격 불가 */
export const KNOCKBACK_TICKS = secToTicks(0.5);

// ── 수풀·노출 ──
/** 공격하면 이 시간 동안 수풀 안에서도 보인다 */
export const REVEAL_TICKS = secToTicks(1);
/** 이 거리(타일, 중심 사이) 안의 적에게는 수풀 안에서도 보인다 */
export const BUSH_REVEAL_DIST = 2.5;

// ── 체력 회복 ──
/** 파이터: 마지막 전투 후 이 시간이 지나면 회복 시작 */
export const REGEN_DELAY_TICKS = secToTicks(3);
/** 파이터: 초당 최대 체력 대비 회복 비율 */
export const REGEN_PER_SEC = 0.13;
/** 더미: 마지막 전투 후 이 시간이 지나면 빠르게 전부 회복 */
export const DUMMY_REGEN_DELAY_TICKS = secToTicks(2);
/** 더미: 초당 최대 체력 대비 회복 비율(1 = 1초 만에 0→가득) */
export const DUMMY_REGEN_PER_SEC = 1;

// ── 더미 ──
export const DUMMY_RADIUS = 0.45;
export const DUMMY_HP = 6000;
/** patrol: 시작점 기준 좌우로 오가는 거리 */
export const PATROL_HALF_WIDTH = 3;
/** patrol: 이동 속도(타일/초) */
export const PATROL_SPEED = 1.4;
/** turret: 발사 간격 */
export const TURRET_INTERVAL_TICKS = secToTicks(1.5);
/** turret: 조준 사거리(이 안의 적 파이터만 노린다) */
export const TURRET_RANGE = 5.6;
/** turret: 탄이 날아가는 최대 거리(사거리 끝의 표적에도 닿도록 조금 더 길다) */
export const TURRET_SHOT_RANGE = 6;
export const TURRET_SHOT_SPEED = 5.5;
export const TURRET_DAMAGE = 400;
export const TURRET_SHOT_RADIUS = 0.25;

// ── dash ──
/** 돌진 중 몸 반지름에 더해 벽을 부수는 여유 거리 */
export const DASH_BREAK_MARGIN = 0.15;

// ── leap ──
/** 가장 짧은 점프 거리(조준을 짧게 해도 이만큼은 뛴다) */
export const MIN_LEAP_DIST = 2;
/** 착지 지점이 막혔을 때 빈 곳을 찾는 반경 */
export const LEAP_LAND_SEARCH = 1.5;
/** 점프한 자리에 떨어뜨리는 폭탄이 놓이는 원의 반지름 */
export const LEAP_BOMB_RING = 1;
/** 데이터에 leapTime·fuse가 없을 때 */
export const DEFAULT_LEAP_TIME = 0.7;
export const DEFAULT_FUSE = 0.5;

// ── TEAM FIGHT ──
/** 이 점수(상대 파이터를 쓰러뜨린 수)에 먼저 닿는 팀이 이긴다 */
export const TEAMFIGHT_TARGET_SCORE = 10;
/** 경기 시간. 끝나면 점수가 높은 팀 승리, 같으면 무승부 */
export const TEAMFIGHT_TICKS = secToTicks(150);

// ── CRYSTAL RUSH ──
/** 경기 시작 뒤 첫 크리스탈이 생기기까지 */
export const CRYSTAL_FIRST_SPAWN_TICKS = secToTicks(3);
/** 그 뒤 크리스탈 생성 간격 */
export const CRYSTAL_SPAWN_INTERVAL_TICKS = secToTicks(7);
/** 바닥에 놓일 수 있는 최대 개수(넘으면 생성을 건너뛴다. 떨어뜨린 크리스탈은 제한 없음) */
export const CRYSTAL_MAX_ON_FLOOR = 10;
/** 생성 지점 주변에 흩어 놓는 반경(같은 자리에 겹치지 않게) */
export const CRYSTAL_SPAWN_SCATTER = 0.6;
/** 크리스탈 몸 반지름: 파이터 원과 이 원이 닿으면 줍는다 */
export const CRYSTAL_RADIUS = 0.3;
/** 쓰러진 자리 주변에 흩뿌리는 반경 */
export const CRYSTAL_DROP_SPREAD = 1.2;
/** 팀 합계가 이 이상이고 상대보다 많으면 카운트다운 */
export const CRYSTAL_WIN_COUNT = 10;
export const CRYSTAL_COUNTDOWN_TICKS = secToTicks(12);
/** 경기 시간. 끝나면 크리스탈이 많은 팀 승리, 같으면 무승부 */
export const CRYSTAL_MATCH_TICKS = secToTicks(180);

/** 부동소수 누적 오차 허용치(탄창·게이지 비교) */
export const EPS = 1e-9;

// ── lob · 파편 · 지대 ──
/** 데이터에 탄속이 없는(0) lob의 비행 시간 */
export const LOB_FLIGHT_TICKS = secToTicks(0.5);
/** lob 최소 던지는 거리(조준을 짧게 해도 이만큼) */
export const LOB_MIN_DIST = 1;
/** lob 여러 개를 던질 때 조준 방향과 수직으로 벌리는 간격 */
export const LOB_SPACING = 0.7;
/** 지대 최소 거리 */
export const ZONE_MIN_DIST = 1;
/** 지대 피해를 모아서 주는 간격(틱). 30틱/초 기준 초당 5번 */
export const ZONE_HIT_TICKS = 6;

// ── FIGHTER BALL ──
/** 이 골 수에 먼저 닿는 팀이 이긴다 */
export const BALL_TARGET_SCORE = 2;
/** 경기 시간. 끝나면 골이 많은 팀 승리, 같으면 무승부 */
export const BALL_MATCH_TICKS = secToTicks(150);
/** 골 뒤 다시 시작(킥오프)까지 모두 멈추는 시간. 끝나면 모두 출발 지점에서 가득 찬 상태로 다시 시작 */
export const BALL_KICKOFF_TICKS = secToTicks(2.5);
/** 공 몸 반지름: 파이터 원과 이 원이 닿으면 줍는다. 벽 충돌도 이 반지름 */
export const BALL_RADIUS = 0.3;
/** 들고 있을 때 공이 파이터 중심에서 바라보는 방향으로 떨어진 거리(표시용) */
export const BALL_CARRY_OFFSET = 0.3;
/** 차기(기본 공격 입력) 초속(타일/초) */
export const BALL_KICK_SPEED = 8.8;
/** 강슛(궁극기 입력, 게이지 소모) 초속. 벽은 부수지 않는다 */
export const BALL_POWER_KICK_SPEED = 12.8;
/** 굴러가는 공의 감속(타일/초²) */
export const BALL_FRICTION = 7;
/** 이 속도(타일/초)보다 느려지면 멈춘다 */
export const BALL_STOP_SPEED = 0.3;
/** 벽에 튕기면 속도에 곱한다 */
export const BALL_BOUNCE_DAMP = 0.6;
/** 물 위에서는 멈추지 않고 적어도 이 속도로 계속 굴러간다(아무도 못 줍는 곳에 서지 않게) */
export const BALL_WATER_MIN_SPEED = 1.5;
/** 찬 사람은 이 시간 동안 공을 다시 줍지 못한다 */
export const BALL_REPICK_TICKS = secToTicks(0.3);
