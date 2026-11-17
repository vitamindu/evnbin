import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** 카툰 느낌의 3단 명암 재질 + 외곽선. */

let gradientTex: THREE.DataTexture | null = null;

function gradientMap(): THREE.DataTexture {
  if (!gradientTex) {
    const data = new Uint8Array([110, 190, 255]);
    gradientTex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradientTex.minFilter = THREE.NearestFilter;
    gradientTex.magFilter = THREE.NearestFilter;
    gradientTex.generateMipmaps = false;
    gradientTex.needsUpdate = true;
  }
  return gradientTex;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  const key = `${String(color)}|${String(emissive ?? '')}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
    if (emissive !== undefined) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = 1;
    }
    toonCache.set(key, m);
  }
  return m;
}

/** 텍스처가 있는 모델(glb)용 카툰 재질. 텍스처 색은 유지하고 명암만 3단으로 */
export function toonTextured(src: { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; color?: THREE.Color }): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    color: src.color ?? new THREE.Color('#ffffff'),
    gradientMap: gradientMap(),
  });
}

export const OUTLINE_COLOR = '#12102a';

const outlineMat = new THREE.ShaderMaterial({
  uniforms: {
    thickness: { value: 0.022 },
    color: { value: new THREE.Color(OUTLINE_COLOR) },
  },
  vertexShader: /* glsl */ `
    uniform float thickness;
    void main() {
      vec3 p = position + normalize(normal) * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    void main() { gl_FragColor = vec4(color, 1.0); }
  `,
  side: THREE.BackSide,
});

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** 모서리에서 외곽선이 갈라지지 않도록 법선을 부드럽게 만든 사본 */
function smoothed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = smoothCache.get(geo);
  if (!g) {
    const c = geo.clone();
    for (const name of Object.keys(c.attributes)) if (name !== 'position') c.deleteAttribute(name);
    g = mergeVertices(c, 1e-4);
    g.computeVertexNormals();
    smoothCache.set(geo, g);
  }
  return g;
}

/** 메쉬 + 외곽선 메쉬(자식)를 만든다. */
export function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  opts: { outline?: boolean } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  if (opts.outline !== false) {
    const ol = new THREE.Mesh(smoothed(geo), outlineMat);
    ol.name = 'outline';
    ol.raycast = () => {};
    mesh.add(ol);
  }
  return mesh;
}

/** 원형 그림자(그림자 맵 대신 쓰는 가벼운 방식) */
export function blobShadow(radius: number, opacity = 0.45): THREE.Mesh {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.005;
  mesh.renderOrder = -1;
  return mesh;
}

/** 모든 뷰에서 같이 쓰는 기본 조명 */
export function addStandardLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#dfe9ff', '#3a2a5a', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(2.5, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fe8ff', 1.2);
  rim.position.set(-3, 3, -4);
  scene.add(rim);
}
