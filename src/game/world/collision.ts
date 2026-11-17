import type { Vec2 } from '../types';
import { Grid, Tile } from './grid';

/**
 * 충돌 함수. World 담당. 순수 평면 계산이고 결정적이다(Math.hypot 대신 sqrt만 쓴다).
 *
 * - moveCircle(유닛 이동): 짧은 걸음(≤ 0.1타일)으로 나눠 움직이고, 걸음마다 겹친 벽 중 가장 깊은 것부터
 *   밀어낸다. 벽면에서는 면을 따라, 볼록한 모서리에서는 모서리를 돌아 미끄러진다. 걸음이 반지름보다
 *   짧아서 벽을 건너뛸 수 없다.
 * - sweepCircle(투사체): 움직이는 원과 타일(모서리가 둥근 사각형)의 첫 접촉 시점을 계산한다.
 *   샘플링이 아니라 연속 판정이라 속도와 상관없이 벽을 뚫지 않는다.
 * - 시작할 때 이미 벽과 겹쳐 있으면: moveCircle은 먼저 밖으로 꺼내고, sweepCircle은 그 벽 쪽으로
 *   움직이면 바로 막힘(hit, point = from), 벽에서 멀어지면 그 벽은 무시한다.
 */

/** 밀어낼 때 접촉면에서 더 띄우는 거리 */
const SKIN = 1e-4;
/** moveCircle 한 걸음의 최대 길이(타일). 반지름보다 작으면 반지름으로 줄인다 */
const MOVE_STEP = 0.1;
/** sweepCircle이 후보 타일을 모을 때 나누는 구간 길이(타일) */
const SWEEP_SEGMENT = 0.5;
/** hasLineOfSight 기본 굵기: 대각선으로 맞붙은 두 벽 사이의 틈으로 시야가 새지 않게 */
const LOS_RADIUS = 0.05;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 점 (cx, cy)와 타일 (tx, ty) 사각형 사이 거리의 제곱 */
function sqDistToTile(cx: number, cy: number, tx: number, ty: number): number {
  const dx = cx - clamp(cx, tx, tx + 1);
  const dy = cy - clamp(cy, ty, ty + 1);
  return dx * dx + dy * dy;
}

/** 원과 타일이 겹치는가(맞닿기만 한 것은 겹침이 아님) */
function circleHitsTile(cx: number, cy: number, r: number, tx: number, ty: number): boolean {
  return sqDistToTile(cx, cy, tx, ty) < r * r;
}

/** 원이 이동을 막는 타일(벽·단단한 벽·물·맵 밖)과 겹치는가 */
export function circleBlocked(grid: Grid, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (grid.blocksMovement(tx, ty) && circleHitsTile(x, y, r, tx, ty)) return true;
    }
  }
  return false;
}

/**
 * p를 겹친 이동 불가 타일 밖으로 밀어낸다(p를 직접 바꾼다). 가장 깊이 겹친 타일부터 처리하므로
 * 한 줄로 이어진 벽의 이음매에서 옆으로 튕기지 않는다. 다 풀리면 true.
 */
function pushOut(grid: Grid, p: Vec2, r: number, maxIter: number): boolean {
  const r2 = r * r;
  for (let iter = 0; iter < maxIter; iter++) {
    let best = -1;
    let bnx = 0;
    let bny = 0;
    const x = p.x;
    const y = p.y;
    for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (!grid.blocksMovement(tx, ty)) continue;
        const ox = x - clamp(x, tx, tx + 1);
        const oy = y - clamp(y, ty, ty + 1);
        const d2 = ox * ox + oy * oy;
        if (d2 >= r2) continue;
        let pen: number;
        let nx: number;
        let ny: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          pen = r - d;
          nx = ox / d;
          ny = oy / d;
        } else {
          // 중심이 타일 안: 가장 가까운 면으로 꺼낸다. 막히지 않은 이웃 쪽을 우선한다.
          let bestFace = Infinity;
          let bestOpen = false;
          nx = 0;
          ny = 0;
          const faces: [number, number, number][] = [
            [x - tx, -1, 0],
            [tx + 1 - x, 1, 0],
            [y - ty, 0, -1],
            [ty + 1 - y, 0, 1],
          ];
          for (const [d, fx, fy] of faces) {
            const open = !grid.blocksMovement(tx + fx, ty + fy);
            if ((open && !bestOpen) || (open === bestOpen && d < bestFace)) {
              bestFace = d;
              bestOpen = open;
              nx = fx;
              ny = fy;
            }
          }
          pen = bestFace + r;
        }
        if (pen > best) {
          best = pen;
          bnx = nx;
          bny = ny;
        }
      }
    }
    if (best < 0) return true;
    p.x += bnx * (best + SKIN);
    p.y += bny * (best + SKIN);
  }
  return !circleBlocked(grid, p.x, p.y, r);
}

/**
 * 원이 벽과 겹치지 않는 가장 가까운 위치. 겹치지 않으면 그대로 돌려준다.
 * 밀어내기로 안 풀리면 주변 타일 중심을 가까운 순으로 찾는다(벽이 새로 생겼거나 순간이동한 경우).
 */
export function resolveCircle(grid: Grid, pos: Vec2, r: number): Vec2 {
  const p = { x: pos.x, y: pos.y };
  if (!circleBlocked(grid, p.x, p.y, r)) return p;
  if (pushOut(grid, p, r, 8)) return p;
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const maxRing = Math.max(grid.width, grid.height);
  for (let ring = 0; ring <= maxRing; ring++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let ty = cy - ring; ty <= cy + ring; ty++) {
      for (let tx = cx - ring; tx <= cx + ring; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== ring) continue;
        const x = tx + 0.5;
        const y = ty + 0.5;
        if (circleBlocked(grid, x, y, r)) continue;
        const d = (x - pos.x) * (x - pos.x) + (y - pos.y) * (y - pos.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return { x: pos.x, y: pos.y };
}

/**
 * 원을 (dx, dy)만큼 움직인다. 벽·물에 막히면 벽을 따라 미끄러지고, 모서리에 살짝 걸리면 돌아서 지나간다.
 * 시작 위치가 벽과 겹쳐 있으면 먼저 가장 가까운 빈 곳으로 꺼낸다.
 */
export function moveCircle(grid: Grid, pos: Vec2, r: number, dx: number, dy: number): Vec2 {
  const p = resolveCircle(grid, pos, r);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-9) return p;
  const stepLen = Math.min(MOVE_STEP, Math.max(r, 0.02));
  const steps = Math.max(1, Math.ceil(dist / stepLen));
  const sx = dx / steps;
  const sy = dy / steps;
  const q = { x: 0, y: 0 };
  for (let i = 0; i < steps; i++) {
    q.x = p.x + sx;
    q.y = p.y + sy;
    if (pushOut(grid, q, r, 4)) {
      p.x = q.x;
      p.y = q.y;
      continue;
    }
    // 밀어내기로 못 푸는 좁은 곳: 축별로 따로 시도
    if (!circleBlocked(grid, p.x + sx, p.y, r)) p.x += sx;
    else if (!circleBlocked(grid, p.x, p.y + sy, r)) p.y += sy;
  }
  return p;
}

export interface SweepResult {
  hit: boolean;
  /** 멈춘 지점(막혔으면 막히기 직전) */
  point: Vec2;
  /** 막은 타일 */
  tile?: Vec2;
  /** breakWalls 옵션일 때 지나가며 부순 타일(그리드에서 이미 바닥으로 바뀜). 부순 순서대로 */
  broken: Vec2[];
}

export interface SweepOptions {
  /** true면 부서지는 벽(Wall)은 부수고 계속 날아간다. 단단한 벽(HardWall)에서만 멈춘다 */
  breakWalls?: boolean;
}

/** 원점 기준 o에서 d로 움직이는 점이 반지름 r 원에 처음 닿는 시점(없으면 Infinity) */
function circleContact(ox: number, oy: number, dx: number, dy: number, r: number): number {
  const b = ox * dx + oy * dy;
  if (b >= 0) return Infinity; // 멀어지는 중
  const a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - a * c;
  if (disc <= 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 ? t : Infinity;
}

/**
 * (px, py)에서 (dx, dy) 방향으로 움직이는 반지름 r 원이 타일 (tx, ty)에 처음 닿는 시점 t ≥ 0(없으면 Infinity).
 * 타일을 r만큼 부풀린 둥근 사각형과 반직선의 교차: 부풀린 사각형에 먼저 들어간 뒤, 들어간 곳이
 * 모서리 구역이면 모서리 원과 다시 판정한다. 시작점이 타일과 겹치지 않는다고 가정한다.
 */
function tileContact(px: number, py: number, dx: number, dy: number, r: number, tx: number, ty: number): number {
  let tmin = 0;
  let tmax = Infinity;
  const minx = tx - r;
  const maxx = tx + 1 + r;
  const miny = ty - r;
  const maxy = ty + 1 + r;
  if (Math.abs(dx) < 1e-12) {
    if (px <= minx || px >= maxx) return Infinity;
  } else {
    let t1 = (minx - px) / dx;
    let t2 = (maxx - px) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dy) < 1e-12) {
    if (py <= miny || py >= maxy) return Infinity;
  } else {
    let t1 = (miny - py) / dy;
    let t2 = (maxy - py) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (tmin >= tmax) return Infinity;
  const qx = px + dx * tmin;
  const qy = py + dy * tmin;
  const cornerX = qx < tx ? tx : qx > tx + 1 ? tx + 1 : NaN;
  const cornerY = qy < ty ? ty : qy > ty + 1 ? ty + 1 : NaN;
  if (Number.isNaN(cornerX) || Number.isNaN(cornerY)) return tmin;
  return circleContact(px - cornerX, py - cornerY, dx, dy, r);
}

/**
 * 직선 투사체(원)가 from→to로 갈 때 투사체를 막는 타일(벽·단단한 벽·맵 밖)에 막히는지.
 * breakWalls면 부서지는 벽은 그리드에서 바닥으로 바꾸고 계속 간다(단단한 벽에서만 멈춤).
 */
export function sweepCircle(grid: Grid, from: Vec2, to: Vec2, r: number, opts: SweepOptions = {}): SweepResult {
  const broken: Vec2[] = [];
  const breakWalls = opts.breakWalls === true;
  const px = from.x;
  const py = from.y;
  const dx = to.x - px;
  const dy = to.y - py;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;

  const breakTile = (tx: number, ty: number): boolean => {
    if (!breakWalls || grid.get(tx, ty) !== Tile.Wall) return false;
    grid.set(tx, ty, Tile.Floor);
    broken.push({ x: tx, y: ty });
    return true;
  };

  // 1) 시작할 때 이미 겹친 타일: 그쪽으로 가면 바로 막힘, 멀어지면 무시
  let ignored: number[] | null = null;
  for (let ty = Math.floor(py - r); ty <= Math.floor(py + r); ty++) {
    for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) {
      if (!grid.blocksProjectile(tx, ty)) continue;
      const ox = px - clamp(px, tx, tx + 1);
      const oy = py - clamp(py, ty, ty + 1);
      const d2 = ox * ox + oy * oy;
      if (d2 >= r2) continue;
      const into = d2 < 1e-12 || len2 < 1e-12 || ox * dx + oy * dy < 0;
      if (!into) {
        (ignored ??= []).push(tx, ty);
        continue;
      }
      if (breakTile(tx, ty)) continue;
      return { hit: true, point: { x: px, y: py }, tile: { x: tx, y: ty }, broken };
    }
  }
  if (len2 < 1e-12) return { hit: false, point: { x: to.x, y: to.y }, broken };

  const isIgnored = (tx: number, ty: number) => {
    if (!ignored) return false;
    for (let i = 0; i < ignored.length; i += 2) if (ignored[i] === tx && ignored[i + 1] === ty) return true;
    return false;
  };

  // 2) 짧은 구간마다 주변 타일의 첫 접촉 시점을 구해 가장 이른 것부터 처리
  const len = Math.sqrt(len2);
  const segT = SWEEP_SEGMENT / len;
  let t0 = 0;
  while (t0 < 1) {
    const t1 = Math.min(1, t0 + segT);
    const ax = px + dx * t0;
    const ay = py + dy * t0;
    const bx = px + dx * t1;
    const by = py + dy * t1;
    const minTx = Math.floor(Math.min(ax, bx) - r);
    const maxTx = Math.floor(Math.max(ax, bx) + r);
    const minTy = Math.floor(Math.min(ay, by) - r);
    const maxTy = Math.floor(Math.max(ay, by) + r);
    for (;;) {
      let bestT = Infinity;
      let btx = 0;
      let bty = 0;
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          if (!grid.blocksProjectile(tx, ty) || isIgnored(tx, ty)) continue;
          const t = tileContact(px, py, dx, dy, r, tx, ty);
          if (t < bestT) {
            bestT = t;
            btx = tx;
            bty = ty;
          }
        }
      }
      if (bestT > t1) break;
      if (breakTile(btx, bty)) continue;
      const tb = Math.max(0, bestT - SKIN / len);
      return { hit: true, point: { x: px + dx * tb, y: py + dy * tb }, tile: { x: btx, y: bty }, broken };
    }
    t0 = t1;
  }
  return { hit: false, point: { x: to.x, y: to.y }, broken };
}

/**
 * 두 점 사이에 투사체를 막는 벽(벽·단단한 벽)이 없는가. 수풀·물은 시야를 막지 않는다.
 * r: 시야선 굵기(기본 0.05 — 대각선으로 맞붙은 벽 틈으로 새지 않게).
 */
export function hasLineOfSight(grid: Grid, a: Vec2, b: Vec2, r = LOS_RADIUS): boolean {
  return !sweepCircle(grid, a, b, r).hit;
}

export function isInBush(grid: Grid, pos: Vec2): boolean {
  return grid.get(Math.floor(pos.x), Math.floor(pos.y)) === Tile.Bush;
}

/** 원과 겹치는 부서지는 벽을 바닥으로 바꾸고, 바뀐 타일 목록을 돌려준다(행 우선 순서) */
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
