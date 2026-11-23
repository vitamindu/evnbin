import { describe, expect, it } from 'vitest';
import { getFighter } from '../../../src/data/fighters';
import { MAX_POWER, POWER_STEP, UPGRADE_COST, powerMult, upgradeCost } from '../../../src/data/power';
import { Sim } from '../../../src/game/sim';
import type { Fighter } from '../../../src/game/types';
import { attack, ofType, run, testMap, tick } from './helpers';

const map = testMap(20, 11, [
  [3, 5, 'A'],
  [6, 5, 'Z'],
]);
const duel = (power: number) => {
  const sim = new Sim({
    map,
    seed: 1,
    dummies: false,
    fighters: [
      { fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0, power },
      { fighterId: 'boulder', team: 1, controller: 'player', spawnIndex: 0 },
    ],
  });
  const [a, b] = sim.units as Fighter[];
  return { sim, a: a!, b: b! };
};

describe('character level (power)', () => {
  it('same +10% of base per level, 11 levels, level 11 = x2', () => {
    expect(MAX_POWER).toBe(11);
    for (let lv = 1; lv <= MAX_POWER; lv++) expect(powerMult(lv)).toBeCloseTo(1 + POWER_STEP * (lv - 1), 9);
    expect(powerMult(MAX_POWER)).toBeCloseTo(2, 9);
    expect(powerMult(undefined)).toBe(1);
    expect(powerMult(99)).toBeCloseTo(2, 9);
  });

  it('upgrade costs exist for 1..10 and rise; none at max', () => {
    for (let lv = 1; lv < MAX_POWER; lv++) expect(upgradeCost(lv)).toBe(UPGRADE_COST[lv]);
    for (let lv = 2; lv < MAX_POWER; lv++) expect(upgradeCost(lv)!).toBeGreaterThan(upgradeCost(lv - 1)!);
    expect(upgradeCost(MAX_POWER)).toBeNull();
  });

  it('scales max HP', () => {
    const def = getFighter('rivet');
    expect(duel(1).a.maxHp).toBe(def.hp);
    expect(duel(6).a.maxHp).toBe(Math.round(def.hp * 1.5));
    expect(duel(11).a.hp).toBe(def.hp * 2);
  });

  it('scales every hit by the shooter level', () => {
    const per = getFighter('rivet').attack.damage;
    for (const lv of [1, 6, 11]) {
      const { sim, a, b } = duel(lv);
      const ev = [...tick(sim, { [a.id]: attack({ x: 1, y: 0 }) }), ...run(sim, 30)];
      const hits = ofType(ev, 'hit').filter((h) => h.targetId === b.id);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) expect(h.damage).toBe(Math.round(per * powerMult(lv)));
    }
  });
});
