import type { DummyBehavior, Vec2 } from '../types';

/**
 * 맵 격자. World 담당.
 * 타일 (tx, ty)는 x ∈ [tx, tx+1), y ∈ [ty, ty+1) 영역이고, 중심은 (tx+0.5, ty+0.5).
 */
export enum Tile {
  Floor = 0,
  /** 부술 수 있는 벽(궁극기 등) */
  Wall = 1,
  /** 부술 수 없는 벽(맵 테두리 등) */
  HardWall = 2,
  Bush = 3,
  Water = 4,
}

/**
 * 맵 정의. rows의 각 글자가 타일 하나.
 *  .  바닥      #  벽(부서짐)   X  단단한 벽   B  수풀   W  물
 *  A  팀0 출발 지점(바닥)       Z  팀1 출발 지점(바닥)
 *  d  더미(가만히)  p  더미(왕복)  t  더미(마주 쏨)   — 모두 바닥 위
 */
export interface MapDef {
  id: string;
  name: string;
  rows: string[];
}

export interface DummySpawn {
  pos: Vec2;
  behavior: DummyBehavior;
}

const CHAR_TILE: Record<string, Tile> = {
  '.': Tile.Floor,
  '#': Tile.Wall,
  X: Tile.HardWall,
  B: Tile.Bush,
  W: Tile.Water,
  A: Tile.Floor,
  Z: Tile.Floor,
  d: Tile.Floor,
  p: Tile.Floor,
  t: Tile.Floor,
};

const DUMMY_CHAR: Record<string, DummyBehavior> = { d: 'idle', p: 'patrol', t: 'turret' };

export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Uint8Array;
  readonly teamSpawns: [Vec2[], Vec2[]] = [[], []];
  readonly dummySpawns: DummySpawn[] = [];
  /** 타일이 바뀔 때마다 1씩 증가(렌더러가 다시 그릴지 판단) */
  version = 0;

  constructor(def: MapDef) {
    this.height = def.rows.length;
    this.width = Math.max(...def.rows.map((r) => r.length));
    this.tiles = new Uint8Array(this.width * this.height);
    def.rows.forEach((row, ty) => {
      for (let tx = 0; tx < this.width; tx++) {
        const ch = row[tx] ?? 'X';
        const tile = CHAR_TILE[ch];
        if (tile === undefined) throw new Error(`Unknown map char '${ch}' at ${tx},${ty} in ${def.id}`);
        this.tiles[ty * this.width + tx] = tile;
        const center = { x: tx + 0.5, y: ty + 0.5 };
        if (ch === 'A') this.teamSpawns[0].push(center);
        if (ch === 'Z') this.teamSpawns[1].push(center);
        const b = DUMMY_CHAR[ch];
        if (b) this.dummySpawns.push({ pos: center, behavior: b });
      }
    });
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /** 맵 밖은 단단한 벽으로 취급 */
  get(tx: number, ty: number): Tile {
    if (!this.inBounds(tx, ty)) return Tile.HardWall;
    return this.tiles[ty * this.width + tx] as Tile;
  }

  set(tx: number, ty: number, t: Tile) {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.width + tx;
    if (this.tiles[i] === t) return;
    this.tiles[i] = t;
    this.version++;
  }

  /** 걸어서 지나갈 수 없는 타일 */
  blocksMovement(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === Tile.Wall || t === Tile.HardWall || t === Tile.Water;
  }

  /** 직선 투사체를 막는 타일 */
  blocksProjectile(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === Tile.Wall || t === Tile.HardWall;
  }
}
