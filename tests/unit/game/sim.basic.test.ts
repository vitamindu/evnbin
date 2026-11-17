import { describe, expect, it } from 'vitest';
import { TRAINING_YARD } from '../../../src/data/maps/training';
import { getFighter } from '../../../src/data/fighters';
import { Sim } from '../../../src/game/sim';
import { fighterRadius } from '../../../src/game/rules';
import type { FighterInput } from '../../../src/game/types';
import { fighters, makeSim, testMap } from './helpers';

const make = () =>
  new Sim({ map: TRAINING_YARD, seed: 1, dummies: true, fighters: [{ fighterId: 'rivet', team: 0, controller: 'player', spawnIndex: 0 }] });

describe('Sim 기본', () => {
  it('연습장에 플레이어와 더미가 생성된다', () => {
    const sim = make();
    expect(sim.units[0]?.type).toBe('fighter');
    expect(sim.units.some((u) => u.type === 'dummy')).toBe(true);
    for (const u of sim.units) expect(sim.getUnit(u.id)).toBe(u);
  });

  it('오른쪽 입력으로 moveSpeed만큼 오른쪽으로 움직인다', () => {
    const sim = makeSim(testMap(20, 7, [[2, 3, 'A']]), [{ id: 'rivet' }]);
    const p = fighters(sim)[0]!;
    const x0 = p.pos.x;
    const input = new Map<number, FighterInput>([[p.id, { move: { x: 1, y: 0 } }]]);
    for (let i = 0; i < 30; i++) sim.step(input);
    expect(p.pos.x - x0).toBeCloseTo(getFighter('rivet').moveSpeed, 6);
    expect(p.moving).toBe(true);
    expect(p.facing).toBe(0);
  });

  it('파이터 반지름: 기본 0.4, BOULDER 0.5', () => {
    const sim = makeSim(testMap(10, 7, [[2, 2, 'A'], [2, 4, 'A']]), [
      { id: 'rivet', spawnIndex: 0 },
      { id: 'boulder', spawnIndex: 1 },
    ]);
    const [r, b] = fighters(sim);
    expect(r!.radius).toBe(fighterRadius('rivet'));
    expect(r!.radius).toBe(0.4);
    expect(b!.radius).toBe(0.5);
  });

  it('연습장에서 세 파이터가 공격·궁극기를 계속 써도 상태 값이 유효하다', () => {
    for (const id of ['rivet', 'volley', 'boulder'] as const) {
      const sim = new Sim({ map: TRAINING_YARD, seed: 3, dummies: true, fighters: [{ fighterId: id, team: 0, controller: 'player', spawnIndex: 0 }] });
      const p = fighters(sim)[0]!;
      for (let i = 0; i < 600; i++) {
        if (i % 120 === 0) p.superCharge = 1;
        const a = i * 0.05;
        const input: FighterInput = { move: { x: Math.cos(a), y: Math.sin(a * 1.3) }, attack: i % 7 === 0 ? { aim: null } : undefined };
        if (i % 120 === 1) input.super = { aim: null };
        sim.step(new Map([[p.id, input]]));
        for (const u of sim.units) {
          expect(Number.isFinite(u.pos.x) && Number.isFinite(u.pos.y)).toBe(true);
          expect(u.hp).toBeGreaterThanOrEqual(0);
          expect(u.hp).toBeLessThanOrEqual(u.maxHp);
        }
        expect(p.ammo).toBeGreaterThanOrEqual(0);
        expect(p.ammo).toBeLessThanOrEqual(p.maxAmmo);
        expect(p.superCharge).toBeGreaterThanOrEqual(0);
        expect(p.superCharge).toBeLessThanOrEqual(1);
      }
    }
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
