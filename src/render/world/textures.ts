import * as THREE from 'three';
import { Ground, Tile, type Grid } from '../../game/world';
import { OUTLINE_COLOR } from '../toon';

/**
 * 맵 텍스처(캔버스에 직접 그림, 외부 이미지 없음). World 담당.
 * 바닥은 맵 전체를 큰 캔버스 하나에 한 번만 그린다. 벽이 부서져도 바닥은 다시 그리지 않는다
 * (벽 아래는 처음부터 흙 자국으로 그려 둠).
 */

/** 타일 좌표 → 0..1 결정적 난수 */
export function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function canvasTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** '#rrggbb'를 밝기 k배(1=그대로)로 */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const SPRING_FLOOR = {
  yard: ['#efd5a0', '#e7cb92'],
  dirt: '#cfa878',
  grass: ['#97d46c', '#8dcb63'],
  lane: ['#aab3c6', '#a2abbf'],
  laneLine: '#f7f9ff',
  shoreLip: '#eadcb9',
};
/** 겨울: 눈 덮인 마당, 살짝 파란 눈밭, 얼음 가장자리 */
const WINTER_FLOOR: typeof SPRING_FLOOR = {
  yard: ['#eef3fa', '#e4ecf6'],
  dirt: '#c7d3e3',
  grass: ['#dbe9f5', '#d2e3f1'],
  lane: ['#b9c4d6', '#b1bccf'],
  laneLine: '#ffffff',
  shoreLip: '#ffffff',
};
let FLOOR = SPRING_FLOOR;

/** 맵 겉모습(봄·겨울). MapRenderer가 맵을 만들기 전에 정한다. 텍스처·바깥 풍경이 이 값을 읽는다 */
export type WorldTheme = 'spring' | 'winter';
let THEME: WorldTheme = 'spring';
export function setWorldTheme(t: WorldTheme) {
  THEME = t;
  FLOOR = t === 'winter' ? WINTER_FLOOR : SPRING_FLOOR;
}
export const worldTheme = (): WorldTheme => THEME;

/** 바닥 전체 텍스처. 타일 하나 = ppt 픽셀. 캔버스 위쪽 = 맵 y=0 */
/** viewerTeam: 보는 사람의 팀. 출발 지점은 우리 팀 파랑, 상대 팀 빨강 */
export function buildFloorTexture(grid: Grid, ppt = 64, viewerTeam = 0): THREE.CanvasTexture {
  const P = ppt;
  const [c, ctx] = canvas(grid.width * P, grid.height * P);
  const isGrass = (tx: number, ty: number) => grid.ground(tx, ty) === Ground.Grass && grid.get(tx, ty) !== Tile.Water;

  // 1) 바탕
  for (let ty = 0; ty < grid.height; ty++) {
    for (let tx = 0; tx < grid.width; tx++) {
      const t = grid.get(tx, ty);
      const g = grid.ground(tx, ty);
      const odd = (tx + ty) & 1;
      let col: string;
      if (t === Tile.Wall) col = FLOOR.dirt;
      else if (g === Ground.Grass) col = FLOOR.grass[odd]!;
      else if (g === Ground.Lane) col = FLOOR.lane[odd]!;
      else col = FLOOR.yard[odd]!;
      ctx.fillStyle = shade(col, 0.985 + hash(tx, ty, 1) * 0.03);
      ctx.fillRect(tx * P, ty * P, P, P);
    }
  }

  // 2) 풀밭 가장자리: 옆 칸으로 몽글몽글 번지게
  for (let ty = 0; ty < grid.height; ty++) {
    for (let tx = 0; tx < grid.width; tx++) {
      if (!isGrass(tx, ty)) continue;
      ctx.fillStyle = FLOOR.grass[(tx + ty) & 1]!;
      const sides: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [sx, sy] of sides) {
        const nx = tx + sx;
        const ny = ty + sy;
        if (!grid.inBounds(nx, ny) || isGrass(nx, ny) || grid.get(nx, ny) === Tile.Water) continue;
        for (let k = 0; k < 4; k++) {
          const u = (k + 0.5) / 4;
          const rad = P * (0.1 + hash(tx * 4 + k, ty, 7 + sx + sy * 3) * 0.05);
          const cx = (tx + 0.5 + sx * 0.5 + (sx === 0 ? u - 0.5 : 0)) * P;
          const cy = (ty + 0.5 + sy * 0.5 + (sy === 0 ? u - 0.5 : 0)) * P;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 3) 타일 무늬
  for (let ty = 0; ty < grid.height; ty++) {
    for (let tx = 0; tx < grid.width; tx++) {
      const t = grid.get(tx, ty);
      if (t === Tile.Water || t === Tile.HardWall) continue;
      const x0 = tx * P;
      const y0 = ty * P;
      const g = grid.ground(tx, ty);
      const r = (s: number) => hash(tx, ty, s);
      if (t === Tile.Wall) {
        // 벽 자리: 다져진 흙 + 금(부서진 뒤 보임)
        ctx.strokeStyle = 'rgba(110,70,40,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + P * (0.2 + r(2) * 0.2), y0 + P * 0.3);
        ctx.lineTo(x0 + P * 0.5, y0 + P * (0.45 + r(3) * 0.1));
        ctx.lineTo(x0 + P * (0.75 + r(4) * 0.1), y0 + P * 0.7);
        ctx.stroke();
        continue;
      }
      if (g === Ground.Grass) {
        // 풀잎(작은 V)과 가끔 꽃
        ctx.strokeStyle = THEME === 'winter' ? 'rgba(150,180,215,0.5)' : 'rgba(60,130,50,0.55)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let k = 0; k < 5; k++) {
          const bx = x0 + P * (0.12 + hash(tx, ty, 10 + k) * 0.76);
          const by = y0 + P * (0.15 + hash(tx, ty, 20 + k) * 0.75);
          ctx.beginPath();
          ctx.moveTo(bx - 4, by - 6);
          ctx.lineTo(bx, by);
          ctx.lineTo(bx + 4, by - 7);
          ctx.stroke();
        }
        if (r(30) < 0.28 && THEME !== 'winter') {
          const fx = x0 + P * (0.2 + r(31) * 0.6);
          const fy = y0 + P * (0.2 + r(32) * 0.6);
          ctx.fillStyle = r(33) < 0.5 ? '#fff6d8' : '#ffd84d';
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(fx + Math.cos((k * Math.PI) / 2) * 3.5, fy + Math.sin((k * Math.PI) / 2) * 3.5, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#ff9a3c';
          ctx.beginPath();
          ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (g === Ground.Lane) {
        // 포장 이음매 + 작은 얼룩
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x0, y0, P, 2);
        ctx.fillStyle = 'rgba(40,46,70,0.16)';
        ctx.fillRect(x0, y0 + P - 2, P, 2);
        ctx.fillRect(x0 + P - 2, y0, 2, P);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = 'rgba(60,70,100,0.12)';
          ctx.beginPath();
          ctx.arc(x0 + P * hash(tx, ty, 40 + k), y0 + P * hash(tx, ty, 50 + k), 2 + hash(tx, ty, 60 + k) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 흙 마당: 은은한 타일 경계 + 자갈
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x0 + 2, y0 + 2, P - 4, 2);
        ctx.fillRect(x0 + 2, y0 + 2, 2, P - 4);
        ctx.fillStyle = 'rgba(150,105,55,0.16)';
        ctx.fillRect(x0 + 2, y0 + P - 4, P - 4, 2);
        ctx.fillRect(x0 + P - 4, y0 + 2, 2, P - 4);
        const pebbles = 1 + Math.floor(r(70) * 3);
        for (let k = 0; k < pebbles; k++) {
          const px = x0 + P * (0.15 + hash(tx, ty, 71 + k) * 0.7);
          const py = y0 + P * (0.15 + hash(tx, ty, 81 + k) * 0.7);
          const pr = 2 + hash(tx, ty, 91 + k) * 3;
          ctx.fillStyle = 'rgba(160,115,65,0.45)';
          ctx.beginPath();
          ctx.ellipse(px, py + 1, pr + 0.5, pr * 0.75, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,248,225,0.8)';
          ctx.beginPath();
          ctx.ellipse(px - 0.5, py - 0.5, pr * 0.8, pr * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (r(100) < 0.1) {
          ctx.strokeStyle = 'rgba(150,105,55,0.25)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const sx = x0 + P * (0.2 + r(101) * 0.3);
          const sy = y0 + P * (0.2 + r(102) * 0.3);
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + P * 0.18, sy + P * 0.12);
          ctx.lineTo(sx + P * 0.24, sy + P * 0.3);
          ctx.stroke();
        }
      }
    }
  }

  // 4) 물가 테두리(밝은 돌 턱)
  ctx.fillStyle = FLOOR.shoreLip;
  for (let ty = 0; ty < grid.height; ty++) {
    for (let tx = 0; tx < grid.width; tx++) {
      if (grid.get(tx, ty) === Tile.Water) continue;
      const L = 7;
      if (grid.get(tx + 1, ty) === Tile.Water && grid.inBounds(tx + 1, ty)) ctx.fillRect((tx + 1) * P - L, ty * P, L, P);
      if (grid.get(tx - 1, ty) === Tile.Water && grid.inBounds(tx - 1, ty)) ctx.fillRect(tx * P, ty * P, L, P);
      if (grid.get(tx, ty + 1) === Tile.Water && grid.inBounds(tx, ty + 1)) ctx.fillRect(tx * P, (ty + 1) * P - L, P, L);
      if (grid.get(tx, ty - 1) === Tile.Water && grid.inBounds(tx, ty - 1)) ctx.fillRect(tx * P, ty * P, P, L);
    }
  }

  drawLanes(ctx, grid, P);
  drawPads(ctx, grid, P, viewerTeam);
  drawGoals(ctx, grid, P, viewerTeam);
  return canvasTexture(c);
}

/** 사격장 레인: 테두리 선, 과녁까지의 거리 눈금(2타일마다 숫자) */
/** 세로 사격장: 좌우 테두리, 과녁(위)에서 아래로 2타일마다 거리 숫자 */
function drawVerticalLane(ctx: CanvasRenderingContext2D, tx: number, ty: number, left: number, right: number, bottom: number, P: number) {
  ctx.fillStyle = FLOOR.laneLine;
  ctx.fillRect(left * P, ty * P, 4, (bottom + 1 - ty) * P);
  ctx.fillRect((right + 1) * P - 4, ty * P, 4, (bottom + 1 - ty) * P);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(P * 0.46)}px 'Lilita One', 'Arial Black', sans-serif`;
  for (let k = 1; ty + k <= bottom; k++) {
    const y = (ty + k + 0.5) * P;
    if (k % 2 === 1) {
      ctx.fillStyle = FLOOR.laneLine;
      ctx.fillRect(left * P, y - 2, P * 0.22, 4);
      ctx.fillRect((right + 1) * P - P * 0.22, y - 2, P * 0.22, 4);
      continue;
    }
    const nx = (left + 0.45) * P;
    ctx.fillStyle = 'rgba(247,249,255,0.9)';
    for (let x = nx + P * 0.32; x < (right + 1) * P - 8; x += 16) ctx.fillRect(x, y - 2.5, 9, 5);
    ctx.fillStyle = 'rgba(30,34,60,0.55)';
    roundRect(ctx, nx - P * 0.3, y - P * 0.26, P * 0.6, P * 0.5, 9);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.strokeText(String(k), nx, y + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(k), nx, y + 1);
  }
  void tx;
}

function drawLanes(ctx: CanvasRenderingContext2D, grid: Grid, P: number) {
  const lane = (tx: number, ty: number) => grid.ground(tx, ty) === Ground.Lane && grid.get(tx, ty) === Tile.Floor;
  for (const d of grid.dummySpawns) {
    const tx = Math.floor(d.pos.x);
    const ty = Math.floor(d.pos.y);
    if (!lane(tx, ty)) continue;
    let top = ty;
    while (lane(tx - 1, top - 1)) top--;
    let bottom = ty;
    while (lane(tx - 1, bottom + 1)) bottom++;
    let left = tx;
    while (lane(left - 1, ty)) left--;
    let right = tx;
    while (lane(right + 1, ty)) right++;

    // 세로 레인(과녁이 위쪽 끝, 아래로 갈수록 멀다)
    let vTop = ty;
    while (lane(tx, vTop - 1)) vTop--;
    let vBottom = ty;
    while (lane(tx, vBottom + 1)) vBottom++;
    let vLeft = tx;
    while (lane(vLeft - 1, ty + 1)) vLeft--;
    let vRight = tx;
    while (lane(vRight + 1, ty + 1)) vRight++;
    if (vBottom - ty > right - left) {
      drawVerticalLane(ctx, tx, ty, vLeft, vRight, vBottom, P);
      continue;
    }

    // 테두리 선
    ctx.fillStyle = FLOOR.laneLine;
    ctx.fillRect(left * P, top * P, (right + 1 - left) * P, 4);
    ctx.fillRect(left * P, (bottom + 1) * P - 4, (right + 1 - left) * P, 4);

    // 거리 눈금
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(P * 0.46)}px 'Lilita One', 'Arial Black', sans-serif`;
    for (let k = 1; tx - k >= left; k++) {
      const x = (tx - k + 0.5) * P;
      if (k % 2 === 1) {
        ctx.fillRect(x - 2, top * P, 4, P * 0.22);
        ctx.fillRect(x - 2, (bottom + 1) * P - P * 0.22, 4, P * 0.22);
        continue;
      }
      // 숫자 판은 레인 위쪽 줄에(아래쪽은 레인 옆 벽에 가려질 수 있음), 점선은 그 아래로
      const ny = (top + 0.4) * P;
      ctx.fillStyle = 'rgba(247,249,255,0.9)';
      for (let y = ny + P * 0.32; y < (bottom + 1) * P - 8; y += 16) ctx.fillRect(x - 2.5, y, 5, 9);
      ctx.fillStyle = 'rgba(30,34,60,0.55)';
      roundRect(ctx, x - P * 0.3, ny - P * 0.26, P * 0.6, P * 0.5, 9);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.strokeText(String(k), x, ny + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(k), x, ny + 1);
      ctx.fillStyle = FLOOR.laneLine;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** [우리 팀, 상대 팀] — 보는 사람 기준 */
const TEAM_PAD = { ally: '#3f8cff', enemy: '#ff4f5e' } as const;
const DUMMY_PAD: Record<string, string> = { idle: '#e84a4a', patrol: '#ff9a2a', turret: '#9b5cf0' };

/** 파이터 볼 골대 칸: 그물 무늬 + 골라인. 보는 사람 기준 우리 골대 파랑, 상대 골대 빨강 */
function drawGoals(ctx: CanvasRenderingContext2D, grid: Grid, P: number, viewerTeam = 0) {
  grid.goalTiles.forEach((tiles, team) => {
    if (!tiles.length) return;
    const color = team === viewerTeam ? TEAM_PAD.ally : TEAM_PAD.enemy;
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x0 = Math.min(...xs) * P;
    const y0 = Math.min(...ys) * P;
    const x1 = (Math.max(...xs) + 1) * P;
    const y1 = (Math.max(...ys) + 1) * P;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    // 그물
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    for (let x = x0; x <= x1; x += P / 4) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += P / 4) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    // 골라인(경기장 쪽 가장자리): 골대가 위에 있으면 아래 변, 아래에 있으면 위 변
    const fieldBelow = y1 < (grid.height * P) / 2;
    const ly = fieldBelow ? y1 : y0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 - P * 0.6, ly - 4, x1 - x0 + P * 1.2, 8);
    ctx.fillStyle = color;
    ctx.fillRect(x0 - P * 0.6, ly - 2, x1 - x0 + P * 1.2, 4);
  });
}

/** 출발 지점(팀 색 원판 + 화살표), 더미 받침(과녁 무늬, 왕복 경로, 포탑 판) */
function drawPads(ctx: CanvasRenderingContext2D, grid: Grid, P: number, viewerTeam = 0) {
  grid.teamSpawns.forEach((spawns, team) => {
    for (const s of spawns) {
      const x = s.x * P;
      const y = s.y * P;
      const R = P * 1.15;
      ctx.fillStyle = 'rgba(18,16,42,0.25)';
      ctx.beginPath();
      ctx.arc(x, y + 4, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team === viewerTeam ? TEAM_PAD.ally : TEAM_PAD.enemy;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, R - 8, 0, Math.PI * 2);
      ctx.stroke();
      // 진행 방향 화살표 3개(세로 맵: 팀0은 아래에서 위쪽, 팀1은 위에서 아래쪽)
      const dir = team === 0 ? -1 : 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let k = -1; k <= 1; k++) {
        const cy = y + k * P * 0.2 * dir;
        ctx.beginPath();
        ctx.moveTo(x - P * 0.12, cy - P * 0.06 * dir);
        ctx.lineTo(x, cy + P * 0.06 * dir);
        ctx.lineTo(x + P * 0.12, cy - P * 0.06 * dir);
        ctx.stroke();
      }
    }
  });

  for (const d of grid.dummySpawns) {
    const x = d.pos.x * P;
    const y = d.pos.y * P;
    const col = DUMMY_PAD[d.behavior] ?? '#e84a4a';
    if (d.behavior === 'patrol') {
      // 왕복 경로: 3타일 점선 + 끝 표시('q'면 위아래, 아니면 좌우)
      ctx.fillStyle = col;
      if (d.axis === 'y') {
        for (let k = -3 * P; k < 3 * P; k += 22) ctx.fillRect(x - 3, y + k + 4, 6, 12);
        for (const e of [-1, 1]) {
          roundRect(ctx, x - P * 0.28, y + e * 3 * P - 4, P * 0.56, 8, 4);
          ctx.fill();
        }
      } else {
        for (let k = -3 * P; k < 3 * P; k += 22) ctx.fillRect(x + k + 4, y - 3, 12, 6);
        for (const e of [-1, 1]) {
          roundRect(ctx, x + e * 3 * P - 4, y - P * 0.28, 8, P * 0.56, 4);
          ctx.fill();
        }
      }
    }
    if (d.behavior === 'turret') {
      ctx.fillStyle = 'rgba(18,16,42,0.3)';
      octagon(ctx, x, y + 3, P * 0.62);
      ctx.fill();
      ctx.fillStyle = col;
      octagon(ctx, x, y, P * 0.62);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 4;
      octagon(ctx, x, y, P * 0.5);
      ctx.stroke();
      continue;
    }
    // 과녁 고리
    const rings = [
      [0.56, '#ffffff'],
      [0.47, col],
      [0.34, '#ffffff'],
      [0.22, col],
    ] as const;
    for (const [rr, c] of rings) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, P * rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function octagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** 맵 바깥 풀밭(반복 무늬, 한 장 = 2타일) */
export function buildOuterGrassTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = THEME === 'winter' ? '#e8f0f8' : '#74bf58';
  ctx.fillRect(0, 0, S, S);
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  for (let k = 0; k < 10; k++) {
    const x = hash(k, 1, 300) * S;
    const y = hash(k, 2, 300) * S;
    const r = 10 + hash(k, 3, 300) * 16;
    ctx.fillStyle = THEME === 'winter' ? (k % 2 ? 'rgba(190,210,232,0.5)' : 'rgba(255,255,255,0.6)') : k % 2 ? 'rgba(98,170,72,0.55)' : 'rgba(140,205,104,0.45)';
    wrap((ox, oy) => {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.strokeStyle = THEME === 'winter' ? 'rgba(150,178,210,0.5)' : 'rgba(60,128,48,0.6)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    const x = hash(k, 4, 300) * S;
    const y = hash(k, 5, 300) * S;
    wrap((ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(x + ox - 3, y + oy - 5);
      ctx.lineTo(x + ox, y + oy);
      ctx.lineTo(x + ox + 3, y + oy - 6);
      ctx.stroke();
    });
  }
  return canvasTexture(c, true);
}

/** 단단한 벽: 돌 블록 무늬(흰 바탕에 어두운 줄눈 — 재질 색과 곱해짐) */
export function buildStoneTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#6c7285';
  ctx.fillRect(0, 0, S, S);
  const rows = [0, 40, 84, 128];
  for (let r = 0; r < 3; r++) {
    const y0 = rows[r]!;
    const y1 = rows[r + 1]!;
    let x = -((r * 23) % 40);
    let k = 0;
    while (x < S) {
      const w = 38 + hash(k, r, 400) * 26;
      const v = 0.9 + hash(k, r, 401) * 0.1;
      ctx.fillStyle = shade('#ffffff', v);
      roundRect(ctx, x + 2.5, y0 + 2.5, w - 5, y1 - y0 - 5, 7);
      ctx.fill();
      // 위쪽 하이라이트, 아래쪽 그늘
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x + 7, y0 + 4, w - 14, 3);
      ctx.fillStyle = 'rgba(80,86,110,0.18)';
      ctx.fillRect(x + 6, y1 - 9, w - 12, 4);
      x += w;
      k++;
    }
  }
  return canvasTexture(c);
}

/** 부서지는 벽 A: 나무 상자 면(테두리 + 대각선 버팀목 + 판자) */
export function buildCrateTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  // 겨울은 얼음 상자(파란 판), 봄은 나무 상자
  const ice = THEME === 'winter';
  const planks = ice ? ['#bfe6ff', '#b0dcfb', '#c6eaff', '#a9d6f7'] : ['#e9ab66', '#dfa05a', '#e6a862', '#da9b55'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = planks[i]!;
    ctx.fillRect(i * 32, 0, 32, S);
    ctx.fillStyle = ice ? 'rgba(60,120,190,0.22)' : 'rgba(150,85,35,0.22)';
    ctx.fillRect(i * 32 + 9, 20 + i * 11, 2, 40);
    ctx.fillRect(i * 32 + 20, 62 - i * 7, 2, 34);
    ctx.fillStyle = ice ? '#5c94c9' : '#9b5b28';
    ctx.fillRect(i * 32 - 1, 0, 2, S);
  }
  // 대각선 버팀목
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = ice ? '#4f86bd' : '#8f5124';
  ctx.fillRect(-S * 0.75, -11, S * 1.5, 22);
  ctx.fillStyle = ice ? '#8cc6f0' : '#c27a38';
  ctx.fillRect(-S * 0.75, -9, S * 1.5, 16);
  ctx.fillStyle = 'rgba(255,220,170,0.35)';
  ctx.fillRect(-S * 0.75, -9, S * 1.5, 3);
  ctx.restore();
  // 테두리 틀
  const F = 17;
  ctx.fillStyle = ice ? '#7db6e6' : '#b86f30';
  ctx.fillRect(0, 0, S, F);
  ctx.fillRect(0, S - F, S, F);
  ctx.fillRect(0, 0, F, S);
  ctx.fillRect(S - F, 0, F, S);
  ctx.fillStyle = 'rgba(255,215,160,0.4)';
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.strokeStyle = ice ? '#3f74a8' : '#7e4419';
  ctx.lineWidth = 3;
  ctx.strokeRect(F, F, S - 2 * F, S - 2 * F);
  // 못
  ctx.fillStyle = '#5b3a24';
  for (const [x, y] of [
    [8, 8],
    [S - 8, 8],
    [8, S - 8],
    [S - 8, S - 8],
  ]) {
    ctx.beginPath();
    ctx.arc(x!, y!, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c);
}

/** 부서지는 벽 B: 흙벽돌 면(엇갈린 벽돌 + 밝은 줄눈 + 지푸라기) */
export function buildAdobeTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  // 겨울은 눈 벽돌(하얀 줄눈 + 연한 파란 벽돌)
  const snow = THEME === 'winter';
  ctx.fillStyle = snow ? '#f4f8fc' : '#f1cf9f';
  ctx.fillRect(0, 0, S, S);
  const rowH = 32;
  for (let r = 0; r < 4; r++) {
    const y = r * rowH;
    const off = r % 2 ? -21 : 0;
    for (let k = 0; k < 4; k++) {
      const x = off + k * 43;
      const v = 0.94 + hash(k, r, 500) * 0.1;
      ctx.fillStyle = shade(snow ? '#b7cde6' : '#d88957', v);
      roundRect(ctx, x + 3, y + 3, 37, rowH - 6, 6);
      ctx.fill();
      ctx.fillStyle = snow ? 'rgba(255,255,255,0.7)' : 'rgba(255,230,190,0.45)';
      ctx.fillRect(x + 7, y + 5, 29, 3);
      ctx.fillStyle = snow ? 'rgba(60,90,140,0.22)' : 'rgba(120,55,25,0.22)';
      ctx.fillRect(x + 6, y + rowH - 9, 31, 3);
      ctx.strokeStyle = snow ? 'rgba(255,255,255,0.8)' : 'rgba(255,236,170,0.75)';
      ctx.lineWidth = 1.5;
      for (let s = 0; s < 2; s++) {
        const sx = x + 9 + hash(k, r, 510 + s) * 22;
        const sy = y + 9 + hash(k, r, 520 + s) * 12;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 6, sy + 2);
        ctx.stroke();
      }
    }
  }
  return canvasTexture(c);
}
