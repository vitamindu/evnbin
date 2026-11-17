import type { Vec2 } from '../types';
import { Grid, Tile } from './grid';

/**
 * 충돌 함수. World 담당. (현재는 Lead가 만든 단순한 초기 구현)
 */

function circleHitsTile(cx: number, cy: number, r: number, tx: number, ty: number): boolean {
  const nx = Math.max(tx, Math.min(cx, tx + 1));
  const ny = Math.max(ty, Math.min(cy, ty + 1));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** 원이 이동을 막는 타일과 겹치는가 */
export function circleBlocked(grid: Grid, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (grid.blocksMovement(tx, ty) && circleHitsTile(x, y, r, tx, ty)) return true;
    }
  }
  return false;
}

/** 원을 (dx, dy)만큼 움직인다. 벽에 막히면 막힌 축만 멈춰서 벽을 따라 미끄러진다. */
export function moveCircle(grid: Grid, pos: Vec2, r: number, dx: number, dy: number): Vec2 {
  let x = pos.x;
  let y = pos.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(grid, x + sx, y, r)) x += sx;
    if (!circleBlocked(grid, x, y + sy, r)) y += sy;
  }
  return { x, y };
}

export interface SweepResult {
  hit: boolean;
  /** 멈춘 지점(막혔으면 막히기 직전) */
  point: Vec2;
  /** 막은 타일 */
  tile?: Vec2;
  /** breakWalls 옵션일 때 지나가며 부순 타일(그리드에서 이미 바닥으로 바뀜) */
  broken: Vec2[];
}

export interface SweepOptions {
  /** true면 부서지는 벽(Wall)은 부수고 계속 날아간다. 단단한 벽(HardWall)에서만 멈춘다 */
  breakWalls?: boolean;
}

/** 직선 투사체(원)가 from→to로 갈 때 벽에 막히는지 */
export function sweepCircle(grid: Grid, from: Vec2, to: Vec2, r: number, opts: SweepOptions = {}): SweepResult {
  const broken: Vec2[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  let px = from.x;
  let py = from.y;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (dx * i) / steps;
    const y = from.y + (dy * i) / steps;
    for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (grid.blocksProjectile(tx, ty) && circleHitsTile(x, y, r, tx, ty)) {
          if (opts.breakWalls && grid.get(tx, ty) === Tile.Wall) {
            grid.set(tx, ty, Tile.Floor);
            broken.push({ x: tx, y: ty });
            continue;
          }
          return { hit: true, point: { x: px, y: py }, tile: { x: tx, y: ty }, broken };
        }
      }
    }
    px = x;
    py = y;
  }
  return { hit: false, point: { x: to.x, y: to.y }, broken };
}

/** 두 점 사이에 투사체를 막는 벽이 없는가 */
export function hasLineOfSight(grid: Grid, a: Vec2, b: Vec2): boolean {
  return !sweepCircle(grid, a, b, 0.05).hit;
}

export function isInBush(grid: Grid, pos: Vec2): boolean {
  return grid.get(Math.floor(pos.x), Math.floor(pos.y)) === Tile.Bush;
}

/** 원 안의 부서지는 벽을 바닥으로 바꾸고, 바뀐 타일 목록을 돌려준다 */
export function breakWallsInCircle(grid: Grid, c: Vec2, r: number): Vec2[] {
  const out: Vec2[] = [];
  for (let ty = Math.floor(c.y - r); ty <= Math.floor(c.y + r); ty++) {
    for (let tx = Math.floor(c.x - r); tx <= Math.floor(c.x + r); tx++) {
      if (grid.get(tx, ty) === Tile.Wall && circleHitsTile(c.x, c.y, r, tx, ty)) {
        grid.set(tx, ty, Tile.Floor);
        out.push({ x: tx, y: ty });
      }
    }
  }
  return out;
}
