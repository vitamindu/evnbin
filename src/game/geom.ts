import type { Vec2 } from './types';

/** 선분 ab가 중심 c, 반지름 r 원과 만나는가 */
export function segmentCircle(a: Vec2, b: Vec2, c: Vec2, r: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + abx * t - c.x;
  const py = a.y + aby * t - c.y;
  return px * px + py * py <= r * r;
}

/**
 * a→b로 움직이는 점이 중심 c, 반지름 r 원에 처음 닿는 비율 t(0..1).
 * 처음부터 원 안이면 0, 닿지 않으면 -1.
 */
export function segmentCircleT(a: Vec2, b: Vec2, c: Vec2, r: number): number {
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const cc = fx * fx + fy * fy - r * r;
  if (cc <= 0) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const aa = dx * dx + dy * dy;
  if (aa < 1e-12) return -1;
  const bb = 2 * (fx * dx + fy * dy);
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return -1;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : -1;
}

/** 두 각도의 차이(-π..π) */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
