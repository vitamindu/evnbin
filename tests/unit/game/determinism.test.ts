import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../../../src/game/sim';
import type { FighterInput, SimEvent } from '../../../src/game/types';
import { fighters, makeSim, tick } from './helpers';

const ARENA = {
  id: 'arena',
  name: 'ARENA',
  rows: [
      'XXXXXXXXXXXXXXXXXX',
      'X................X',
      'X.A....##....t...X',
      'X......##.BB.....X',
      'X.A......#BB..d..X',
      'X........#....p..X',
      'X.A..WW....##..Z.X',
      'X....WW....##....X',
      'XXXXXXXXXXXXXXXXXX',
    ],
};

/** 모든 공격 종류·궁극기·넉백·돌진·벽 파괴·더미가 섞인 300틱 시나리오 */
function scenario(seed: number) {
  const sim = makeSim(
    ARENA,
    [
      { id: 'rivet', team: 0, spawnIndex: 0 },
      { id: 'volley', team: 0, spawnIndex: 1 },
      { id: 'boulder', team: 0, spawnIndex: 2 },
      { id: 'rivet', team: 1, spawnIndex: 0 },
      { id: 'hinako', team: 1, spawnIndex: 1 },
    ],
    { seed },
  );
  const fs = fighters(sim);
  const log: SimEvent[][] = [];
  for (let i = 0; i < 300; i++) {
    if (i === 90) for (const f of fs) f.superCharge = 1;
    const inputs: Record<number, FighterInput> = {};
    fs.forEach((f, k) => {
      const a = i * 0.07 + k * 1.3;
      const input: FighterInput = { move: { x: (f.team === 0 ? 0.7 : -0.7) * (i < 150 ? 1 : Math.cos(a)), y: Math.sin(a * 1.7) } };
      if ((i + k * 7) % 11 === 0) input.attack = { aim: k % 2 === 0 ? null : { x: f.team === 0 ? 1 : -1, y: Math.sin(a * 2) * 0.3 } };
      // 궁극기가 찼으면 20틱마다 다시 시도(밸런스·속도가 바뀌어도 모든 궁극기가 한 번은 나가도록)
      if (i >= 91 + k * 5 && (i - 91 - k * 5) % 20 === 0 && f.alive && f.superCharge >= 1) input.super = { aim: k === 2 ? { x: 1, y: 0 } : null };
      inputs[f.id] = input;
    });
    log.push(tick(sim, inputs));
  }
  return { sim, log };
}

function snapshot(sim: Sim, log: SimEvent[][]): string {
  const tiles: number[] = [];
  for (let y = 0; y < sim.grid.height; y++) for (let x = 0; x < sim.grid.width; x++) tiles.push(sim.grid.get(x, y));
  return JSON.stringify({ tick: sim.tick, units: sim.units, projectiles: sim.projectiles, lobs: sim.lobs, tiles, log });
}

describe('결정성', () => {
  it('같은 시드·같은 입력 → 같은 결과(모든 상태와 사건)', () => {
    const a = scenario(7);
    const b = scenario(7);
    expect(snapshot(b.sim, b.log)).toBe(snapshot(a.sim, a.log));
    // 시나리오가 실제로 여러 규칙을 거쳤는지
    const types = new Set(a.log.flat().map((e) => e.type));
    for (const t of ['attack', 'hit', 'projectileEnd', 'wallsBroken', 'explode'] as const) expect(types.has(t), `event ${t}`).toBe(true);
  });
});

describe('순수성', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(fileURLToPath(new URL('../../../src/game', import.meta.url)));

  it('src/game은 Math.random·DOM·Three.js를 쓰지 않는다', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random/);
      expect(src, f).not.toMatch(/from\s+['"]three['"]/);
      expect(src, f).not.toMatch(/\b(document|window|localStorage|requestAnimationFrame|performance)\./);
      expect(src, f).not.toMatch(/from\s+['"]\.\.\/(render|ui|core|audio|battle)\//);
    }
  });
});
