import type { Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const fromAngle = (r: number, l = 1): Vec2 => ({ x: Math.cos(r) * l, y: Math.sin(r) * l });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export function clampLen(a: Vec2, max: number): Vec2 {
  const l = len(a);
  return l > max ? scale(a, max / l) : { x: a.x, y: a.y };
}
