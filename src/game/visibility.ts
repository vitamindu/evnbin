import { BUSH_REVEAL_DIST } from './rules';
import type { SimView, Team, Unit } from './types';

/**
 * 수풀 은신 규칙. Gameplay 담당. 렌더러·UI·AI·서버가 같은 규칙을 쓴다.
 *
 * unit이 team에게 보이는가:
 * - 같은 팀이면 항상 보인다.
 * - 죽은 유닛은 보이지 않는다.
 * - 더미는 숨지 않는다(수풀 규칙은 파이터만).
 * - 적 파이터는 수풀 밖이거나, 공격 후 노출 중(tick < revealedUntil)이거나,
 *   team의 살아 있는 유닛 중 하나가 BUSH_REVEAL_DIST(2.5타일, 중심 사이) 안에 있으면 보인다.
 */
export function isVisibleTo(sim: SimView, unit: Unit, team: Team): boolean {
  if (unit.team === team) return true;
  if (!unit.alive) return false;
  if (unit.type !== 'fighter') return true;
  if (!unit.inBush) return true;
  if (sim.tick < unit.revealedUntil) return true;
  const r2 = BUSH_REVEAL_DIST * BUSH_REVEAL_DIST;
  for (const o of sim.units) {
    if (!o.alive || o.team !== team) continue;
    const dx = o.pos.x - unit.pos.x;
    const dy = o.pos.y - unit.pos.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
