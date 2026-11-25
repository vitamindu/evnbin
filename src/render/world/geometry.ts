import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 맵 소품 모양(기본 도형 조합, 오리지널). World 담당.
 * 모든 소품은 바닥 y=0에 서 있고 타일 중심이 원점. 색은 정점 색(color 속성)으로 넣어
 * 재질 하나 + InstancedMesh 하나로 그린다.
 */

type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.ColorRepresentation;

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/** 정점 색을 칠한다(색 하나 또는 위치·법선에 따른 함수) */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation | ColorFn): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    if (typeof color === 'function') {
      _p.fromBufferAttribute(pos, i);
      if (nor) _n.fromBufferAttribute(nor, i);
      else _n.set(0, 1, 0);
      _c.set(color(_p, _n));
    } else _c.set(color);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 여러 부품을 하나로 합친다(색·uv가 없으면 채워 넣음). 결과는 인덱스가 있는 기하 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((g) => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2));
    if (!p.getAttribute('color')) paint(p, '#ffffff');
    for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) p.deleteAttribute(name);
    return p;
  });
  const merged = mergeGeometries(prepared, false)!;
  for (const p of prepared) p.dispose();
  for (const g of parts) g.dispose();
  const indexed = mergeVertices(merged, 1e-5);
  merged.dispose();
  return indexed;
}

/** 외곽선용 사본: 위치만 남겨 이어 붙이고 법선을 부드럽게(모서리에서 외곽선이 갈라지지 않게) */
export function outlineGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) c.setIndex(geo.index.clone());
  const g = mergeVertices(c, 1e-4);
  c.dispose();
  g.computeVertexNormals();
  return g;
}

const lerpHex = (a: string, b: string, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, k)));

// ───────────── 벽 ─────────────

/** 단단한 벽: 둥근 돌 블록(윗면은 밝게). 텍스처 = buildStoneTexture */
export function stoneBlockGeometry(): THREE.BufferGeometry {
  const body = new RoundedBoxGeometry(1.0, 1.08, 1.0, 1, 0.1);
  body.translate(0, 0.54, 0);
  paint(body, (_p, n) => (n.y > 0.6 ? '#b3bbcd' : n.y < -0.5 ? '#5d6476' : '#8a93aa'));
  return mergeParts([body]);
}

/** 부서지는 벽 A: 나무 상자. 텍스처 = buildCrateTexture */
export function crateGeometry(): THREE.BufferGeometry {
  const body = new RoundedBoxGeometry(0.9, 0.88, 0.9, 1, 0.06);
  body.translate(0, 0.44, 0);
  paint(body, (_p, n) => (n.y > 0.6 ? '#fff4e0' : '#ffffff'));
  return mergeParts([body]);
}

/** 부서지는 벽 B: 흙벽돌 덩어리(살짝 좁아지는 위쪽 + 둥근 갓). 텍스처 = buildAdobeTexture */
export function adobeGeometry(): THREE.BufferGeometry {
  const body = new RoundedBoxGeometry(0.94, 0.72, 0.94, 1, 0.09);
  body.translate(0, 0.36, 0);
  paint(body, (_p, n) => (n.y > 0.6 ? '#fff0dc' : '#ffffff'));
  const cap = new RoundedBoxGeometry(0.84, 0.16, 0.84, 1, 0.07);
  cap.translate(0, 0.78, 0);
  paint(cap, '#f6d7b0');
  return mergeParts([body, cap]);
}

/** 부서진 벽 잔해(낮은 조각 몇 개). 정점 색은 흰색 계열 → 인스턴스 색으로 나무/흙 구분 */
export function rubbleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pieces: [number, number, number, number, number, number][] = [
    // x, z, w, h, d, yaw
    [-0.24, -0.18, 0.3, 0.1, 0.16, 0.5],
    [0.2, -0.22, 0.22, 0.12, 0.2, -0.3],
    [0.05, 0.2, 0.34, 0.09, 0.14, 1.2],
    [-0.27, 0.22, 0.16, 0.14, 0.16, 0.2],
    [0.3, 0.12, 0.15, 0.08, 0.15, 0.9],
  ];
  pieces.forEach(([x, z, w, h, d, yaw], i) => {
    const b = new RoundedBoxGeometry(w, h, d, 1, 0.025);
    b.rotateY(yaw);
    b.translate(x, h / 2, z);
    paint(b, i % 2 ? '#ffffff' : '#e2d6c8');
    parts.push(b);
  });
  return mergeParts(parts);
}

// ───────────── 수풀 ─────────────

/** 뭉게뭉게 수풀 한 칸: 공 여러 개. 아래는 어둡고 위는 밝은 초록 */
/** winter: 눈 덮인 덤불(아래는 짙은 청록, 위는 눈처럼 하얗게) */
export function bushGeometry(winter = false): THREE.BufferGeometry {
  const puffs: [number, number, number, number][] = [
    // x, y, z, r
    [-0.24, 0.3, -0.2, 0.31],
    [0.24, 0.31, -0.22, 0.3],
    [-0.22, 0.29, 0.23, 0.3],
    [0.23, 0.3, 0.22, 0.31],
    [0.02, 0.56, 0.0, 0.34],
    [0.2, 0.5, 0.08, 0.2],
  ];
  const parts = puffs.map(([x, y, z, r]) => {
    const s = new THREE.SphereGeometry(r, 10, 6);
    s.translate(x, y, z);
    paint(s, (p) => (winter ? lerpHex('#2e6b5e', '#f2f7fc', (p.y - 0.15) / 0.55) : lerpHex('#2d8a44', '#6fd468', (p.y - 0.05) / 0.8)).getHex());
    return s;
  });
  return mergeParts(parts);
}

// ───────────── 물가 ─────────────

/** 갈대 한 묶음(물가 장식) */
export function reedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stalks: [number, number, number, number][] = [
    [0, 0, 0.55, 0],
    [0.08, 0.05, 0.42, 0.25],
    [-0.07, 0.04, 0.47, -0.2],
    [0.03, -0.08, 0.36, 0.1],
  ];
  for (const [x, z, h, lean] of stalks) {
    const c = new THREE.ConeGeometry(0.035, h, 5);
    c.translate(0, h / 2, 0);
    c.rotateZ(lean * 0.6);
    c.translate(x, 0, z);
    paint(c, (p) => lerpHex('#3f8f3c', '#a3d86a', p.y / 0.5).getHex());
    parts.push(c);
  }
  const tip = new THREE.CapsuleGeometry(0.035, 0.1, 3, 6);
  tip.translate(0, 0.55, 0);
  paint(tip, '#8a5a34');
  parts.push(tip);
  return mergeParts(parts);
}
