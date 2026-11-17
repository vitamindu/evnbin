import { describe, expect, it } from 'vitest';
import { autoAimTarget, resolveAim } from '../../../src/game/aim';
import { BUSH_REVEAL_DIST, REVEAL_TICKS } from '../../../src/game/rules';
import { isVisibleTo } from '../../../src/game/visibility';
import { attack, center, dummies, fighters, makeSim, ofType, run, testMap, tick } from './helpers';

describe('자동 조준', () => {
  const aimDir = (events: ReturnType<typeof tick>, id: number) => ofType(events, 'attack').find((e) => e.unitId === id)!.dir;

  it('aim=null이면 사거리 안의 가장 가까운 적 방향', () => {
    const sim = makeSim(testMap(20, 10, [[2, 5, 'A'], [5, 2, 'd'], [8, 5, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
    expect(p.facing).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('길이 0 조준도 자동 조준', () => {
    const sim = makeSim(testMap(20, 10, [[2, 5, 'A'], [5, 2, 'd'], [8, 5, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack({ x: 0, y: 0 }) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('시야가 트인 적을 벽 뒤의 더 가까운 적보다 먼저 고른다', () => {
    const sim = makeSim(testMap(20, 10, [[2, 5, 'A'], [5, 2, 'd'], [8, 5, 'd'], [3, 4, 'X'], [4, 3, 'X']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(0, 6);
  });

  it('시야가 트인 적이 없으면 벽 뒤의 가장 가까운 적', () => {
    const sim = makeSim(testMap(20, 10, [[2, 5, 'A'], [5, 2, 'd'], [3, 4, 'X'], [4, 3, 'X']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('사거리 안에 적이 없으면 바라보는 방향', () => {
    const sim = makeSim(testMap(24, 10, [[2, 5, 'A'], [12, 5, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    tick(sim, { [p.id]: { move: { x: 0, y: 1 } } });
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('궁극기는 궁극기 사거리로 찾는다', () => {
    // RIVET 기본 7.5, 궁극기 8.5. 더미까지 중심 거리 8.2(− 반지름 0.45 = 7.75)
    const sim = makeSim(testMap(24, 10, [[2, 5, 'A'], [10, 3, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    expect(autoAimTarget(sim, p, 7.5)).toBeNull();
    expect(autoAimTarget(sim, p, 8.5)).toBe(d);
    const r = resolveAim(sim, p, null, 8.5);
    expect(r.target).toBe(d);
    expect(r.dir).toBeCloseTo(Math.atan2(-2, 8), 6);
  });

  it('수풀에 숨은 적은 노리지 않고, 노출되면 노린다', () => {
    const sim = makeSim(testMap(20, 10, [[2, 5, 'A'], [6, 5, 'B'], [6, 8, 'Z'], [8, 2, 'd']]), [
      { id: 'rivet', team: 0 },
      { id: 'volley', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    foe!.pos = center(6, 5);
    tick(sim);
    expect(foe!.inBush).toBe(true);
    expect(aimDir(tick(sim, { [me!.id]: attack(null) }), me!.id)).toBeCloseTo(Math.atan2(-3, 6), 6);
    // 적이 공격하면 노출된다
    tick(sim, { [foe!.id]: attack({ x: 0, y: 1 }) });
    expect(aimDir(tick(sim, { [me!.id]: attack(null) }), me!.id)).toBeCloseTo(0, 6);
  });
});

describe('수풀·isVisibleTo', () => {
  function setup() {
    const marks: Array<[number, number, string]> = [[2, 4, 'A'], [12, 4, 'Z'], [4, 7, 'd']];
    for (let x = 9; x <= 11; x++) for (let y = 3; y <= 5; y++) marks.push([x, y, 'B']);
    const sim = makeSim(testMap(16, 9, marks), [
      { id: 'rivet', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    return { sim, me: me!, foe: foe! };
  }

  it('수풀에 들어가면 inBush가 켜지고, 나오면 꺼진다', () => {
    const { sim, foe } = setup();
    expect(foe.inBush).toBe(false);
    run(sim, 20, { [foe.id]: { move: { x: -1, y: 0 } } });
    expect(foe.inBush).toBe(true);
    run(sim, 40, { [foe.id]: { move: { x: -1, y: 0 } } });
    expect(foe.inBush).toBe(false);
  });

  it('같은 팀은 항상, 적은 수풀 밖이면 보인다', () => {
    const { sim, me, foe } = setup();
    expect(isVisibleTo(sim, foe, 0)).toBe(true);
    foe.pos = center(10, 4);
    tick(sim);
    expect(foe.inBush).toBe(true);
    expect(isVisibleTo(sim, foe, 1)).toBe(true);
    expect(isVisibleTo(sim, foe, 0)).toBe(false);
    expect(isVisibleTo(sim, me, 1)).toBe(true);
  });

  it(`적이 ${BUSH_REVEAL_DIST}타일 안에 오면 보인다`, () => {
    const { sim, me, foe } = setup();
    foe.pos = center(10, 4);
    me.pos = { x: foe.pos.x - BUSH_REVEAL_DIST - 0.05, y: foe.pos.y };
    tick(sim);
    expect(isVisibleTo(sim, foe, 0)).toBe(false);
    me.pos = { x: foe.pos.x - BUSH_REVEAL_DIST + 0.05, y: foe.pos.y };
    expect(isVisibleTo(sim, foe, 0)).toBe(true);
  });

  it('공격하면 1초 동안 노출된다(revealedUntil)', () => {
    const { sim, foe } = setup();
    foe.pos = center(10, 4);
    tick(sim, { [foe.id]: attack({ x: 0, y: -1 }) });
    expect(foe.revealedUntil).toBe(sim.tick + REVEAL_TICKS);
    expect(isVisibleTo(sim, foe, 0)).toBe(true);
    run(sim, REVEAL_TICKS - 1);
    expect(isVisibleTo(sim, foe, 0)).toBe(true);
    tick(sim);
    expect(isVisibleTo(sim, foe, 0)).toBe(false);
  });

  it('더미는 숨지 않고, 죽은 유닛은 보이지 않는다', () => {
    const { sim, foe } = setup();
    const d = dummies(sim)[0]!;
    expect(isVisibleTo(sim, d, 0)).toBe(true);
    foe.alive = false;
    expect(isVisibleTo(sim, foe, 0)).toBe(false);
  });
});
