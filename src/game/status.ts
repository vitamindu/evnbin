import type { Unit } from './types';

/** 점프(leap) 중인가. 공중에 있는 동안은 피해·넉백을 받지 않고 투사체가 지나간다 */
export function isAirborne(u: Unit): boolean {
  return u.type === 'fighter' && u.action?.kind === 'leap';
}

/** 지금 피해를 받을 수 있는가(살아 있고 공중에 있지 않음) */
export function isHittable(u: Unit): boolean {
  return u.alive && !isAirborne(u);
}

/** 이름표에 보이는 군중 제어(하드 CC). 둔화(슬로우)는 하드 CC가 아니라 보이지 않는다. 겹치면 기절 > 넉백 */
export type CcKind = 'stun' | 'knockback';

/** 화면(닉네임 칸)에 보일 CC 이름 */
export const CC_NAME: Record<CcKind, string> = { stun: '기절', knockback: '넉백' };

/**
 * 이 파이터에게 걸려 있는 군중 제어. 없으면 null.
 * - 기절: stunnedUntilTick이 아직 안 지남(Chainer E2 등)
 * - 넉백: 밀려나는 중(action knockback)
 * 둔화(적 지대 안)는 하드 CC가 아니라서 표시하지 않는다.
 */
export function ccOf(view: { readonly tick: number }, u: Unit): CcKind | null {
  if (u.type !== 'fighter' || !u.alive) return null;
  if ((u.stunnedUntilTick ?? 0) > view.tick) return 'stun';
  if (u.action?.kind === 'knockback') return 'knockback';
  return null;
}
