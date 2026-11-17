import { describe, expect, it } from 'vitest';
import { TRAINING_YARD } from '../../../src/data/maps/training';
import type { Vec2 } from '../../../src/game/types';
import {
  Grid,
  Tile,
  breakWallsInCircle,
  circleBlocked,
  hasLineOfSight,
  isInBush,
  moveCircle,
  resolveCircle,
  sweepCircle,
} from '../../../src/game/world';

const grid = (rows: string[]) => new Grid({ id: 'test', name: 'test', rows });

/** 결정적 의사난수(테스트용) */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 원이 투사체를 막는 타일과 겹치는가(무차별 검사용) */
function overlapsProjectileTile(g: Grid, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (!g.blocksProjectile(tx, ty)) continue;
      const nx = Math.max(tx, Math.min(x, tx + 1));
      const ny = Math.max(ty, Math.min(y, ty + 1));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}

const OPEN = [
  'XXXXXXXXXXXX',
  'X..........X',
  'X..........X',
  'X..........X',
  'X..........X',
  'X..........X',
  'X..........X',
  'X..........X',
  'XXXXXXXXXXXX',
];

describe('moveCircle', () => {
  it('빈 곳에서는 정확히 그만큼 움직인다', () => {
    const g = grid(OPEN);
    const p = moveCircle(g, { x: 3.5, y: 3.5 }, 0.4, 0.37, -0.21);
    expect(p.x).toBeCloseTo(3.87, 9);
    expect(p.y).toBeCloseTo(3.29, 9);
  });

  it('벽에 정면으로 부딪히면 맞닿은 곳에서 멈춘다', () => {
    const g = grid(OPEN);
    let p: Vec2 = { x: 8.5, y: 4.5 };
    for (let i = 0; i < 60; i++) p = moveCircle(g, p, 0.4, 0.1, 0);
    // 오른쪽 테두리 벽 x = 11
    expect(p.x).toBeLessThanOrEqual(11 - 0.4);
    expect(p.x).toBeGreaterThan(11 - 0.4 - 0.01);
    expect(p.y).toBeCloseTo(4.5, 6);
  });

  it('대각선으로 벽을 밀면 벽을 따라 미끄러진다', () => {
    const g = grid(OPEN);
    let p: Vec2 = { x: 10.5, y: 2.5 }; // 오른쪽 벽에 붙어 있음
    p = moveCircle(g, p, 0.4, 0, 0); // 시작점이 벽과 겹치면 꺼낸다
    const y0 = p.y;
    const s = 0.1 / Math.SQRT2;
    for (let i = 0; i < 30; i++) p = moveCircle(g, p, 0.4, s, s);
    expect(p.x).toBeLessThanOrEqual(11 - 0.4 + 1e-9);
    expect(p.y - y0).toBeCloseTo(30 * s, 3);
  });

  it('여러 타일로 된 긴 벽의 이음매에 걸리지 않는다', () => {
    const g = grid(OPEN);
    let p: Vec2 = { x: 1.5, y: 1.4 }; // 위쪽 테두리(y = 1)에 붙어서 오른쪽으로, 벽 쪽으로 누르면서
    for (let i = 0; i < 80; i++) {
      p = moveCircle(g, p, 0.4, 0.1, -0.05);
      // 이음매를 지날 때도 옆으로 튕기지 않는다
      expect(p.y).toBeCloseTo(1.4, 3);
    }
    // 가로 속도를 하나도 잃지 않는다
    expect(p.x).toBeCloseTo(1.5 + 80 * 0.1, 3);
    expect(circleBlocked(g, p.x, p.y, 0.4)).toBe(false);
  });

  it('볼록한 모서리에 살짝 걸리면 돌아서 지나간다(멈추지 않음)', () => {
    const g = grid([
      'XXXXXXXXXXXX',
      'X..........X',
      'X..........X',
      'X..........X',
      'X..........X',
      'X....#.....X',
      'X..........X',
      'XXXXXXXXXXXX',
    ]);
    // 벽 타일 (5,5)의 윗면 y = 5. 중심 y = 4.75 → 반지름 0.4 중 0.15만큼 모서리에 걸린다
    let p: Vec2 = { x: 3.5, y: 4.75 };
    for (let i = 0; i < 40; i++) p = moveCircle(g, p, 0.4, 0.1, 0);
    expect(p.x).toBeGreaterThan(6.5);
    expect(p.y).toBeLessThanOrEqual(5 - 0.4 + 1e-6);
    expect(p.y).toBeGreaterThan(4.3);
  });

  it('안쪽 모서리로 밀면 그 자리에 멈춘다', () => {
    const g = grid(OPEN);
    let p: Vec2 = { x: 2, y: 2 };
    for (let i = 0; i < 40; i++) p = moveCircle(g, p, 0.4, -0.07, -0.07);
    expect(p.x).toBeCloseTo(1.4, 3);
    expect(p.y).toBeCloseTo(1.4, 3);
  });

  it('물은 건널 수 없다', () => {
    const g = grid([
      'XXXXXXXX',
      'X......X',
      'X..W...X',
      'X..W...X',
      'X..W...X',
      'X......X',
      'XXXXXXXX',
    ]);
    let p: Vec2 = { x: 1.5, y: 3.5 };
    for (let i = 0; i < 40; i++) p = moveCircle(g, p, 0.4, 0.1, 0);
    expect(p.x).toBeLessThanOrEqual(3 - 0.4 + 1e-9);
  });

  it('한 번에 크게 움직여도(넉백·돌진) 얇은 벽을 건너뛰지 않는다', () => {
    const g = grid(['XXXXXXXXXX', 'X........X', 'X...#....X', 'X........X', 'XXXXXXXXXX']);
    const p = moveCircle(g, { x: 1.5, y: 2.5 }, 0.4, 6, 0);
    expect(p.x).toBeLessThanOrEqual(4 - 0.4 + 1e-9);
  });

  it('폭 1타일 통로를 반지름 0.45로 지나간다', () => {
    const g = grid(['XXXXXXXXX', 'X.......X', 'XXX.XXXXX', 'XXX.XXXXX', 'XXX.XXXXX', 'X.......X', 'XXXXXXXXX']);
    let p: Vec2 = { x: 3.5, y: 1.5 };
    for (let i = 0; i < 60; i++) p = moveCircle(g, p, 0.45, 0.02, 0.1);
    expect(p.y).toBeGreaterThan(5);
    expect(circleBlocked(g, p.x, p.y, 0.45)).toBe(false);
  });

  it('시작점이 벽 안이면 가장 가까운 빈 곳으로 꺼낸다', () => {
    const g = grid(OPEN);
    g.set(4, 4, Tile.Wall);
    const p = moveCircle(g, { x: 4.6, y: 4.5 }, 0.4, 0, 0);
    expect(circleBlocked(g, p.x, p.y, 0.4)).toBe(false);
    expect(Math.hypot(p.x - 4.6, p.y - 4.5)).toBeLessThan(1);
    // 사방이 막힌 깊은 곳에서도 빠져나온다
    const g2 = grid(OPEN);
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) g2.set(x, y, Tile.HardWall);
    const q = resolveCircle(g2, { x: 4.5, y: 4.5 }, 0.4);
    expect(circleBlocked(g2, q.x, q.y, 0.4)).toBe(false);
  });

  it('연습장에서 무작위로 오래 움직여도 벽·물과 겹치지 않는다', () => {
    const g = new Grid(TRAINING_YARD);
    const rnd = lcg(7);
    for (const r of [0.4, 0.45, 0.5]) {
      let p: Vec2 = { ...g.teamSpawns[0][0]! };
      let dir = 0;
      for (let i = 0; i < 4000; i++) {
        if (i % 20 === 0) dir = rnd() * Math.PI * 2;
        const speed = rnd() < 0.05 ? 0.4 : 0.1; // 가끔 넉백처럼 크게
        p = moveCircle(g, p, r, Math.cos(dir) * speed, Math.sin(dir) * speed);
        expect(circleBlocked(g, p.x, p.y, r)).toBe(false);
      }
    }
  });

  it('결정적이다(같은 입력 → 같은 결과)', () => {
    const run = () => {
      const g = new Grid(TRAINING_YARD);
      const rnd = lcg(3);
      let p: Vec2 = { ...g.teamSpawns[0][0]! };
      for (let i = 0; i < 500; i++) p = moveCircle(g, p, 0.4, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
      return `${p.x},${p.y}`;
    };
    expect(run()).toBe(run());
  });
});

describe('sweepCircle', () => {
  const THIN = ['XXXXXXXXXXXXXXXXXXXX', 'X..................X', 'X.........#........X', 'X..................X', 'XXXXXXXXXXXXXXXXXXXX'];

  it('초당 22타일 탄을 1/30초씩 진행해도 1칸 벽을 뚫지 않는다', () => {
    const g = grid(THIN);
    for (const y of [2.5, 2.05, 2.95, 1.9, 3.1]) {
      for (const x0 of [1.5, 1.6, 1.73, 1.9]) {
        let pos: Vec2 = { x: x0, y };
        const step = 22 / 30;
        let hit = false;
        for (let i = 0; i < 40 && !hit; i++) {
          const res = sweepCircle(g, pos, { x: pos.x + step, y }, 0.18);
          pos = res.point;
          hit = res.hit;
        }
        expect(hit).toBe(true);
        expect(pos.x).toBeLessThan(10);
        expect(overlapsProjectileTile(g, pos.x, pos.y, 0.18)).toBe(false);
      }
    }
  });

  it('아주 긴 한 번의 스윕도 첫 벽에서 멈춘다', () => {
    const g = grid(THIN);
    const res = sweepCircle(g, { x: 1.5, y: 2.5 }, { x: 18.5, y: 2.5 }, 0.2);
    expect(res.hit).toBe(true);
    expect(res.tile).toEqual({ x: 10, y: 2 });
    expect(res.point.x).toBeCloseTo(10 - 0.2, 3);
    expect(res.point.x).toBeLessThan(10 - 0.2);
  });

  it('모서리를 살짝 스치는 경로도 정확한 접촉 지점에서 막힌다', () => {
    const g = grid(OPEN);
    g.set(5, 4, Tile.Wall);
    // 중심 y = 3.97, r = 0.05 → 타일 윗면(y=4)을 0.02 파고든다. 모서리 (5,4)에 x = 5 - 0.04에서 닿는다
    const res = sweepCircle(g, { x: 1.5, y: 3.97 }, { x: 9.5, y: 3.97 }, 0.05);
    expect(res.hit).toBe(true);
    expect(res.tile).toEqual({ x: 5, y: 4 });
    expect(res.point.x).toBeCloseTo(4.96, 3);
  });

  it('살짝 비켜 가면 막히지 않는다', () => {
    const g = grid(OPEN);
    g.set(5, 4, Tile.Wall);
    const res = sweepCircle(g, { x: 1.5, y: 3.9 }, { x: 9.5, y: 3.9 }, 0.05);
    expect(res.hit).toBe(false);
    expect(res.point).toEqual({ x: 9.5, y: 3.9 });
  });

  it('맵 밖으로 나가면 테두리에서 막힌다', () => {
    const g = grid(['....', '....', '....']); // 테두리 벽이 없어도 맵 밖은 단단한 벽
    const res = sweepCircle(g, { x: 1.5, y: 1.5 }, { x: 10, y: 1.5 }, 0.2);
    expect(res.hit).toBe(true);
    expect(res.point.x).toBeCloseTo(4 - 0.2, 3);
  });

  it('시작점이 벽과 겹치고 벽 쪽으로 가면 바로 막힌다', () => {
    const g = grid(OPEN);
    g.set(5, 4, Tile.Wall);
    const res = sweepCircle(g, { x: 4.9, y: 4.5 }, { x: 7, y: 4.5 }, 0.18);
    expect(res.hit).toBe(true);
    expect(res.point).toEqual({ x: 4.9, y: 4.5 });
    expect(res.tile).toEqual({ x: 5, y: 4 });
    // 중심이 벽 안이면 방향과 상관없이 막힌다
    expect(sweepCircle(g, { x: 5.5, y: 4.5 }, { x: 3, y: 4.5 }, 0.18).hit).toBe(true);
  });

  it('시작점이 벽과 겹쳐도 벽에서 멀어지면 그 벽은 무시한다', () => {
    const g = grid(OPEN);
    g.set(5, 4, Tile.Wall);
    const res = sweepCircle(g, { x: 4.9, y: 4.5 }, { x: 2, y: 4.5 }, 0.18);
    expect(res.hit).toBe(false);
    expect(res.point).toEqual({ x: 2, y: 4.5 });
  });

  it('길이 0이면 겹침만 본다', () => {
    const g = grid(OPEN);
    expect(sweepCircle(g, { x: 3, y: 3 }, { x: 3, y: 3 }, 0.2).hit).toBe(false);
    expect(sweepCircle(g, { x: 1.1, y: 3 }, { x: 1.1, y: 3 }, 0.2).hit).toBe(true);
  });

  it('breakWalls: 부서지는 벽은 순서대로 부수고 단단한 벽에서 멈춘다', () => {
    const g = grid(['XXXXXXXXXXXX', 'X..........X', 'X..###.X...X', 'X..........X', 'XXXXXXXXXXXX']);
    const v0 = g.version;
    const res = sweepCircle(g, { x: 1.5, y: 2.5 }, { x: 10.5, y: 2.5 }, 0.25, { breakWalls: true });
    expect(res.hit).toBe(true);
    expect(res.tile).toEqual({ x: 7, y: 2 });
    expect(res.broken).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    for (const t of res.broken) expect(g.get(t.x, t.y)).toBe(Tile.Floor);
    expect(g.get(7, 2)).toBe(Tile.HardWall);
    expect(g.version).toBe(v0 + 3);
    expect(res.point.x).toBeCloseTo(7 - 0.25, 3);
  });

  it('breakWalls: 경로에 스치기만 한 벽도 부순다(넓은 탄)', () => {
    const g = grid(['XXXXXXXXXX', 'X........X', 'X...#....X', 'X...#....X', 'X........X', 'XXXXXXXXXX']);
    const res = sweepCircle(g, { x: 1.5, y: 3.0 }, { x: 7.5, y: 3.0 }, 0.3, { breakWalls: true });
    expect(res.hit).toBe(false);
    expect(res.broken).toHaveLength(2);
  });

  it('breakWalls가 아니면 그리드를 바꾸지 않는다', () => {
    const g = grid(THIN);
    const v0 = g.version;
    const res = sweepCircle(g, { x: 1.5, y: 2.5 }, { x: 18.5, y: 2.5 }, 0.2);
    expect(res.broken).toEqual([]);
    expect(g.version).toBe(v0);
    expect(g.get(10, 2)).toBe(Tile.Wall);
  });

  it('물·수풀은 투사체를 막지 않는다', () => {
    const g = grid(['XXXXXXXXXX', 'X........X', 'X..WWBB..X', 'X........X', 'XXXXXXXXXX']);
    expect(sweepCircle(g, { x: 1.5, y: 2.5 }, { x: 8.5, y: 2.5 }, 0.2).hit).toBe(false);
  });

  it('무작위 스윕이 촘촘한 무차별 검사와 일치한다', () => {
    const g = new Grid(TRAINING_YARD);
    const rnd = lcg(11);
    let checked = 0;
    for (let n = 0; n < 1500; n++) {
      const r = 0.05 + rnd() * 0.35;
      const from = { x: 1 + rnd() * (g.width - 2), y: 1 + rnd() * (g.height - 2) };
      if (overlapsProjectileTile(g, from.x, from.y, r)) continue;
      const a = rnd() * Math.PI * 2;
      const L = 0.2 + rnd() * 4;
      const to = { x: from.x + Math.cos(a) * L, y: from.y + Math.sin(a) * L };
      const res = sweepCircle(g, from, to, r);
      const end = res.hit ? res.point : to;
      const segLen = Math.hypot(end.x - from.x, end.y - from.y);
      const steps = Math.ceil(segLen / 0.004);
      for (let i = 0; i <= steps; i++) {
        const k = steps ? i / steps : 0;
        const x = from.x + (end.x - from.x) * k;
        const y = from.y + (end.y - from.y) * k;
        expect(overlapsProjectileTile(g, x, y, r)).toBe(false);
      }
      if (res.hit) {
        // 멈춘 곳 바로 다음은 막은 타일과 겹친다
        const k = 0.002 / L;
        const x = res.point.x + (to.x - from.x) * k;
        const y = res.point.y + (to.y - from.y) * k;
        expect(overlapsProjectileTile(g, x, y, r)).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('hasLineOfSight', () => {
  it('트인 곳은 보이고, 벽·단단한 벽은 가린다', () => {
    const g = grid(['XXXXXXXXXX', 'X........X', 'X...#..X.X', 'X........X', 'XXXXXXXXXX']);
    expect(hasLineOfSight(g, { x: 1.5, y: 1.5 }, { x: 8.5, y: 1.5 })).toBe(true);
    expect(hasLineOfSight(g, { x: 1.5, y: 2.5 }, { x: 6.5, y: 2.5 })).toBe(false);
    expect(hasLineOfSight(g, { x: 5.5, y: 2.5 }, { x: 8.5, y: 2.5 })).toBe(false);
  });

  it('물과 수풀은 시야를 막지 않는다', () => {
    const g = grid(['XXXXXXXXXX', 'X........X', 'X..WWBB..X', 'X........X', 'XXXXXXXXXX']);
    expect(hasLineOfSight(g, { x: 1.5, y: 2.5 }, { x: 8.5, y: 2.5 })).toBe(true);
  });

  it('대각선으로 맞붙은 두 벽의 틈으로는 보이지 않는다', () => {
    const g = grid(OPEN);
    g.set(3, 3, Tile.Wall);
    g.set(4, 4, Tile.Wall);
    // 두 벽은 점 (4,4)에서만 맞닿는다. 그 점을 지나는 시선
    expect(hasLineOfSight(g, { x: 2.5, y: 5.5 }, { x: 5.5, y: 2.5 })).toBe(false);
  });

  it('양방향 결과가 같다', () => {
    const g = new Grid(TRAINING_YARD);
    const rnd = lcg(5);
    for (let n = 0; n < 400; n++) {
      const a = { x: 1 + rnd() * (g.width - 2), y: 1 + rnd() * (g.height - 2) };
      const b = { x: 1 + rnd() * (g.width - 2), y: 1 + rnd() * (g.height - 2) };
      if (circleBlocked(g, a.x, a.y, 0.1) || circleBlocked(g, b.x, b.y, 0.1)) continue;
      expect(hasLineOfSight(g, a, b)).toBe(hasLineOfSight(g, b, a));
    }
  });
});

describe('breakWallsInCircle / isInBush', () => {
  it('원과 겹치는 부서지는 벽만 바닥으로 바꾼다', () => {
    const g = grid(['XXXXXXX', 'X.#X#.X', 'X.#.#.X', 'X.....X', 'XXXXXXX']);
    const out = breakWallsInCircle(g, { x: 3.5, y: 2.5 }, 1.2);
    expect(out).toEqual([
      { x: 2, y: 1 },
      { x: 4, y: 1 },
      { x: 2, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(g.get(3, 1)).toBe(Tile.HardWall);
    for (const t of out) expect(g.get(t.x, t.y)).toBe(Tile.Floor);
    expect(breakWallsInCircle(g, { x: 3.5, y: 2.5 }, 1.2)).toEqual([]);
  });

  it('맞닿기만 한 벽은 부수지 않는다', () => {
    const g = grid(['XXXXX', 'X.#.X', 'X...X', 'XXXXX']);
    expect(breakWallsInCircle(g, { x: 1.5, y: 1.5 }, 0.5)).toEqual([]);
    expect(g.get(2, 1)).toBe(Tile.Wall);
  });

  it('isInBush는 중심이 있는 타일로 판단한다', () => {
    const g = grid(['XXXXX', 'X.B.X', 'XXXXX']);
    expect(isInBush(g, { x: 2.5, y: 1.5 })).toBe(true);
    expect(isInBush(g, { x: 1.95, y: 1.5 })).toBe(false);
  });
});
