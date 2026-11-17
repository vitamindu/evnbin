import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import {
  DUMMY_REGEN_DELAY_TICKS,
  DUMMY_RESPAWN_TICKS,
  FIGHTER_RESPAWN_TICKS,
  PATROL_HALF_WIDTH,
  PATROL_SPEED,
  REGEN_DELAY_TICKS,
  REGEN_PER_SEC,
  TURRET_DAMAGE,
  TURRET_INTERVAL_TICKS,
  TURRET_SHOT_SPEED,
} from '../../../src/game/rules';
import { attack, center, dummies, fighters, makeSim, ofType, run, testMap, tick } from './helpers';

describe('더미', () => {
  it('idle은 가만히 있는다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [10, 4, 'd']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    expect(d.behavior).toBe('idle');
    run(sim, 120);
    expect(d.pos).toEqual(center(10, 4));
  });

  it('patrol은 시작점 기준 좌우 3타일을 오간다', () => {
    const sim = makeSim(testMap(24, 9, [[2, 4, 'A'], [12, 4, 'p']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    const x0 = d.pos.x;
    tick(sim);
    expect(d.pos.x - x0).toBeCloseTo(PATROL_SPEED / 30, 6);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 300; i++) {
      tick(sim);
      min = Math.min(min, d.pos.x);
      max = Math.max(max, d.pos.x);
      expect(d.pos.y).toBeCloseTo(center(12, 4).y, 9);
    }
    expect(max).toBeCloseTo(x0 + PATROL_HALF_WIDTH, 6);
    expect(min).toBeCloseTo(x0 - PATROL_HALF_WIDTH, 6);
  });

  it('patrol은 벽에 막히면 반대로 간다', () => {
    const sim = makeSim(testMap(24, 9, [[2, 4, 'A'], [12, 4, 'p'], [14, 3, 'X'], [14, 4, 'X'], [14, 5, 'X']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    const x0 = d.pos.x;
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < 300; i++) {
      tick(sim);
      max = Math.max(max, d.pos.x);
      min = Math.min(min, d.pos.x);
    }
    expect(max + d.radius).toBeLessThanOrEqual(14 + 1e-9);
    expect(max + d.radius).toBeGreaterThan(14 - 0.1);
    expect(min).toBeCloseTo(x0 - PATROL_HALF_WIDTH, 6);
  });

  it(`turret은 ${TURRET_INTERVAL_TICKS / 30}초마다 가장 가까운 적 파이터에게 느린 탄을 쏜다`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [7, 4, 't']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const t = dummies(sim)[0]!;
    const shotTicks: number[] = [];
    const hits = [];
    for (let i = 0; i < TURRET_INTERVAL_TICKS * 3 + 5; i++) {
      const ev = tick(sim);
      if (ofType(ev, 'attack').some((e) => e.unitId === t.id)) {
        shotTicks.push(sim.tick);
        const shot = sim.projectiles.find((q) => q.ownerId === t.id)!;
        expect(Math.hypot(shot.vel.x, shot.vel.y)).toBeCloseTo(TURRET_SHOT_SPEED, 6);
        expect(shot.vel.x).toBeLessThan(0);
      }
      hits.push(...ofType(ev, 'hit').filter((h) => h.sourceId === t.id));
    }
    expect(shotTicks).toEqual([TURRET_INTERVAL_TICKS, TURRET_INTERVAL_TICKS * 2, TURRET_INTERVAL_TICKS * 3]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.targetId === p.id && h.damage === TURRET_DAMAGE)).toBe(true);
    expect(t.facing).toBeCloseTo(Math.PI, 6);
  });

  it('turret은 사거리 밖·벽 뒤·수풀에 숨은 적은 쏘지 않는다', () => {
    const fires = (marks: Array<[number, number, string]>, place?: { x: number; y: number }) => {
      const sim = makeSim(testMap(24, 9, marks), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      if (place) p.pos = place;
      const t = dummies(sim)[0]!;
      return ofType(run(sim, TURRET_INTERVAL_TICKS * 2), 'attack').filter((e) => e.unitId === t.id).length;
    };
    expect(fires([[2, 4, 'A'], [11, 4, 't']])).toBe(0); // 거리 9
    expect(fires([[2, 4, 'A'], [7, 4, 't'], [5, 3, 'X'], [5, 4, 'X'], [5, 5, 'X']])).toBe(0);
    expect(fires([[2, 4, 'A'], [9, 4, 't'], [4, 4, 'B']], center(4, 4))).toBe(0);
    expect(fires([[2, 4, 'A'], [9, 4, 't'], [4, 4, 'B']])).toBe(2); // 수풀 밖이면 쏜다
  });

  it(`더미는 죽으면 ${DUMMY_RESPAWN_TICKS / 30}초 뒤 시작 지점에서 부활한다`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    d.hp = 1;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) })];
    for (let i = 0; i < 5 && d.alive; i++) events.push(...tick(sim));
    const death = ofType(events, 'death')[0]!;
    expect(death.unitId).toBe(d.id);
    const deathTick = sim.tick;
    expect(d.alive).toBe(false);
    run(sim, DUMMY_RESPAWN_TICKS - 1);
    expect(d.alive).toBe(false);
    const ev = tick(sim);
    expect(ofType(ev, 'respawn')).toEqual([{ type: 'respawn', unitId: d.id }]);
    expect(sim.tick - deathTick).toBe(DUMMY_RESPAWN_TICKS);
    expect(d.alive).toBe(true);
    expect(d.hp).toBe(d.maxHp);
    expect(d.pos).toEqual(center(4, 4));
  });

  it(`파이터는 죽으면 ${FIGHTER_RESPAWN_TICKS / 30}초 뒤 출발 지점에서 탄창을 채우고 부활한다`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'Z']]), [
      { id: 'rivet', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.hp = 1;
    me!.ammo = 0;
    me!.pos = center(3, 4);
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    for (let i = 0; i < 5 && me!.alive; i++) tick(sim);
    expect(me!.alive).toBe(false);
    run(sim, FIGHTER_RESPAWN_TICKS - 1);
    expect(me!.alive).toBe(false);
    tick(sim);
    expect(me!.alive).toBe(true);
    expect(me!.hp).toBe(me!.maxHp);
    expect(me!.ammo).toBe(me!.maxAmmo);
    expect(me!.pos).toEqual(center(2, 4));
  });
});

describe('체력 회복', () => {
  it('마지막 전투 3초 뒤부터 초당 최대 체력의 13%', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.hp = 1000;
    p.lastCombatTick = sim.tick;
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(p.hp).toBe(1000);
    run(sim, 31);
    expect(p.hp).toBeCloseTo(1000 + p.maxHp * REGEN_PER_SEC * (31 / 30), 6);
    run(sim, 30 * 10);
    expect(p.hp).toBe(p.maxHp);
  });

  it('공격하면 회복 대기가 다시 시작된다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.hp = 1000;
    p.lastCombatTick = sim.tick;
    run(sim, 60);
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(p.hp).toBe(1000);
    tick(sim);
    expect(p.hp).toBeGreaterThan(1000);
  });

  it('맞으면 회복 대기가 다시 시작된다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [6, 4, 'Z']]), [
      { id: 'rivet', team: 0 },
      { id: 'boulder', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.hp = 1000;
    me!.lastCombatTick = 0;
    run(sim, 60);
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    for (let i = 0; i < 10 && me!.lastCombatTick <= 61; i++) tick(sim);
    const hpAfterHit = me!.hp;
    expect(hpAfterHit).toBeLessThan(1000);
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(me!.hp).toBe(hpAfterHit);
  });

  it('더미는 2초 뒤 빠르게 전부 회복한다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    for (let i = 0; i < 5 && d.hp === d.maxHp; i++) tick(sim);
    const hurt = d.hp;
    expect(hurt).toBe(d.maxHp - 5 * getFighter('rivet').attack.damage);
    run(sim, DUMMY_REGEN_DELAY_TICKS - 1);
    expect(d.hp).toBe(hurt);
    run(sim, 30);
    expect(d.hp).toBe(d.maxHp);
  });
});
