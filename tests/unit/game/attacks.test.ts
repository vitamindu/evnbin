import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { DUMMY_RADIUS, KNOCKBACK_TICKS, PROJECTILE_RADIUS, SUPER_PROJECTILE_RADIUS } from '../../../src/game/rules';
import { TICK_DT, TICK_RATE } from '../../../src/game/types';
import { Tile } from '../../../src/game/world';
import { attack, center, dummies, fighters, makeSim, ofType, run, superIn, testMap, tick, ticksFor, withoutJitter } from './helpers';

const RIVET = getFighter('rivet');
const VOLLEY = getFighter('volley');

/** 왼쪽에 플레이어(A, 타일 (2,3)), 같은 줄 dx칸 오른쪽에 가만히 있는 더미 */
function rangeMap(dx: number) {
  return testMap(Math.max(12, dx + 6), 7, [
    [2, 3, 'A'],
    [2 + dx, 3, 'd'],
  ]);
}

/** 사거리 끝까지 날아가는 데 필요한 틱(여유 포함) */
const flightTicks = (range: number, speed: number) => ticksFor(range, speed);

describe('spread', () => {
  it('count발을 spreadDeg 부채꼴에 균등 각도로 동시에 쏜다', () => {
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const events = tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    const a = RIVET.attack;
    expect(sim.projectiles).toHaveLength(a.count);
    const angles = sim.projectiles.map((s) => Math.atan2(s.vel.y, s.vel.x)).sort((x, y) => x - y);
    const step = (a.spreadDeg * Math.PI) / 180 / (a.count - 1);
    angles.forEach((ang, i) => expect(ang).toBeCloseTo(-((a.spreadDeg * Math.PI) / 360) + i * step, 6));
    for (const s of sim.projectiles) {
      expect(Math.hypot(s.vel.x, s.vel.y)).toBeCloseTo(a.projectileSpeed, 6);
      expect(s.radius).toBe(PROJECTILE_RADIUS);
      expect(s.isSuper).toBe(false);
    }
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: false, dir: 0 }]);
    expect(p.ammo).toBe(a.ammo - 1); // 가득 찬 상태에서는 재장전이 진행되지 않는다
  });

  it('가까울수록 많이 맞는다(기하로만, 맞는 발 수가 기하 계산과 같다)', () => {
    const a = RIVET.attack;
    const hitR = DUMMY_RADIUS + PROJECTILE_RADIUS;
    /** 거리 D의 더미에 맞는 탄 수: 탄 경로가 더미 원(반지름 hitR)에 닿고, 닿는 지점이 사거리 안 */
    const predicted = (D: number) => {
      let n = 0;
      for (let i = 0; i < a.count; i++) {
        const th = ((i / (a.count - 1) - 0.5) * a.spreadDeg * Math.PI) / 180;
        const perp = Math.abs(D * Math.sin(th));
        if (perp >= hitR) continue;
        if (D * Math.cos(th) - Math.sqrt(hitR * hitR - perp * perp) <= a.range) n++;
      }
      return n;
    };
    const hitsAt = (dx: number) => {
      const sim = makeSim(rangeMap(dx), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), ...run(sim, flightTicks(a.range, a.projectileSpeed))];
      return ofType(events, 'hit').filter((e) => e.sourceId === p.id).length;
    };
    const nearD = 1;
    const farD = Math.floor(a.range + hitR - 1e-6); // 가운데 탄이 겨우 닿는 거리
    const midD = Math.round((nearD + farD) / 2);
    const near = hitsAt(nearD);
    const mid = hitsAt(midD);
    const far = hitsAt(farD);
    expect(near).toBe(predicted(nearD));
    expect(mid).toBe(predicted(midD));
    expect(far).toBe(predicted(farD));
    expect(near).toBe(a.count);
    expect(far).toBeGreaterThanOrEqual(1);
    expect(far).toBeLessThan(near);
    expect(mid).toBeLessThanOrEqual(near);
    expect(far).toBeLessThanOrEqual(mid);
  });

  it('사거리 끝에서 사라진다(range 사건)', () => {
    const a = getFighter('boulder').attack;
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'boulder' }]);
    const p = fighters(sim)[0]!;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), ...run(sim, flightTicks(a.range, a.projectileSpeed))];
    const ends = ofType(events, 'projectileEnd');
    expect(ends).toHaveLength(a.count);
    for (const e of ends) {
      expect(e.reason).toBe('range');
      expect(Math.hypot(e.pos.x - 2.5, e.pos.y - 4.5)).toBeCloseTo(a.range, 3);
    }
  });

  it('벽에 막힌다(기본 공격은 벽을 부수지 않는다)', () => {
    const a = RIVET.attack;
    const wallX = 2 + Math.max(2, Math.floor(a.range / 2)); // 사거리 안의 벽 줄
    const marks: Array<[number, number, string]> = [[2, 3, 'A']];
    for (let y = 1; y <= 5; y++) marks.push([wallX, y, '#']);
    const sim = makeSim(testMap(wallX + 6, 7, marks), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), ...run(sim, flightTicks(a.range, a.projectileSpeed))];
    expect(ofType(events, 'wallsBroken')).toHaveLength(0);
    expect(sim.grid.get(wallX, 3)).toBe(Tile.Wall);
    const ends = ofType(events, 'projectileEnd');
    expect(ends).toHaveLength(a.count);
    expect(ends.every((e) => e.reason === 'wall' && e.pos.x < wallX)).toBe(true);
  });
});

describe('burst', () => {
  it('count발을 burstInterval 간격으로 연사하고, attack 사건은 한 번만 나온다', () => {
    const a = VOLLEY.attack;
    const sim = makeSim(testMap(40, 9, [[2, 4, 'A']]), [{ id: 'volley' }]);
    const p = fighters(sim)[0]!;
    const total = Math.ceil((a.count - 1) * a.burstInterval * TICK_RATE) + 8;
    const spawnTick = new Map<number, number>();
    const events = [];
    for (let i = 0; i < total; i++) {
      events.push(...tick(sim, i === 0 ? { [p.id]: attack({ x: 1, y: 0 }) } : {}));
      for (const s of sim.projectiles) if (!spawnTick.has(s.id)) spawnTick.set(s.id, sim.tick);
      if (i === 0) expect(p.action?.kind).toBe('burst');
    }
    expect(spawnTick.size).toBe(a.count);
    const ticks = [...spawnTick.values()];
    expect(ticks[0]).toBe(1);
    // 마지막 탄은 (count-1)×interval 뒤(틱 단위로 반올림 오차 1틱 이내)
    expect(Math.abs(ticks[ticks.length - 1]! - ticks[0]! - (a.count - 1) * a.burstInterval * TICK_RATE)).toBeLessThan(1);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    expect(ofType(events, 'attack')).toHaveLength(1);
    expect(p.action).toBeNull();
    // 탄창은 한 칸만 쓴다
    expect(p.ammo).toBeCloseTo(a.ammo - 1 + ((total - 1) * TICK_DT) / a.reload, 6);
  });

  it('lateralOffset만큼 진행 방향의 좌우로 번갈아 발사한다', () => {
    const a = VOLLEY.attack;
    const sim = makeSim(testMap(40, 9, [[2, 4, 'A']]), [{ id: 'volley' }]);
    const p = fighters(sim)[0]!;
    const off = a.lateralOffset!;
    const ys = new Map<number, number>();
    const total = Math.ceil((a.count - 1) * a.burstInterval * TICK_RATE) + 2;
    for (let i = 0; i < total; i++) {
      tick(sim, i === 0 ? { [p.id]: attack({ x: 1, y: 0 }) } : {});
      for (const s of sim.projectiles) if (!ys.has(s.id)) ys.set(s.id, s.pos.y);
    }
    const offs = [...ys.values()].map((y) => y - p.pos.y);
    expect(offs).toHaveLength(a.count);
    offs.forEach((o, i) => expect(o).toBeCloseTo(i % 2 === 0 ? off : -off, 6));
  });

  it('연사 중에도 움직일 수 있고, 새 공격·궁극기는 무시된다', () => {
    const a = VOLLEY.attack;
    const sim = makeSim(testMap(40, 12, [[2, 4, 'A']]), [{ id: 'volley' }]);
    const p = fighters(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    p.superCharge = 1;
    const y0 = p.pos.y;
    const ammo0 = p.ammo;
    const events = [
      ...tick(sim, { [p.id]: attack({ x: 0, y: 1 }, { x: 0, y: 1 }) }),
      ...tick(sim, { [p.id]: superIn({ x: 0, y: 1 }, { x: 0, y: 1 }) }),
    ];
    expect(p.action?.kind).toBe('burst');
    expect(p.pos.y - y0).toBeCloseTo(2 * VOLLEY.moveSpeed * TICK_DT, 6);
    expect(p.facing).toBeCloseTo(0, 6); // 연사 방향을 바라본다
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(ofType(events, 'noAmmo')).toHaveLength(0);
    expect(p.superCharge).toBe(1);
    expect(p.ammo).toBeGreaterThan(ammo0); // 재장전만 진행
    // 연사가 끝나면 다시 공격할 수 있다
    run(sim, Math.ceil(a.count * a.burstInterval * TICK_RATE) + 1);
    expect(p.action).toBeNull();
    const after = tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    expect(ofType(after, 'attack')).toHaveLength(1);
  });
});

describe('탄창', () => {
  it('탄이 1 미만이면 공격하지 않고 noAmmo', () => {
    const a = RIVET.attack;
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const events = run(sim, a.ammo + 1, { [p.id]: attack({ x: 1, y: 0 }) });
    expect(ofType(events, 'attack')).toHaveLength(a.ammo);
    expect(ofType(events, 'noAmmo')).toEqual([{ type: 'noAmmo', unitId: p.id }]);
  });

  it('1칸은 reload초 뒤에 다시 찬다', () => {
    const a = RIVET.attack;
    const sim = makeSim(testMap(30, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    run(sim, a.ammo, { [p.id]: attack({ x: 1, y: 0 }) });
    const reloadTicks = Math.round(a.reload * TICK_RATE);
    // 탄창을 비운 마지막 틱에는 첫 칸이 이미 (ammo−1)틱만큼 찼다
    run(sim, reloadTicks - a.ammo - 1);
    expect(ofType(tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), 'noAmmo')).toHaveLength(1);
    expect(ofType(tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), 'attack')).toHaveLength(1);
  });
});

describe('궁극기 충전', () => {
  const settle = flightTicks(2, RIVET.attack.projectileSpeed);

  it('기본 공격 적중마다 superChargePerHit, 1이 되면 superReady 한 번', () => {
    const sim = makeSim(rangeMap(2), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    const a = RIVET.attack;
    const per = a.superChargePerHit;
    const volleys = Math.ceil(1 / (a.count * per)) + 1;
    const events = [];
    for (let shot = 0; shot < volleys; shot++) {
      p.ammo = p.maxAmmo;
      d.hp = d.maxHp;
      events.push(...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), ...run(sim, settle));
      if (shot === 0) expect(p.superCharge).toBeCloseTo(a.count * per, 9);
    }
    expect(p.superCharge).toBe(1);
    expect(ofType(events, 'superReady')).toEqual([{ type: 'superReady', unitId: p.id }]);
  });

  it('게이지가 1 미만이면 궁극기 입력을 무시한다', () => {
    const sim = makeSim(rangeMap(2), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 0.96;
    const events = tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) });
    expect(events).toHaveLength(0);
    expect(sim.projectiles).toHaveLength(0);
    expect(p.superCharge).toBe(0.96);
  });

  it('궁극기를 쓰면 0이 되고, 적중하면 기본 공격 기준으로 게이지가 찬다', () => {
    const sim = makeSim(rangeMap(2), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const events = [...tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) }), ...run(sim, flightTicks(2, RIVET.super.projectileSpeed))];
    expect(ofType(events, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: true, dir: 0 }]);
    const hits = ofType(events, 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.isSuper && h.damage === RIVET.super.damage)).toBe(true);
    expect(p.superCharge).toBeCloseTo(hits.length * RIVET.attack.superChargePerHit, 9);
    expect(ofType(events, 'superReady')).toHaveLength(0);
  });

  it('궁극기와 기본 공격이 같은 틱이면 궁극기만, 탄창은 그대로', () => {
    const sim = makeSim(rangeMap(2), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const events = tick(sim, { [p.id]: { move: { x: 0, y: 0 }, attack: { aim: { x: 1, y: 0 } }, super: { aim: { x: 1, y: 0 } } } });
    expect(ofType(events, 'attack')).toHaveLength(1);
    expect(ofType(events, 'attack')[0]!.isSuper).toBe(true);
    expect(p.ammo).toBe(p.maxAmmo);
  });
});

describe('궁극기: spread (RIVET Scrap Cannon)', () => {
  const s = RIVET.super;
  /** A(2,4). 부서지는 벽 줄 breakX, 가운데 탄이 닿는 단단한 벽 줄 hardX */
  const hardX = Math.floor(2.5 + s.range + SUPER_PROJECTILE_RADIUS - 1e-6);
  const breakX = 2 + Math.max(2, Math.floor((hardX - 2) / 2));
  const wallMap = () => {
    const marks: Array<[number, number, string]> = [[2, 4, 'A']];
    for (let y = 1; y <= 7; y++) marks.push([breakX, y, '#'], [hardX, y, 'X']);
    return testMap(hardX + 6, 9, marks);
  };

  it('SuperDef 값으로 쏘고, 부서지는 벽을 부수며 계속 날아가 단단한 벽에서 멈춘다', () => {
    expect(breakX).toBeLessThan(hardX - 1);
    const sim = makeSim(wallMap(), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const first = tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) });
    expect(sim.projectiles).toHaveLength(s.count);
    expect(sim.projectiles.every((q) => q.isSuper && q.breaksWalls && q.knockback === s.knockback && q.damage === s.damage)).toBe(true);
    // 탄속 흔들림이 있으면 가장 느린 탄 기준으로 기다린다
    const events = [...first, ...run(sim, flightTicks(s.range, s.projectileSpeed * (1 - (s.speedJitter ?? 0))))];
    const broken = ofType(events, 'wallsBroken').flatMap((e) => e.tiles);
    expect(broken).toContainEqual({ x: breakX, y: 4 });
    for (const t of broken) {
      expect(t.x).toBe(breakX);
      expect(sim.grid.get(t.x, t.y)).toBe(Tile.Floor);
    }
    // 같은 타일은 한 번만 알린다
    expect(new Set(broken.map((t) => `${t.x},${t.y}`)).size).toBe(broken.length);
    const ends = ofType(events, 'projectileEnd');
    expect(ends).toHaveLength(s.count);
    // 가운데 탄은 부순 벽을 지나 단단한 벽 앞에서 멈춘다
    expect(ends.some((e) => e.reason === 'wall' && e.pos.x > hardX - 1 && e.pos.x < hardX)).toBe(true);
    expect(ends.every((e) => !(e.reason === 'wall' && e.pos.x < breakX + 0.5))).toBe(true);
    for (let y = 1; y <= 7; y++) expect(sim.grid.get(hardX, y)).toBe(Tile.HardWall);
  });

  it('맞은 대상을 넉백 거리만큼 맞은 방향으로 밀어낸다(탄속 흔들림 없이)', () =>
    withoutJitter(() => {
    const sim = makeSim(testMap(Math.ceil(8 + s.knockback * 2), 9, [[2, 4, 'A'], [4, 4, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    p.superCharge = 1;
    const x0 = d.pos.x;
    tick(sim, { [p.id]: superIn({ x: 1, y: 0 }) });
    run(sim, flightTicks(2, s.projectileSpeed) + KNOCKBACK_TICKS + 2);
    expect(d.pos.x - x0).toBeCloseTo(s.knockback, 2);
    expect(d.pos.y).toBeCloseTo(center(4, 4).y, 3);
    }));
});

describe('궁극기: burst (VOLLEY Overdrive)', () => {
  it('count발 연사, 벽을 부순다', () => {
    const s = VOLLEY.super;
    const breakX = 2 + Math.max(2, Math.floor(s.range / 2));
    const marks: Array<[number, number, string]> = [[2, 4, 'A']];
    for (let y = 1; y <= 7; y++) marks.push([breakX, y, '#']);
    const sim = makeSim(testMap(Math.ceil(s.range) + 10, 9, marks), [{ id: 'volley' }]);
    const p = fighters(sim)[0]!;
    p.superCharge = 1;
    const ids = new Set<number>();
    const events = [];
    const total = Math.ceil((s.count - 1) * s.burstInterval * TICK_RATE) + flightTicks(s.range, s.projectileSpeed);
    for (let i = 0; i < total; i++) {
      events.push(...tick(sim, i === 0 ? { [p.id]: superIn({ x: 1, y: 0 }) } : {}));
      for (const q of sim.projectiles) {
        ids.add(q.id);
        expect(q.isSuper).toBe(true);
        expect(q.breaksWalls).toBe(true);
      }
    }
    expect(ids.size).toBe(s.count);
    expect(ofType(events, 'attack')).toHaveLength(1);
    expect(ofType(events, 'wallsBroken').flatMap((e) => e.tiles)).toContainEqual({ x: breakX, y: 4 });
    expect(sim.grid.get(breakX, 4)).toBe(Tile.Floor);
    expect(p.superCharge).toBe(0);
  });
});
