import * as THREE from 'three';

/**
 * 사슬 모양 이펙트(Chainer): 타원 고리를 직선 위에 줄 세운다. 사슬은 항상 직선이다.
 * 고리는 한 줄에 하나씩 90°씩 돌려 놓아 진짜 사슬처럼 보이게 한다. 인스턴싱이라 사슬 한 줄이 드로우 콜 1개.
 * 색은 호출하는 쪽이 팀 색(우리 파랑 / 상대 빨강)으로 넘긴다.
 */
const LINK_SPACING = 0.26;
const MAX_LINKS = 48;

let sharedGeo: THREE.BufferGeometry | null = null;
function linkGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) {
    sharedGeo = new THREE.TorusGeometry(0.1, 0.04, 6, 12);
    sharedGeo.scale(1.55, 1, 1); // 진행 방향(+x)으로 길쭉한 고리
  }
  return sharedGeo;
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const P = new THREE.Vector3();
const T = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const M = new THREE.Matrix4();

export class ChainLine {
  readonly mesh: THREE.InstancedMesh;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(linkGeometry(), material, MAX_LINKS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 5;
  }

  /**
   * a에서 b까지 **직선** 사슬을 놓는다. progress(0~1): a에서부터 이만큼만 보인다(뻗어 나가는 연출).
   * 고리는 일정한 간격으로 놓이고, 하나씩 90°씩 돌려 사슬처럼 보이게 한다.
   */
  setPath(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, progress = 1) {
    A.set(a.x, a.y, a.z);
    B.set(b.x, b.y, b.z);
    T.subVectors(B, A);
    const len = T.length();
    if (len < 1e-6) {
      this.mesh.count = 0;
      return;
    }
    T.divideScalar(len);
    Q1.setFromUnitVectors(AXIS_X, T);
    const total = Math.max(2, Math.min(MAX_LINKS, Math.round(len / LINK_SPACING)));
    const shown = Math.max(0, Math.min(total, Math.round(total * Math.max(0, Math.min(1, progress)))));
    for (let i = 0; i < shown; i++) {
      P.lerpVectors(A, B, (i + 0.5) / total);
      Q2.setFromAxisAngle(T, (i % 2) * (Math.PI / 2));
      Q2.multiply(Q1);
      M.compose(P, Q2, ONE);
      this.mesh.setMatrixAt(i, M);
    }
    this.mesh.count = shown;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}

let burstTex: THREE.CanvasTexture | null = null;
/** 내리치는 순간의 번쩍임: 가운데 원 + 사방으로 뻗는 뾰족한 빛줄기(흰색 → 팀 색을 곱해 쓴다) */
export function burstTexture(): THREE.CanvasTexture {
  if (burstTex) return burstTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const cx = size / 2;
  g.translate(cx, cx);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, cx * 0.55);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, cx * 0.55, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0;
    const r = cx * (long ? 0.98 : 0.62);
    const w = long ? 0.13 : 0.1;
    g.save();
    g.rotate((i * Math.PI) / 4);
    g.beginPath();
    g.moveTo(0, -cx * 0.12 * w * 4);
    g.lineTo(r, 0);
    g.lineTo(0, cx * 0.12 * w * 4);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  g.setLineDash([16, 14]);
  g.beginPath();
  g.arc(0, 0, cx * 0.7, 0, Math.PI * 2);
  g.stroke();
  burstTex = new THREE.CanvasTexture(c);
  burstTex.colorSpace = THREE.SRGBColorSpace;
  return burstTex;
}
