import { describe, expect, it } from 'vitest';
import { MEADOW_PITCH } from '../../../src/data/maps/pitch';
import { botInput } from '../../../src/game/bot';
import {
  BALL_FRICTION,
  BALL_KICKOFF_TICKS,
  BALL_KICK_SPEED,
  BALL_MATCH_TICKS,
  BALL_RADIUS,
  BALL_TARGET_SCORE,
} from '../../../src/game/rules';
import { Sim } from '../../../src/game/sim';
import type { EntityId, FighterInput, SimEvent, SpawnFighter } from '../../../src/game/types';
import { Tile, type MapDef } from '../../../src/game/world';
import { attack, center, fighters, ofType, run, runUntil, testMap, tick } from './helpers';

/**
 * 세로 경기장 11×20: 위쪽 줄(y=1, x=4..6)은 팀1 골대(h), 아래쪽 줄(y=18)은 팀0 골대(g).
 * 공 (5,10), 팀0 출발 (5,16), 팀1 출발 (5,3).
 */
const PITCH: MapDef = testMap(11, 20, [
  [4, 1, 'h'], [5, 1, 'h'], [6, 1, 'h'],
  [4, 18, 'g'], [5, 18, 'g'], [6, 18, 'g'],
  [5, 10, 'O'], [5, 16, 'A'], [5, 3, 'Z'], [2, 2, 'd'],
]);

function ballSim(map: MapDef = PITCH, specs: Partial<SpawnFighter>[] = [{ team: 0 }, { team: 1 }]) {
  const sim = new Sim({
    map,
    seed: 3,
    mode: 'ball',
    dummies: true,
    fighters: specs.map((s) => ({ fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0, ...s })),
  });
  return sim;
}

/** 오른쪽으로 걸어가 공을 줍는다(가로 시험 맵) */
function grabRight(sim: Sim, id: EntityId) {
  runUntil(sim, () => sim.ball!.carrierId === id, 60, { [id]: { move: { x: 1, y: 0 } } });
  expect(sim.ball!.carrierId).toBe(id);
}

const up = (extra: Partial<FighterInput> = {}): FighterInput => ({ move: { x: 0, y: -1 }, ...extra });

/** 팀0 파이터를 공까지 걸어가게 해서 줍는다 */
function pickUp(sim: Sim, id: EntityId) {
  const ev = runUntil(sim, () => sim.ball!.carrierId === id, 200, { [id]: up() });
  expect(sim.ball!.carrierId).toBe(id);
  return ev;
}

describe('FIGHTER BALL 규칙', () => {
  it('시작 상태: 공은 가운데, 더미 없음, 점수판', () => {
    const sim = ballSim();
    expect(sim.match).toEqual({ mode: 'ball', score: [0, 0], targetScore: BALL_TARGET_SCORE, ticksLeft: BALL_MATCH_TICKS, winner: null, kickoffTicks: 0 });
    expect(sim.ball).toMatchObject({ type: 'ball', pos: center(5, 10), vel: { x: 0, y: 0 }, carrierId: null, kickerId: null });
    expect(sim.units.every((u) => u.type === 'fighter')).toBe(true);
    // 공 자리가 없는 맵·다른 모드에서는 공 없음
    expect(ballSim(testMap(8, 8, [[2, 2, 'A'], [5, 5, 'Z']])).ball).toBeNull();
    const tf = new Sim({ map: PITCH, seed: 1, mode: 'teamfight', dummies: false, fighters: [] });
    expect(tf.ball).toBeNull();
  });

  it('닿으면 줍고, 든 공은 운반자를 따라간다', () => {
    const sim = ballSim();
    const [me] = fighters(sim);
    const ev = pickUp(sim, me!.id);
    expect(ofType(ev, 'ballPickup')).toEqual([{ type: 'ballPickup', unitId: me!.id }]);
    expect(Math.hypot(sim.ball!.pos.x - me!.pos.x, sim.ball!.pos.y - me!.pos.y)).toBeLessThanOrEqual(me!.radius);
    run(sim, 10, { [me!.id]: { move: { x: 1, y: 0 } } });
    expect(Math.hypot(sim.ball!.pos.x - me!.pos.x, sim.ball!.pos.y - me!.pos.y)).toBeLessThanOrEqual(me!.radius);
  });

  it('차기: 탄창을 쓰지 않고, 마찰로 멈추며, 찬 사람은 바로 다시 줍지 못한다', () => {
    const map = testMap(30, 7, [[2, 3, 'A'], [3, 3, 'O'], [2, 1, 'g'], [2, 5, 'h']]);
    const sim = ballSim(map, [{ team: 0 }]);
    const [me] = fighters(sim);
    grabRight(sim, me!.id);
    const from = { ...me!.pos };
    const ammo = me!.ammo;
    const ev = tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) });
    expect(ofType(ev, 'ballKick')).toEqual([{ type: 'ballKick', unitId: me!.id, isSuper: false, dir: 0 }]);
    expect(ofType(ev, 'attack')).toHaveLength(0);
    expect(sim.projectiles).toHaveLength(0);
    expect(me!.ammo).toBe(ammo);
    expect(sim.ball!.carrierId).toBeNull();
    runUntil(sim, () => sim.ball!.vel.x === 0, 120);
    expect(sim.ball!.vel).toEqual({ x: 0, y: 0 });
    const d = sim.ball!.pos.x - from.x;
    const ideal = (BALL_KICK_SPEED * BALL_KICK_SPEED) / (2 * BALL_FRICTION);
    expect(d).toBeGreaterThan(ideal - 1);
    expect(d).toBeLessThan(ideal + 1);
    expect(sim.ball!.pos.y).toBeCloseTo(from.y, 6);
  });

  it('자동 조준 차기는 상대 골대 쪽, 찬 직후에는 다시 줍지 않는다', () => {
    const sim = ballSim();
    const [me] = fighters(sim);
    pickUp(sim, me!.id);
    const ev = tick(sim, { [me!.id]: { move: { x: 0, y: 0 }, attack: { aim: null } } });
    const dir = ofType(ev, 'ballKick')[0]!.dir;
    expect(Math.sin(dir)).toBeLessThan(-0.95); // 위쪽(팀1 골대)
    expect(sim.ball!.carrierId).toBeNull();
    tick(sim, { [me!.id]: up() });
    expect(sim.ball!.carrierId).toBeNull();
  });

  it('벽에 튕기면 반대로 감쇠되어 돌아온다', () => {
    const map = testMap(8, 5, [[2, 2, 'A'], [3, 2, 'O'], [1, 1, 'g'], [1, 3, 'h']]);
    const sim = ballSim(map, [{ team: 0 }]);
    const [me] = fighters(sim);
    grabRight(sim, me!.id);
    tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) });
    let maxX = 0;
    let bounced = false;
    for (let i = 0; i < 60; i++) {
      tick(sim, { [me!.id]: { move: { x: 0, y: 0 } } });
      maxX = Math.max(maxX, sim.ball!.pos.x);
      if (sim.ball!.vel.x < 0) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(maxX).toBeLessThanOrEqual(7 - BALL_RADIUS + 1e-6);
    expect(sim.ball!.pos.x).toBeLessThan(maxX - 0.5);
  });

  it('물·수풀 위는 지나가고 부서지는 벽에 막힌다. 강슛도 벽을 부수지 않는다', () => {
    const marks: Array<[number, number, string]> = [[2, 2, 'A'], [3, 2, 'O'], [1, 1, 'g'], [1, 3, 'h'], [6, 2, 'W'], [7, 2, 'B'], [9, 2, '#']];
    const sim = ballSim(testMap(16, 5, marks), [{ team: 0 }]);
    const [me] = fighters(sim);
    grabRight(sim, me!.id);
    tick(sim, { [me!.id]: attack({ x: 1, y: 0 }) });
    let maxX = 0;
    run(sim, 40, () => {
      maxX = Math.max(maxX, sim.ball!.pos.x);
      return {};
    });
    expect(maxX).toBeGreaterThan(8);
    expect(maxX).toBeLessThanOrEqual(9 - BALL_RADIUS + 1e-6);
    expect(sim.grid.get(9, 2)).toBe(Tile.Wall);

    const sim2 = ballSim(testMap(16, 5, marks), [{ team: 0 }]);
    const [me2] = fighters(sim2);
    me2!.superCharge = 1;
    grabRight(sim2, me2!.id);
    const ev = tick(sim2, { [me2!.id]: { move: { x: 0, y: 0 }, super: { aim: { x: 1, y: 0 } } } });
    expect(ofType(ev, 'ballKick')[0]).toMatchObject({ isSuper: true });
    expect(me2!.superCharge).toBe(0);
    const all = run(sim2, 40);
    expect(sim2.grid.get(9, 2)).toBe(Tile.Wall);
    expect(ofType(all, 'wallsBroken')).toHaveLength(0);
    expect(sim2.ball!.pos.x).toBeLessThanOrEqual(9 - BALL_RADIUS + 1e-6);
  });

  it('운반자가 쓰러지면 그 자리에 공을 떨어뜨리고, 쓰러뜨려도 점수는 없다', () => {
    const sim = ballSim();
    const [me, foe] = fighters(sim);
    pickUp(sim, me!.id);
    me!.hp = 1;
    foe!.pos = { x: me!.pos.x, y: me!.pos.y - 2.5 };
    const ev = runUntil(sim, () => !me!.alive, 120, { [foe!.id]: attack(null) });
    expect(me!.alive).toBe(false);
    const drops = ofType(ev, 'ballDrop');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.pos).toEqual(me!.pos);
    expect(sim.ball!.carrierId).toBeNull();
    expect(sim.ball!.vel).toEqual({ x: 0, y: 0 });
    expect(ofType(ev, 'score')).toHaveLength(0);
    expect(sim.match.score).toEqual([0, 0]);
  });

  it('차서 넣은 골 → 킥오프 대기 → 모두 처음 자리로', () => {
    const sim = ballSim();
    const [me, foe] = fighters(sim);
    pickUp(sim, me!.id);
    run(sim, 30, { [me!.id]: up() });
    foe!.pos = { x: 1.5, y: 3.5 };
    const kick = tick(sim, { [me!.id]: attack({ x: 0, y: -1 }) });
    expect(ofType(kick, 'ballKick')).toHaveLength(1);
    const ev = runUntil(sim, () => sim.match.score[0] > 0, 60);
    expect(me!.hp).toBeLessThanOrEqual(me!.maxHp);
    me!.hp = 100;
    expect(ofType(ev, 'goal')).toEqual([{ type: 'goal', team: 0, score: [1, 0], scorerId: me!.id }]);
    expect(sim.match.kickoffTicks).toBe(BALL_KICKOFF_TICKS);
    // 대기 중에는 입력 무시
    const before = { ...foe!.pos };
    tick(sim, { [foe!.id]: { move: { x: 1, y: 0 } } });
    expect(foe!.pos).toEqual(before);
    run(sim, BALL_KICKOFF_TICKS - 1);
    expect(sim.match.kickoffTicks).toBe(0);
    expect(me!.pos).toEqual(center(5, 16));
    expect(foe!.pos).toEqual(center(5, 3));
    expect(me!.hp).toBe(me!.maxHp);
    expect(sim.ball).toMatchObject({ pos: center(5, 10), vel: { x: 0, y: 0 }, carrierId: null });
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.match.winner).toBeNull();
  });

  it('공을 들고 상대 골대에 들어가도 골, 두 골이면 승리하고 그 뒤 입력은 무시', () => {
    const sim = ballSim();
    const [me] = fighters(sim);
    let all: SimEvent[] = [];
    for (let g = 0; g < BALL_TARGET_SCORE; g++) {
      if (g > 0) run(sim, BALL_KICKOFF_TICKS);
      pickUp(sim, me!.id);
      all = all.concat(runUntil(sim, () => sim.match.score[0] > g, 300, { [me!.id]: up() }));
    }
    const goals = ofType(all, 'goal');
    expect(goals.map((e) => e.scorerId)).toEqual([me!.id, me!.id]);
    expect(ofType(all, 'matchEnd')).toEqual([{ type: 'matchEnd', winner: 0, score: [2, 0] }]);
    expect(sim.match.winner).toBe(0);
    const pos = { ...me!.pos };
    run(sim, 10, { [me!.id]: { move: { x: 0, y: 1 } } });
    expect(me!.pos).toEqual(pos);
  });

  it('자책골 없음: 제 골대로 찬 공은 골대 입구에서 튕겨 나오고, 들고 들어가도 아무 일 없음', () => {
    const sim = ballSim();
    const [me] = fighters(sim);
    pickUp(sim, me!.id);
    const ev = run(sim, 150, { [me!.id]: { move: { x: 0, y: 1 } } });
    expect(ofType(ev, 'goal')).toHaveLength(0);
    expect(sim.grid.goalAt(me!.pos.x, me!.pos.y)).toBe(0);
    run(sim, 40, { [me!.id]: { move: { x: 0, y: -1 } } }); // 골대 밖 경기장으로 나온다
    expect(sim.grid.goalAt(me!.pos.x, me!.pos.y)).toBeNull();
    // 아래(우리 골대)로 세게 찬다
    const ev2 = [...tick(sim, { [me!.id]: attack({ x: 0, y: 1 }) }), ...run(sim, 60)];
    expect(ofType(ev2, 'goal')).toHaveLength(0);
    expect(sim.match.score).toEqual([0, 0]);
    expect(sim.grid.goalAt(sim.ball!.pos.x, sim.ball!.pos.y)).toBeNull(); // 골대 칸 밖
  });

  it('상대가 찬 공이 우리 골대에 들어가면 상대 득점', () => {
    const sim = ballSim();
    const [me, foe] = fighters(sim);
    me!.pos = { x: 1.5, y: 2.5 }; // 우리 선수는 멀리(공을 가로채지 않게)
    // 상대(팀1)가 우리(팀0) 골대 바로 앞에서 공을 들고 아래로 찬다
    const goal = sim.goalCenter(0)!;
    foe!.pos = { x: goal.x, y: goal.y - 3 };
    sim.ball!.carrierId = foe!.id;
    const ev = [...tick(sim, { [foe!.id]: attack({ x: 0, y: 1 }) }), ...runUntil(sim, () => sim.match.score[1] > 0, 60)];
    expect(ofType(ev, 'goal')).toEqual([{ type: 'goal', team: 1, score: [0, 1], scorerId: foe!.id }]);
  });

  it('시간이 끝나면 골이 많은 팀 승리, 같으면 무승부', () => {
    const sim = ballSim();
    sim.match.ticksLeft = 3;
    const ev = run(sim, 5);
    expect(ofType(ev, 'matchEnd')).toEqual([{ type: 'matchEnd', winner: -1, score: [0, 0] }]);

    const sim2 = ballSim();
    sim2.match.score = [0, 1];
    sim2.match.ticksLeft = 2;
    expect(ofType(run(sim2, 3), 'matchEnd')[0]!.winner).toBe(1);
  });

  it('봇: 놓인 공을 상대 골대로 몰고 가서 넣는다', () => {
    const sim = new Sim({
      map: MEADOW_PITCH,
      seed: 7,
      mode: 'ball',
      dummies: false,
      fighters: [0, 1, 2].map((i) => ({ fighterId: 'rivet' as const, team: 0 as const, controller: 'bot' as const, spawnIndex: i })),
    });
    const ids = fighters(sim).map((f) => f.id);
    let goals = 0;
    for (let i = 0; i < 30 * 40 && goals === 0; i++) {
      const inputs = new Map(ids.map((id) => [id, botInput(sim, id)] as const));
      goals += sim.step(inputs).filter((e) => e.type === 'goal').length;
    }
    expect(sim.match.score[0]).toBeGreaterThan(0);
  });

  it('봇 3대3: 공을 줍고 차며 경기가 진행된다(결정적)', () => {
    const play = () => {
      const sim = new Sim({
        map: MEADOW_PITCH,
        seed: 11,
        mode: 'ball',
        dummies: false,
        fighters: [0, 1, 2].flatMap((i) => [
          { fighterId: 'rivet' as const, team: 0 as const, controller: 'bot' as const, spawnIndex: i },
          { fighterId: 'rivet' as const, team: 1 as const, controller: 'bot' as const, spawnIndex: i },
        ]),
      });
      const ids = fighters(sim).map((f) => f.id);
      const ev: SimEvent[] = [];
      for (let i = 0; i < 30 * 60; i++) ev.push(...sim.step(new Map(ids.map((id) => [id, botInput(sim, id)] as const))));
      return { sim, ev };
    };
    const a = play();
    expect(ofType(a.ev, 'ballPickup').length).toBeGreaterThan(0);
    expect(ofType(a.ev, 'ballKick').length).toBeGreaterThan(0);
    expect(ofType(a.ev, 'score')).toHaveLength(0);
    const b = play();
    expect(b.sim.match).toEqual(a.sim.match);
    expect(b.sim.ball).toEqual(a.sim.ball);
  });
});

describe('ids', () => {
  it('fighters keep ids 1..n in ball mode (the ball comes after them)', async () => {
    const { Sim } = await import('../../../src/game/sim');
    const { getMap } = await import('../../../src/data/maps');
    const sim = new Sim({
      map: getMap('meadow-pitch'),
      seed: 1,
      mode: 'ball',
      dummies: false,
      fighters: [
        { fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 },
        { fighterId: 'volley', team: 1, controller: 'bot', spawnIndex: 0 },
      ],
    });
    expect(sim.units.map((u) => u.id)).toEqual([1, 2]);
    expect(sim.ball!.id).toBe(3);
  });
});
