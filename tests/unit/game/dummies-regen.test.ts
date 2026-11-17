import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import {
  BUSH_REVEAL_DIST,
  DUMMY_REGEN_DELAY_TICKS,
  DUMMY_REGEN_PER_SEC,
  DUMMY_RESPAWN_TICKS,
  FIGHTER_RESPAWN_TICKS,
  PATROL_HALF_WIDTH,
  PATROL_SPEED,
  REGEN_DELAY_TICKS,
  REGEN_PER_SEC,
  TURRET_DAMAGE,
  TURRET_INTERVAL_TICKS,
  TURRET_RANGE,
  TURRET_SHOT_RADIUS,
  TURRET_SHOT_SPEED,
} from '../../../src/game/rules';
import { TICK_DT, TICK_RATE } from '../../../src/game/types';
import { attack, center, dummies, fighters, makeSim, ofType, run, runUntil, testMap, tick, ticksFor } from './helpers';

/** patrol 한 바퀴(오른쪽 끝 → 왼쪽 끝 → 오른쪽 끝)보다 넉넉한 틱 */
const PATROL_CYCLE = ticksFor(4 * PATROL_HALF_WIDTH + 2, PATROL_SPEED);
/** 터렛 사거리 안에서 가장 먼 정수 칸 거리 */
const TURRET_DX = Math.floor(TURRET_RANGE);

describe('더미', () => {
  it('idle은 가만히 있는다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [10, 4, 'd']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    expect(d.behavior).toBe('idle');
    run(sim, 120);
    expect(d.pos).toEqual(center(10, 4));
  });

  it(`patrol은 시작점 기준 좌우 ${PATROL_HALF_WIDTH}타일을 오간다`, () => {
    const px = Math.ceil(PATROL_HALF_WIDTH) + 3;
    const sim = makeSim(testMap(px * 2 + 2, 9, [[1, 1, 'A'], [px, 4, 'p']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    const x0 = d.pos.x;
    tick(sim);
    expect(d.pos.x - x0).toBeCloseTo(PATROL_SPEED * TICK_DT, 6);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < PATROL_CYCLE; i++) {
      tick(sim);
      min = Math.min(min, d.pos.x);
      max = Math.max(max, d.pos.x);
      expect(d.pos.y).toBeCloseTo(center(px, 4).y, 9);
    }
    expect(max).toBeCloseTo(x0 + PATROL_HALF_WIDTH, 6);
    expect(min).toBeCloseTo(x0 - PATROL_HALF_WIDTH, 6);
  });

  it('patrol은 벽에 막히면 반대로 간다', () => {
    const px = Math.ceil(PATROL_HALF_WIDTH) + 3;
    // 오른쪽 끝(px + 0.5 + HALF)보다 앞에 벽
    const wx = px + Math.max(1, Math.floor(PATROL_HALF_WIDTH) - 1);
    const sim = makeSim(testMap(px * 2 + 2, 9, [[1, 1, 'A'], [px, 4, 'p'], [wx, 3, 'X'], [wx, 4, 'X'], [wx, 5, 'X']]), [{ id: 'rivet' }]);
    const d = dummies(sim)[0]!;
    const x0 = d.pos.x;
    expect(wx).toBeLessThan(x0 + PATROL_HALF_WIDTH);
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < PATROL_CYCLE; i++) {
      tick(sim);
      max = Math.max(max, d.pos.x);
      min = Math.min(min, d.pos.x);
    }
    expect(max + d.radius).toBeLessThanOrEqual(wx + 1e-9);
    expect(max + d.radius).toBeGreaterThan(wx - 0.1);
    expect(min).toBeCloseTo(x0 - PATROL_HALF_WIDTH, 6);
  });

  it(`turret은 ${TURRET_INTERVAL_TICKS / TICK_RATE}초마다 가장 가까운 적 파이터에게 느린 탄을 쏜다`, () => {
    const tx = 2 + TURRET_DX;
    const sim = makeSim(testMap(tx + 6, 9, [[2, 4, 'A'], [tx, 4, 't']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const t = dummies(sim)[0]!;
    const travel = ticksFor(TURRET_DX - p.radius - TURRET_SHOT_RADIUS, TURRET_SHOT_SPEED);
    const shotTicks: number[] = [];
    const hits = [];
    for (let i = 0; i < TURRET_INTERVAL_TICKS * 3 + travel; i++) {
      const ev = tick(sim);
      if (ofType(ev, 'attack').some((e) => e.unitId === t.id)) {
        shotTicks.push(sim.tick);
        const shot = sim.projectiles.filter((q) => q.ownerId === t.id).sort((a, b) => b.id - a.id)[0]!; // 방금 쏜 탄
        expect(Math.hypot(shot.vel.x, shot.vel.y)).toBeCloseTo(TURRET_SHOT_SPEED, 6);
        expect(shot.vel.x).toBeLessThan(0);
      }
      hits.push(...ofType(ev, 'hit').filter((h) => h.sourceId === t.id));
    }
    expect(shotTicks.slice(0, 3)).toEqual([TURRET_INTERVAL_TICKS, TURRET_INTERVAL_TICKS * 2, TURRET_INTERVAL_TICKS * 3]);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.every((h) => h.targetId === p.id && h.damage === TURRET_DAMAGE)).toBe(true);
    expect(t.facing).toBeCloseTo(Math.PI, 6);
  });

  it('turret은 사거리 밖·벽 뒤·수풀에 숨은 적은 쏘지 않는다', () => {
    const fires = (marks: Array<[number, number, string]>, place?: { x: number; y: number }) => {
      const sim = makeSim(testMap(TURRET_DX + 12, 9, marks), [{ id: 'rivet' }]);
      const p = fighters(sim)[0]!;
      if (place) p.pos = place;
      const t = dummies(sim)[0]!;
      return ofType(run(sim, TURRET_INTERVAL_TICKS * 2), 'attack').filter((e) => e.unitId === t.id).length;
    };
    const inRange = 2 + TURRET_DX;
    const outOfRange = 2 + Math.ceil(TURRET_RANGE) + 1;
    // 수풀은 터렛에서 노출 거리보다 멀고 사거리 안
    const bushX = 3;
    expect(inRange - bushX).toBeGreaterThan(BUSH_REVEAL_DIST);
    expect(fires([[2, 4, 'A'], [outOfRange, 4, 't']])).toBe(0);
    expect(fires([[2, 4, 'A'], [inRange, 4, 't'], [4, 3, 'X'], [4, 4, 'X'], [4, 5, 'X']])).toBe(0);
    expect(fires([[2, 4, 'A'], [inRange, 4, 't'], [bushX, 4, 'B']], center(bushX, 4))).toBe(0);
    expect(fires([[2, 4, 'A'], [inRange, 4, 't'], [bushX, 4, 'B']])).toBe(2); // 수풀 밖이면 쏜다
  });

  it(`더미는 죽으면 ${DUMMY_RESPAWN_TICKS / TICK_RATE}초 뒤 시작 지점에서 부활한다`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    d.hp = 1;
    const events = [...tick(sim, { [p.id]: attack({ x: 1, y: 0 }) }), ...runUntil(sim, () => !d.alive, 120)];
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

  it(`파이터는 죽으면 ${FIGHTER_RESPAWN_TICKS / TICK_RATE}초 뒤 출발 지점에서 탄창을 채우고 부활한다`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [4, 4, 'Z']]), [
      { id: 'rivet', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.hp = 1;
    me!.ammo = 0;
    me!.pos = center(3, 4);
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    runUntil(sim, () => !me!.alive, 120);
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
  it(`마지막 전투 ${REGEN_DELAY_TICKS / TICK_RATE}초 뒤부터 초당 최대 체력의 ${REGEN_PER_SEC * 100}%`, () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.hp = 1000;
    p.lastCombatTick = sim.tick;
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(p.hp).toBe(1000);
    run(sim, TICK_RATE + 1);
    expect(p.hp).toBeCloseTo(1000 + p.maxHp * REGEN_PER_SEC * ((TICK_RATE + 1) / TICK_RATE), 6);
    run(sim, ticksFor(p.maxHp - 1000, p.maxHp * REGEN_PER_SEC));
    expect(p.hp).toBe(p.maxHp);
  });

  it('공격하면 회복 대기가 다시 시작된다', () => {
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    p.hp = 1000;
    p.lastCombatTick = sim.tick;
    run(sim, Math.floor(REGEN_DELAY_TICKS * 2 / 3));
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(p.hp).toBe(1000);
    tick(sim);
    expect(p.hp).toBeGreaterThan(1000);
  });

  it('맞으면 회복 대기가 다시 시작된다', () => {
    const B = getFighter('boulder').attack;
    const fx = 2 + Math.max(1, Math.floor(B.range)); // BOULDER 사거리 안
    const sim = makeSim(testMap(fx + 6, 9, [[2, 4, 'A'], [fx, 4, 'Z']]), [
      { id: 'rivet', team: 0 },
      { id: 'boulder', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.hp = 1000;
    me!.lastCombatTick = 0;
    run(sim, Math.floor(REGEN_DELAY_TICKS * 2 / 3));
    tick(sim, { [foe!.id]: attack({ x: -1, y: 0 }) });
    const attackTick = sim.tick;
    runUntil(sim, () => me!.lastCombatTick > attackTick, 120);
    const hpAfterHit = me!.hp;
    expect(hpAfterHit).toBeLessThan(1000);
    run(sim, REGEN_DELAY_TICKS - 1);
    expect(me!.hp).toBe(hpAfterHit);
  });

  it(`더미는 ${DUMMY_REGEN_DELAY_TICKS / TICK_RATE}초 뒤 빠르게 전부 회복한다`, () => {
    const a = getFighter('rivet').attack;
    const sim = makeSim(testMap(20, 9, [[2, 4, 'A'], [3, 4, 'd']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    runUntil(sim, () => d.hp < d.maxHp, 120);
    const hurt = d.hp;
    expect(hurt).toBe(d.maxHp - a.count * a.damage); // 바로 옆이라 모두 맞는다
    run(sim, DUMMY_REGEN_DELAY_TICKS - 1);
    expect(d.hp).toBe(hurt);
    run(sim, ticksFor(d.maxHp - hurt, d.maxHp * DUMMY_REGEN_PER_SEC));
    expect(d.hp).toBe(d.maxHp);
  });
});
