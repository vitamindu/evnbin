import { describe, expect, it } from 'vitest';
import { Sim } from '../../../src/game/sim';
import type { Fighter, FighterInput, MatchState, Projectile, Unit } from '../../../src/game/types';
import { Grid } from '../../../src/game/world';
import { ServerClock } from '../../../src/net/clock';
import { Predictor } from '../../../src/net/predict';
import { SnapshotBuffer, type BufferedSnap } from '../../../src/net/snapshots';
import { quantizeMove } from '../../../src/net/wire';
import { testMap } from '../game/helpers';

const MATCH: MatchState = { mode: 'teamfight', score: [0, 0], targetScore: 10, ticksLeft: -1, winner: null };

function snap(tick: number, units: Unit[], projectiles: Projectile[] = [], events: BufferedSnap['events'] = []): BufferedSnap {
  return { tick, units, projectiles, lobs: [], match: MATCH, events };
}

function fighterAt(x: number, y: number, extra: Partial<Fighter> = {}): Fighter {
  const map = testMap(8, 8, [[2, 2, 'A']]);
  const sim = new Sim({ map, seed: 1, dummies: false, fighters: [{ fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 }] });
  const f = sim.units[0] as Fighter;
  return { ...f, pos: { x, y }, ...extra };
}

describe('SnapshotBuffer', () => {
  it('interpolates unit positions between snaps and keeps discrete state from the earlier snap', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [fighterAt(2, 2, { hp: 100 })]));
    b.push(snap(12, [fighterAt(3, 2, { hp: 50 })]));
    const v = b.sample(11)!;
    expect(v.tick).toBe(11);
    expect(v.getUnit(1)!.pos.x).toBeCloseTo(2.5);
    expect(v.getUnit(1)!.hp).toBe(100);
    expect(b.sample(12)!.getUnit(1)!.hp).toBe(50);
  });

  it('does not interpolate teleports and ignores old snaps', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [fighterAt(2, 2)]));
    b.push(snap(12, [fighterAt(9, 9)]));
    expect(b.push(snap(11, [fighterAt(0, 0)]))).toBe(false);
    expect(b.sample(11)!.getUnit(1)!.pos).toEqual({ x: 2, y: 2 });
  });

  it('extrapolates a little past the newest snap, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [fighterAt(2, 2)]));
    b.push(snap(12, [fighterAt(2.2, 2)]));
    expect(b.sample(13, 3)!.getUnit(1)!.pos.x).toBeCloseTo(2.3);
    expect(b.sample(30, 3)!.getUnit(1)!.pos.x).toBeCloseTo(2.5);
  });

  it('projectiles: spawned between snaps appear only after leaving the shooter; ended ones stop at the end point', () => {
    const shooter = fighterAt(2, 2);
    const p: Projectile = {
      id: 9,
      type: 'projectile',
      ownerId: 1,
      team: 0,
      pos: { x: 2.45, y: 2 },
      vel: { x: 9, y: 0 },
      radius: 0.18,
      damage: 1,
      remaining: 5,
      isSuper: false,
      breaksWalls: false,
      knockback: 0,
      pierce: false,
      hitIds: [],
    };
    const b = new SnapshotBuffer();
    b.push(snap(10, [shooter]));
    b.push(snap(12, [shooter], [p]));
    // 0.45타일 = 1.5틱 전(10.5틱) 출발 → 10.2틱에는 아직 없음, 11틱에는 2.15
    expect(b.sample(10.2)!.projectiles).toHaveLength(0);
    expect(b.sample(11)!.projectiles[0]!.pos.x).toBeCloseTo(2.15);
    // 12→14 사이에 x=3.0에서 벽에 맞음(0.55타일 ≈ 1.83틱 뒤)
    b.push(snap(14, [shooter], [], [{ type: 'projectileEnd', id: 9, pos: { x: 3.0, y: 2 }, reason: 'wall' }]));
    expect(b.sample(12.2)!.projectiles[0]!.pos.x).toBeCloseTo(2.51);
    expect(b.sample(13.9)!.projectiles).toHaveLength(0);
  });
});

describe('ServerClock', () => {
  it('locks to the earliest arrivals and measures jitter', () => {
    const c = new ServerClock();
    const tickMs = 1000 / 30;
    // 서버 틱 t를 로컬 t*tickMs + 50ms(+지터)에 받는다
    for (let i = 0; i < 200; i++) {
      const tick = i * 2;
      const jitter = i % 3 === 0 ? 30 : 0;
      c.observe(tick, tick * tickMs + 50 + jitter);
    }
    // 도착 기준 서버 틱 ≈ (local - 50) / tickMs
    const local = 400 * tickMs + 50;
    expect(c.serverTick(local)).toBeGreaterThan(399.3);
    expect(c.serverTick(local)).toBeLessThan(400.5);
    expect(c.jitterTicks).toBeGreaterThan(0.5);
    expect(c.jitterTicks).toBeLessThan(1.2);
  });
});

describe('Predictor', () => {
  const map = testMap(12, 8, [[2, 4, 'A'], [6, 2, '#'], [6, 3, '#'], [6, 4, '#'], [6, 5, '#']]);

  function serverSim() {
    return new Sim({ map, seed: 3, dummies: false, fighters: [{ fighterId: 'volley', team: 0, controller: 'player', spawnIndex: 0 }] });
  }

  it('matches the server exactly when every input is acked in order (including wall sliding)', () => {
    const server = serverSim();
    const me = server.units[0] as Fighter;
    const pred = new Predictor(new Grid(map), me.fighterId, me.radius);
    pred.reconcile(0, structuredClone(me));
    const moves = [...Array(60)].map((_, i) => quantizeMove({ x: 1, y: i % 7 === 0 ? 0.4 : -0.3 }));
    let seq = 0;
    for (const m of moves) {
      pred.applyLocal(++seq, m);
      const input: FighterInput = { move: m };
      server.step(new Map([[me.id, input]]));
      // 2틱마다 서버 상태(ack=seq)가 오면 보정량이 0이어야 한다
      if (seq % 2 === 0) {
        const corr = pred.reconcile(seq, structuredClone(server.units[0] as Fighter));
        expect(Math.hypot(corr!.x, corr!.y)).toBeLessThan(1e-9);
      }
    }
    expect(pred.pos.x).toBeCloseTo(server.units[0]!.pos.x, 9);
    // 벽(x=6) 앞에서 멈췄다
    expect(pred.pos.x).toBeLessThan(6 - me.radius + 1e-6);
    expect(pred.pos.x).toBeGreaterThan(6 - me.radius - 0.05);
  });

  it('replays unacked inputs on top of a delayed server state', () => {
    const server = serverSim();
    const me = server.units[0] as Fighter;
    const pred = new Predictor(new Grid(map), me.fighterId, me.radius);
    pred.reconcile(0, structuredClone(me));
    const history: Fighter[] = [];
    const m = quantizeMove({ x: 0.6, y: 0.8 });
    for (let seq = 1; seq <= 20; seq++) {
      pred.applyLocal(seq, m);
      server.step(new Map([[me.id, { move: m }]]));
      history.push(structuredClone(server.units[0] as Fighter));
    }
    // 서버는 12까지만 처리한 상태를 보냈다
    const corr = pred.reconcile(12, history[11]);
    expect(Math.hypot(corr!.x, corr!.y)).toBeLessThan(1e-9);
    expect(pred.pending.map((p) => p.seq)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(pred.pos.y).toBeCloseTo(history[19]!.pos.y, 9);
  });

  it('stops predicting while the server says dashing/dead', () => {
    const server = serverSim();
    const me = server.units[0] as Fighter;
    const pred = new Predictor(new Grid(map), me.fighterId, me.radius);
    pred.reconcile(0, structuredClone(me));
    expect(pred.active).toBe(true);
    pred.reconcile(0, { ...structuredClone(me), action: { kind: 'dash', dir: 0, remaining: 3, speed: 9, hitIds: [] } });
    expect(pred.active).toBe(false);
    pred.reconcile(0, { ...structuredClone(me), alive: false });
    expect(pred.active).toBe(false);
    pred.reconcile(0, structuredClone(me));
    expect(pred.active).toBe(true);
  });
});
