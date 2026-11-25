import * as THREE from 'three';
import type { Grid } from '../../game/world';
import { mergeParts, outlineGeometry, paint } from './geometry';
import { outlineMaterial, worldToon } from './materials';
import { buildOuterGrassTexture, hash, worldTheme } from './textures';

/**
 * 맵 바깥 장식: 풀밭, 나무, 바위, 건초 더미, 과녁판, 꽃. World 담당.
 * 움직이지 않으므로 전부 정점에 위치를 구워 메쉬 하나 + 외곽선 하나로 그린다(드로우콜 3: 풀밭 포함).
 * 카메라가 남쪽(+z)에서 북쪽을 내려다보므로, 맵 남쪽에는 낮은 것만 둔다(맵을 가리지 않게).
 */

const OUTER_MARGIN = 30;

const lerpHex = (a: string, b: string, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, k)));

interface Placed {
  geo: THREE.BufferGeometry;
  outline: boolean;
}

function place(geo: THREE.BufferGeometry, x: number, z: number, yaw: number, s: number, sy = s): THREE.BufferGeometry {
  geo.scale(s, sy, s);
  geo.rotateY(yaw);
  geo.translate(x, 0, z);
  return geo;
}

/** 겨울이면 높은 곳(눈 쌓인 윗면)을 하얗게 */
function snowy(col: THREE.Color, height: number, from: number): THREE.Color {
  if (worldTheme() !== 'winter') return col;
  const k = Math.max(0, Math.min(1, (height - from) / 0.25));
  return col.lerp(new THREE.Color('#f4f8fd'), 0.35 + 0.6 * k);
}

function roundTree(tint: number): THREE.BufferGeometry[] {
  const trunk = new THREE.CylinderGeometry(0.11, 0.16, 0.9, 6, 1, true);
  trunk.translate(0, 0.45, 0);
  paint(trunk, '#8b5a36');
  const leaves: [number, number, number, number][] = [
    [0, 1.3, 0, 0.62],
    [0.36, 1.08, 0.12, 0.42],
    [-0.32, 1.12, -0.1, 0.44],
    [0.05, 1.72, -0.05, 0.4],
  ];
  const parts: THREE.BufferGeometry[] = [trunk];
  for (const [x, y, z, r] of leaves) {
    const s = new THREE.SphereGeometry(r, 9, 6);
    s.translate(x, y, z);
    paint(s, (p) => snowy(lerpHex('#2b7a3e', '#62c25a', (p.y - 0.75) / 1.25).multiplyScalar(tint), p.y, 1.25).getHex());
    parts.push(s);
  }
  return parts;
}

function pineTree(tint: number): THREE.BufferGeometry[] {
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 0.6, 6, 1, true);
  trunk.translate(0, 0.3, 0);
  paint(trunk, '#7a4c2e');
  const parts: THREE.BufferGeometry[] = [trunk];
  const tiers: [number, number, number][] = [
    [0.72, 0.85, 0.75],
    [0.56, 0.75, 1.25],
    [0.38, 0.65, 1.7],
  ];
  for (const [r, h, y] of tiers) {
    const c = new THREE.ConeGeometry(r, h, 8, 1, true);
    c.translate(0, y, 0);
    paint(c, (p) => snowy(lerpHex('#245f43', '#4fa86a', (p.y - 0.4) / 1.8).multiplyScalar(tint), p.y - y + h / 2, h * 0.45).getHex());
    parts.push(c);
  }
  return parts;
}

function rock(seed: number): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.34, 0);
  g.scale(1.15 + hash(seed, 1, 900) * 0.4, 0.62 + hash(seed, 2, 900) * 0.3, 0.95 + hash(seed, 3, 900) * 0.3);
  g.rotateY(hash(seed, 4, 900) * Math.PI);
  g.translate(0, 0.12, 0);
  paint(g, (_p, n) => (n.y > 0.55 ? '#c3c8d4' : '#949bab'));
  return g;
}

function hayBale(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.33, 0.33, 0.72, 12);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.33, 0);
  paint(g, (p, n) => (Math.abs(n.x) > 0.7 ? '#f2d98c' : Math.abs(p.x) > 0.18 && Math.abs(p.x) < 0.24 ? '#b98f3a' : '#e5bf55'));
  return g;
}

/** 과녁판(기둥 위 둥근 판, 남쪽을 봄) */
function targetBoard(): THREE.BufferGeometry[] {
  const post = new THREE.CylinderGeometry(0.06, 0.07, 1.0, 6);
  post.translate(0, 0.5, -0.05);
  paint(post, '#8b5a36');
  const board = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20);
  board.rotateX(Math.PI / 2);
  board.translate(0, 0.95, 0.02);
  paint(board, (p, n) => {
    if (n.z < 0.5) return '#d9d2c4';
    const r = Math.hypot(p.x, p.y - 0.95);
    return r < 0.1 ? '#e84a4a' : r < 0.2 ? '#ffffff' : r < 0.3 ? '#e84a4a' : '#ffffff';
  });
  return [post, board];
}

function flowers(seed: number): THREE.BufferGeometry[] {
  const cols = ['#ffffff', '#ffd84d', '#ff8fb8', '#9fd8ff'];
  const out: THREE.BufferGeometry[] = [];
  const n = 3 + Math.floor(hash(seed, 1, 950) * 3);
  for (let i = 0; i < n; i++) {
    const s = new THREE.SphereGeometry(0.06, 5, 3);
    s.translate((hash(seed, i, 951) - 0.5) * 0.6, 0.07, (hash(seed, i, 952) - 0.5) * 0.6);
    paint(s, cols[Math.floor(hash(seed, i, 953) * cols.length)]!);
    out.push(s);
  }
  return out;
}

function tuft(seed: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const h = 0.16 + hash(seed, i, 960) * 0.12;
    const c = new THREE.ConeGeometry(0.035, h, 4);
    c.translate(0, h / 2, 0);
    c.rotateZ((i - 1) * 0.35);
    c.translate((i - 1) * 0.05, 0, hash(seed, i, 961) * 0.05);
    paint(c, '#4f9a40');
    out.push(c);
  }
  return out;
}

/** 맵 사각형(0..W, 0..H)을 뺀 바깥 띠. uv는 월드 좌표/2(텍스처 한 장 = 2타일, 반복) */
function frameGeometry(W: number, H: number, m: number, y: number): THREE.BufferGeometry {
  const rects: [number, number, number, number][] = [
    [-m, -m, W + m, 0], // 북
    [-m, H, W + m, H + m], // 남
    [-m, 0, 0, H], // 서
    [W, 0, W + m, H], // 동
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const [x0, z0, x1, z1] of rects) {
    const b = pos.length / 3;
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ] as const) {
      pos.push(x, y, z);
      uv.push(x / 2, -z / 2);
      nor.push(0, 1, 0);
    }
    // 위에서 볼 때 앞면이 되도록 (a, d, c), (a, c, b)
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Scenery {
  readonly object = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];

  /** clearNear: 테두리 바깥 이 거리(타일)까지는 풍경을 두지 않는다(자연 테두리가 차지). 남쪽은 그대로 */
  constructor(grid: Grid, opts: { clearNear?: number } = {}) {
    const clearNear = opts.clearNear ?? 0;
    const W = grid.width;
    const H = grid.height;

    // 바깥 풀밭: 맵을 둘러싼 액자 모양(맵 안쪽은 비워 둔다 — 물웅덩이가 바닥보다 낮아서)
    const grassTex = buildOuterGrassTexture();
    const groundGeo = frameGeometry(W, H, OUTER_MARGIN, -0.03);
    const groundMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    this.object.add(ground);
    this.disposables.push(grassTex, groundGeo, groundMat);

    // 덩어리별로 따로 합쳐서 화면 밖 덩어리는 통째로 그리지 않는다(절두체 컬링)
    const chunks = new Map<string, Placed[]>();
    const chunkOf = (x: number, z: number) => {
      if (z > H) return 's';
      if (x < 0) return z < H / 2 ? 'wn' : 'ws';
      if (x > W) return z < H / 2 ? 'en' : 'es';
      return `n${Math.min(2, Math.floor((x / W) * 3))}`;
    };
    const add = (geos: THREE.BufferGeometry[], outline: boolean, x: number, z: number, yaw: number, s: number, sy = s) => {
      const key = chunkOf(x, z);
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      for (const g of geos) list.push({ geo: place(g, x, z, yaw, s, sy), outline });
    };

    // 카메라에 보이는 띠 안에만 둔다: 북쪽 7타일, 옆 7타일, 남쪽 3.5타일(낮은 것만)
    const STEP = 1.6;
    for (let gz = -7; gz < H + 3.6; gz += STEP) {
      for (let gx = -7; gx < W + 7; gx += STEP) {
        const ix = Math.round(gx * 10);
        const iz = Math.round(gz * 10);
        const x = gx + (hash(ix, iz, 1) - 0.5) * 1.2;
        const z = gz + (hash(ix, iz, 2) - 0.5) * 1.2;
        // 맵 바깥에서 떨어진 거리(테두리 벽 바깥 면 기준)
        const dx = x < 0 ? -x : x > W ? x - W : 0;
        const dz = z < 0 ? -z : z > H ? z - H : 0;
        const d = Math.max(dx, dz);
        if (d < 0.55) continue;
        const south = z > H;
        if (!south && d < clearNear) continue;
        const r = hash(ix, iz, 3);
        const yaw = hash(ix, iz, 4) * Math.PI * 2;
        const tint = 0.88 + hash(ix, iz, 5) * 0.2;
        const seed = ix * 7 + iz * 13;
        const treeOk = !south && d > 1.5;
        if (treeOk && r < (z < 0 ? 0.5 : 0.34)) {
          const s = 0.95 + hash(ix, iz, 6) * 0.5;
          add(hash(ix, iz, 7) < 0.45 ? pineTree(tint) : roundTree(tint), true, x, z, yaw, s);
        } else if (r < 0.66) {
          if (hash(ix, iz, 8) < 0.5) add(tuft(seed), false, x, z, yaw, 1);
          else add(flowers(seed), false, x, z, yaw, 1);
        } else if (r < 0.8) {
          const s = 0.7 + hash(ix, iz, 9) * 0.8;
          add([rock(seed)], true, x, z, yaw, s);
          if (hash(ix, iz, 10) < 0.5) add([rock(seed + 1)], true, x + 0.42, z + 0.18, yaw + 1, s * 0.55);
        } else if (r < 0.85 && d < 4) {
          add([hayBale()], true, x, z, yaw, 1);
        }
      }
    }

    // 연습장다운 장식: 오른쪽(더미 구역) 바깥 과녁판, 왼쪽(출발) 바깥 건초 더미
    for (let i = 0; i < 3; i++) {
      add(targetBoard(), true, W + 1.3, 3 + i * 5.5, 0.15 * (i - 1), 1);
    }
    for (const [x, z, yaw] of [
      [-1.2, 5.2, 0.2],
      [-1.25, 6.0, 1.7],
      [-1.15, H - 4.5, 0.4],
    ] as const) {
      add([hayBale()], true, x, z, yaw, 1);
    }

    const mat = worldToon({ vertexColors: true });
    const lineMat = outlineMaterial(0.03);
    this.disposables.push(mat, lineMat);
    for (const placed of chunks.values()) {
      const outlined = placed.filter((p) => p.outline).map((p) => p.geo);
      const plain = placed.filter((p) => !p.outline).map((p) => p.geo);
      const mainGeo = mergeParts([...outlined.map((g) => g.clone()), ...plain]);
      const mesh = new THREE.Mesh(mainGeo, mat);
      this.object.add(mesh);
      this.disposables.push(mainGeo);
      if (outlined.length) {
        const outlinedMerged = mergeParts(outlined);
        const lineGeo = outlineGeometry(outlinedMerged);
        outlinedMerged.dispose();
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.raycast = () => {};
        this.object.add(line);
        this.disposables.push(lineGeo);
      }
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.object.removeFromParent();
  }
}
