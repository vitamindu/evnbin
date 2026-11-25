import * as THREE from 'three';
import { Tile, type Grid } from '../../game/world';
import { mergeParts, outlineGeometry, paint } from './geometry';
import { outlineMaterial, worldToon } from './materials';
import { hash, worldTheme } from './textures';

/**
 * 맵 테두리(바깥과 이어진 단단한 벽)를 돌벽돌 대신 자연 지형으로 그린다. 판정(벽)은 그대로.
 * - rock: 이끼 낀 바위가 바깥으로 갈수록 높아지는 산기슭
 * - hill: 둥근 풀 언덕
 * - cliff: 층이 보이는 흙 절벽 + 위에 풀
 * 아래쪽(남쪽) 테두리는 카메라 앞이라 낮게(캐릭터를 가리지 않게).
 */
export type BorderStyle = 'stone' | 'rock' | 'hill' | 'cliff';

/** 프로토타입 확인용: 주소의 ?edge=rock|hill|cliff|stone. 없으면 기본 */
export const DEFAULT_BORDER: BorderStyle = 'hill'; // 사용자가 고른 B안(풀 언덕)
export function borderStyleFromUrl(): BorderStyle {
  try {
    const v = new URLSearchParams(location.search).get('edge');
    if (v === 'rock' || v === 'hill' || v === 'cliff' || v === 'stone') return v;
  } catch {
    /* 주소 없음(테스트) */
  }
  return DEFAULT_BORDER;
}

/** 바깥 경계와 이어진 단단한 벽 칸(맵 테두리). 안쪽에 따로 선 단단한 벽은 빠진다 */
export function borderTiles(grid: Grid): Set<number> {
  const W = grid.width;
  const H = grid.height;
  const out = new Set<number>();
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (out.has(k) || grid.get(x, y) !== Tile.HardWall) return;
    out.add(k);
    stack.push(k);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % W;
    const y = (k - x) / W;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return out;
}

const lerpHex = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));

function colors() {
  const winter = worldTheme() === 'winter';
  return {
    top: winter ? '#f3f8fd' : '#6cc45a',
    topDark: winter ? '#d7e6f3' : '#4a9a45',
    rock: winter ? '#9aa8bd' : '#9a8f84',
    rockDark: winter ? '#6c7891' : '#6b625a',
    dirt: winter ? '#8f9cb2' : '#b07a4a',
    dirtDark: winter ? '#66728a' : '#7d5333',
  };
}

function rockPiece(seed: number, h: number): THREE.BufferGeometry {
  const c = colors();
  const g = new THREE.DodecahedronGeometry(0.62, 0);
  g.scale(1.0 + hash(seed, 1, 700) * 0.35, h, 0.95 + hash(seed, 2, 700) * 0.35);
  g.translate(0, h * 0.5, 0);
  // 윗면은 이끼(겨울엔 눈), 옆은 바위
  paint(g, (p, n) => (n.y > 0.55 ? c.top : lerpHex(c.rockDark, c.rock, p.y / (h + 0.4)).getHex()));
  return g;
}

/** 풀 언덕: 크고 둥근 반구(색 대비를 줄여 눈이 편하게). radius = 바닥 반지름 */
function hillPiece(seed: number, h: number, radius = 1.15): THREE.BufferGeometry {
  const winter = worldTheme() === 'winter';
  const base = winter ? '#cfdcec' : '#5fa857';
  const top = winter ? '#f4f8fd' : '#86d06e';
  const g = new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1 + hash(seed, 3, 710) * 0.15, h / radius, 1 + hash(seed, 4, 710) * 0.15);
  paint(g, (p) => lerpHex(base, top, Math.pow(p.y / h, 0.7)).getHex());
  return g;
}

function cliffPiece(seed: number, h: number): THREE.BufferGeometry {
  const c = colors();
  const body = new THREE.BoxGeometry(1.02, h, 1.02, 1, 3, 1);
  body.translate(0, h / 2, 0);
  // 층무늬: 높이에 따라 밝고 어두운 흙
  paint(body, (p, n) => (n.y > 0.5 ? c.top : Math.floor(p.y * 3 + hash(seed, 5, 720)) % 2 ? c.dirt : c.dirtDark));
  const cap = new THREE.CylinderGeometry(0.6, 0.66, 0.18, 7);
  cap.translate((hash(seed, 6, 720) - 0.5) * 0.2, h + 0.06, (hash(seed, 7, 720) - 0.5) * 0.2);
  paint(cap, (_p, n) => (n.y > 0.5 ? c.top : c.topDark));
  return mergeParts([body, cap]);
}

function placed(g: THREE.BufferGeometry, x: number, z: number, yaw: number): THREE.BufferGeometry {
  g.rotateY(yaw);
  g.translate(x, 0, z);
  return g;
}

/**
 * 테두리 메시. 칸마다 한 덩어리(+ 바깥쪽으로 1~2덩어리 더, 바깥일수록 높게). 남쪽은 낮게.
 */
export function buildBorder(grid: Grid, style: Exclude<BorderStyle, 'stone'>): { object: THREE.Group; dispose(): void } {
  const W = grid.width;
  const H = grid.height;
  const tiles = borderTiles(grid);
  const parts: THREE.BufferGeometry[] = [];
  // 열마다 가장 아래 바닥 칸. 그보다 아래(카메라 쪽)의 테두리는 '앞쪽'이라 낮고 작게(골대 주머니 옆 포함)
  const lowestFloor = new Array<number>(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (grid.get(x, y) !== Tile.HardWall) lowestFloor[x] = y;
  const piece = (seed: number, h: number) => (style === 'rock' ? rockPiece(seed, h) : style === 'hill' ? hillPiece(seed, h) : cliffPiece(seed, h));
  for (const k of tiles) {
    const tx = k % W;
    const ty = (k - tx) / W;
    // 풀 언덕은 한 칸 건너 하나씩(언덕이 커서 옆 칸까지 덮는다) — 덜 빽빽하게
    if (style === 'hill' && (tx + ty) % 2 === 1 && !(ty >= H - 2 || (ty > H * 0.6 && ty > lowestFloor[tx]!))) continue;
    const r = (s: number) => hash(tx, ty, 740 + s);
    const south = ty >= H - 2 || (ty > H * 0.6 && ty > lowestFloor[tx]!);
    // 맵 안쪽과 맞닿은 칸인가(그 칸은 벽 높이를 지키고, 더 바깥 칸은 높아진다)
    const inner = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const nx = tx + dx!;
      const ny = ty + dy!;
      return nx >= 0 && ny >= 0 && nx < W && ny < H && grid.get(nx, ny) !== Tile.HardWall;
    });
    // 앞쪽(카메라 쪽) 언덕: 경기장과 맞닿은 줄만 낮게, 그 뒤는 비워 둔다(풀밭이 보이게)
    if (style === 'hill' && south && !inner) continue;
    const base = south ? (style === 'hill' ? 0.55 : 0.75) : inner ? 1.05 : 1.45;
    const h = base + r(1) * (south ? 0.2 : 0.45);
    const jx = style === 'cliff' ? 0 : (r(2) - 0.5) * 0.25;
    const jz = style === 'cliff' ? 0 : (r(3) - 0.5) * 0.25;
    const yaw = style === 'cliff' ? Math.floor(r(4) * 4) * (Math.PI / 2) : r(4) * Math.PI * 2;
    // 아래쪽 언덕은 카메라 앞이라 작게(경기장 쪽으로 넘어오지 않게)
    const geo = style === 'hill' ? hillPiece(tx * 31 + ty * 17, h, south ? 0.9 : 1.15) : piece(tx * 31 + ty * 17, h);
    parts.push(placed(geo, tx + 0.5 + jx, ty + 0.5 + (style === 'hill' && south ? 0.15 : jz), yaw));
  }
  // 맵 밖 바로 바깥: 산기슭처럼 한두 줄 더(남쪽은 없음). 풀 언덕은 한 줄, 세 칸마다 큰 언덕 하나
  const rings = style === 'hill' ? 1 : 2;
  for (let ring = 1; ring <= rings; ring++) {
    const add = (x: number, z: number, seed: number) => {
      const r = (s: number) => hash(Math.round(x * 10), Math.round(z * 10), 760 + s);
      if (style === 'hill') {
        if (seed % 3 !== 0) return;
        parts.push(placed(hillPiece(seed, 1.7 + r(1) * 0.5, 1.6), x + (r(3) - 0.5) * 0.4, z + (r(4) - 0.5) * 0.4, r(2) * Math.PI * 2));
        return;
      }
      const h = (style === 'cliff' ? 1.6 : 1.7) + ring * 0.55 + r(1) * 0.6;
      const yaw = style === 'cliff' ? Math.floor(r(2) * 4) * (Math.PI / 2) : r(2) * Math.PI * 2;
      const j = style === 'cliff' ? 0 : 0.35;
      parts.push(placed(piece(seed, h), x + (r(3) - 0.5) * j, z + (r(4) - 0.5) * j, yaw));
    };
    for (let x = -ring; x < W + ring; x++) add(x + 0.5, -ring + 0.5, x * 7 + ring * 101);
    for (let z = -ring + 1; z < H - 1; z++) {
      add(-ring + 0.5, z + 0.5, z * 11 + ring * 103);
      add(W + ring - 0.5, z + 0.5, z * 13 + ring * 107);
    }
  }
  const geo = mergeParts(parts);
  const line = outlineGeometry(geo);
  const mat = worldToon({ vertexColors: true });
  const lineMat = outlineMaterial(0.028);
  const object = new THREE.Group();
  object.name = 'border';
  object.add(new THREE.Mesh(geo, mat), new THREE.Mesh(line, lineMat));
  return {
    object,
    dispose() {
      geo.dispose();
      line.dispose();
      mat.dispose();
      lineMat.dispose();
    },
  };
}
