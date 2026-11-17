import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Vec2 } from '../../game/types';
import { Tile, type Grid } from '../../game/world';
import { toon } from '../toon';

/**
 * 맵 3D 표현. World 담당. (현재는 Lead가 만든 단순한 초기 구현)
 * 월드 좌표: 타일 (tx, ty)의 중심 = (tx+0.5, 0, ty+0.5). 바닥은 y=0.
 */
export class MapRenderer {
  readonly object = new THREE.Group();
  private readonly grid: Grid;
  private builtVersion = -1;
  private readonly floor: THREE.Mesh;
  private readonly floorTex: THREE.CanvasTexture;
  private readonly floorCanvas: HTMLCanvasElement;
  private dynamic = new THREE.Group();
  private readonly wallGeo = new RoundedBoxGeometry(0.98, 1.0, 0.98, 2, 0.08);
  private readonly bushGeo = new RoundedBoxGeometry(0.98, 0.7, 0.98, 2, 0.3);

  constructor(grid: Grid) {
    this.grid = grid;
    this.floorCanvas = document.createElement('canvas');
    this.floorCanvas.width = grid.width * 16;
    this.floorCanvas.height = grid.height * 16;
    this.floorTex = new THREE.CanvasTexture(this.floorCanvas);
    this.floorTex.magFilter = THREE.NearestFilter;
    this.floorTex.colorSpace = THREE.SRGBColorSpace;
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(grid.width, grid.height),
      new THREE.MeshLambertMaterial({ map: this.floorTex }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(grid.width / 2, 0, grid.height / 2);
    this.object.add(this.floor, this.dynamic);
    this.rebuild();
  }

  private rebuild() {
    this.builtVersion = this.grid.version;
    const g = this.grid;
    const ctx = this.floorCanvas.getContext('2d')!;
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        const t = g.get(tx, ty);
        ctx.fillStyle = t === Tile.Water ? '#3fa9e0' : (tx + ty) % 2 ? '#e8c98a' : '#e2bf7c';
        ctx.fillRect(tx * 16, ty * 16, 16, 16);
      }
    }
    this.floorTex.needsUpdate = true;

    this.dynamic.clear();
    const walls: Vec2[] = [];
    const hard: Vec2[] = [];
    const bushes: Vec2[] = [];
    for (let ty = 0; ty < g.height; ty++) {
      for (let tx = 0; tx < g.width; tx++) {
        const t = g.get(tx, ty);
        if (t === Tile.Wall) walls.push({ x: tx, y: ty });
        else if (t === Tile.HardWall) hard.push({ x: tx, y: ty });
        else if (t === Tile.Bush) bushes.push({ x: tx, y: ty });
      }
    }
    this.dynamic.add(
      this.instanced(this.wallGeo, toon('#b0744a'), walls, 0.5),
      this.instanced(this.wallGeo, toon('#5d6680'), hard, 0.5),
      this.instanced(this.bushGeo, toon('#3fae4f'), bushes, 0.35),
    );
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, tiles: Vec2[], y: number) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, tiles.length));
    mesh.count = tiles.length;
    const m = new THREE.Matrix4();
    tiles.forEach((t, i) => {
      m.makeTranslation(t.x + 0.5, y, t.y + 0.5);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /** 매 프레임. viewer: 플레이어 위치(수풀 반투명 처리 등에 사용) */
  update(_t: number, _dt: number, _viewer: Vec2 | null) {
    if (this.grid.version !== this.builtVersion) this.rebuild();
  }

  dispose() {
    this.wallGeo.dispose();
    this.bushGeo.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    this.floorTex.dispose();
    this.object.removeFromParent();
  }
}
