import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FIGHTERS, type FighterDef } from '../data/fighters';
import type { FighterModel } from './fighterModel';
import { blobShadow, toon, toonTextured } from './toon';

/**
 * glb 파일로 만든 캐릭터 모델. 뼈대(리깅)가 없는 정적 모델이라 몸 전체를 움직이는 절차적 애니메이션을 쓴다
 * (대기: 숨쉬기·흔들림, 걷기: 통통 튀며 좌우로 뒤뚱, 공격: 총 반동, 선택: 점프+회전).
 * 모델은 부팅 때 preloadGlbFighters()로 미리 받고, 아직 없으면 임시 캡슐을 보여줬다가 받는 즉시 바꿔 끼운다.
 */

const TARGET_HEIGHT = 1.75;
/** 총 길이(캐릭터 키 대비) */
const GUN_LENGTH = 1.2;
/** 총을 쥐는 손 위치(정규화된 모델 기준: 발바닥 y=0, 정면 +z). 모델에 맞춰 조정한 값 */
const HAND = new THREE.Vector3(-0.37, 0.74, 0.12);
/** 총 원본에서 손잡이(방아쇠) 위치의 x 비율(-1 총구 ~ 1 개머리판) */
const GUN_GRIP = 0.44;

interface Loaded {
  body: THREE.Object3D;
  weapon: THREE.Object3D | null;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<Loaded>>();
const ready = new Map<string, Loaded>();

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

function toToon(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    m.material = toonTextured({ map: src.map, normalMap: src.normalMap, color: src.color });
  });
}

/** 발바닥이 y=0, 가운데가 원점, 키가 TARGET_HEIGHT가 되도록 감싼다 */
function normalizeBody(scene: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = TARGET_HEIGHT / size.y;
  const center = box.getCenter(new THREE.Vector3());
  scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  scene.scale.multiplyScalar(s);
  const wrap = new THREE.Group();
  wrap.add(scene);
  return wrap;
}

/** 총: 원본은 x축을 따라 놓여 있고 총구가 -x. 정면(+z)을 향하게 돌려서 손에 쥐어 준다 */
function normalizeWeapon(scene: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = GUN_LENGTH / size.x;
  scene.position.set(-center.x * s, -center.y * s, -center.z * s);
  scene.scale.multiplyScalar(s);
  const pivot = new THREE.Group();
  pivot.add(scene);
  pivot.rotation.y = Math.PI / 2; // -x(총구) → +z(정면)
  // 손잡이가 holder 원점(손)에 오도록 총 중심을 앞으로 민다
  pivot.position.z = (GUN_GRIP * GUN_LENGTH) / 2;
  const holder = new THREE.Group();
  holder.add(pivot);
  holder.position.copy(HAND);
  // 총구를 앞·위·바깥쪽으로 비스듬히 든 자세(정면에서도, 위에서도 총이 보이게)
  holder.rotation.set(-0.75, -0.35, 0);
  return holder;
}

async function load(def: FighterDef): Promise<Loaded> {
  if (def.model.type !== 'glb') throw new Error(`${def.id} is not a glb fighter`);
  const [b, w] = await Promise.all([
    loader.loadAsync(url(def.model.body)),
    def.model.weapon ? loader.loadAsync(url(def.model.weapon)) : Promise.resolve(null),
  ]);
  toToon(b.scene);
  if (w) toToon(w.scene);
  const loaded = { body: normalizeBody(b.scene), weapon: w ? normalizeWeapon(w.scene) : null };
  ready.set(def.id, loaded);
  return loaded;
}

function loadOnce(def: FighterDef): Promise<Loaded> {
  let p = cache.get(def.id);
  if (!p) {
    p = load(def);
    cache.set(def.id, p);
  }
  return p;
}

/** 모든 glb 캐릭터를 미리 받는다(부팅 로딩 화면에서 호출) */
export async function preloadGlbFighters(): Promise<void> {
  await Promise.all(
    FIGHTERS.filter((f) => f.model.type === 'glb').map((f) =>
      loadOnce(f).catch((e) => {
        console.warn(`model load failed: ${f.id}`, e);
      }),
    ),
  );
}

export function buildGlbFighterModel(def: FighterDef, opts: { shadow?: boolean } = {}): FighterModel {
  const root = new THREE.Group();
  root.name = `fighter:${def.id}`;
  const body = new THREE.Group();
  root.add(body);
  if (opts.shadow !== false) root.add(blobShadow(0.6));

  let weapon: THREE.Object3D | null = null;
  let weaponBase = new THREE.Vector3();
  let weaponRot = new THREE.Euler();
  let placeholder: THREE.Object3D | null = null;
  let disposed = false;

  const attach = (l: Loaded) => {
    if (disposed) return;
    if (placeholder) {
      body.remove(placeholder);
      placeholder = null;
    }
    body.add(l.body.clone());
    if (l.weapon) {
      weapon = l.weapon.clone();
      weaponBase = weapon.position.clone();
      weaponRot = weapon.rotation.clone();
      body.add(weapon);
    }
  };

  const have = ready.get(def.id);
  if (have) attach(have);
  else {
    const geo = new THREE.CapsuleGeometry(0.35, 0.9, 6, 14);
    placeholder = new THREE.Mesh(geo, toon(def.palette.primary));
    placeholder.position.y = 0.8;
    body.add(placeholder);
    loadOnce(def).then(attach, () => {});
  }

  const phase = Math.random() * Math.PI * 2;
  let moving = false;
  let walk = 0;
  let walkPhase = 0;
  let recoil = 0;
  let celebrateT = -1;

  return {
    id: def.id,
    root,
    update(t, dt) {
      walk += ((moving ? 1 : 0) - walk) * Math.min(1, dt * 12);
      if (moving) walkPhase += dt * 12;
      const s = Math.sin(t * 2 + phase);
      const hop = Math.abs(Math.sin(walkPhase));
      body.position.y = s * 0.012 * (1 - walk) + hop * 0.09 * walk;
      body.scale.set(1 - s * 0.006, 1 + s * 0.012 - hop * 0.04 * walk, 1 - s * 0.006);
      body.rotation.z = Math.sin(t * 1.1 + phase) * 0.02 * (1 - walk) + Math.sin(walkPhase) * 0.09 * walk;
      body.rotation.x = 0.1 * walk;
      body.rotation.y = 0;
      if (weapon) {
        recoil = Math.max(0, recoil - dt * 5);
        weapon.position.set(weaponBase.x, weaponBase.y + recoil * 0.04, weaponBase.z - recoil * 0.16);
        weapon.rotation.x = weaponRot.x - recoil * 0.3;
      }
      if (celebrateT >= 0) {
        celebrateT += dt;
        const k = Math.min(1, celebrateT / 0.7);
        body.position.y += Math.sin(Math.PI * k) * 0.35;
        body.rotation.y = (1 - Math.pow(1 - k, 3)) * Math.PI * 2;
        if (k >= 1) celebrateT = -1;
      }
    },
    celebrate() {
      celebrateT = 0;
    },
    setMoving(m) {
      moving = m;
    },
    attack() {
      recoil = 1;
    },
    dispose() {
      disposed = true;
      root.removeFromParent();
      // 형상·재질은 모든 복제본이 공유하므로 여기서 정리하지 않는다
    },
  };
}
