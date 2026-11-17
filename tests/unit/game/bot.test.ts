import { describe, expect, it } from 'vitest';
import { getFighter, type FighterId } from '../../../src/data/fighters';
import { BLOSSOM_ARENA } from '../../../src/data/maps/arena';
import { AIM_JITTER, KEEP_RANGE, LEAP_HP, RANGE_BAND, REACT_MAX_TICKS, RETREAT_HP, SELF_DEFENSE, botInput } from '../../../src/game/bot';
import { TEAMFIGHT_TICKS } from '../../../src/game/rules';
import { Sim } from '../../../src/game/sim';
import { isAirborne } from '../../../src/game/status';
import type { EntityId, Fighter, FighterInput, MatchMode, SimEvent, Team } from '../../../src/game/types';
import { circleBlocked, type MapDef } from '../../../src/game/world';
import { center, fighters, ofType, testMap, ticksFor } from './helpers';
import { angleDiff } from '../../../src/game/geom';

interface Spec {
  id: FighterId;
  team: Team;
  spawnIndex?: number;
  bot?: boolean;
}

function makeBotSim(map: MapDef, specs: Spec[], mode: MatchMode = 'training', seed = 1) {
  const sim = new Sim({
    map,
    seed,
    mode,
    dummies: false,
    fighters: specs.map((s) => ({ fighterId: s.id, team: s.team, controller: s.bot === false ? 'player' : 'bot', spawnIndex: s.spawnIndex ?? 0 })),
  });
  const fs = fighters(sim);
  const botIds = fs.filter((_, i) => specs[i]!.bot !== false).map((f) => f.id);
  return { sim, fs, botIds };
}

/** 봇은 botInput으로, 나머지는 가만히. n틱 진행 후 모든 사건 */
function runBots(sim: Sim, botIds: EntityId[], n: number, stop?: () => boolean): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n && !stop?.(); i++) {
    const inputs = new Map<EntityId, FighterInput>();
    for (const id of botIds) inputs.set(id, botInput(sim, id));
    all.push(...sim.step(inputs));
  }
  return all;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 봇(A)과 표적(Z, 가만히, 죽지 않게 체력을 크게) 한 쌍 */
function pair(bot: FighterId, gap: number, opts: { w?: number; h?: number; extra?: Array<[number, number, string]>; target?: FighterId } = {}) {
  const w = opts.w ?? 2 + gap + 8;
  const h = opts.h ?? 13;
  const ay = Math.floor(h / 2);
  const { sim, fs } = makeBotSim(testMap(w, h, [[2, ay, 'A'], [2 + gap, ay, 'Z'], ...(opts.extra ?? [])]), [
    { id: bot, team: 0 },
    { id: opts.target ?? 'rivet', team: 1, bot: false },
  ]);
  const [me, foe] = fs as [Fighter, Fighter];
  foe.maxHp = foe.hp = 1e9;
  return { sim, me, foe, ay };
}

describe('봇 기본', () => {
  it('없는 id·죽은 파이터·끝난 경기에서는 가만히 있는다', () => {
    const { sim, me } = pair('rivet', 3);
    expect(botInput(sim, 9999)).toEqual({ move: { x: 0, y: 0 } });
    me.alive = false;
    expect(botInput(sim, me.id)).toEqual({ move: { x: 0, y: 0 } });
    me.alive = true;
    sim.match.winner = -1;
    expect(botInput(sim, me.id)).toEqual({ move: { x: 0, y: 0 } });
  });

  it('보이는 적에게 다가간다', () => {
    const { sim, me, foe } = pair('rivet', 22, { h: 9 });
    const d0 = dist(me.pos, foe.pos);
    runBots(sim, [me.id], 90);
    expect(d0 - dist(me.pos, foe.pos)).toBeGreaterThan(getFighter('rivet').moveSpeed * 3 * 0.6);
  });

  it(`사거리의 ${KEEP_RANGE * 100}% 거리를 유지한다: 저격수는 물러나고, 근거리 캐릭터는 붙는다`, () => {
    const settle = (bot: FighterId, gap: number) => {
      const { sim, me, foe } = pair(bot, gap, { w: 34, h: 15 });
      runBots(sim, [me.id], 240);
      return dist(me.pos, foe.pos);
    };
    for (const [bot, gap] of [
      ['hinako', 2],
      ['boulder', 12],
      ['volley', 12],
    ] as const) {
      const keep = getFighter(bot).attack.range * KEEP_RANGE;
      const d = settle(bot, gap);
      expect(d, bot).toBeGreaterThan(keep - RANGE_BAND - 1);
      expect(d, bot).toBeLessThan(keep + RANGE_BAND + 1);
    }
  });

  it('사거리 안·시야가 트였으면 표적 쪽으로(흔들림 범위 안) 공격해서 맞힌다', () => {
    const { sim, me, foe } = pair('rivet', 3);
    const R = getFighter('rivet').attack;
    const attacks: { dir: number; want: number }[] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < REACT_MAX_TICKS + ticksFor(R.range, R.projectileSpeed) + 20; i++) {
      // 봇은 이동 전 위치에서 조준한다
      const want = Math.atan2(foe.pos.y - me.pos.y, foe.pos.x - me.pos.x);
      const ev = runBots(sim, [me.id], 1);
      events.push(...ev);
      for (const e of ofType(ev, 'attack')) if (e.unitId === me.id) attacks.push({ dir: e.dir, want });
    }
    expect(attacks.length).toBeGreaterThan(0);
    for (const a of attacks) expect(Math.abs(angleDiff(a.dir, a.want))).toBeLessThanOrEqual(AIM_JITTER + 1e-9);
    expect(ofType(events, 'hit').some((h) => h.sourceId === me.id && h.targetId === foe.id)).toBe(true);
  });

  it('벽으로 완전히 막힌 적은 쏘지 않는다', () => {
    const box: Array<[number, number, string]> = [];
    for (let x = 5; x <= 7; x++) for (let y = 5; y <= 7; y++) if (x !== 6 || y !== 6) box.push([x, y, 'X']);
    const { sim, me } = pair('rivet', 4, { w: 14, h: 13, extra: box });
    const events = runBots(sim, [me.id], 150);
    expect(ofType(events, 'attack').filter((e) => e.unitId === me.id)).toHaveLength(0);
  });

  it('벽에 막히면 돌아가서 결국 공격한다', () => {
    // 봇과 적 사이에 아래쪽만 열린 단단한 벽
    const wall: Array<[number, number, string]> = [];
    for (let y = 1; y <= 9; y++) wall.push([6, y, 'X']);
    const { sim, me } = pair('rivet', 10, { w: 18, h: 13, extra: wall });
    const events = runBots(sim, [me.id], 30 * 20);
    expect(ofType(events, 'attack').some((e) => e.unitId === me.id)).toBe(true);
  });
});

describe('봇 궁극기', () => {
  const superWithin = (bot: FighterId, gap: number, setup?: (me: Fighter) => void) => {
    const { sim, me, foe } = pair(bot, gap);
    me.superCharge = 1;
    setup?.(me);
    const from = { ...me.pos };
    const events = runBots(sim, [me.id], REACT_MAX_TICKS + 5, () => me.superCharge < 1);
    const used = ofType(events, 'attack').some((e) => e.unitId === me.id && e.isSuper);
    return { sim, me, foe, used, from };
  };

  it('RIVET·VOLLEY: 궁극기 사거리 안의 표적에게 쓴다', () => {
    expect(superWithin('rivet', 2).used).toBe(true);
    expect(superWithin('volley', 3).used).toBe(true);
  });

  it('BOULDER: 표적 쪽으로 돌진한다', () => {
    const r = superWithin('boulder', 3);
    expect(r.used).toBe(true);
    expect(r.me.action?.kind).toBe('dash');
    expect((r.me.action as { dir: number }).dir).toBeLessThan(AIM_JITTER + 0.35);
  });

  it(`HINAKO: 체력이 충분하면 아끼고, ${LEAP_HP * 100}% 미만이면 적 반대쪽으로 뛴다`, () => {
    const healthy = superWithin('hinako', 3);
    expect(healthy.used).toBe(false);
    expect(healthy.me.superCharge).toBe(1);

    const hurt = superWithin('hinako', 3, (me) => (me.hp = me.maxHp * ((LEAP_HP + RETREAT_HP) / 2)));
    expect(hurt.used).toBe(true);
    expect(isAirborne(hurt.me)).toBe(true);
    const to = (hurt.me.action as { to: { x: number; y: number } }).to;
    expect(dist(to, hurt.foe.pos)).toBeGreaterThan(dist(hurt.from, hurt.foe.pos) + 1);
  });
});

describe('봇 후퇴', () => {
  it(`체력이 ${RETREAT_HP * 100}% 미만이면 출발 지점으로 물러나고, 먼 적은 쏘지 않는다`, () => {
    const { sim, me, foe, ay } = pair('rivet', 14, { w: 26 });
    me.pos = center(12, ay);
    foe.pos = { x: me.pos.x + getFighter('rivet').attack.range * SELF_DEFENSE + 1.5, y: me.pos.y };
    me.hp = me.maxHp * RETREAT_HP * 0.5;
    const d0 = dist(me.pos, me.spawn);
    const events = runBots(sim, [me.id], 60);
    expect(dist(me.pos, me.spawn)).toBeLessThan(d0 - 1);
    expect(ofType(events, 'attack').filter((e) => e.unitId === me.id)).toHaveLength(0);
  });
});

describe('3대3 봇 경기(BLOSSOM ARENA)', () => {
  const lineup: Spec[] = [
    { id: 'rivet', team: 0, spawnIndex: 0 },
    { id: 'volley', team: 0, spawnIndex: 1 },
    { id: 'boulder', team: 0, spawnIndex: 2 },
    { id: 'hinako', team: 1, spawnIndex: 0 },
    { id: 'boulder', team: 1, spawnIndex: 1 },
    { id: 'rivet', team: 1, spawnIndex: 2 },
  ];

  it('네 캐릭터 모두 30초 동안 오류 없이 싸운다(벽 안에 들어가지 않음)', () => {
    const { sim, botIds } = makeBotSim(BLOSSOM_ARENA, lineup, 'teamfight', 3);
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 * 30; i++) {
      events.push(...runBots(sim, botIds, 1));
      for (const f of fighters(sim)) {
        expect(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.y)).toBe(true);
        if (f.alive && !isAirborne(f)) expect(circleBlocked(sim.grid, f.pos.x, f.pos.y, f.radius)).toBe(false);
      }
    }
    const attackers = new Set(ofType(events, 'attack').map((e) => e.unitId));
    expect(attackers.size).toBeGreaterThanOrEqual(4);
    expect(ofType(events, 'hit').length).toBeGreaterThan(0);
  });

  it('경기가 끝까지 진행되고 matchEnd는 한 번', () => {
    const { sim, botIds } = makeBotSim(BLOSSOM_ARENA, lineup, 'teamfight', 11);
    const events = runBots(sim, botIds, TEAMFIGHT_TICKS + 30);
    const ends = ofType(events, 'matchEnd');
    expect(ends).toHaveLength(1);
    expect(sim.match.winner).not.toBeNull();
    expect(ends[0]!.winner).toBe(sim.match.winner);
    const scores = ofType(events, 'score');
    expect(scores.length).toBe(sim.match.score[0] + sim.match.score[1]);
    expect(ofType(events, 'death').length).toBeGreaterThanOrEqual(scores.length);
  });

  it('같은 시드면 봇 경기도 같은 결과(결정적)', () => {
    const play = (seed: number) => {
      const { sim, botIds } = makeBotSim(BLOSSOM_ARENA, lineup, 'teamfight', seed);
      const events = runBots(sim, botIds, 600);
      return JSON.stringify({ units: sim.units, projectiles: sim.projectiles, lobs: sim.lobs, match: sim.match, events });
    };
    expect(play(21)).toBe(play(21));
    expect(play(21)).not.toBe(play(22)); // 시드가 다르면 흔들림이 달라진다
  });
});
