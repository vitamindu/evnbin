import { describe, expect, it } from 'vitest';
import { dummies, fighters, makeSim, ofType, run, testMap } from './helpers';

describe('VOLLEY 궁극기 관통', () => {
  it('한 줄에 선 더미 둘을 모두 맞힌다', () => {
    // A(2,3) 오른쪽으로 d 두 개
    const sim = makeSim(testMap(14, 7, [[2, 3, 'A'], [5, 3, 'd'], [7, 3, 'd']]), [{ id: 'volley' }]);
    const me = fighters(sim)[0]!;
    me.superCharge = 1;
    const ev = run(sim, 60, (i) => ({ [me.id]: i === 0 ? { move: { x: 0, y: 0 }, super: { aim: { x: 1, y: 0 } } } : { move: { x: 0, y: 0 } } }));
    const hitIds = new Set(ofType(ev, 'hit').map((h) => h.targetId));
    for (const d of dummies(sim)) expect(hitIds.has(d.id)).toBe(true);
  });
});
