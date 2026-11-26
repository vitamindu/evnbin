import { describe, expect, it } from 'vitest';
import { getFighter, type AttackDef } from '../../../src/data/fighters';
import { autoAimTarget, resolveLeapAim } from '../../../src/game/aim';
import {
  DUMMY_RADIUS,
  LEAP_BOMB_RING,
  LEAP_LAND_SEARCH,
  MIN_LEAP_DIST,
  PROJECTILE_RADIUS,
  TURRET_INTERVAL_TICKS,
  TURRET_RANGE,
  fighterRadius,
  secToTicks,
} from '../../../src/game/rules';
import { distanceDamage } from '../../../src/game/sim';
import { isAirborne } from '../../../src/game/status';
import type { Fighter } from '../../../src/game/types';
import { circleBlocked } from '../../../src/game/world';
import { attack, center, dummies, fighters, makeSim, ofType, run, runUntil, superIn, testMap, tick, ticksFor } from './helpers';

const A = getFighter('hinako').attack;
const S = getFighter('hinako').super;
const LEAP_TICKS = secToTicks(S.leapTime!);
const FUSE_TICKS = secToTicks(S.fuse!);
const AOE = S.aoeRadius!;

type Leap = Extract<NonNullable<Fighter['action']>, { kind: 'leap' }>;
const leapOf = (f: Fighter) => {
  expect(f.action?.kind).toBe('leap');
  return f.action as Leap;
};

describe('HINAKO 기본 공격: 한 발 저격 + 거리 비례 피해', () => {
  const flight = ticksFor(A.range, A.projectileSpeed);

  it('count 1 burst: 한 발, attack 사건 한 번, 옆으로 띄우지 않고, 같은 틱에 행동이 끝난다', () => {
    const sim = makeSim(testMap(Math.ceil(A.range) + 8, 9, [[2, 4, 'A']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) })];
    expect(p.action).toBeNull();
    expect(sim.projectiles).toHaveLength(1);
    const shot = sim.projectiles[0]!;
    expect(shot.pos.y).toBeCloseTo(p.pos.y, 9);
    expect(shot.damage).toBe(A.damage);
    expect(shot.damageFar).toBe(A.damageFar);
    expect(shot.range).toBe(A.range);
    events.push(...run(sim, flight));
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
    const hitR = DUMMY_RADIUS + PROJECTILE_RADIUS;
    const hitAt = (dx: number) => {
      const sim = makeSim(testMap(dx + 8, 9, [[2, 4, 'A'], [2 + dx, 4, 'd']]), [{ id: 'hinako' }]);
      const p = fighters(sim)[0]!;
      const events = [...tick(sim, { [p.id]: attack(null) }), ...run(sim, flight)];
      const hits = ofType(events, 'hit').filter((h) => h.sourceId === p.id);
      expect(hits).toHaveLength(1);
      return hits[0]!.damage;
    };
    // 탄은 몸 중심에서 나가 더미 원(반지름 hitR)에 닿을 때까지 dx − hitR을 날아간다
    const expected = (dx: number) => Math.round(A.damage + (A.damageFar! - A.damage) * Math.min(1, (dx - hitR) / A.range));
    const nearDx = 2;
    const farDx = Math.floor(A.range + hitR - 1e-6); // 사거리 끝에서 겨우 닿는 거리
    expect(farDx).toBeGreaterThan(nearDx);
    const near = hitAt(nearDx);
    const far = hitAt(farDx);
    expect(near).toBe(expected(nearDx));
    expect(far).toBe(expected(farDx));
    expect(far).toBeGreaterThan(near);
  });

  it('적중 1회마다 superChargePerHit만큼 찬다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'd']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    run(sim, flight);
    expect(p.superCharge).toBeCloseTo(A.superChargePerHit, 9);
  });
});

describe('HINAKO 궁극기: leap', () => {
  /** 점프 거리보다 넉넉한 빈 맵. A는 (AX, AY) */
  const AX = 3;
  const AY = Math.ceil(S.range) + 2;
  const W = AX + Math.ceil(S.range) * 2 + 8;
  const H = AY * 2 + 1;
  const FROM = center(AX, AY);
  const open = (extra: Array<[number, number, string]> = []) => testMap(W, H, [[AX, AY, 'A'], ...extra]);
  /** 오른쪽으로 끝까지 뛸 때의 목표 */
  const RAW = { x: FROM.x + S.range, y: FROM.y };
  const fullColumn = (x: number, ch: string): Array<[number, number, string]> => Array.from({ length: H - 2 }, (_, i) => [x, i + 1, ch]);

  function leap(sim: ReturnType<typeof makeSim>, aim: { x: number; y: number } | null) {
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const events = tick(sim, { [p.id]: superIn(aim) });
    return { p, events };
  }

  it('조준 방향으로 range × |aim|만큼, leapTime 동안 직선으로 날아간다', () => {
    const sim = makeSim(open(), [{ id: 'hinako' }]);
    const { p, events } = leap(sim, { x: 1, y: 0 });
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: true, dir: 0 }]);
    expect(p.superCharge).toBe(0);
    const act = leapOf(p);
    expect(act.from).toEqual(FROM);
    expect(act.to.x).toBeCloseTo(RAW.x, 9);
    expect(act.to.y).toBeCloseTo(RAW.y, 9);
    expect(act.endTick - act.startTick).toBe(LEAP_TICKS);
    expect(isAirborne(p)).toBe(true);
    // 위치는 매 틱 from→to 직선 보간
    const mid = Math.floor(LEAP_TICKS / 2);
    run(sim, mid);
    expect(p.pos.x).toBeCloseTo(FROM.x + (S.range * mid) / LEAP_TICKS, 9);
    run(sim, LEAP_TICKS - mid);
    expect(p.action).toBeNull();
    expect(p.pos).toEqual(act.to);
    // 착지한 다음 틱부터 움직인다
    tick(sim, { [p.id]: { move: { x: 0, y: 1 } } });
    expect(p.pos.y).toBeGreaterThan(FROM.y);
  });

  it(`조준 길이에 비례하고, 최소 ${MIN_LEAP_DIST}타일은 뛴다`, () => {
    const half = makeSim(open(), [{ id: 'hinako' }]);
    expect(leapOf(leap(half, { x: 0, y: 0.5 }).p).to.y).toBeCloseTo(FROM.y + Math.max(MIN_LEAP_DIST, S.range * 0.5), 9);
    const tiny = makeSim(open(), [{ id: 'hinako' }]);
    const short = MIN_LEAP_DIST / S.range / 2; // 최소 거리의 절반만 조준
    expect(leapOf(leap(tiny, { x: short, y: 0 }).p).to.x).toBeCloseTo(FROM.x + MIN_LEAP_DIST, 9);
  });

  it('점프 중에는 이동·공격·궁극기를 받지 않는다', () => {
    const sim = makeSim(open(), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const ammo = p.ammo;
    p.superCharge = 1;
    const events = run(sim, Math.min(5, LEAP_TICKS - 1), { [p.id]: { move: { x: 0, y: 1 }, attack: { aim: { x: 0, y: 1 } }, super: { aim: null } } });
    expect(isAirborne(p)).toBe(true);
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(p.pos.y).toBeCloseTo(FROM.y, 9);
    expect(p.superCharge).toBe(1);
    expect(p.ammo).toBe(ammo); // 탄을 쓰지 않았다
  });

  it('벽과 물을 넘어간다', () => {
    // 출발점과 착지점 사이에 단단한 벽 줄과 물 줄
    const landTile = Math.floor(RAW.x - fighterRadius('hinako'));
    const waterX = landTile - 2;
    const wallX = waterX - 2;
    expect(wallX).toBeGreaterThan(AX);
    const sim = makeSim(open([...fullColumn(wallX, 'X'), ...fullColumn(waterX, 'W')]), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    run(sim, LEAP_TICKS);
    expect(p.action).toBeNull();
    expect(p.pos.x).toBeCloseTo(RAW.x, 9);
    expect(circleBlocked(sim.grid, p.pos.x, p.pos.y, p.radius)).toBe(false);
  });

  it(`목표가 막혔으면 ${LEAP_LAND_SEARCH}타일 안의 가장 가까운 빈 곳에 내린다`, () => {
    // 목표를 감싸는 가로 3 × 세로 2 단단한 벽. 목표에서 아래쪽 빈 곳(0.5 + 반지름)이 가장 가깝다
    const bx = Math.floor(RAW.x) - 1;
    const by = AY - 1;
    const marks: Array<[number, number, string]> = [];
    for (let x = bx; x < bx + 3; x++) for (let y = by; y < by + 2; y++) marks.push([x, y, 'X']);
    const sim = makeSim(open(marks), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const to = leapOf(p).to;
    expect(circleBlocked(sim.grid, RAW.x, RAW.y, p.radius)).toBe(true);
    expect(circleBlocked(sim.grid, to.x, to.y, p.radius)).toBe(false);
    expect(Math.hypot(to.x - RAW.x, to.y - RAW.y)).toBeLessThanOrEqual(LEAP_LAND_SEARCH + 1e-9);
    expect(to.y).toBeGreaterThanOrEqual(by + 2 + p.radius - 1e-9);
  });

  it(`${LEAP_LAND_SEARCH}타일 안에 빈 곳이 없으면 출발점 쪽으로 물러나 내린다`, () => {
    // 목표 주변 LEAP_LAND_SEARCH + 반지름보다 넓게 물
    const r = fighterRadius('hinako');
    const wx0 = Math.floor(RAW.x - LEAP_LAND_SEARCH - r) - 1;
    expect(wx0).toBeGreaterThan(AX);
    const marks: Array<[number, number, string]> = [];
    for (let x = wx0; x <= Math.ceil(RAW.x + LEAP_LAND_SEARCH + 1); x++) marks.push(...fullColumn(x, 'W'));
    const sim = makeSim(open(marks), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 1, y: 0 });
    const to = leapOf(p).to;
    expect(to.y).toBeCloseTo(FROM.y, 9);
    expect(to.x + p.radius).toBeLessThanOrEqual(wx0 + 1e-9);
    expect(to.x + p.radius).toBeGreaterThan(wx0 - 0.06);
  });

  it('맵 밖을 노려도 맵 안에 내린다', () => {
    const sim = makeSim(testMap(W, H, [[AX, 2, 'A']]), [{ id: 'hinako' }]);
    const { p } = leap(sim, { x: 0, y: -1 });
    const to = leapOf(p).to;
    expect(circleBlocked(sim.grid, to.x, to.y, p.radius)).toBe(false);
    expect(to.y - p.radius).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('자동 조준: 가장 가까운 보이는 적에게서 정반대로 끝까지, 적이 없으면 바라보는 방향', () => {
    const ax = Math.ceil(S.range) + 3;
    const sim = makeSim(testMap(ax + 8, H, [[ax, AY, 'A'], [ax + 3, AY, 'd'], [ax, AY + 4, 'd']]), [{ id: 'hinako' }]);
    const { p } = leap(sim, null);
    const act = leapOf(p);
    expect(act.to.x).toBeCloseTo(ax + 0.5 - S.range, 9);
    expect(act.to.y).toBeCloseTo(AY + 0.5, 9);

    const zero = makeSim(testMap(ax + 8, H, [[ax, AY, 'A'], [ax, AY + 3, 'd']]), [{ id: 'hinako' }]);
    const z = leap(zero, { x: 0, y: 0 }).p;
    expect(leapOf(z).to.y).toBeLessThan(AY + 0.5 - MIN_LEAP_DIST + 1e-9); // 아래쪽 더미에게서 위로

    const none = makeSim(testMap(ax + 8, H, [[ax, AY, 'A']]), [{ id: 'hinako' }], { dummies: false });
    const n = fighters(none)[0]!;
    tick(none, { [n.id]: { move: { x: -1, y: 0 } } });
    expect(resolveLeapAim(none, n, null).dir).toBeCloseTo(Math.PI, 9);
    const nl = leapOf(leap(none, null).p);
    expect(nl.to.x).toBeCloseTo(nl.from.x - S.range, 9);
    expect(nl.to.y).toBeCloseTo(nl.from.y, 9);
  });

  it('뛴 자리에 count개 폭탄: 반지름 LEAP_BOMB_RING 원 위에 균등, 첫 폭탄은 점프 반대쪽, fuse 뒤 범위 피해', () => {
    const sim = makeSim(open([[AX - 1, AY, 'd']]), [{ id: 'hinako' }]);
    const d = dummies(sim)[0]!;
    const { p } = leap(sim, { x: 1, y: 0 });
    const bombAt = (i: number) => {
      const a = Math.PI + (i * Math.PI * 2) / S.count;
      return { x: FROM.x + Math.cos(a) * LEAP_BOMB_RING, y: FROM.y + Math.sin(a) * LEAP_BOMB_RING };
    };
    expect(sim.lobs).toHaveLength(S.count);
    sim.lobs.forEach((l, i) => {
      expect(l.ownerId).toBe(p.id);
      expect(l.from).toEqual(FROM);
      expect(l.to.x).toBeCloseTo(bombAt(i).x, 9);
      expect(l.to.y).toBeCloseTo(bombAt(i).y, 9);
      expect(l.endTick - l.startTick).toBe(FUSE_TICKS);
      expect(l.damage).toBe(S.damage);
      expect(l.aoeRadius).toBe(AOE);
      expect(l.isSuper).toBe(true);
      expect(l.breaksWalls).toBe(false);
    });
    const before = run(sim, FUSE_TICKS - 1);
    expect(ofType(before, 'explode')).toHaveLength(0);
    const boom = tick(sim);
    expect(ofType(boom, 'explode')).toHaveLength(S.count);
    const hits = ofType(boom, 'hit');
    // 더미(뛴 자리 바로 왼쪽)는 범위 + 반지름 안에 드는 폭탄마다 맞는다
    const inRange = Array.from({ length: S.count }, (_, i) => bombAt(i)).filter(
      (b) => Math.hypot(b.x - d.spawn.x, b.y - d.spawn.y) <= AOE + d.radius,
    ).length;
    expect(inRange).toBeGreaterThan(0);
    expect(hits).toHaveLength(inRange);
    expect(hits.every((h) => h.targetId === d.id && h.isSuper && h.damage === S.damage)).toBe(true);
    expect(sim.lobs).toHaveLength(0);
    expect(p.superCharge).toBeCloseTo(inRange * getFighter('hinako').attack.superChargePerHit, 9);
  });

  it('점프 중에는 피해를 받지 않고, 투사체는 소모되지 않고 지나간다', () => {
    // 적 RIVET이 HINAKO에게 산탄을 쏘고, 산탄이 닿기 직전에 HINAKO가 적 쪽으로 점프한다.
    // 산탄과 공중의 HINAKO가 엇갈리고(맞지 않음), 산탄은 뛴 자리 뒤쪽 사거리 끝까지 간다
    const R = getFighter('rivet').attack;
    const gap = Math.max(2, Math.floor(R.range * 0.6));
    const hx = Math.ceil(R.range) + 2;
    const sim = makeSim(testMap(hx + Math.ceil(S.range) + 8, 11, [[hx, 5, 'A'], [hx + gap, 5, 'Z']]), [
      { id: 'hinako', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    const ids = new Set(sim.projectiles.filter((q) => q.ownerId === foe!.id).map((q) => q.id));
    expect(ids.size).toBe(R.count);
    // 가장 앞선 탄이 HINAKO에게 한 틱 거리 안으로 들어오면 점프
    const step = (R.projectileSpeed * (1 + (R.speedJitter ?? 0))) / 30;
    const lead = () => Math.min(...sim.projectiles.filter((q) => ids.has(q.id)).map((q) => q.pos.x));
    const reach = me!.pos.x + me!.radius + PROJECTILE_RADIUS;
    const events = runUntil(sim, () => lead() - reach <= 2 * step, ticksFor(gap, R.projectileSpeed * (1 - (R.speedJitter ?? 0))));
    expect(ofType(events, 'hit')).toHaveLength(0);
    events.push(...tick(sim, { [me!.id]: superIn({ x: 1, y: 0 }) }));
    expect(isAirborne(me!)).toBe(true);
    // 공중에 있는 동안 어떤 탄이 HINAKO의 현재 위치를 지나쳤는가(엇갈림)
    let crossedInAir = false;
    events.push(
      ...runUntil(
        sim,
        () => {
          const live = sim.projectiles.filter((q) => ids.has(q.id));
          if (isAirborne(me!) && live.some((q) => q.pos.x < me!.pos.x)) crossedInAir = true;
          return live.length === 0;
        },
        ticksFor(R.range, R.projectileSpeed * (1 - (R.speedJitter ?? 0))),
      ),
    );
    expect(crossedInAir).toBe(true);
    expect(ofType(events, 'hit').filter((h) => h.targetId === me!.id)).toHaveLength(0);
    expect(me!.hp).toBe(me!.maxHp);
    const ends = ofType(events, 'projectileEnd').filter((e) => ids.has(e.id));
    expect(ends).toHaveLength(R.count);
    expect(ends.every((e) => e.reason === 'range')).toBe(true);
    // 가운데 탄은 HINAKO가 뛴 자리보다 뒤(왼쪽)까지 날아갔다
    expect(ends.some((e) => e.pos.x < hx + 0.5)).toBe(true);
    // 착지 뒤에는 다시 맞는다
    runUntil(sim, () => me!.action === null, LEAP_TICKS + 1);
    foe!.ammo = foe!.maxAmmo;
    const after = [...tick(sim, { [foe!.id]: attack(null) }), ...run(sim, ticksFor(R.range, R.projectileSpeed * (1 - (R.speedJitter ?? 0))))];
    expect(ofType(after, 'hit').some((h) => h.targetId === me!.id)).toBe(true);
  });

  it('점프 중에는 폭발 피해도 받지 않는다(착지 뒤에는 받는다)', () => {
    const sim = makeSim(open([[W - 3, 1, 'd']]), [{ id: 'hinako' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    /** 적(더미) 소유의 폭탄을 p 바로 위에 두고 다음 틱에 터뜨린다 */
    const dropOnMe = () =>
      sim.lobs.push({
        id: 10_000 + sim.tick,
        type: 'lob',
        ownerId: d.id,
        team: d.team,
        from: { ...p.pos },
        to: { ...p.pos },
        startTick: sim.tick,
        endTick: sim.tick + 1,
        damage: 500,
        aoeRadius: 1,
        isSuper: false,
        breaksWalls: false,
      });
    leap(sim, { x: 1, y: 0 });
    run(sim, Math.floor(LEAP_TICKS / 2));
    expect(isAirborne(p)).toBe(true);
    dropOnMe();
    const mid = tick(sim);
    expect(ofType(mid, 'explode')).toHaveLength(1);
    expect(ofType(mid, 'hit').filter((h) => h.targetId === p.id)).toHaveLength(0);
    expect(p.hp).toBe(p.maxHp);
    runUntil(sim, () => p.action === null, LEAP_TICKS);
    dropOnMe();
    const landed = tick(sim);
    expect(ofType(landed, 'hit').filter((h) => h.targetId === p.id)).toHaveLength(1);
  });

  it('점프 중인 적은 자동 조준·터렛이 노리지 않는다', () => {
    const tx = AX + Math.floor(TURRET_RANGE); // 터렛 사거리 안
    const make = () => makeSim(open([[tx, AY, 't']]), [{ id: 'hinako' }]);
    // 대조: 점프하지 않으면 터렛은 TURRET_INTERVAL_TICKS에 쏜다
    const calm = make();
    const ct = dummies(calm)[0]!;
    const calmShots = ofType(run(calm, TURRET_INTERVAL_TICKS + 5), 'attack').filter((e) => e.unitId === ct.id);
    expect(calmShots).toHaveLength(1);

    const sim = make();
    const p = fighters(sim)[0]!;
    const t = dummies(sim)[0]!;
    p.superCharge = 1;
    run(sim, TURRET_INTERVAL_TICKS - 1);
    tick(sim, { [p.id]: superIn({ x: 0, y: 0.5 }) }); // 터렛이 쏘려는 틱에 점프
    expect(isAirborne(p)).toBe(true);
    expect(autoAimTarget(sim, t, 100)).toBeNull();
    const events = run(sim, Math.min(5, LEAP_TICKS - 1));
    expect(ofType(events, 'attack').filter((e) => e.unitId === t.id)).toHaveLength(0);
  });
});
