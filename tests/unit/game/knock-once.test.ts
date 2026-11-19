import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { dummies, fighters, makeSim, run, testMap } from './helpers';

describe('넉백은 한 번의 공격당 한 번', () => {
  it('RIVET 궁극기 탄이 흩어져 여러 틱에 맞아도 넉백 거리만큼만 밀린다', () => {
    const kb = getFighter('rivet').super.knockback;
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = makeSim(testMap(20, 9, [[3, 4, 'A'], [6, 4, 'd']]), [{ id: 'rivet' }], { seed });
      const me = fighters(sim)[0]!;
      const d = dummies(sim)[0]!;
      const x0 = d.pos.x;
      me.superCharge = 1;
      run(sim, 90, (i) => ({ [me.id]: i === 0 ? { move: { x: 0, y: 0 }, super: { aim: { x: 1, y: 0 } } } : { move: { x: 0, y: 0 } } }));
      expect(d.pos.x - x0).toBeLessThanOrEqual(kb + 0.05);
      expect(d.pos.x - x0).toBeGreaterThan(kb * 0.8);
    }
  });
});
