import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { FIGHTER_RESPAWN_TICKS, TEAMFIGHT_TARGET_SCORE, TEAMFIGHT_TICKS } from '../../../src/game/rules';
import { Sim } from '../../../src/game/sim';
import type { FighterInput, MatchMode } from '../../../src/game/types';
import { attack, center, dummies, fighters, ofType, run, runUntil, superIn, testMap, tick, ticksFor } from './helpers';

const R = getFighter('rivet').attack;

/** 팀0 RIVET(A, (2,4))과 2칸 오른쪽 팀1 RIVET(Z) */
function duel(mode: MatchMode = 'teamfight', extra: Array<[number, number, string]> = []) {
  const sim = new Sim({
    map: testMap(16, 9, [[2, 4, 'A'], [4, 4, 'Z'], ...extra]),
    seed: 1,
    mode,
    dummies: extra.some(([, , ch]) => ch === 'd'),
    fighters: [
      { fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 },
      { fighterId: 'rivet', team: 1, controller: 'player', spawnIndex: 0 },
    ],
  });
  const [me, foe] = fighters(sim);
  return { sim, me: me!, foe: foe! };
}

/** me가 foe를 한 번에 쓰러뜨리고, 그 사이 사건을 돌려준다 */
function ko(sim: Sim, killer: { id: number; pos: { x: number } }, victim: { id: number; hp: number; alive: boolean; pos: { x: number } }) {
  victim.hp = 1;
  const dir = victim.pos.x > killer.pos.x ? 1 : -1;
  const ev = tick(sim, { [killer.id]: attack({ x: dir, y: 0 }) });
  return [...ev, ...runUntil(sim, () => !victim.alive, ticksFor(R.range, R.projectileSpeed))];
}

describe('TEAM FIGHT 규칙', () => {
  it('시작 상태: 0:0, 목표 점수, 경기 시간, 승자 없음. 남은 시간은 매 틱 1씩 준다', () => {
    const { sim } = duel();
    expect(sim.match).toEqual({ mode: 'teamfight', score: [0, 0], targetScore: TEAMFIGHT_TARGET_SCORE, ticksLeft: TEAMFIGHT_TICKS, winner: null });
    run(sim, 10);
    expect(sim.match.ticksLeft).toBe(TEAMFIGHT_TICKS - 10);
  });

  it('상대 파이터를 쓰러뜨리면 쓰러뜨린 팀 +1, score 사건, 쓰러진 쪽은 출발 지점에서 부활', () => {
    const { sim, me, foe } = duel();
    const events = ko(sim, me, foe);
    expect(foe.alive).toBe(false);
    expect(ofType(events, 'score')).toEqual([{ type: 'score', team: 0, score: [1, 0], killerId: me.id, victimId: foe.id }]);
    expect(sim.match.score).toEqual([1, 0]);
    expect(sim.match.winner).toBeNull();
    run(sim, FIGHTER_RESPAWN_TICKS);
    expect(foe.alive).toBe(true);
    expect(foe.pos).toEqual(center(4, 4));
    // 반대 팀 득점
    const back = ko(sim, foe, me);
    expect(ofType(back, 'score')).toEqual([{ type: 'score', team: 1, score: [1, 1], killerId: foe.id, victimId: me.id }]);
  });

  it('더미를 쓰러뜨려도 점수는 없다(파이터만)', () => {
    const { sim, me } = duel('teamfight', [[2, 6, 'd']]);
    const d = dummies(sim)[0]!;
    d.hp = 1;
    tick(sim, { [me.id]: attack({ x: 0, y: 1 }) });
    const events = runUntil(sim, () => !d.alive, ticksFor(R.range, R.projectileSpeed));
    expect(d.alive).toBe(false);
    expect(ofType(events, 'score')).toHaveLength(0);
    expect(sim.match.score).toEqual([0, 0]);
  });

  it('목표 점수에 먼저 닿으면 그 팀 승리, matchEnd는 한 번만', () => {
    const { sim, me, foe } = duel();
    sim.match.score[0] = TEAMFIGHT_TARGET_SCORE - 1;
    const events = ko(sim, me, foe);
    expect(ofType(events, 'matchEnd')).toEqual([{ type: 'matchEnd', winner: 0, score: [TEAMFIGHT_TARGET_SCORE, 0] }]);
    expect(sim.match.winner).toBe(0);
    const later = run(sim, 120);
    expect(ofType(later, 'matchEnd')).toHaveLength(0);
    expect(ofType(later, 'score')).toHaveLength(0);
  });

  it('시간이 다 되면 점수가 높은 팀 승리, 같으면 무승부(-1)', () => {
    const end = (score: [number, number]) => {
      const { sim } = duel();
      sim.match.score = score;
      sim.match.ticksLeft = 3;
      const ev = run(sim, 2);
      expect(ofType(ev, 'matchEnd')).toHaveLength(0);
      const last = tick(sim);
      expect(sim.match.ticksLeft).toBe(0);
      expect(ofType([...last, ...run(sim, 30)], 'matchEnd')).toHaveLength(1);
      expect(sim.match.ticksLeft).toBe(0);
      return ofType(last, 'matchEnd')[0]!.winner;
    };
    expect(end([3, 1])).toBe(0);
    expect(end([2, 5])).toBe(1);
    expect(end([4, 4])).toBe(-1);
    expect(end([0, 0])).toBe(-1);
  });

  it('경기가 끝나면 입력을 무시하고, 부활·회복도 멈춘다', () => {
    const { sim, me, foe } = duel();
    me.superCharge = 1;
    foe.hp = 1000;
    foe.lastCombatTick = sim.tick; // 회복 대기 중
    sim.match.ticksLeft = 1;
    tick(sim);
    expect(sim.match.winner).toBe(-1);
    const pos = { ...me.pos };
    const input: FighterInput = { move: { x: 0, y: 1 }, attack: { aim: { x: 1, y: 0 } } };
    const events = [...run(sim, 10, { [me.id]: input }), ...tick(sim, { [me.id]: superIn({ x: 1, y: 0 }) })];
    expect(me.pos).toEqual(pos);
    expect(ofType(events, 'attack')).toHaveLength(0);
    expect(me.superCharge).toBe(1);
    expect(sim.projectiles).toHaveLength(0);
    run(sim, 200); // 회복 대기 시간이 지나도
    expect(foe.hp).toBe(1000); // 회복 없음
  });

  it('끝나기 직전에 쏜 탄은 끝까지 날아가지만 피해·득점은 없다', () => {
    const { sim, me, foe } = duel();
    foe.hp = 1;
    foe.lastCombatTick = sim.tick;
    sim.match.ticksLeft = 2;
    tick(sim, { [me.id]: attack({ x: 1, y: 0 }) });
    expect(sim.projectiles.length).toBeGreaterThan(0);
    const events = runUntil(sim, () => sim.projectiles.length === 0, ticksFor(R.range, R.projectileSpeed));
    expect(sim.match.winner).toBe(-1);
    expect(ofType(events, 'projectileEnd').length).toBeGreaterThan(0);
    expect(ofType(events, 'hit')).toHaveLength(0);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBe(1);
    expect(sim.match.score).toEqual([0, 0]);
  });

  it('training은 그대로: 끝이 없고, 파이터를 쓰러뜨려도 점수가 없다', () => {
    const { sim, me, foe } = duel('training');
    expect(sim.match).toEqual({ mode: 'training', score: [0, 0], targetScore: 0, ticksLeft: -1, winner: null });
    const events = ko(sim, me, foe);
    expect(foe.alive).toBe(false);
    expect(ofType(events, 'score')).toHaveLength(0);
    run(sim, 300);
    expect(sim.match).toEqual({ mode: 'training', score: [0, 0], targetScore: 0, ticksLeft: -1, winner: null });
    expect(foe.alive).toBe(true);
  });
});
