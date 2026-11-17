import * as THREE from 'three';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * 같은 모양 타일들을 InstancedMesh 하나로 그린다(+ 같은 인스턴스 행렬을 쓰는 외곽선 메쉬).
 * 타일 번호(key)마다 인스턴스 칸이 하나 있어서, 벽 하나가 부서지면 그 칸만 숨긴다(전체 재구성 없음).
 */
export class InstancedLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh | null;
  private readonly slots = new Map<number, number>();
  private readonly matrices: THREE.Matrix4[] = [];
  private readonly hidden = new Set<number>();
  private readonly capacity: number;

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    capacity: number,
    outline?: { geo: THREE.BufferGeometry; mat: THREE.Material },
  ) {
    this.capacity = Math.max(1, capacity);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 색 버퍼는 처음부터 만든다(나중에 생기면 셰이더가 다시 컴파일돼야 함). 기본 흰색 = 색 변화 없음
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
    this.outline = null;
    if (outline) {
      const o = new THREE.InstancedMesh(outline.geo, outline.mat, this.capacity);
      o.instanceMatrix = this.mesh.instanceMatrix; // 같은 버퍼를 같이 쓴다
      o.count = 0;
      o.frustumCulled = false;
      o.raycast = () => {};
      this.outline = o;
    }
  }

  get size(): number {
    return this.matrices.length;
  }

  has(key: number): boolean {
    return this.slots.has(key);
  }

  /** 새 인스턴스. 칸이 모자라면 false */
  add(key: number, matrix: THREE.Matrix4, color?: THREE.Color): boolean {
    if (this.slots.has(key)) {
      this.show(key);
      return true;
    }
    const i = this.matrices.length;
    if (i >= this.capacity) return false;
    this.slots.set(key, i);
    this.matrices.push(matrix.clone());
    this.mesh.setMatrixAt(i, matrix);
    if (color) this.mesh.setColorAt(i, color);
    this.mesh.count = i + 1;
    if (this.outline) this.outline.count = i + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  /** 해당 타일의 인스턴스를 숨긴다(크기 0). 없으면 false */
  hide(key: number): boolean {
    const i = this.slots.get(key);
    if (i === undefined || this.hidden.has(key)) return i !== undefined;
    this.hidden.add(key);
    this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  show(key: number): boolean {
    const i = this.slots.get(key);
    if (i === undefined) return false;
    if (this.hidden.delete(key)) {
      this.mesh.setMatrixAt(i, this.matrices[i]!);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  addTo(parent: THREE.Object3D) {
    parent.add(this.mesh);
    if (this.outline) parent.add(this.outline);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.outline?.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    if (this.outline) {
      this.outline.geometry.dispose();
      (this.outline.material as THREE.Material).dispose();
    }
    this.mesh.dispose();
  }
}

/** 타일 위치 + y축 회전 + 크기로 행렬 */
export function tileMatrix(x: number, z: number, yaw: number, sx = 1, sy = 1, sz = sx, y = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sz),
  );
  return m;
}
