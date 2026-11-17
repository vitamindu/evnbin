import type { FighterId } from '../../../src/data/fighters';
import { Sim } from '../../../src/game/sim';
import type { Aim, Dummy, EntityId, Fighter, FighterInput, SimEvent, Team, Vec2 } from '../../../src/game/types';
import type { MapDef } from '../../../src/game/world';

/**
 * 테스트용 작은 맵. 테두리는 단단한 벽(X), 안은 바닥. marks로 글자를 놓는다(grid.ts 글자 규칙).
 * 타일 (x, y)의 중심은 (x + 0.5, y + 0.5).
 */
export function testMap(w: number, h: number, marks: Array<[number, number, string]> = []): MapDef {
  const rows: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 'X' : '.');
    rows.push(row);
  }
  for (const [x, y, ch] of marks) rows[y]![x] = ch;
  return { id: 'test', name: 'TEST', rows: rows.map((r) => r.join('')) };
}

export interface FighterSpec {
  id: FighterId;
  team?: Team;
  spawnIndex?: number;
}

export function makeSim(map: MapDef, fighters: FighterSpec[], opts: { dummies?: boolean; seed?: number } = {}): Sim {
  return new Sim({
    map,
    seed: opts.seed ?? 1,
    dummies: opts.dummies ?? true,
    fighters: fighters.map((f) => ({ fighterId: f.id, team: f.team ?? 0, controller: 'player', spawnIndex: f.spawnIndex ?? 0 })),
  });
}

export const fighters = (sim: Sim): Fighter[] => sim.units.filter((u): u is Fighter => u.type === 'fighter');
export const dummies = (sim: Sim): Dummy[] => sim.units.filter((u): u is Dummy => u.type === 'dummy');

export const idle = (): FighterInput => ({ move: { x: 0, y: 0 } });

/** 한 틱 진행. inputs가 없으면 모두 가만히 */
export function tick(sim: Sim, inputs: Record<EntityId, FighterInput> = {}): SimEvent[] {
  return sim.step(new Map(Object.entries(inputs).map(([k, v]) => [Number(k), v])));
}

/** n틱 진행하고 모든 사건을 모아 돌려준다 */
export function run(sim: Sim, n: number, inputs: Record<EntityId, FighterInput> | ((i: number) => Record<EntityId, FighterInput>) = {}): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tick(sim, typeof inputs === 'function' ? inputs(i) : inputs));
  return all;
}

export const attack = (aim: Aim, move: Vec2 = { x: 0, y: 0 }): FighterInput => ({ move, attack: { aim } });
export const superIn = (aim: Aim, move: Vec2 = { x: 0, y: 0 }): FighterInput => ({ move, super: { aim } });

export function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

export const center = (x: number, y: number): Vec2 => ({ x: x + 0.5, y: y + 0.5 });
