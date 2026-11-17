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
/** 파이터별 반지름 예외 (docs/03: BOULDER 0.5) */
export const FIGHTER_RADIUS_BY_ID: Partial<Record<FighterId, number>> = { boulder: 0.5 };
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

/** 부동소수 누적 오차 허용치(탄창·게이지 비교) */
export const EPS = 1e-9;
