import { describe, expect, it } from 'vitest';
import { getFighter, type FighterId } from '../../../src/data/fighters';
import { BLOSSOM_ARENA } from '../../../src/data/maps/arena';
import { botInput } from '../../../src/game/bot';
import {
  CRYSTAL_COUNTDOWN_TICKS,
  CRYSTAL_DROP_SPREAD,
  CRYSTAL_FIRST_SPAWN_TICKS,
  CRYSTAL_MATCH_TICKS,
  CRYSTAL_MAX_ON_FLOOR,
  CRYSTAL_RADIUS,
  CRYSTAL_SPAWN_INTERVAL_TICKS,
  CRYSTAL_SPAWN_SCATTER,
  CRYSTAL_WIN_COUNT,
  FIGHTER_RESPAWN_TICKS,
} from '../../../src/game/rules';
import { Sim } from '../../../src/game/sim';
import { isAirborne } from '../../../src/game/status';
import type { EntityId, Fighter, FighterInput, MatchMode, SimEvent, Team } from '../../../src/game/types';
import { circleBlocked, type MapDef } from '../../../src/game/world';
import { attack, center, fighters, ofType, run, runUntil, testMap, tick, ticksFor } from './helpers';

/** 크리스탈 생성 지점 (10,4). 팀0 RIVET은 (2,4), 팀1 RIVET은 (4,4) */
const CX = 10;
const CY = 4;
function crystalSim(opts: { mode?: MatchMode; marks?: Array<[number, number, string]>; seed?: number } = {}) {
  const sim = new Sim({
    map: testMap(16, 9, [[2, 4, 'A'], [4, 4, 'Z'], [CX, CY, 'C'], ...(opts.marks ?? [])]),
    seed: opts.seed ?? 1,
    mode: opts.mode ?? 'crystal',
    dummies: false,
    fighters: [
      { fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 },
      { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
    ],
  });
  const [me, foe] = fighters(sim);
  return { sim, me: me!, foe: foe! };
}

describe('CRYSTAL RUSH 규칙', () => {
  it('시작 상태와 파이터의 crystals=0, 다른 모드는 그대로', () => {
    const { sim, me } = crystalSim();
    expect(sim.match).toEqual({
      mode: 'crystal',
      score: [0, 0],
      targetScore: CRYSTAL_WIN_COUNT,
      ticksLeft: CRYSTAL_MATCH_TICKS,
      winner: null,
      crystals: [0, 0],
      countdownTicks: -1,
      countdownTeam: null,
    });
    expect(me.crystals).toBe(0);
    for (const mode of ['training', 'teamfight'] as const) {
      const o = crystalSim({ mode });
      expect(o.me.crystals).toBeUndefined();
      expect(o.sim.match.crystals).toBeUndefined();
      run(o.sim, CRYSTAL_FIRST_SPAWN_TICKS + 5);
      expect(o.sim.crystals).toHaveLength(0);
    }
  });

  it(`첫 크리스탈은 ${CRYSTAL_FIRST_SPAWN_TICKS}틱, 그 뒤 ${CRYSTAL_SPAWN_INTERVAL_TICKS}틱마다, 바닥에 ${CRYSTAL_MAX_ON_FLOOR}개까지`, () => {
    const { sim } = crystalSim();
    const spawnTicks: number[] = [];
    const total = CRYSTAL_FIRST_SPAWN_TICKS + CRYSTAL_SPAWN_INTERVAL_TICKS * (CRYSTAL_MAX_ON_FLOOR + 3);
    for (let i = 0; i < total; i++) {
      const ev = tick(sim);
      for (const e of ofType(ev, 'crystalSpawn')) {
        spawnTicks.push(sim.tick);
        expect(Math.hypot(e.pos.x - (CX + 0.5), e.pos.y - (CY + 0.5))).toBeLessThanOrEqual(CRYSTAL_SPAWN_SCATTER + 1e-9);
        expect(circleBlocked(sim.grid, e.pos.x, e.pos.y, CRYSTAL_RADIUS)).toBe(false);
      }
    }
    expect(spawnTicks).toEqual(Array.from({ length: CRYSTAL_MAX_ON_FLOOR }, (_, i) => CRYSTAL_FIRST_SPAWN_TICKS + i * CRYSTAL_SPAWN_INTERVAL_TICKS));
    expect(sim.crystals).toHaveLength(CRYSTAL_MAX_ON_FLOOR);
  });

  it('닿으면 줍고, 팀 합계가 match.crystals와 score에 들어간다', () => {
    const { sim, me } = crystalSim();
    runUntil(sim, () => sim.crystals.length > 0, CRYSTAL_FIRST_SPAWN_TICKS + 1);
    const c = sim.crystals[0]!;
    me.pos = { x: c.pos.x - me.radius - CRYSTAL_RADIUS + 0.01, y: c.pos.y };
    const ev = tick(sim);
    expect(ofType(ev, 'crystalPickup')).toEqual([{ type: 'crystalPickup', unitId: me.id, crystalId: c.id, carried: 1 }]);
    expect(sim.crystals).toHaveLength(0);
    expect(me.crystals).toBe(1);
    expect(sim.match.crystals).toEqual([1, 0]);
    expect(sim.match.score).toEqual([1, 0]);
  });

  it('쓰러지면 든 크리스탈을 주변 걸을 수 있는 곳에 흩뿌린다(개수 보존), 점수는 없다', () => {
    const { sim, me, foe } = crystalSim({ marks: [[5, 3, 'X'], [5, 5, 'X']] });
    foe.crystals = 5;
    foe.hp = 1;
    tick(sim, { [me.id]: attack({ x: 1, y: 0 }) });
    const events = runUntil(sim, () => !foe.alive, ticksFor(getFighter('rivet').attack.range, getFighter('rivet').attack.projectileSpeed));
    const drop = ofType(events, 'crystalDrop');
    expect(drop).toHaveLength(1);
    expect(drop[0]!.unitId).toBe(foe.id);
    expect(drop[0]!.count).toBe(5);
    expect(foe.crystals).toBe(0);
    expect(sim.crystals).toHaveLength(5);
    for (const c of sim.crystals) {
      expect(Math.hypot(c.pos.x - drop[0]!.pos.x, c.pos.y - drop[0]!.pos.y)).toBeLessThanOrEqual(CRYSTAL_DROP_SPREAD + 1e-9);
      expect(circleBlocked(sim.grid, c.pos.x, c.pos.y, CRYSTAL_RADIUS)).toBe(false);
    }
    expect(ofType(events, 'score')).toHaveLength(0);
    expect(sim.match.crystals).toEqual([0, 0]);
    run(sim, FIGHTER_RESPAWN_TICKS);
    expect(foe.alive).toBe(true);
    expect(foe.pos).toEqual(center(4, 4));
  });

  it(`${CRYSTAL_WIN_COUNT}개 이상·앞서면 ${CRYSTAL_COUNTDOWN_TICKS}틱 카운트다운, 조건이 깨지면 취소, 버티면 승리`, () => {
    const { sim, me, foe } = crystalSim();
    me.crystals = CRYSTAL_WIN_COUNT;
    const start = tick(sim);
    expect(ofType(start, 'countdown')).toEqual([{ type: 'countdown', team: 0, ticks: CRYSTAL_COUNTDOWN_TICKS }]);
    expect(sim.match.countdownTeam).toBe(0);
    run(sim, 10);
    expect(sim.match.countdownTicks).toBe(CRYSTAL_COUNTDOWN_TICKS - 10);
    // 상대가 따라잡으면(같아지면) 취소
    foe.crystals = CRYSTAL_WIN_COUNT;
    const cancel = tick(sim);
    expect(ofType(cancel, 'countdown')).toEqual([{ type: 'countdown', team: null, ticks: -1 }]);
    expect(sim.match.countdownTeam).toBeNull();
    expect(sim.match.countdownTicks).toBe(-1);
    // 다시 앞서면 처음부터
    foe.crystals = 0;
    const again = tick(sim);
    expect(ofType(again, 'countdown')[0]!.ticks).toBe(CRYSTAL_COUNTDOWN_TICKS);
    const rest = run(sim, CRYSTAL_COUNTDOWN_TICKS - 1);
    expect(ofType(rest, 'matchEnd')).toHaveLength(0);
    const end = tick(sim);
    expect(ofType(end, 'matchEnd')).toEqual([{ type: 'matchEnd', winner: 0, score: [CRYSTAL_WIN_COUNT, 0] }]);
    expect(sim.match.winner).toBe(0);
    expect(ofType(run(sim, 60), 'matchEnd')).toHaveLength(0);
  });

  it('카운트다운 중 운반자가 쓰러져 합계가 떨어지면 취소된다', () => {
    const { sim, me, foe } = crystalSim();
    foe.crystals = CRYSTAL_WIN_COUNT;
    tick(sim);
    expect(sim.match.countdownTeam).toBe(1);
    foe.hp = 1;
    tick(sim, { [me.id]: attack({ x: 1, y: 0 }) });
    const ev = runUntil(sim, () => !foe.alive, 60);
    expect(foe.alive).toBe(false);
    expect(ofType(ev, 'crystalDrop')[0]!.count).toBe(CRYSTAL_WIN_COUNT);
    expect(sim.match.countdownTeam).toBeNull();
    expect(sim.match.crystals).toEqual([0, 0]);
  });

  it('시간이 끝나면 크리스탈이 많은 팀 승리, 같으면 무승부', () => {
    const end = (a: number, b: number) => {
      const { sim, me, foe } = crystalSim();
      me.crystals = a;
      foe.crystals = b;
      sim.match.ticksLeft = 2;
      const ev = run(sim, 2);
      return ofType(ev, 'matchEnd')[0]!;
    };
    expect(end(3, 1)).toEqual({ type: 'matchEnd', winner: 0, score: [3, 1] });
    expect(end(2, 7)).toEqual({ type: 'matchEnd', winner: 1, score: [2, 7] });
    expect(end(4, 4).winner).toBe(-1);
    expect(end(0, 0).winner).toBe(-1);
  });

  it('경기가 끝나면 입력·생성·줍기가 멈춘다', () => {
    const { sim, me } = crystalSim();
    sim.match.ticksLeft = 1;
    tick(sim);
    expect(sim.match.winner).toBe(-1);
    const pos = { ...me.pos };
    const ev = run(sim, CRYSTAL_FIRST_SPAWN_TICKS + 5, { [me.id]: { move: { x: 1, y: 0 }, attack: { aim: { x: 1, y: 0 } } } });
    expect(me.pos).toEqual(pos);
    expect(ofType(ev, 'attack')).toHaveLength(0);
    expect(ofType(ev, 'crystalSpawn')).toHaveLength(0);
  });
});

describe('CRYSTAL RUSH 봇', () => {
  const lineup: Array<{ id: FighterId; team: Team; spawnIndex: number }> = [
    { id: 'rivet', team: 0, spawnIndex: 0 },
    { id: 'volley', team: 0, spawnIndex: 1 },
    { id: 'boulder', team: 0, spawnIndex: 2 },
    { id: 'hinako', team: 1, spawnIndex: 0 },
    { id: 'boulder', team: 1, spawnIndex: 1 },
    { id: 'rivet', team: 1, spawnIndex: 2 },
  ];
  const make = (seed: number, map: MapDef = BLOSSOM_ARENA) =>
    new Sim({ map, seed, mode: 'crystal', dummies: false, fighters: lineup.map((l) => ({ fighterId: l.id, team: l.team, controller: 'bot', spawnIndex: l.spawnIndex })) });
  const play = (sim: Sim, n: number, each?: () => void): SimEvent[] => {
    const all: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const inputs = new Map<EntityId, FighterInput>();
      for (const u of sim.units) if (u.type === 'fighter') inputs.set(u.id, botInput(sim, u.id));
      all.push(...sim.step(inputs));
      each?.();
    }
    return all;
  };

  it('BLOSSOM ARENA에 크리스탈 생성 지점이 있다', () => {
    expect(make(1).grid.crystalSpawns.length).toBeGreaterThan(0);
  });

  it('보이는 적이 없으면 바닥 크리스탈을 주우러 간다', () => {
    const sim = new Sim({
      map: testMap(20, 9, [[2, 4, 'A'], [17, 1, 'Z'], [12, 4, 'C'], [17, 7, 'B']]),
      seed: 1,
      mode: 'crystal',
      dummies: false,
      fighters: [
        { fighterId: 'rivet', team: 0, controller: 'bot', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
      ],
    });
    const [me, foe] = fighters(sim) as [Fighter, Fighter];
    foe.pos = center(17, 7); // 수풀 속에 숨어 있다
    const events: SimEvent[] = [];
    for (let i = 0; i < CRYSTAL_FIRST_SPAWN_TICKS + 30 * 8; i++) {
      const inputs = new Map<EntityId, FighterInput>([[me.id, botInput(sim, me.id)]]);
      events.push(...sim.step(inputs));
    }
    expect(ofType(events, 'crystalPickup').some((e) => e.unitId === me.id)).toBe(true);
  });

  it('보이는 적 운반자를 가장 가까운 적보다 먼저 노린다', () => {
    const sim = new Sim({
      map: testMap(24, 11, [[2, 5, 'A'], [6, 2, 'Z'], [6, 8, 'Z']]),
      seed: 1,
      mode: 'crystal',
      dummies: false,
      fighters: [
        { fighterId: 'rivet', team: 0, controller: 'bot', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 1 },
      ],
    });
    const [me, near, carrier] = fighters(sim) as [Fighter, Fighter, Fighter];
    near.pos = { x: me.pos.x + 2, y: me.pos.y - 1 };
    carrier.pos = { x: me.pos.x + 4, y: me.pos.y + 1 };
    carrier.crystals = 3;
    near.maxHp = near.hp = carrier.maxHp = carrier.hp = 1e9;
    let firstDir: number | null = null;
    for (let i = 0; i < 40 && firstDir === null; i++) {
      const ev = sim.step(new Map([[me.id, botInput(sim, me.id)]]));
      const a = ofType(ev, 'attack').find((e) => e.unitId === me.id);
      if (a) firstDir = a.dir;
    }
    expect(firstDir).not.toBeNull();
    const toCarrier = Math.atan2(carrier.pos.y - me.pos.y, carrier.pos.x - me.pos.x);
    expect(Math.abs(firstDir! - toCarrier)).toBeLessThan(0.4);
  });

  it('많이 들고 다쳤으면 출발 지점으로 물러난다', () => {
    const sim = new Sim({
      map: testMap(24, 9, [[2, 4, 'A'], [21, 4, 'Z']]),
      seed: 1,
      mode: 'crystal',
      dummies: false,
      fighters: [
        { fighterId: 'rivet', team: 0, controller: 'bot', spawnIndex: 0 },
        { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
      ],
    });
    const [me] = fighters(sim) as [Fighter];
    me.pos = center(12, 4);
    me.crystals = 5;
    me.hp = me.maxHp * 0.5;
    const d0 = Math.hypot(me.pos.x - me.spawn.x, me.pos.y - me.spawn.y);
    for (let i = 0; i < 60; i++) sim.step(new Map([[me.id, botInput(sim, me.id)]]));
    expect(Math.hypot(me.pos.x - me.spawn.x, me.pos.y - me.spawn.y)).toBeLessThan(d0 - 1);
  });

  it('3대3 크리스탈 경기 60초: 오류 없이 줍고 싸우며, 크리스탈 수가 보존된다', () => {
    const sim = make(4);
    let spawned = 0;
    const events = play(sim, 60 * 30, () => {
      const held = fighters(sim).reduce((n, f) => n + (f.crystals ?? 0), 0);
      for (const f of fighters(sim)) {
        expect(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.y)).toBe(true);
        if (f.alive && !isAirborne(f)) expect(circleBlocked(sim.grid, f.pos.x, f.pos.y, f.radius)).toBe(false);
      }
      expect(sim.match.crystals).toEqual([
        fighters(sim).filter((f) => f.team === 0).reduce((n, f) => n + (f.crystals ?? 0), 0),
        fighters(sim).filter((f) => f.team === 1).reduce((n, f) => n + (f.crystals ?? 0), 0),
      ]);
      spawned = held + sim.crystals.length;
    });
    expect(spawned).toBe(ofType(events, 'crystalSpawn').length);
    expect(ofType(events, 'crystalPickup').length).toBeGreaterThan(0);
    expect(ofType(events, 'attack').length).toBeGreaterThan(0);
  });

  it('같은 시드면 크리스탈 경기도 같은 결과(결정적), 끝까지 가면 matchEnd 한 번', () => {
    const snap = (seed: number) => {
      const sim = make(seed);
      const events = play(sim, 900);
      return JSON.stringify({ units: sim.units, crystals: sim.crystals, match: sim.match, events });
    };
    expect(snap(9)).toBe(snap(9));
    const sim = make(9);
    const events = play(sim, CRYSTAL_MATCH_TICKS + 30);
    expect(ofType(events, 'matchEnd')).toHaveLength(1);
    expect(sim.match.winner).not.toBeNull();
  });
});
