import { isHittable } from './status';
import type { Aim, SimView, Unit, Vec2 } from './types';
import { angleOf, len } from './vec';
import { isVisibleTo } from './visibility';
import { hasLineOfSight, type Grid } from './world';

/** 자동 조준에 필요한 시뮬레이션 상태(격자 포함) */
export interface AimWorld extends SimView {
  readonly grid: Grid;
}

/** 이 길이보다 짧은 조준 벡터는 방향이 없는 것으로 보고 자동 조준한다 */
export const MIN_AIM_LEN = 1e-3;

/**
 * 자동 조준 대상: shooter의 적 중 맞힐 수 있고(살아 있고 점프 중이 아님), shooter 팀에게 보이며(수풀 규칙),
 * 사거리 안(중심 거리 − 대상 반지름 ≤ range)인 가장 가까운 유닛.
 * 시야(벽에 가리지 않음)가 트인 대상을 먼저 고르고, 없으면 벽 뒤의 가장 가까운 대상.
 * 거리가 같으면 units 순서가 앞선 쪽(결정적).
 */
export function autoAimTarget(sim: AimWorld, shooter: Unit, range: number): Unit | null {
  let bestLos: Unit | null = null;
  let bestLosD = Infinity;
  let bestAny: Unit | null = null;
  let bestAnyD = Infinity;
  for (const u of sim.units) {
    if (!isHittable(u) || u.team === shooter.team || u.id === shooter.id) continue;
    const d = Math.hypot(u.pos.x - shooter.pos.x, u.pos.y - shooter.pos.y);
    if (d - u.radius > range) continue;
    if (d >= bestAnyD && d >= bestLosD) continue;
    if (!isVisibleTo(sim, u, shooter.team)) continue;
    if (d < bestAnyD) {
      bestAny = u;
      bestAnyD = d;
    }
    if (d < bestLosD && hasLineOfSight(sim.grid, shooter.pos, u.pos)) {
      bestLos = u;
      bestLosD = d;
    }
  }
  return bestLos ?? bestAny;
}

/** 조준 결과: 방향(라디안)과 사거리 비율(0~1, 자동 조준이면 대상까지 거리 비율) */
export interface ResolvedAim {
  dir: number;
  /** 0~1. lob처럼 지점을 노리는 공격만 쓴다 */
  ratio: number;
  target: Unit | null;
}

/**
 * 조준 입력을 방향으로 바꾼다. aim이 있으면 그 방향, null(또는 길이 0)이면 자동 조준,
 * 자동 조준 대상이 없으면 바라보는 방향(사거리 끝).
 */
export function resolveAim(sim: AimWorld, shooter: Unit, aim: Aim, range: number): ResolvedAim {
  if (aim && len(aim) > MIN_AIM_LEN) {
    return { dir: angleOf(aim), ratio: Math.min(1, len(aim)), target: null };
  }
  const target = autoAimTarget(sim, shooter, range);
  if (target) {
    const d: Vec2 = { x: target.pos.x - shooter.pos.x, y: target.pos.y - shooter.pos.y };
    const l = len(d);
    if (l > 1e-6) return { dir: angleOf(d), ratio: range > 0 ? Math.min(1, l / range) : 1, target };
  }
  return { dir: shooter.facing, ratio: 1, target };
}

/** shooter 팀에게 보이는(수풀 규칙) 맞힐 수 있는 적 중 가장 가까운 유닛. 거리 제한·시야 조건 없음 */
export function nearestVisibleEnemy(sim: SimView, shooter: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of sim.units) {
    if (!isHittable(u) || u.team === shooter.team) continue;
    const d = Math.hypot(u.pos.x - shooter.pos.x, u.pos.y - shooter.pos.y);
    if (d >= bestD || !isVisibleTo(sim, u, shooter.team)) continue;
    best = u;
    bestD = d;
  }
  return best;
}

/**
 * leap 궁극기 조준: aim이 있으면 그 방향·길이 비율. null(또는 길이 0)이면 가장 가까운 보이는 적에게서
 * 정반대 방향으로 끝까지(비율 1), 적이 없으면 바라보는 방향으로 끝까지.
 * towardRange(내려찍기)가 있으면 반대로 가장 가까운 보이는 적 쪽으로, 거리 비율 min(1, 거리 / towardRange).
 */
export function resolveLeapAim(sim: SimView, shooter: Unit, aim: Aim, towardRange?: number): ResolvedAim {
  if (aim && len(aim) > MIN_AIM_LEN) return { dir: angleOf(aim), ratio: Math.min(1, len(aim)), target: null };
  const enemy = nearestVisibleEnemy(sim, shooter);
  if (enemy) {
    const dx = shooter.pos.x - enemy.pos.x;
    const dy = shooter.pos.y - enemy.pos.y;
    const d2 = dx * dx + dy * dy;
    if (towardRange !== undefined) {
      if (d2 > 1e-12) {
        const ratio = towardRange > 0 ? Math.min(1, Math.sqrt(d2) / towardRange) : 1;
        return { dir: Math.atan2(-dy, -dx), ratio, target: enemy };
      }
      return { dir: shooter.facing, ratio: 0, target: enemy };
    }
    if (d2 > 1e-12) return { dir: Math.atan2(dy, dx), ratio: 1, target: enemy };
  }
  return { dir: shooter.facing, ratio: 1, target: enemy };
}
