import * as THREE from 'three';
import type { Vec2 } from '../../game/types';
import { Tile, labelClusters, type Grid } from '../../game/world';
import { BushLayer } from './bushes';
import { adobeGeometry, crateGeometry, mergeParts, outlineGeometry, paint, reedGeometry, rubbleGeometry, stoneBlockGeometry } from './geometry';
import { InstancedLayer, tileMatrix } from './instancedLayer';
import { outlineMaterial, waterMaterial, worldToon, type TimeUniform } from './materials';
import { Scenery } from './scenery';
import { borderStyleFromUrl, borderTiles, buildBorder, type BorderStyle } from './border';
import { buildAdobeTexture, buildCrateTexture, buildFloorTexture, buildStoneTexture, hash, setWorldTheme } from './textures';

/**
 * 맵 3D 표현. World 담당.
 * 월드 좌표: 타일 (tx, ty)의 중심 = (tx+0.5, 0, ty+0.5). 바닥은 y=0. 그림자 맵은 쓰지 않는다.
 *
 * 드로우콜(연습장 기준 약 20): 바닥 1, 물 1, 물가 벽 1, 물가 장식 1, 돌벽 2(+외곽선), 상자 2, 흙벽돌 2,
 * 잔해 1, 수풀 2(+반투명일 때 2), 바깥 풀밭 1, 바깥 장식 2.
 *
 * 벽이 부서지면(grid.version 변화) 바뀐 타일만 찾아서 그 칸의 인스턴스를 숨기고 잔해를 놓는다.
 * 바닥 텍스처는 처음부터 벽 아래를 흙 자국으로 그려 두었으므로 다시 그리지 않는다.
 */

const WATER_Y = -0.17;
const BANK_DEPTH = 0.6;
const WALL_OUTLINE = 0.026;

type WallKind = 'crate' | 'adobe';
const RUBBLE_TINT: Record<WallKind, THREE.Color> = {
  crate: new THREE.Color('#d8954f'),
  adobe: new THREE.Color('#d98a5c'),
};

/** 정점 배열로 사각형들을 모으는 도우미(감김 방향은 원하는 법선에 맞춰 자동으로) */
class QuadBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  quad(v: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][], colors?: THREE.Color[]) {
    const base = this.pos.length / 3;
    v.forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(...uvs[i]!);
      const c = colors?.[i] ?? new THREE.Color(1, 1, 1);
      this.col.push(c.r, c.g, c.b);
    });
    const e1 = new THREE.Vector3().subVectors(v[1]!, v[0]!);
    const e2 = new THREE.Vector3().subVectors(v[2]!, v[0]!);
    const flip = new THREE.Vector3().crossVectors(e1, e2).dot(n) < 0;
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class MapRenderer {
  readonly object = new THREE.Group();
  private readonly grid: Grid;
  private readonly time: TimeUniform = { value: 0 };
  private builtVersion = -1;
  /** 마지막으로 그린 타일 상태(바뀐 칸만 찾기 위해) */
  private tiles = new Uint8Array(0);
  /** 이번 빌드에서 만든 것들(dispose 대상) */
  private parts: { dispose(): void }[] = [];
  private stone!: InstancedLayer;
  private walls!: Record<WallKind, InstancedLayer>;
  private rubble!: InstancedLayer;
  private wallKind = new Map<number, WallKind>();
  private bushes!: BushLayer;
  private scenery: Scenery;
  private readonly borderStyle: BorderStyle;
  private border: { object: THREE.Group; dispose(): void } | null = null;
  private borderSet: Set<number> | null = null;

  /** viewerTeam: 보는 사람의 팀(출발 지점 색) */
  constructor(grid: Grid, private readonly viewerTeam = 0) {
    this.grid = grid;
    // 겉모습(눈·얼음 등)을 먼저 정한다: 아래에서 만드는 텍스처·풍경이 읽는다
    setWorldTheme(grid.theme);
    this.borderStyle = borderStyleFromUrl();
    this.scenery = new Scenery(grid, { clearNear: this.borderStyle === 'stone' ? 0 : this.borderStyle === 'hill' ? 1.8 : 2.6 });
    this.object.add(this.scenery.object);
    this.build();
    // 맵 테두리: 자연 지형(바위·언덕·절벽). 단단한 벽은 바뀌지 않으므로 한 번만 만든다
    if (this.borderStyle !== 'stone') {
      this.border = buildBorder(grid, this.borderStyle);
      this.object.add(this.border.object);
    }
  }

  // ───────────── 만들기 ─────────────

  private build() {
    const g = this.grid;
    this.builtVersion = g.version;
    this.tiles = new Uint8Array(g.width * g.height);
    for (let ty = 0; ty < g.height; ty++) for (let tx = 0; tx < g.width; tx++) this.tiles[ty * g.width + tx] = g.get(tx, ty);
    const root = new THREE.Group();
    this.object.add(root);
    this.parts.push({ dispose: () => root.removeFromParent() });

    this.buildFloor(root);
    this.buildWater(root);
    this.buildWalls(root);
    this.bushes = new BushLayer(g, this.time);
    root.add(this.bushes.object);
    this.parts.push(this.bushes);
  }

  private own<T extends { dispose(): void }>(x: T): T {
    this.parts.push(x);
    return x;
  }

  private buildFloor(root: THREE.Group) {
    const g = this.grid;
    const qb = new QuadBuilder();
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        if (g.get(tx, ty) === Tile.Water) continue;
        const u0 = tx / g.width;
        const u1 = (tx + 1) / g.width;
        const v0 = 1 - ty / g.height;
        const v1 = 1 - (ty + 1) / g.height;
        qb.quad([V(tx, 0, ty), V(tx + 1, 0, ty), V(tx + 1, 0, ty + 1), V(tx, 0, ty + 1)], UP, [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ]);
      }
    }
    const geo = this.own(qb.build());
    const tex = this.own(buildFloorTexture(g, 64, this.viewerTeam));
    const mat = this.own(new THREE.MeshLambertMaterial({ map: tex }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'floor';
    root.add(mesh);
  }

  private buildWater(root: THREE.Group) {
    const g = this.grid;
    const isWater = (tx: number, ty: number) => g.inBounds(tx, ty) && g.get(tx, ty) === Tile.Water;
    const surface = new QuadBuilder();
    const banks = new QuadBuilder();
    const mask = new Uint8Array(g.width * g.height);
    const deco: THREE.BufferGeometry[] = [];
    const bankTop = new THREE.Color('#a07a4e');
    const bankBottom = new THREE.Color('#3f3226');
    let any = false;
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        if (!isWater(tx, ty)) continue;
        any = true;
        mask[ty * g.width + tx] = 255;
        surface.quad([V(tx, WATER_Y, ty), V(tx + 1, WATER_Y, ty), V(tx + 1, WATER_Y, ty + 1), V(tx, WATER_Y, ty + 1)], UP, [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]);
        for (const [sx, sy] of SIDES) {
          if (isWater(tx + sx, ty + sy)) continue;
          // 물 쪽을 보는 세로 벽(물가 흙벽)
          const n = V(-sx, 0, -sy);
          const ex = sx === 0 ? [tx, tx + 1] : [sx > 0 ? tx + 1 : tx, sx > 0 ? tx + 1 : tx];
          const ez = sy === 0 ? [ty, ty + 1] : [sy > 0 ? ty + 1 : ty, sy > 0 ? ty + 1 : ty];
          const a = V(ex[0]!, 0, ez[0]!);
          const b = V(ex[1]!, 0, ez[1]!);
          banks.quad([a, b, V(b.x, -BANK_DEPTH, b.z), V(a.x, -BANK_DEPTH, a.z)], n, [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ], [bankTop, bankTop, bankBottom, bankBottom]);
          // 물가 갈대(바깥 칸 가장자리)
          const nx = tx + sx;
          const ny = ty + sy;
          if (g.get(nx, ny) === Tile.Floor && hash(nx * 4 + sx + 2, ny * 4 + sy + 2, 610) < 0.4) {
            const r = reedGeometry();
            const along = 0.2 + hash(nx, ny, 611 + sx + sy * 2) * 0.6;
            const px = sx !== 0 ? (sx > 0 ? nx + 0.16 : nx + 0.84) : nx + along;
            const pz = sy !== 0 ? (sy > 0 ? ny + 0.16 : ny + 0.84) : ny + along;
            r.scale(1, 0.8 + hash(nx, ny, 612) * 0.5, 1);
            r.rotateY(hash(nx, ny, 613) * 6.28);
            r.translate(px, 0, pz);
            deco.push(r);
          }
        }
        // 연잎
        if (hash(tx, ty, 620) < 0.35) {
          const pad = new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14, 1, false, 0.35, Math.PI * 2 - 0.7);
          paint(pad, (_p, n) => (n.y > 0.5 ? '#5cbf55' : '#3a8a3e'));
          pad.rotateY(hash(tx, ty, 621) * 6.28);
          pad.translate(tx + 0.3 + hash(tx, ty, 622) * 0.4, WATER_Y + 0.012, ty + 0.3 + hash(tx, ty, 623) * 0.4);
          deco.push(pad);
          if (hash(tx, ty, 624) < 0.5) {
            const bloom = new THREE.SphereGeometry(0.06, 8, 6);
            paint(bloom, '#ff9ccc');
            bloom.translate(tx + 0.3 + hash(tx, ty, 622) * 0.4, WATER_Y + 0.05, ty + 0.3 + hash(tx, ty, 623) * 0.4);
            deco.push(bloom);
          }
        }
      }
    }
    if (!any) return;
    const maskTex = this.own(new THREE.DataTexture(mask, g.width, g.height, THREE.RedFormat, THREE.UnsignedByteType));
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.needsUpdate = true;
    const sGeo = this.own(surface.build());
    const sMat = this.own(waterMaterial(this.time, maskTex, new THREE.Vector2(g.width, g.height), g.theme === 'winter'));
    const water = new THREE.Mesh(sGeo, sMat);
    water.name = 'water';
    const bGeo = this.own(banks.build());
    const bMat = this.own(worldToon({ vertexColors: true }));
    const bankMesh = new THREE.Mesh(bGeo, bMat);
    root.add(water, bankMesh);
    if (deco.length) {
      const dGeo = this.own(mergeParts(deco));
      const dMat = this.own(worldToon({ vertexColors: true }));
      root.add(new THREE.Mesh(dGeo, dMat));
    }
  }

  private buildWalls(root: THREE.Group) {
    const g = this.grid;
    const W = g.width;
    let hardCount = 0;
    let wallCount = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === Tile.HardWall) hardCount++;
      if (this.tiles[i] === Tile.Wall) wallCount++;
    }
    const layer = (geo: THREE.BufferGeometry, map: THREE.Texture, cap: number) => {
      this.own(map);
      return this.own(
        new InstancedLayer(geo, worldToon({ vertexColors: true, map }), cap, { geo: outlineGeometry(geo), mat: outlineMaterial(WALL_OUTLINE) }),
      );
    };
    this.stone = layer(stoneBlockGeometry(), buildStoneTexture(), hardCount);
    // 부서지는 벽: 묶음마다 나무 상자 / 흙벽돌을 번갈아(같은 묶음은 같은 재료)
    const spare = 8;
    this.walls = {
      crate: layer(crateGeometry(), buildCrateTexture(), wallCount + spare),
      adobe: layer(adobeGeometry(), buildAdobeTexture(), wallCount + spare),
    };
    this.rubble = this.own(new InstancedLayer(rubbleGeometry(), worldToon({ vertexColors: true }), wallCount + spare));
    for (const l of [this.stone, this.walls.crate, this.walls.adobe, this.rubble]) l.addTo(root);

    const stoneColor = new THREE.Color();
    // 테두리 칸은 border.ts가 자연 지형으로 그린다(돌벽돌은 안쪽 단단한 벽만)
    if (this.borderStyle !== 'stone') this.borderSet ??= borderTiles(g);
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (g.get(tx, ty) !== Tile.HardWall) continue;
        if (this.borderSet?.has(ty * W + tx)) continue;
        const r = (s: number) => hash(tx, ty, 300 + s);
        const k = 0.9 + r(1) * 0.14;
        stoneColor.setRGB(k * (0.98 + r(2) * 0.04), k, k * (1 + r(3) * 0.05));
        this.stone.add(ty * W + tx, tileMatrix(tx + 0.5, ty + 0.5, Math.floor(r(4) * 4) * (Math.PI / 2), 1, 0.94 + r(5) * 0.14), stoneColor);
      }
    }

    this.wallKind.clear();
    labelClusters(g, Tile.Wall).clusters.forEach((cluster, ci) => {
      const kind: WallKind = ci % 2 === 0 ? 'crate' : 'adobe';
      for (const t of cluster) this.addWall(t.x, t.y, kind);
    });
  }

  private addWall(tx: number, ty: number, kind: WallKind): boolean {
    const key = ty * this.grid.width + tx;
    const r = (s: number) => hash(tx, ty, 330 + s);
    const yaw = Math.floor(r(1) * 4) * (Math.PI / 2) + (kind === 'crate' ? (r(2) - 0.5) * 0.14 : 0);
    const s = kind === 'crate' ? 0.97 + r(3) * 0.06 : 1;
    const c = new THREE.Color().setScalar(0.93 + r(4) * 0.1);
    this.wallKind.set(key, kind);
    return this.walls[kind].add(key, tileMatrix(tx + 0.5, ty + 0.5, yaw, s, s * (0.97 + r(5) * 0.06)), c);
  }

  // ───────────── 바뀐 타일만 갱신 ─────────────

  private applyTileChanges() {
    const g = this.grid;
    let rebuild = false;
    for (let ty = 0; ty < g.height && !rebuild; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        const key = ty * g.width + tx;
        const prev = this.tiles[key] as Tile;
        const now = g.get(tx, ty);
        if (prev === now) continue;
        this.tiles[key] = now;
        if (prev === Tile.Wall && now === Tile.Floor) {
          const kind = this.wallKind.get(key) ?? 'crate';
          this.walls[kind].hide(key);
          const r = (s: number) => hash(tx, ty, 360 + s);
          this.rubble.add(key, tileMatrix(tx + 0.5 + (r(1) - 0.5) * 0.1, ty + 0.5 + (r(2) - 0.5) * 0.1, r(3) * Math.PI * 2, 1.05), RUBBLE_TINT[kind]);
          continue;
        }
        if (prev === Tile.Floor && now === Tile.Wall) {
          const kind = this.wallKind.get(key) ?? 'crate';
          this.rubble.hide(key);
          if (this.walls[kind].show(key) || this.addWall(tx, ty, kind)) continue;
        }
        // 그 밖의 변화(물·수풀·단단한 벽이 바뀜)는 지원 범위 밖: 맵 부분을 다시 만든다
        rebuild = true;
        break;
      }
    }
    if (rebuild) {
      this.disposeBuild();
      this.build();
      return;
    }
    this.builtVersion = g.version;
  }

  /** 매 프레임. viewer: 플레이어 위치(그 수풀 덩어리를 반투명으로) */
  update(t: number, dt: number, viewer: Vec2 | null) {
    this.time.value = t;
    if (this.grid.version !== this.builtVersion) this.applyTileChanges();
    this.bushes.update(dt, viewer);
  }

  private disposeBuild() {
    for (const p of this.parts) p.dispose();
    this.parts = [];
  }

  dispose() {
    this.disposeBuild();
    this.scenery.dispose();
    this.border?.dispose();
    this.object.removeFromParent();
  }
}
