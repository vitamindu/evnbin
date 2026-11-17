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
 * 바닥 무늬(표현 전용). 로직은 쓰지 않는다 — 렌더러가 바닥을 그릴 때만 읽는다.
 * 벽·물 아래는 Yard, 수풀 아래는 Grass.
 */
export enum Ground {
  /** 다져진 흙 마당(기본) */
  Yard = 0,
  /** 풀밭 */
  Grass = 1,
  /** 사격장 레인(거리 눈금이 그려지는 포장 바닥) */
  Lane = 2,
}

/**
 * 맵 정의. rows의 각 글자가 타일 하나. 모든 줄은 같은 길이로 쓴다(짧으면 나머지는 단단한 벽).
 *  .  바닥(흙 마당)   ,  바닥(풀밭)   =  바닥(사격장 레인)  — 셋 다 로직에서는 같은 바닥
 *  #  벽(부서짐)      X  단단한 벽    B  수풀              W  물
 *  A  팀0 출발 지점(바닥)       Z  팀1 출발 지점(바닥)
 *  d  더미(가만히)  p  더미(왕복)  t  더미(마주 쏨)   — 모두 바닥 위
 * 출발 지점·더미 칸의 바닥 무늬는 왼쪽 칸의 바닥 무늬를 따른다.
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
  ',': Tile.Floor,
  '=': Tile.Floor,
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

const CHAR_GROUND: Record<string, Ground> = { ',': Ground.Grass, '=': Ground.Lane, B: Ground.Grass };

/** 바닥 무늬를 왼쪽 칸에서 물려받는 글자 */
const INHERITS_GROUND = new Set(['A', 'Z', 'd', 'p', 't']);

const DUMMY_CHAR: Record<string, DummyBehavior> = { d: 'idle', p: 'patrol', t: 'turret' };

export class Grid {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  private readonly tiles: Uint8Array;
  private readonly grounds: Uint8Array;
  readonly teamSpawns: [Vec2[], Vec2[]] = [[], []];
  readonly dummySpawns: DummySpawn[] = [];
  /** 타일이 바뀔 때마다 1씩 증가(렌더러가 다시 그릴지 판단) */
  version = 0;

  constructor(def: MapDef) {
    this.id = def.id;
    this.height = def.rows.length;
    this.width = Math.max(...def.rows.map((r) => r.length));
    this.tiles = new Uint8Array(this.width * this.height);
    this.grounds = new Uint8Array(this.width * this.height);
    def.rows.forEach((row, ty) => {
      for (let tx = 0; tx < this.width; tx++) {
        const ch = row[tx] ?? 'X';
        const tile = CHAR_TILE[ch];
        if (tile === undefined) throw new Error(`Unknown map char '${ch}' at ${tx},${ty} in ${def.id}`);
        const i = ty * this.width + tx;
        this.tiles[i] = tile;
        this.grounds[i] = INHERITS_GROUND.has(ch) && tx > 0 ? this.grounds[i - 1]! : (CHAR_GROUND[ch] ?? Ground.Yard);
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

  /** 바닥 무늬(표현 전용). 맵 밖은 Grass */
  ground(tx: number, ty: number): Ground {
    if (!this.inBounds(tx, ty)) return Ground.Grass;
    return this.grounds[ty * this.width + tx] as Ground;
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
