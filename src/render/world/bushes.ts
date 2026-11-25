import * as THREE from 'three';
import type { Vec2 } from '../../game/types';
import { Tile, bushClusterAt, labelClusters, type Grid } from '../../game/world';
import { bushGeometry, outlineGeometry } from './geometry';
import { tileMatrix } from './instancedLayer';
import { outlineMaterial, worldToon, type TimeUniform } from './materials';
import { hash } from './textures';

const GHOST_OPACITY = 0.45;
const FADE_RATE = 12;

interface BushTile {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  cluster: number;
}

/**
 * 수풀. World 담당.
 * - 뭉게뭉게 공 모양, 셰이더로 바람에 살짝 흔들림(외곽선도 같이 흔들림).
 * - 플레이어(viewer)가 들어간 수풀 덩어리만 반투명 메쉬로 옮겨 그린다.
 *   반투명은 깊이만 먼저 쓰고(색 없음) 같은 깊이에서 색을 섞는 2단계라서, 공이 겹친 곳이 얼룩지지 않는다.
 * 드로우콜: 불투명 1 + 외곽선 1 + (반투명일 때) 2.
 */
export class BushLayer {
  readonly object = new THREE.Group();
  private readonly grid: Grid;
  private readonly geo: THREE.BufferGeometry;
  private readonly lineGeo: THREE.BufferGeometry;
  private readonly opaque: THREE.InstancedMesh;
  private readonly line: THREE.InstancedMesh;
  private readonly ghostDepth: THREE.InstancedMesh;
  private readonly ghost: THREE.InstancedMesh;
  private readonly ghostMat: THREE.MeshToonMaterial;
  private readonly materials: THREE.Material[] = [];
  private tiles: BushTile[] = [];
  private labels: Int32Array = new Int32Array(0);
  /** 반투명 메쉬에 들어가 있는 덩어리(-1 = 없음) */
  private shown = -1;
  private opacity = 1;

  constructor(grid: Grid, time: TimeUniform) {
    this.grid = grid;
    this.geo = bushGeometry(grid.theme === 'winter');
    this.lineGeo = outlineGeometry(this.geo);
    const cap = Math.max(1, grid.width * grid.height);

    const mat = worldToon({ vertexColors: true, sway: time });
    const lineMat = outlineMaterial(0.022, time);
    this.ghostMat = worldToon({ vertexColors: true, sway: time });
    this.ghostMat.transparent = true;
    this.ghostMat.depthWrite = false;
    this.ghostMat.opacity = 1;
    const depthMat = worldToon({ vertexColors: true, sway: time });
    depthMat.transparent = true;
    depthMat.colorWrite = false;
    this.materials.push(mat, lineMat, this.ghostMat, depthMat);

    const inst = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(g, m, cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    };
    this.opaque = inst(this.geo, mat);
    this.opaque.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.line = inst(this.lineGeo, lineMat);
    this.line.instanceMatrix = this.opaque.instanceMatrix;
    this.line.raycast = () => {};
    this.ghostDepth = inst(this.geo, depthMat);
    this.ghost = inst(this.geo, this.ghostMat);
    this.ghost.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.ghostDepth.instanceMatrix = this.ghost.instanceMatrix;
    // 반투명 수풀은 다른 반투명 효과보다 나중에, 깊이 → 색 순서로
    this.ghostDepth.renderOrder = 20;
    this.ghost.renderOrder = 21;
    this.object.add(this.opaque, this.line, this.ghostDepth, this.ghost);
    this.rebuild();
  }

  /** 수풀 배치를 처음부터 다시(수풀 타일이 바뀌었을 때만) */
  rebuild() {
    const g = this.grid;
    this.labels = labelClusters(g, Tile.Bush).labels;
    this.tiles = [];
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        if (g.get(tx, ty) !== Tile.Bush) continue;
        const r = (s: number) => hash(tx, ty, 200 + s);
        const s = 0.96 + r(1) * 0.1;
        this.tiles.push({
          matrix: tileMatrix(tx + 0.5 + (r(2) - 0.5) * 0.06, ty + 0.5 + (r(3) - 0.5) * 0.06, r(4) * Math.PI * 2, s, 0.92 + r(5) * 0.2),
          // 겨울: 눈 덮인 덤불(초록을 하얗고 파랗게)
          color: new THREE.Color().setHSL(0, 0, 1).multiplyScalar(0.92 + r(6) * 0.12),
          cluster: this.labels[ty * g.width + tx]!,
        });
      }
    }
    this.fill(this.shown);
  }

  /** cluster 덩어리는 반투명 쪽으로, 나머지는 불투명 쪽으로 */
  private fill(cluster: number) {
    let o = 0;
    let gi = 0;
    for (const t of this.tiles) {
      if (cluster >= 0 && t.cluster === cluster) {
        this.ghost.setMatrixAt(gi, t.matrix);
        this.ghost.setColorAt(gi, t.color);
        gi++;
      } else {
        this.opaque.setMatrixAt(o, t.matrix);
        this.opaque.setColorAt(o, t.color);
        o++;
      }
    }
    this.opaque.count = this.line.count = o;
    this.ghost.count = this.ghostDepth.count = gi;
    this.opaque.instanceMatrix.needsUpdate = true;
    this.opaque.instanceColor!.needsUpdate = true;
    this.ghost.instanceMatrix.needsUpdate = true;
    this.ghost.instanceColor!.needsUpdate = true;
    this.shown = cluster;
  }

  update(dt: number, viewer: Vec2 | null) {
    const want = viewer ? bushClusterAt(this.grid, this.labels, viewer) : -1;
    if (want !== this.shown) {
      if (this.shown >= 0) {
        // 나가는 중: 불투명해질 때까지 올린 뒤 원래 메쉬로 돌려보낸다
        this.opacity = Math.min(1, this.opacity + (1 - this.opacity) * (1 - Math.exp(-dt * FADE_RATE)) + dt * 0.5);
        if (this.opacity >= 0.97 || want >= 0) {
          this.opacity = 1;
          this.fill(-1);
        }
      }
      if (this.shown < 0 && want >= 0) {
        this.opacity = 1;
        this.fill(want);
      }
    } else if (this.shown >= 0) {
      this.opacity += (GHOST_OPACITY - this.opacity) * (1 - Math.exp(-dt * FADE_RATE));
    }
    this.ghostMat.opacity = this.opacity;
    const visible = this.shown >= 0;
    this.ghost.visible = this.ghostDepth.visible = visible;
  }

  dispose() {
    this.object.removeFromParent();
    this.geo.dispose();
    this.lineGeo.dispose();
    for (const m of this.materials) m.dispose();
    this.opaque.dispose();
    this.ghost.dispose();
  }
}
