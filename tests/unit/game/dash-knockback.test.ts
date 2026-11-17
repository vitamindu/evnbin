import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { KNOCKBACK_TICKS } from '../../../src/game/rules';
import { TICK_DT, TICK_RATE, type Fighter } from '../../../src/game/types';
import { Tile } from '../../../src/game/world';
import { attack, center, dummies, fighters, makeSim, ofType, run, runUntil, superIn, testMap, tick, ticksFor } from './helpers';

const S = getFighter('boulder').super;
const RIVET_S = getFighter('rivet').super;
/** 돌진 전체에 걸리는 틱(여유 포함) */
const DASH_TICKS = ticksFor(S.range, S.projectileSpeed);
/** A(2,3) 중심에서 돌진이 끝나는 x */
const DASH_END_X = 2.5 + S.range;
/** 돌진 경로 위, 출발점과 끝 사이의 타일 줄 */
const midCol = (k: number) => 2 + Math.max(2, Math.floor(S.range * k));
const column = (x: number, ch: string): Array<[number, number, string]> => [1, 2, 3, 4, 5].map((y) => [x, y, ch]);

/** 돌진 거리보다 넉넉한 통로(세로 5칸), A는 (2,3) */
function corridor(extra: Array<[number, number, string]> = []) {
  return testMap(Math.ceil(DASH_END_X) + 8, 7, [[2, 3, 'A'], ...extra]);
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
    expect(p.pos.x - x0).toBeCloseTo(S.projectileSpeed * TICK_DT, 6);
    expect(p.moving).toBe(true);
    const ticks = Math.round((S.range / S.projectileSpeed) * TICK_RATE);
    run(sim, ticks - 1);
    expect(p.pos.x - x0).toBeCloseTo(S.range, 6);
    expect(p.pos.y).toBeCloseTo(center(2, 3).y, 9);
    expect(p.action).toBeNull();
  });

  it('돌진 중에는 이동 입력과 공격을 받지 않는다', () => {
    const sim = makeSim(corridor(), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    const ammo = p.ammo;
    const events = run(sim, Math.min(5, Math.round((S.range / S.projectileSpeed) * TICK_RATE) - 1), { [p.id]: attack({ x: 0, y: 1 }, { x: 0, y: 1 }) });
    expect(p.action?.kind).toBe('dash');
    expect(p.pos.y).toBeCloseTo(center(2, 3).y, 9);
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(p.ammo).toBe(ammo);
  });

  it('부서지는 벽을 부수고 지나가며 wallsBroken을 알린다', () => {
    const wx = midCol(0.5);
    const sim = makeSim(corridor(column(wx, '#')), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    const x0 = p.pos.x;
    const events = run(sim, DASH_TICKS);
    const tiles = ofType(events, 'wallsBroken').flatMap((e) => e.tiles);
    expect(tiles).toContainEqual({ x: wx, y: 3 });
    expect(sim.grid.get(wx, 3)).toBe(Tile.Floor);
    expect(p.pos.x - x0).toBeCloseTo(S.range, 6);
  });

  it('단단한 벽 앞에서 멈춘다', () => {
    const wx = midCol(0.7);
    const sim = makeSim(corridor(column(wx, 'X')), [{ id: 'boulder' }]);
    const { p } = startDash(sim);
    run(sim, DASH_TICKS);
    expect(p.action).toBeNull();
    expect(p.pos.x + p.radius).toBeLessThanOrEqual(wx + 1e-9);
    expect(p.pos.x + p.radius).toBeGreaterThan(wx - 0.05);
    expect(sim.grid.get(wx, 3)).toBe(Tile.HardWall);
  });

  it('물과 맵 끝에서도 멈춘다', () => {
    const wx = midCol(0.6);
    const water = makeSim(corridor(column(wx, 'W')), [{ id: 'boulder' }]);
    const a = startDash(water).p;
    run(water, DASH_TICKS);
    expect(a.action).toBeNull();
    expect(a.pos.x + a.radius).toBeLessThanOrEqual(wx + 1e-9);
    expect(a.pos.x + a.radius).toBeGreaterThan(wx - 0.05);

    const edge = makeSim(corridor(), [{ id: 'boulder' }]);
    const b = startDash(edge, { x: -1, y: 0 }).p;
    run(edge, DASH_TICKS);
    expect(b.action).toBeNull();
    expect(b.pos.x - b.radius).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('닿은 적에게 한 번씩 피해 + 넉백', () => {
    const x1 = midCol(0.3);
    const x2 = midCol(0.75);
    expect(x2).toBeGreaterThan(x1);
    const sim = makeSim(corridor([[x1, 3, 'd'], [x2, 3, 'd']]), [{ id: 'boulder' }]);
    const [d1, d2] = dummies(sim);
    const { p } = startDash(sim);
    const events = run(sim, DASH_TICKS + KNOCKBACK_TICKS);
    const hits = ofType(events, 'hit').filter((h) => h.sourceId === p.id);
    expect(hits.map((h) => h.targetId).sort()).toEqual([d1!.id, d2!.id].sort());
    expect(hits.every((h) => h.damage === S.damage && h.isSuper)).toBe(true);
    expect(d1!.hp).toBe(d1!.maxHp - S.damage);
    // 돌진 방향(오른쪽)으로 밀려났다
    expect(d1!.pos.x).toBeGreaterThan(center(x1, 3).x + S.knockback / 2);
    // 궁극기 적중은 충전하지 않는다
    expect(p.superCharge).toBe(0);
  });
});

/** 투사체가 닿아 넉백이 시작될 때까지 진행 */
function untilKnocked(sim: ReturnType<typeof makeSim>, f: Fighter) {
  runUntil(sim, () => f.action?.kind === 'knockback', 120);
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

  it(`${KNOCKBACK_TICKS}틱 동안 밀려나고, 그동안 이동·공격 불가`, () => {
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
    expect(x0 - me.pos.x).toBeCloseTo(RIVET_S.knockback, 6);
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
    const burstTicks = Math.ceil(getFighter('volley').attack.count * getFighter('volley').attack.burstInterval * TICK_RATE);
    for (let i = 0; i < KNOCKBACK_TICKS + burstTicks + 2; i++) {
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

  it('돌진 중인 BOULDER는 넉백 궁극기에 맞아도 밀리지 않는다', () => {
    // 적 RIVET은 BOULDER가 돌진을 시작한 직후 마주 보고 궁극기를 쏜다. 둘이 만나는 거리 D는 돌진 거리 안
    const D = Math.max(3, Math.floor(Math.min(S.range, RIVET_S.range)));
    const sim = makeSim(testMap(Math.ceil(DASH_END_X) + D + 8, 9, [[2, 4, 'A'], [2 + D, 4, 'Z']]), [
      { id: 'boulder', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    foe!.superCharge = 1;
    tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) });
    tick(sim, { [foe!.id]: superIn({ x: -1, y: 0 }) });
    const kinds = new Set<string>();
    const events = runUntil(sim, () => {
      kinds.add(me!.action?.kind ?? 'none');
      return me!.action === null;
    }, DASH_TICKS);
    const hitsOnMe = ofType(events, 'hit').filter((h) => h.targetId === me!.id);
    expect(hitsOnMe.length).toBeGreaterThan(0);
    expect(hitsOnMe.every((h) => h.isSuper)).toBe(true);
    expect(kinds.has('knockback')).toBe(false);
    expect(me!.pos.x).toBeCloseTo(DASH_END_X, 6);
  });
});
