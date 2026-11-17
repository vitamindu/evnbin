import { describe, expect, it } from 'vitest';
import { TRAINING_YARD } from '../../../src/data/maps/training';
import type { Vec2 } from '../../../src/game/types';
import { Grid, Ground, Tile, hasLineOfSight, labelClusters, bushClusterAt, moveCircle } from '../../../src/game/world';

const g = () => new Grid(TRAINING_YARD);

/** 걸어서 갈 수 있는 타일 flood fill. passWalls면 부서지는 벽도 지나갈 수 있다고 본다 */
function reachable(grid: Grid, from: Vec2, passWalls: boolean): Set<number> {
  const seen = new Set<number>();
  const start = Math.floor(from.y) * grid.width + Math.floor(from.x);
  const stack = [start];
  seen.add(start);
  const ok = (tx: number, ty: number) => {
    const t = grid.get(tx, ty);
    return t === Tile.Floor || t === Tile.Bush || (passWalls && t === Tile.Wall);
  };
  while (stack.length) {
    const i = stack.pop()!;
    const tx = i % grid.width;
    const ty = Math.floor(i / grid.width);
    for (const [nx, ny] of [
      [tx + 1, ty],
      [tx - 1, ty],
      [tx, ty + 1],
      [tx, ty - 1],
    ] as const) {
      const j = ny * grid.width + nx;
      if (!grid.inBounds(nx, ny) || seen.has(j) || !ok(nx, ny)) continue;
      seen.add(j);
      stack.push(j);
    }
  }
  return seen;
}

const key = (grid: Grid, p: Vec2) => Math.floor(p.y) * grid.width + Math.floor(p.x);

describe('연습장 맵', () => {
  it('가로로 긴 크기이고 모든 줄 길이가 같다', () => {
    const grid = g();
    expect(grid.width).toBeGreaterThanOrEqual(30);
    expect(grid.width).toBeLessThanOrEqual(36);
    expect(grid.height).toBeGreaterThanOrEqual(17);
    expect(grid.height).toBeLessThanOrEqual(21);
    for (const row of TRAINING_YARD.rows) expect(row.length).toBe(grid.width);
  });

  it('테두리가 단단한 벽으로 닫혀 있다', () => {
    const grid = g();
    for (let x = 0; x < grid.width; x++) {
      expect(grid.get(x, 0)).toBe(Tile.HardWall);
      expect(grid.get(x, grid.height - 1)).toBe(Tile.HardWall);
    }
    for (let y = 0; y < grid.height; y++) {
      expect(grid.get(0, y)).toBe(Tile.HardWall);
      expect(grid.get(grid.width - 1, y)).toBe(Tile.HardWall);
    }
  });

  it('팀0 출발 지점은 왼쪽, 더미는 오른쪽(idle 3+, patrol 1, turret 1)', () => {
    const grid = g();
    expect(grid.teamSpawns[0].length).toBeGreaterThanOrEqual(1);
    for (const s of grid.teamSpawns[0]) expect(s.x).toBeLessThan(grid.width / 4);
    const count = (b: string) => grid.dummySpawns.filter((d) => d.behavior === b).length;
    expect(count('idle')).toBeGreaterThanOrEqual(3);
    expect(count('patrol')).toBe(1);
    expect(count('turret')).toBe(1);
    for (const d of grid.dummySpawns) expect(d.pos.x).toBeGreaterThan(grid.width / 2);
  });

  it('모든 종류의 지형이 있다', () => {
    const grid = g();
    const kinds = new Set<Tile>();
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) kinds.add(grid.get(x, y));
    for (const t of [Tile.Floor, Tile.Wall, Tile.HardWall, Tile.Bush, Tile.Water]) expect(kinds.has(t)).toBe(true);
    // 부서지는 벽은 묶음(2칸 이상 덩어리)이 여러 개
    const walls = labelClusters(grid, Tile.Wall).clusters.filter((c) => c.length >= 2);
    expect(walls.length).toBeGreaterThanOrEqual(4);
  });

  it('왕복 더미는 좌우 3타일씩 막힘 없이 움직인다', () => {
    const grid = g();
    const p = grid.dummySpawns.find((d) => d.behavior === 'patrol')!;
    for (const dir of [-1, 1]) {
      let pos = { ...p.pos };
      for (let i = 0; i < 30; i++) pos = moveCircle(grid, pos, 0.45, dir * 0.1, 0);
      expect(pos.x).toBeCloseTo(p.pos.x + dir * 3, 6);
      expect(pos.y).toBeCloseTo(p.pos.y, 6);
    }
  });

  it('포탑 더미는 서쪽이 일부 가려져 있다(엄폐) — 그래도 보이는 칸이 있다', () => {
    const grid = g();
    const t = grid.dummySpawns.find((d) => d.behavior === 'turret')!;
    const west = { x: t.pos.x - 4, y: t.pos.y };
    expect(hasLineOfSight(grid, t.pos, west)).toBe(false);
    let visible = 0;
    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = 1; x < grid.width - 1; x++) {
        const c = { x: x + 0.5, y: y + 0.5 };
        if (grid.get(x, y) !== Tile.Floor || Math.hypot(c.x - t.pos.x, c.y - t.pos.y) > 8) continue;
        if (hasLineOfSight(grid, t.pos, c)) visible++;
      }
    }
    expect(visible).toBeGreaterThan(20);
  });

  it('출발 지점에서 모든 바닥·더미에 갈 수 있다(벽 부수기 포함), 둘러싸인 더미 외에는 걸어서', () => {
    const grid = g();
    const spawn = grid.teamSpawns[0][0]!;
    const walk = reachable(grid, spawn, false);
    const all = reachable(grid, spawn, true);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const t = grid.get(x, y);
        if (t === Tile.Floor || t === Tile.Bush) expect(all.has(y * grid.width + x)).toBe(true);
      }
    }
    const walled = grid.dummySpawns.filter((d) => !walk.has(key(grid, d.pos)));
    expect(walled.length).toBeLessThanOrEqual(1);
    for (const d of grid.dummySpawns) expect(all.has(key(grid, d.pos))).toBe(true);
  });

  it('사격장 레인: 과녁 더미 왼쪽으로 10타일 이상 트인 레인', () => {
    const grid = g();
    const target = grid.dummySpawns.find((d) => grid.ground(Math.floor(d.pos.x), Math.floor(d.pos.y)) === Ground.Lane);
    expect(target).toBeDefined();
    const tx = Math.floor(target!.pos.x);
    const ty = Math.floor(target!.pos.y);
    for (let k = 1; k <= 10; k++) {
      expect(grid.get(tx - k, ty)).toBe(Tile.Floor);
      expect(grid.ground(tx - k, ty)).toBe(Ground.Lane);
    }
    expect(hasLineOfSight(grid, { x: target!.pos.x - 10, y: target!.pos.y }, target!.pos)).toBe(true);
  });
});

describe('labelClusters', () => {
  it('상하좌우로 이어진 수풀을 한 덩어리로 묶는다(대각선은 따로)', () => {
    const grid = new Grid({ id: 't', name: 't', rows: ['XXXXXXX', 'XBB...X', 'X.B..BX', 'X....BX', 'X...B.X', 'XXXXXXX'] });
    const { labels, clusters } = labelClusters(grid, Tile.Bush);
    expect(clusters.map((c) => c.length)).toEqual([3, 2, 1]);
    expect(bushClusterAt(grid, labels, { x: 1.5, y: 1.5 })).toBe(0);
    expect(bushClusterAt(grid, labels, { x: 2.5, y: 2.5 })).toBe(0);
    expect(bushClusterAt(grid, labels, { x: 5.5, y: 3.2 })).toBe(1);
    expect(bushClusterAt(grid, labels, { x: 4.5, y: 4.5 })).toBe(2);
    expect(bushClusterAt(grid, labels, { x: 3.5, y: 3.5 })).toBe(-1);
    expect(bushClusterAt(grid, labels, { x: -3, y: 1 })).toBe(-1);
  });

  it('바닥 무늬: 출발·더미 칸은 왼쪽 칸 무늬를 따른다', () => {
    const grid = new Grid({ id: 't', name: 't', rows: ['XXXXX', 'X==dX', 'X,,AX', 'X..pX', 'XXXXX'] });
    expect(grid.ground(3, 1)).toBe(Ground.Lane);
    expect(grid.ground(3, 2)).toBe(Ground.Grass);
    expect(grid.ground(3, 3)).toBe(Ground.Yard);
    expect(grid.get(3, 1)).toBe(Tile.Floor);
    expect(grid.get(1, 2)).toBe(Tile.Floor);
  });
});
