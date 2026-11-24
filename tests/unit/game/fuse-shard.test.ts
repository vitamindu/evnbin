import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { botInput } from '../../../src/game/bot';
import { KNOCKBACK_TICKS, LOB_FLIGHT_TICKS, LOB_MIN_DIST, LOB_SPACING, ZONE_HIT_TICKS, secToTicks } from '../../../src/game/rules';
import { Sim } from '../../../src/game/sim';
import type { EntityId, FighterInput } from '../../../src/game/types';
import { Tile } from '../../../src/game/world';
import { attack, dummies, fighters, makeSim, ofType, run, superIn, testMap, tick, ticksFor } from './helpers';

const FUSE = getFighter('fuse');
const FUSE_TICKS = secToTicks(FUSE.attack.fuse ?? 0);
const SHARD = getFighter('shard');

describe('FUSE', () => {
  it('기본 공격: 조준 지점에 폭탄 2개를 조준과 수직으로 나란히, 빠른 비행', () => {
    const sim = makeSim(testMap(20, 11, [[3, 5, 'A']]), [{ id: 'fuse' }]);
    const p = fighters(sim)[0]!;
    const ev = tick(sim, { [p.id]: attack({ x: 0.5, y: 0 }) });
    expect(ofType(ev, 'attack')).toEqual([{ type: 'attack', unitId: p.id, isSuper: false, dir: 0 }]);
    expect(p.ammo).toBe(p.maxAmmo - 1);
    expect(sim.lobs).toHaveLength(FUSE.attack.count);
    const tx = 3.5 + FUSE.attack.range * 0.5;
    const ys = sim.lobs.map((l) => l.to.y).sort((a, b) => a - b);
    for (const l of sim.lobs) {
      expect(l.to.x).toBeCloseTo(tx, 9);
      expect(l.landTick! - l.startTick).toBe(LOB_FLIGHT_TICKS);
      expect(l.endTick - l.landTick!).toBe(FUSE_TICKS); // 떨어진 뒤 0.5초 있다가 터진다
      expect(l.aoeRadius).toBe(FUSE.attack.aoeRadius);
      expect(l.isSuper).toBe(false);
    }
    expect(ys[1]! - ys[0]!).toBeCloseTo(LOB_SPACING, 9);
    expect((ys[0]! + ys[1]!) / 2).toBeCloseTo(5.5, 9);
  });

  it(`조준이 짧아도 최소 ${LOB_MIN_DIST}타일, 자동 조준은 사거리 안 가장 가까운 적`, () => {
    const short = makeSim(testMap(20, 11, [[3, 5, 'A']]), [{ id: 'fuse' }]);
    const p = fighters(short)[0]!;
    tick(short, { [p.id]: attack({ x: 0.01, y: 0 }) });
    expect(short.lobs[0]!.to.x).toBeCloseTo(3.5 + LOB_MIN_DIST, 9);

    const auto = makeSim(testMap(20, 11, [[3, 5, 'A'], [6, 5, 'd']]), [{ id: 'fuse' }]);
    const q = fighters(auto)[0]!;
    tick(auto, { [q.id]: attack(null) });
    for (const l of auto.lobs) expect(l.to.x).toBeCloseTo(6.5, 9);
  });

  it('벽 너머 적에게 터져 피해, 맞은 수만큼 충전', () => {
    const marks: Array<[number, number, string]> = [[3, 5, 'A'], [7, 5, 'd']];
    for (let y = 1; y <= 9; y++) marks.push([5, y, 'X']);
    const sim = makeSim(testMap(20, 11, marks), [{ id: 'fuse' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 4 / FUSE.attack.range, y: 0 }) });
    // 떨어진 순간에는 아직 안 터진다
    expect(ofType(run(sim, LOB_FLIGHT_TICKS), 'explode')).toHaveLength(0);
    const ev = run(sim, FUSE_TICKS);
    const hits = ofType(ev, 'hit').filter((h) => h.targetId === d.id);
    expect(ofType(ev, 'explode')).toHaveLength(FUSE.attack.count);
    expect(hits).toHaveLength(FUSE.attack.count); // 두 폭탄 모두 범위 안
    expect(d.hp).toBe(d.maxHp - FUSE.attack.count * FUSE.attack.damage);
    expect(p.superCharge).toBeCloseTo(FUSE.attack.count * FUSE.attack.superChargePerHit, 9);
  });

  it('궁극기: 큰 폭탄 하나, 벽을 부수고 범위 안의 적을 폭발 중심에서 한 번 밀어낸다', () => {
    const sim = makeSim(testMap(20, 11, [[3, 5, 'A'], [9, 5, 'd'], [8, 4, '#']]), [{ id: 'fuse' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    p.superCharge = 1;
    const aimX = 8.5 - 3.5;
    tick(sim, { [p.id]: superIn({ x: aimX / FUSE.super.range, y: 0 }) });
    expect(sim.lobs).toHaveLength(1);
    expect(sim.lobs[0]!.aoeRadius).toBe(FUSE.super.aoeRadius);
    const x0 = d.pos.x;
    const ev = run(sim, LOB_FLIGHT_TICKS + secToTicks(FUSE.super.fuse ?? 0) + KNOCKBACK_TICKS + 2);
    expect(ofType(ev, 'hit').filter((h) => h.targetId === d.id)).toEqual([expect.objectContaining({ damage: FUSE.super.damage, isSuper: true })]);
    expect(ofType(ev, 'wallsBroken').flatMap((e) => e.tiles)).toContainEqual({ x: 8, y: 4 });
    expect(sim.grid.get(8, 4)).toBe(Tile.Floor);
    expect(d.pos.x - x0).toBeCloseTo(FUSE.super.knockback, 2);
    expect(p.superCharge).toBe(0);
  });
});

describe('SHARD', () => {
  const S = SHARD.attack.split!;
  const shardsOf = (sim: Sim, ownerId: EntityId) => sim.projectiles.filter((q) => q.ownerId === ownerId && q.damage === S.damage);

  it('본탄이 맞으면 그 자리에서 파편이 360도로 고르게(첫 파편은 진행 방향), 맞은 대상은 제외', () => {
    const sim = makeSim(testMap(20, 11, [[3, 5, 'A'], [6, 5, 'd']]), [{ id: 'shard' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    expect(sim.projectiles).toHaveLength(1);
    let ev: ReturnType<typeof tick> = [];
    for (let i = 0; i < 60 && shardsOf(sim, p.id).length === 0; i++) ev = tick(sim);
    expect(ofType(ev, 'hit')).toEqual([expect.objectContaining({ targetId: d.id, damage: SHARD.attack.damage })]);
    const shards = shardsOf(sim, p.id);
    expect(shards).toHaveLength(S.count);
    shards.forEach((q, i) => {
      const a = Math.atan2(q.vel.y, q.vel.x);
      const want = (i * Math.PI * 2) / S.count;
      expect(Math.cos(a - want)).toBeCloseTo(1, 9);
      expect(Math.hypot(q.vel.x, q.vel.y)).toBeCloseTo(S.speed, 9);
      expect(q.remaining).toBe(S.range);
      expect(q.hitIds).toEqual([d.id]);
    });
    const more = run(sim, ticksFor(S.range, S.speed));
    expect(ofType(more, 'hit').filter((h) => h.targetId === d.id)).toHaveLength(0);
    // 파편은 다시 갈라지지 않는다
    expect(sim.projectiles).toHaveLength(0);
    expect(p.superCharge).toBeCloseTo(SHARD.attack.superChargePerHit, 9);
  });

  it('사거리 끝·벽에서도 갈라지고, 파편 적중도 충전된다', () => {
    // 사거리 끝: 본탄이 멈춘 자리 근처의 더미를 파편이 맞힌다
    const endX = 3.5 + SHARD.attack.range;
    const sim = makeSim(testMap(20, 11, [[3, 5, 'A'], [Math.floor(endX), 6, 'd']]), [{ id: 'shard' }]);
    const p = fighters(sim)[0]!;
    const d = dummies(sim)[0]!;
    d.pos = { x: endX, y: 5.5 + 1.2 };
    tick(sim, { [p.id]: attack({ x: 1, y: 0 }) });
    const ev = run(sim, ticksFor(SHARD.attack.range, SHARD.attack.projectileSpeed) + ticksFor(S.range, S.speed));
    const ends = ofType(ev, 'projectileEnd');
    expect(ends.some((e) => e.reason === 'range' && Math.abs(e.pos.x - endX) < 1e-6)).toBe(true);
    const hits = ofType(ev, 'hit').filter((h) => h.targetId === d.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.damage === S.damage)).toBe(true);
    expect(p.superCharge).toBeCloseTo(hits.length * SHARD.attack.superChargePerHit, 9);

    // 벽
    const wall = makeSim(testMap(20, 11, [[3, 5, 'A'], [6, 5, 'X']]), [{ id: 'shard' }]);
    const w = fighters(wall)[0]!;
    tick(wall, { [w.id]: attack({ x: 1, y: 0 }) });
    let wev: ReturnType<typeof tick> = [];
    for (let i = 0; i < 30 && shardsOf(wall, w.id).length === 0; i++) wev = tick(wall);
    expect(ofType(wev, 'projectileEnd')[0]!.reason).toBe('wall');
    expect(shardsOf(wall, w.id)).toHaveLength(S.count);
  });

  it('궁극기 zone: 조준 지점에 지대, 안의 적 파이터는 느려지고 계속 피해, 시간이 지나면 사라진다', () => {
    const z = SHARD.super.zone!;
    const sim = makeSim(testMap(24, 11, [[3, 5, 'A'], [8, 5, 'Z']]), [
      { id: 'shard', team: 0 },
      { id: 'rivet', team: 1 },
    ]);
    const [me, foe] = fighters(sim);
    me!.superCharge = 1;
    const ev0 = tick(sim, { [me!.id]: superIn({ x: 5 / SHARD.super.range, y: 0 }) });
    expect(ofType(ev0, 'attack')[0]!.isSuper).toBe(true);
    expect(sim.zones).toHaveLength(1);
    const zone = sim.zones[0]!;
    expect(zone.pos.x).toBeCloseTo(8.5, 9);
    expect(zone).toMatchObject({ radius: z.radius, slow: z.slow, dps: z.dps, team: 0, ownerId: me!.id, untilTick: sim.tick + secToTicks(z.duration) });
    // 느려짐
    const x0 = foe!.pos.x;
    tick(sim, { [foe!.id]: { move: { x: 0, y: 1 } } });
    const moved = Math.hypot(foe!.pos.x - x0, foe!.pos.y - 5.5);
    expect(moved).toBeCloseTo(getFighter('rivet').moveSpeed * (1 - z.slow) / 30, 6);
    // 1초 동안 피해: 초당 몇 번 이상, 합계는 dps에 가깝게
    const ev = run(sim, 30);
    const hits = ofType(ev, 'hit').filter((h) => h.targetId === foe!.id);
    expect(hits.length).toBeGreaterThanOrEqual(Math.floor(30 / ZONE_HIT_TICKS));
    expect(hits.every((h) => h.isSuper && Number.isInteger(h.damage))).toBe(true);
    const sum = hits.reduce((n, h) => n + h.damage, 0);
    expect(Math.abs(sum - z.dps)).toBeLessThanOrEqual(z.dps * (ZONE_HIT_TICKS / 30) + 1);
    // 시전자 팀은 영향 없음, 지대는 사라진다
    expect(ofType(ev, 'hit').some((h) => h.targetId === me!.id)).toBe(false);
    run(sim, secToTicks(z.duration));
    expect(sim.zones).toHaveLength(0);
    const after = foe!.hp;
    run(sim, 30);
    expect(foe!.hp).toBeGreaterThanOrEqual(after);
  });
});

describe('봇: lob·zone', () => {
  it('FUSE 봇은 벽 너머 적에게 거리 비율로 던지고, SHARD 봇은 궁극기를 표적 위치에 깐다', () => {
    const marks: Array<[number, number, string]> = [[3, 5, 'A'], [7, 5, 'Z']];
    for (let y = 1; y <= 9; y++) marks.push([5, y, 'X']);
    const sim = new Sim({
      map: testMap(16, 11, marks),
      seed: 2,
      dummies: false,
      fighters: [
        { fighterId: 'fuse', team: 0, controller: 'bot', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
      ],
    });
    const [bot, foe] = fighters(sim);
    foe!.maxHp = foe!.hp = 1e9;
    let thrown = false;
    for (let i = 0; i < 40 && !thrown; i++) {
      sim.step(new Map<EntityId, FighterInput>([[bot!.id, botInput(sim, bot!.id)]]));
      if (sim.lobs.length) {
        thrown = true;
        const mid = { x: (sim.lobs[0]!.to.x + sim.lobs[1]!.to.x) / 2, y: (sim.lobs[0]!.to.y + sim.lobs[1]!.to.y) / 2 };
        expect(Math.hypot(mid.x - foe!.pos.x, mid.y - foe!.pos.y)).toBeLessThan(1);
      }
    }
    expect(thrown).toBe(true);

    const z = new Sim({
      map: testMap(16, 11, [[3, 5, 'A'], [7, 5, 'Z']]),
      seed: 2,
      dummies: false,
      fighters: [
        { fighterId: 'shard', team: 0, controller: 'bot', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
      ],
    });
    const [sb, sf] = fighters(z);
    sb!.superCharge = 1;
    for (let i = 0; i < 30 && !z.zones.length; i++) z.step(new Map<EntityId, FighterInput>([[sb!.id, botInput(z, sb!.id)]]));
    expect(z.zones).toHaveLength(1);
    expect(Math.hypot(z.zones[0]!.pos.x - sf!.pos.x, z.zones[0]!.pos.y - sf!.pos.y)).toBeLessThan(1);
  });
});
