import type { Unit } from './types';

/** 점프(leap) 중인가. 공중에 있는 동안은 피해·넉백을 받지 않고 투사체가 지나간다 */
export function isAirborne(u: Unit): boolean {
  return u.type === 'fighter' && u.action?.kind === 'leap';
}

/** 지금 피해를 받을 수 있는가(살아 있고 공중에 있지 않음) */
export function isHittable(u: Unit): boolean {
  return u.alive && !isAirborne(u);
}
