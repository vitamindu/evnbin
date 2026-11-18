/**
 * 통신용 값 다듬기. 서버(server/)와 클라이언트(src/net/)가 같이 쓴다. Network 담당. DOM·Three.js import 금지.
 *
 * 이동 입력은 보내기 전에 소수 셋째 자리로 반올림하고, 클라이언트 예측도 반올림한 값을 쓴다.
 * 서버는 JSON으로 받은 같은 숫자로 시뮬레이션하므로 예측과 서버 결과가 같아진다.
 */
import type { Aim, Vec2 } from '../game/types';
import type { WireAim } from './protocol';

/** 소수 셋째 자리 반올림(-0은 0으로) */
export const q3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/** 길이 0~1로 자르고 반올림한 이동 입력. 숫자가 아니면 0 */
export function quantizeMove(m: Vec2): Vec2 {
  let x = Number.isFinite(m.x) ? m.x : 0;
  let y = Number.isFinite(m.y) ? m.y : 0;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x: q3(x), y: q3(y) };
}

export function toWireAim(aim: Aim): WireAim {
  if (!aim) return null;
  const m = quantizeMove(aim);
  return [m.x, m.y];
}

export function fromWireAim(w: WireAim): Aim {
  if (!w) return null;
  return quantizeMove({ x: w[0], y: w[1] });
}

/** JSON.stringify 치환 함수: 정수가 아닌 숫자를 소수 셋째 자리로(스냅샷 크기 절약) */
export function roundReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? q3(value) : value;
}
