import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { KNOCKBACK_TICKS } from '../../../src/game/rules';
import type { Fighter } from '../../../src/game/types';
import { Tile } from '../../../src/game/world';
import { attack, center, dummies, fighters, makeSim, ofType, run, superIn, testMap, tick } from './helpers';

const S = getFighter('boulder').super;

/** 가로 30칸 통로(세로 3칸), A는 (2,3) */
function corridor(extra: Array<[number, number, string]> = []) {
  return testMap(30, 7, [[2, 3, 'A'], ...extra]);
}

function startDash(sim: ReturnType<typeof makeSim>, aim = { x: 1, y: 0 }) {
  const p = fighters(sim)[0]!;
  p.superCharge = 1;
  const events = tick(sim, { [p.id]: superIn(aim) });
  return { p, events };
}

describe('dash (BOULDER Avalanche Roll)', () => {
  it('조준 방향으로 projectileSpeed 속도로 range만큼 돌진한다', () => {
    const sim = makeSim(corridor(), [{ id: 'boulder' }]);
    const { p, events } = startDash(sim);
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: true, dir: 0 }]);
    expect(p.action?.kind).toBe('dash');
    const x0 = p.pos.x;
    tick(sim);
    expect(p.pos.x - x0).toBeCloseTo(S.projectileSpeed / 30, 6);
    expect(p.moving).toBe(true);
    const ticks = Math.round((S.range / S.projectileSpeed) * 30);
    run(sim, ticks - 1);
    expect(p.pos.x - x0).toBeCloseTo(S.range, 6);
    expect(p.pos.y).toBeCloseTo(center(2, 3).y, 9);
    expect(p.action).toBeNull();
  });

  it('돌진 중에는 이동 입력과 공격을 받지 않는다', () => {
    const sim = makeSim(corridor(), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    const ammo = p.ammo;
    const events = run(sim, 5, { [p.id]: attack({ x: 0, y: 1 }, { x: 0, y: 1 }) });
    expect(p.pos.y).toBeCloseTo(center(2, 3).y, 9);
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(p.ammo).toBe(ammo);
  });

  it('부서지는 벽을 부수고 지나가며 wallsBroken을 알린다', () => {
    const sim = makeSim(corridor([[6, 1, '#'], [6, 2, '#'], [6, 3, '#'], [6, 4, '#'], [6, 5, '#']]), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    const x0 = p.pos.x;
    const events = run(sim, 40);
    const tiles = ofType(events, 'wallsBroken').flatMap((e) => e.tiles);
    expect(tiles).toContainEqual({ x: 6, y: 3 });
    expect(sim.grid.get(6, 3)).toBe(Tile.Floor);
    expect(p.pos.x - x0).toBeCloseTo(S.range, 6);
  });

  it('단단한 벽 앞에서 멈춘다', () => {
    const sim = makeSim(corridor([[8, 1, 'X'], [8, 2, 'X'], [8, 3, 'X'], [8, 4, 'X'], [8, 5, 'X']]), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    run(sim, 30);
    expect(p.action).toBeNull();
    expect(p.pos.x + p.radius).toBeLessThanOrEqual(8 + 1e-9);
    expect(p.pos.x + p.radius).toBeGreaterThan(8 - 0.05);
    expect(sim.grid.get(8, 3)).toBe(Tile.HardWall);
  });

  it('물과 맵 끝에서도 멈춘다', () => {
    const water = makeSim(corridor([[7, 1, 'W'], [7, 2, 'W'], [7, 3, 'W'], [7, 4, 'W'], [7, 5, 'W']]), [{ id: 'boulder' }]);
    const a = startDash(water).p;
    run(water, 30);
    expect(a.action).toBeNull();
    expect(a.pos.x + a.radius).toBeLessThanOrEqual(7 + 1e-9);
    expect(a.pos.x + a.radius).toBeGreaterThan(7 - 0.05);

    const edge = makeSim(corridor(), [{ id: 'boulder' }]);
    const b = startDash(edge, { x: -1, y: 0 }).p;
    run(edge, 30);
    expect(b.action).toBeNull();
    expect(b.pos.x - b.radius).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('닿은 적에게 한 번씩 피해 + 넉백', () => {
    const sim = makeSim(corridor([[5, 3, 'd'], [8, 3, 'd']]), [{ id: 'boulder' }]);
    const [d1, d2] = dummies(sim);
    const { p } = startDash(sim);
    const events = run(sim, 40);
    const hits = ofType(events, 'hit').filter((h) => h.sourceId === p.id);
    expect(hits.map((h) => h.targetId).sort()).toEqual([d1!.id, d2!.id].sort());
    expect(hits.every((h) => h.damage === S.damage && h.isSuper)).toBe(true);
    expect(d1!.hp).toBe(d1!.maxHp - S.damage);
    // 돌진 방향(오른쪽)으로 밀려났다
    expect(d1!.pos.x).toBeGreaterThan(center(5, 3).x + 1);
    // 궁극기 적중은 충전하지 않는다
    expect(p.superCharge).toBe(0);
  });
});

/** 투사체가 닿아 넉백이 시작될 때까지 진행 */
function untilKnocked(sim: ReturnType<typeof makeSim>, f: Fighter) {
  for (let i = 0; i < 10 && f.action?.kind !== 'knockback'; i++) tick(sim);
}

describe('넉백', () => {
  /** 팀0 RIVET(A)과 2칸 오른쪽 팀1 RIVET(Z) */
  function duel() {
    const sim = makeSim(testMap(24, 9, [[8, 4, 'A'], [10, 4, 'Z']]), [
      { id: 'rivet', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    return { sim, me: me!, foe: foe! };
  }

  it('약 0.25초 동안 밀려나고, 그동안 이동·공격 불가', () => {
    const { sim, me, foe } = duel();
    foe.superCharge = 1;
    const x0 = me.pos.x;
    tick(sim, { [foe.id]: superIn({ x: -1, y: 0 }) });
    untilKnocked(sim, me);
    expect(me.action?.kind).toBe('knockback');
    const ammo = me.ammo;
    const events = run(sim, KNOCKBACK_TICKS, { [me.id]: attack({ x: 1, y: 0 }, { x: 1, y: 0 }) });
    expect(ofType(events, 'attack').filter((e) => e.unitId === me.id)).toHaveLength(0);
    expect(me.ammo).toBe(ammo);
    expect(x0 - me.pos.x).toBeCloseTo(getFighter('rivet').super.knockback, 6);
    expect(me.pos.y).toBeCloseTo(center(8, 4).y, 6);
    // 다음 틱에 풀리고 다시 움직인다
    const after = tick(sim, { [me.id]: attack({ x: 1, y: 0 }, { x: 1, y: 0 }) });
    expect(me.action).toBeNull();
    expect(ofType(after, 'attack').filter((e) => e.unitId === me.id)).toHaveLength(1);
  });

  it('넉백은 연사를 끊는다', () => {
    const sim = makeSim(testMap(24, 9, [[8, 4, 'A'], [10, 4, 'Z']]), [
      { id: 'volley', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    tick(sim, { [me!.id]: attack({ x: 0, y: 1 }) });
    expect(me!.action?.kind).toBe('burst');
    foe!.superCharge = 1;
    tick(sim, { [foe!.id]: superIn({ x: -1, y: 0 }) });
    untilKnocked(sim, me!);
    expect(me!.action?.kind).toBe('knockback');
    const seen = new Set(sim.projectiles.map((q) => q.id));
    let newShots = 0;
    for (let i = 0; i < KNOCKBACK_TICKS + 12; i++) {
      tick(sim);
      for (const q of sim.projectiles) if (q.ownerId === me!.id && !seen.has(q.id)) newShots++;
    }
    expect(newShots).toBe(0);
    expect(me!.action).toBeNull();
  });

  it('벽에 막히면 벽 앞에서 멈춘다', () => {
    const sim = makeSim(testMap(24, 9, [[8, 4, 'A'], [10, 4, 'Z'], [7, 3, 'X'], [7, 4, 'X'], [7, 5, 'X']]), [
      { id: 'rivet', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    foe!.superCharge = 1;
    tick(sim, { [foe!.id]: superIn({ x: -1, y: 0 }) });
    untilKnocked(sim, me!);
    run(sim, KNOCKBACK_TICKS + 1);
    expect(me!.pos.x - me!.radius).toBeGreaterThanOrEqual(8 - 1e-9);
  });

  it('돌진 중인 BOULDER는 밀리지 않는다', () => {
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A'], [12, 4, 'Z']]), [
      { id: 'boulder', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    foe!.superCharge = 1;
    tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) });
    run(sim, 10);
    tick(sim, { [foe!.id]: superIn({ x: -1, y: 0 }) });
    expect(me!.action?.kind).toBe('dash');
  });
});
