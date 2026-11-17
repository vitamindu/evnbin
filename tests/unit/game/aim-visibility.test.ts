import { describe, expect, it } from 'vitest';
import { autoAimTarget, resolveAim } from '../../../src/game/aim';
import { getFighter } from '../../../src/data/fighters';
import { BUSH_REVEAL_DIST, DUMMY_RADIUS, REVEAL_TICKS, fighterRadius } from '../../../src/game/rules';
import { isVisibleTo } from '../../../src/game/visibility';
import { attack, center, dummies, fighters, makeSim, ofType, run, runUntil, testMap, tick } from './helpers';

describe('자동 조준', () => {
  const aimDir = (events: ReturnType<typeof tick>, id: number) => ofType(events, 'attack').find((e) => e.unitId === id)!.dir;
  const R = getFighter('rivet').attack.range;
  const RS = getFighter('rivet').super.range;
  /** 사거리 안, 오른쪽으로 곧게 놓인 먼 더미까지의 칸 수 */
  const farDx = Math.floor(R);
  /** 대각선(오른쪽 위 45°) 더미까지의 칸 수: 먼 더미보다 가깝다 */
  const k = Math.floor((farDx - 0.5) / Math.SQRT2);
  /** A의 줄(대각선 더미가 맵 안에 들도록) */
  const AY = k + 2;
  const W = Math.ceil(2.5 + R) + 8;
  const H = AY + 5;
  const A: [number, number, string] = [2, AY, 'A'];
  const diag: [number, number, string] = [2 + k, AY - k, 'd'];
  const far: [number, number, string] = [2 + farDx, AY, 'd'];
  /** A와 대각선 더미 사이를 가리는 단단한 벽 */
  const cover = (): Array<[number, number, string]> => Array.from({ length: k - 1 }, (_, i) => [3 + i, AY - 1 - i, 'X']);

  it('준비: 대각선 더미가 먼 더미보다 가깝고, 둘 다 사거리 안이며, 사이를 벽으로 가릴 수 있다', () => {
    expect(k).toBeGreaterThanOrEqual(2);
    expect(k * Math.SQRT2).toBeLessThan(farDx);
    expect(farDx - DUMMY_RADIUS).toBeLessThanOrEqual(R);
  });

  it('aim=null이면 사거리 안의 가장 가까운 적 방향', () => {
    const sim = makeSim(testMap(W, H, [A, diag, far]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
    expect(p.facing).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('길이 0 조준도 자동 조준', () => {
    const sim = makeSim(testMap(W, H, [A, diag, far]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack({ x: 0, y: 0 }) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('시야가 트인 적을 벽 뒤의 더 가까운 적보다 먼저 고른다', () => {
    const sim = makeSim(testMap(W, H, [A, diag, far, ...cover()]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(0, 6);
  });

  it('시야가 트인 적이 없으면 벽 뒤의 가장 가까운 적', () => {
    const sim = makeSim(testMap(W, H, [A, diag, ...cover()]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('사거리 안에 적이 없으면 바라보는 방향', () => {
    const outDx = Math.ceil(R + DUMMY_RADIUS) + 2;
    const sim = makeSim(testMap(outDx + 8, H, [A, [2 + outDx, AY, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    tick(sim, { [p.id]: { move: { x: 0, y: 1 } } });
    expect(aimDir(tick(sim, { [p.id]: attack(null) }), p.id)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('궁극기는 궁극기 사거리로 찾는다', () => {
    expect(RS).toBeGreaterThan(R);
    const sim = makeSim(testMap(W + 4, H, [A, [W, AY, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    // 기본 사거리 밖, 궁극기 사거리 안(대상 반지름 포함)인 거리에, 위로 비스듬히 놓는다
    const dd = (R + RS) / 2 + d.radius;
    const ang = -0.3;
    d.pos = { x: p.pos.x + Math.cos(ang) * dd, y: p.pos.y + Math.sin(ang) * dd };
    expect(autoAimTarget(sim, p, R)).toBeNull();
    expect(autoAimTarget(sim, p, RS)).toBe(d);
    const r = resolveAim(sim, p, null, RS);
    expect(r.target).toBe(d);
    expect(r.dir).toBeCloseTo(ang, 6);
  });

  it('수풀에 숨은 적은 노리지 않고, 노출되면 노린다', () => {
    // 수풀 속 적은 노출 거리 밖·사거리 안, 더미는 그보다 멀지만 사거리 안
    const bushDx = Math.ceil(BUSH_REVEAL_DIST) + 1;
    expect(bushDx - fighterRadius('volley')).toBeLessThanOrEqual(R);
    const sim = makeSim(testMap(W, H, [A, [2 + bushDx, AY, 'B'], [2 + bushDx, AY + 3, 'Z'], [W - 2, 1, 'd']]), [
      { id: 'rivet', team: 0 },
      { id: 'volley', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    const d = dummies(sim)[0]!;
    const ang = -0.5;
    const dd = (bushDx + R + d.radius) / 2;
    expect(dd).toBeGreaterThan(bushDx);
    d.pos = { x: me!.pos.x + Math.cos(ang) * dd, y: me!.pos.y + Math.sin(ang) * dd };
    foe!.pos = center(2 + bushDx, AY);
    tick(sim);
    expect(foe!.inBush).toBe(true);
    expect(aimDir(tick(sim, { [me!.id]: attack(null) }), me!.id)).toBeCloseTo(ang, 6);
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
    const left = { [foe.id]: { move: { x: -1, y: 0 } } };
    runUntil(sim, () => foe.inBush, 300, left);
    expect(foe.inBush).toBe(true);
    expect(foe.pos.x).toBeLessThan(12);
    runUntil(sim, () => !foe.inBush, 600, left);
    expect(foe.inBush).toBe(false);
    expect(foe.pos.x).toBeLessThan(9);
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
