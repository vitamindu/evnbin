import { describe, expect, it } from 'vitest';
import { getFighter, type AttackDef } from '../../../src/data/fighters';
import { resolveLeapAim } from '../../../src/game/aim';
import { LEAP_BOMB_RING, LEAP_LAND_SEARCH, MIN_LEAP_DIST, PROJECTILE_RADIUS, DUMMY_RADIUS, secToTicks } from '../../../src/game/rules';
import { distanceDamage } from '../../../src/game/sim';
import { isAirborne } from '../../../src/game/status';
import type { Fighter } from '../../../src/game/types';
import { circleBlocked } from '../../../src/game/world';
import { attack, center, dummies, fighters, makeSim, ofType, run, superIn, testMap, tick } from './helpers';

const A = getFighter('hinako').attack;
const S = getFighter('hinako').super;
const LEAP_TICKS = secToTicks(S.leapTime!);
const FUSE_TICKS = secToTicks(S.fuse!);

type Leap = Extract<NonNullable<Fighter['action']>, { kind: 'leap' }>;
const leapOf = (f: Fighter) => {
  expect(f.action?.kind).toBe('leap');
  return f.action as Leap;
};

describe('HINAKO 기본 공격: 한 발 저격 + 거리 비례 피해', () => {
  it('count 1 burst: 한 발, attack 사건 한 번, 옆으로 띄우지 않고, 같은 틱에 행동이 끝난다', () => {
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) })];
    expect(p.action).toBeNull();
    expect(sim.projectiles).toHaveLength(1);
    const shot = sim.projectiles[0]!;
    expect(shot.pos.y).toBeCloseTo(p.pos.y, 9);
    expect(shot.damage).toBe(A.damage);
    expect(shot.damageFar).toBe(A.damageFar);
    expect(shot.range).toBe(A.range);
    events.push(...run(sim, 20));
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: false, dir: 0 }]);
    expect(p.ammo).toBeLessThan(p.maxAmmo);
    // 다음 틱에 바로 다시 쏠 수 있다
    expect(ofType(tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), 'attack')).toHaveLength(1);
  });

  it('lateralOffset이 있어도 한 발짜리 연사는 가운데에서 나간다', () => {
    const def = getFighter('hinako').attack as AttackDef;
    const saved = def.lateralOffset;
    def.lateralOffset = 0.3;
    try {
      const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'hinako' }]);
      const p = fighters(sim)[0]!;
      tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
      expect(sim.projectiles[0]!.pos.y).toBeCloseTo(p.pos.y, 9);
    } finally {
      def.lateralOffset = saved;
    }
  });

  it('distanceDamage: damage → damageFar를 날아간 거리 비율로(정수 반올림, 0~1로 자름)', () => {
    const p = { damage: 800, damageFar: 1700, range: 10 };
    expect(distanceDamage(p, 0)).toBe(800);
    expect(distanceDamage(p, 5)).toBe(1250);
    expect(distanceDamage(p, 10)).toBe(1700);
    expect(distanceDamage(p, 15)).toBe(1700);
    expect(distanceDamage(p, -1)).toBe(800);
    expect(distanceDamage({ damage: 300 }, 7)).toBe(300);
  });

  it('멀리 있는 적일수록 세게 맞는다(날아간 거리로 계산)', () => {
    const hitAt = (dx: number) => {
      const sim = makeSim(testMap(30, 9, [[2, 4, 'A'], [2 + dx, 4, 'd']]), [{ id: 'hinako' }]);
      const p = fighters(sim)[0]!;
      const events = [...tick(sim, { [p.id]: attack(null) }), ...run(sim, 20)];
      const hits = ofType(events, 'hit').filter((h) => h.sourceId === p.id);
      expect(hits).toHaveLength(1);
      return hits[0]!.damage;
    };
    const flown = (dx: number) => dx - DUMMY_RADIUS - PROJECTILE_RADIUS;
    const expected = (dx: number) => Math.round(A.damage + (A.damageFar! - A.damage) * Math.min(1, flown(dx) / A.range));
    const near = hitAt(3);
    const far = hitAt(9);
    expect(near).toBe(expected(3));
    expect(far).toBe(expected(9));
    expect(far).toBeGreaterThan(near);
  });

  it('적중 1회마다 superChargePerHit만큼 찬다', () => {
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A'], [6, 4, 'd']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    run(sim, 10);
    expect(p.superCharge).toBeCloseTo(A.superChargePerHit, 9);
  });
});

describe('HINAKO 궁극기: leap', () => {
  /** 넓은 빈 맵, A는 (3,5) */
  const open = (extra: Array<[number, number, string]> = []) => testMap(30, 11, [[3, 5, 'A'], ...extra]);

  function leap(sim: ReturnType<typeof makeSim>, aim: { x: number; y: number } | null) {
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const events = tick(sim, { [p.id]: superIn(aim) });
    return { p, events };
  }

  it('조준 방향으로 range × |aim|만큼, leapTime 동안 직선으로 날아간다', () => {
    const sim = makeSim(open(), [{ id: 'hinako' }]);
    const from = center(3, 5);
    const { p, events } = leap(sim, { x: 1, y: 0 });
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: true, dir: 0 }]);
    expect(p.superCharge).toBe(0);
    const act = leapOf(p);
    expect(act.from).toEqual(from);
    expect(act.to.x).toBeCloseTo(from.x + S.range, 9);
    expect(act.to.y).toBeCloseTo(from.y, 9);
    expect(act.endTick - act.startTick).toBe(LEAP_TICKS);
    expect(isAirborne(p)).toBe(true);
    // 위치는 매 틱 from→to 직선 보간
    run(sim, 10);
    expect(p.pos.x).toBeCloseTo(from.x + (S.range * 10) / LEAP_TICKS, 9);
    run(sim, LEAP_TICKS - 10);
    expect(p.action).toBeNull();
    expect(p.pos).toEqual(act.to);
    // 착지한 다음 틱부터 움직인다
    tick(sim, { [p.id]: { move: { x: 0, y: 1 } } });
    expect(p.pos.y).toBeGreaterThan(from.y);
  });

  it('조준 길이에 비례하고, 최소 2타일은 뛴다', () => {
    const half = makeSim(open(), [{ id: 'hinako' }]);
    expect(leapOf(leap(half, { x: 0, y: 0.5 }).p).to.y).toBeCloseTo(5.5 + S.range * 0.5, 9);
    const tiny = makeSim(open(), [{ id: 'hinako' }]);
    expect(leapOf(leap(tiny, { x: 0.05, y: 0 }).p).to.x).toBeCloseTo(3.5 + MIN_LEAP_DIST, 9);
  });

  it('점프 중에는 이동·공격·궁극기를 받지 않는다', () => {
    const sim = makeSim(open(), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const ammo = p.ammo;
    p.superCharge = 1;
    const events = run(sim, 5, { [p.id]: { move: { x: 0, y: 1 }, attack: { aim: { x: 0, y: 1 } }, super: { aim: null } } });
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(p.pos.y).toBeCloseTo(5.5, 9);
    expect(p.superCharge).toBe(1);
    expect(p.ammo).toBe(ammo); // 탄을 쓰지 않았다
  });

  it('벽과 물을 넘어간다', () => {
    const marks: Array<[number, number, string]> = [];
    for (let y = 1; y <= 9; y++) marks.push([6, y, 'X'], [8, y, 'W']);
    const sim = makeSim(open(marks), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    run(sim, LEAP_TICKS);
    expect(p.pos.x).toBeCloseTo(3.5 + S.range, 9);
    expect(circleBlocked(sim.grid, p.pos.x, p.pos.y, p.radius)).toBe(false);
  });

  it('목표가 막혔으면 1.5타일 안의 가장 가까운 빈 곳에 내린다', () => {
    // 목표 (11, 5.5)가 2×2 단단한 벽 (10..11, 4..5) 안
    const sim = makeSim(open([[10, 4, 'X'], [11, 4, 'X'], [10, 5, 'X'], [11, 5, 'X']]), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const to = leapOf(p).to;
    const raw = { x: 3.5 + S.range, y: 5.5 };
    expect(circleBlocked(sim.grid, to.x, to.y, p.radius)).toBe(false);
    expect(Math.hypot(to.x - raw.x, to.y - raw.y)).toBeLessThanOrEqual(LEAP_LAND_SEARCH + 1e-9);
    // 벽 블록 아래쪽이 가장 가깝다: y ≥ 6 + 반지름
    expect(to.y).toBeGreaterThanOrEqual(6 + p.radius - 1e-9);
  });

  it('1.5타일 안에 빈 곳이 없으면 출발점 쪽으로 물러나 내린다', () => {
    const marks: Array<[number, number, string]> = [];
    for (let x = 8; x <= 14; x++) for (let y = 1; y <= 9; y++) marks.push([x, y, 'W']);
    const sim = makeSim(open(marks), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const to = leapOf(p).to;
    expect(to.y).toBeCloseTo(5.5, 9);
    expect(to.x + p.radius).toBeLessThanOrEqual(8 + 1e-9);
    expect(to.x + p.radius).toBeGreaterThan(8 - 0.06);
  });

  it('맵 밖을 노려도 맵 안에 내린다', () => {
    const sim = makeSim(open(), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 0, y: -1 });
    const to = leapOf(p).to;
    expect(circleBlocked(sim.grid, to.x, to.y, p.radius)).toBe(false);
    expect(to.y - p.radius).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('자동 조준: 가장 가까운 보이는 적에게서 정반대로 끝까지, 적이 없으면 바라보는 방향', () => {
    const sim = makeSim(testMap(30, 11, [[12, 5, 'A'], [15, 5, 'd'], [12, 9, 'd']]), [{ id: 'hinako' }]);
    const { p } = leap(sim, null);
    const act = leapOf(p);
    expect(act.to.x).toBeCloseTo(12.5 - S.range, 9);
    expect(act.to.y).toBeCloseTo(5.5, 9);

    const zero = makeSim(testMap(30, 11, [[12, 5, 'A'], [12, 8, 'd']]), [{ id: 'hinako' }]);
    const z = leap(zero, { x: 0, y: 0 }).p;
    expect(leapOf(z).to.y).toBeLessThan(5.5 - 2); // 아래쪽 더미에게서 위로

    const none = makeSim(testMap(30, 11, [[12, 5, 'A']]), [{ id: 'hinako' }], { dummies: false });
    const n = fighters(none)[0]!;
    tick(none, { [n.id]: { move: { x: -1, y: 0 } } });
    expect(resolveLeapAim(none, n, null).dir).toBeCloseTo(Math.PI, 9);
    const nl = leapOf(leap(none, null).p);
    expect(nl.to.x).toBeCloseTo(nl.from.x - S.range, 9);
    expect(nl.to.y).toBeCloseTo(nl.from.y, 9);
  });

  it('뛴 자리에 count개 폭탄: 반지름 1 원 위에 균등, 첫 폭탄은 점프 반대쪽, fuse 뒤 범위 피해', () => {
    const sim = makeSim(open([[2, 5, 'd']]), [{ id: 'hinako' }]);
    const d = dummies(sim)[0]!;
    const from = center(3, 5);
    const { p } = leap(sim, { x: 1, y: 0 });
    expect(sim.lobs).toHaveLength(S.count);
    sim.lobs.forEach((l, i) => {
      const a = Math.PI + (i * Math.PI * 2) / S.count;
      expect(l.ownerId).toBe(p.id);
      expect(l.from).toEqual(from);
      expect(l.to.x).toBeCloseTo(from.x + Math.cos(a) * LEAP_BOMB_RING, 9);
      expect(l.to.y).toBeCloseTo(from.y + Math.sin(a) * LEAP_BOMB_RING, 9);
      expect(l.endTick - l.startTick).toBe(FUSE_TICKS);
      expect(l.damage).toBe(S.damage);
      expect(l.aoeRadius).toBe(S.aoeRadius);
      expect(l.isSuper).toBe(true);
      expect(l.breaksWalls).toBe(false);
    });
    const before = run(sim, FUSE_TICKS - 1);
    expect(ofType(before, 'explode')).toHaveLength(0);
    const boom = tick(sim);
    expect(ofType(boom, 'explode')).toHaveLength(S.count);
    const hits = ofType(boom, 'hit');
    // 더미(1타일 왼쪽)까지 폭탄 거리 0, √2, 2, √2 → 반지름 1.3 + 0.45 안에 드는 3개에 맞는다
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.targetId === d.id && h.isSuper && h.damage === S.damage)).toBe(true);
    expect(sim.lobs).toHaveLength(0);
    expect(p.superCharge).toBe(0); // 궁극기 적중은 충전하지 않는다
  });

  it('점프 중에는 피해를 받지 않고, 투사체는 소모되지 않고 지나간다', () => {
    // HINAKO(6,5)가 오른쪽으로 점프, 적 RIVET(12,5)이 왼쪽으로 산탄
    const sim = makeSim(testMap(30, 11, [[6, 5, 'A'], [12, 5, 'Z']]), [
      { id: 'hinako', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) });
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    const ids = new Set(sim.projectiles.filter((q) => q.ownerId === foe!.id).map((q) => q.id));
    expect(ids.size).toBe(5);
    const events = run(sim, 15);
    expect(ofType(events, 'hit').filter((h) => h.targetId === me!.id)).toHaveLength(0);
    expect(me!.hp).toBe(me!.maxHp);
    const ends = ofType(events, 'projectileEnd').filter((e) => ids.has(e.id));
    expect(ends.every((e) => e.reason !== 'hit')).toBe(true);
    // 산탄은 HINAKO를 지나 사거리 끝까지 날아갔다
    expect(ends.some((e) => e.reason === 'range' && e.pos.x < 6)).toBe(true);
    // 착지 뒤에는 다시 맞는다
    run(sim, LEAP_TICKS);
    expect(me!.action).toBeNull();
    foe!.ammo = foe!.maxAmmo;
    const after = [...tick(sim, { [foe!.id]: attack(null) }), ...run(sim, 10)];
    expect(ofType(after, 'hit').some((h) => h.targetId === me!.id)).toBe(true);
  });

  it('점프 중에는 폭발 피해도 받지 않는다', () => {
    // 두 HINAKO가 같은 틱에 점프. 아군 HINAKO는 적 HINAKO가 뛴 자리 위를 폭탄이 터질 때 지나간다
    const sim = makeSim(testMap(32, 11, [[6, 5, 'A'], [10, 5, 'Z']]), [
      { id: 'hinako', team: 0 },
      { id: 'hinako', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    foe!.superCharge = 1;
    tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }), [foe!.id]: superIn({ x: 1, y: 0 }) });
    const events = run(sim, FUSE_TICKS);
    expect(ofType(events, 'explode').length).toBeGreaterThan(0);
    // 폭발 순간 아군 HINAKO는 폭탄 범위 안 공중에 있었다
    expect(isAirborne(me!)).toBe(true);
    expect(Math.hypot(me!.pos.x - 10.5, me!.pos.y - 5.5)).toBeLessThan(LEAP_BOMB_RING + S.aoeRadius!);
    expect(ofType(events, 'hit')).toHaveLength(0);
    expect(me!.hp).toBe(me!.maxHp);
  });

  it('점프 중인 적은 자동 조준·터렛이 노리지 않는다', () => {
    const sim = makeSim(testMap(30, 11, [[6, 5, 'A'], [12, 5, 't']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    const t = dummies(sim)[0]!;
    p.superCharge = 1;
    run(sim, secToTicks(1.5) - 1);
    tick(sim, { [p.id]: superIn({ x: 0, y: 0.5 }) }); // 터렛이 쏘려는 틱에 점프
    expect(isAirborne(p)).toBe(true);
    const events = run(sim, 5);
    expect(ofType(events, 'attack').filter((e) => e.unitId === t.id)).toHaveLength(0);
  });
});
