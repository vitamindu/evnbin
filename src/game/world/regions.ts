import type { Vec2 } from '../types';
import { Grid, Tile } from './grid';

/** 같은 종류 타일이 상하좌우로 이어진 덩어리 */
export interface TileClusters {
  /** 타일 (tx, ty) → 덩어리 번호(ty * width + tx 위치). 해당 종류가 아니면 -1 */
  labels: Int32Array;
  /** 덩어리별 타일 목록(덩어리 번호 순) */
  clusters: Vec2[][];
}

/**
 * kind 타일을 상하좌우로 이어진 덩어리로 나눈다(대각선은 끊김). 행 우선 순서로 번호를 매겨 결정적이다.
 * 예: 수풀 덩어리(플레이어가 들어간 덩어리 반투명), 부서지는 벽 묶음.
 */
export function labelClusters(grid: Grid, kind: Tile): TileClusters {
  const w = grid.width;
  const labels = new Int32Array(w * grid.height).fill(-1);
  const clusters: Vec2[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1 || grid.get(start % w, Math.floor(start / w)) !== kind) continue;
    const id = clusters.length;
    const tiles: Vec2[] = [];
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const tx = i % w;
      const ty = Math.floor(i / w);
      tiles.push({ x: tx, y: ty });
      const nbs = [
        [tx - 1, ty],
        [tx + 1, ty],
        [tx, ty - 1],
        [tx, ty + 1],
      ] as const;
      for (const [nx, ny] of nbs) {
        if (!grid.inBounds(nx, ny)) continue;
        const j = ny * w + nx;
        if (labels[j] !== -1 || grid.get(nx, ny) !== kind) continue;
        labels[j] = id;
        stack.push(j);
      }
    }
    tiles.sort((a, b) => a.y - b.y || a.x - b.x);
    clusters.push(tiles);
  }
  return { labels, clusters };
}

/** pos가 서 있는 수풀 덩어리 번호(수풀 밖이면 -1). labels는 labelClusters(grid, Tile.Bush) 결과 */
export function bushClusterAt(grid: Grid, labels: Int32Array, pos: Vec2): number {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  if (!grid.inBounds(tx, ty)) return -1;
  return labels[ty * grid.width + tx] ?? -1;
}
