import { describe, expect, it } from 'vitest';
import { TRAINING_YARD } from '../../../src/data/maps/training';
import { Sim } from '../../../src/game/sim';
import type { FighterInput } from '../../../src/game/types';

const make = () =>
  new Sim({ map: TRAINING_YARD, seed: 1, dummies: true, fighters: [{ fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 }] });

describe('Sim 기본', () => {
  it('플레이어와 더미가 생성된다', () => {
    const sim = make();
    expect(sim.units[0]?.type).toBe('fighter');
    expect(sim.units.some((u) => u.type === 'dummy')).toBe(true);
  });

  it('오른쪽 입력으로 오른쪽으로 움직인다', () => {
    const sim = make();
    const p = sim.units[0]!;
    const x0 = p.pos.x;
    const input = new Map<number, FighterInput>([[p.id, { move: { x: 1, y: 0 } }]]);
    for (let i = 0; i < 30; i++) sim.step(input);
    expect(p.pos.x).toBeGreaterThan(x0 + 2);
  });

  it('같은 시드·같은 입력이면 결과가 같다(결정적)', () => {
    const run = () => {
      const sim = make();
      const id = sim.units[0]!.id;
      for (let i = 0; i < 60; i++) sim.step(new Map([[id, { move: { x: 1, y: 0.3 }, attack: i % 20 === 0 ? { aim: { x: 1, y: 0 } } : undefined }]]));
      return JSON.stringify(sim.units.map((u) => [u.pos, u.hp]));
    };
    expect(run()).toBe(run());
  });
});
