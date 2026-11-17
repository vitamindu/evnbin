import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FighterDef, FighterId } from '../data/fighters';
import { blobShadow, part, toon } from './toon';

/**
 * 스켈레톤(임시) 3D 캐릭터. 기본 도형을 조합해 만들며, 최종 모델(glTF)이 준비되면
 * 같은 FighterModel 인터페이스를 구현하는 로더로 교체한다.
 * 좌표: 발바닥 y=0, 정면 +z, 키 약 1.7유닛.
 */
export interface FighterModel {
  readonly id: FighterId;
  readonly root: THREE.Group;
  update(t: number, dt: number): void;
  /** 선택했을 때의 짧은 점프+회전 */
  celebrate(): void;
  /** 걷기 동작 켜기/끄기 */
  setMoving(moving: boolean): void;
  /** 공격 반동 */
  attack(): void;
  dispose(): void;
}

interface Proportions {
  torsoW: number;
  torsoH: number;
  torsoD: number;
  headR: number;
  /** 머리 중심이 몸통 위로 올라가는 정도(머리 반지름 배수) */
  headLift: number;
  legR: number;
  legLen: number;
  legX: number;
  armR: number;
  armLen: number;
  shoeH: number;
}

interface Rig {
  legs: THREE.Group[];
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  bodyBaseY: number;
}

class GeoBag {
  private readonly list: THREE.BufferGeometry[] = [];
  add<G extends THREE.BufferGeometry>(g: G): G {
    this.list.push(g);
    return g;
  }
  dispose() {
    for (const g of this.list) g.dispose();
  }
}

const DARK_INK = '#1a1530';
const EYE_WHITE = '#ffffff';
const METAL = '#9aa3b5';

function buildHumanoid(root: THREE.Group, g: GeoBag, p: Proportions, c: { top: string; legs: string; shoes: string; skin: string; hands?: string }): Rig {
  // 신발 + 다리(엉덩이 높이를 축으로 흔들리도록 그룹으로 묶는다)
  const legH = p.legLen + p.legR * 2;
  const hipY = p.shoeH * 0.6 + legH - p.legR;
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * p.legX, hipY, 0);
    const shoe = part(g.add(new RoundedBoxGeometry(p.legR * 2.1, p.shoeH, p.legR * 2.8, 3, p.shoeH * 0.45)), toon(c.shoes));
    shoe.position.set(0, p.shoeH / 2 - hipY, p.legR * 0.35);
    hip.add(shoe);
    const leg = part(g.add(new THREE.CapsuleGeometry(p.legR, p.legLen, 6, 14)), toon(c.legs));
    leg.position.set(0, p.shoeH * 0.6 + legH / 2 - hipY, 0);
    hip.add(leg);
    root.add(hip);
    legs.push(hip);
  }

  const body = new THREE.Group();
  root.add(body);

  const torso = part(
    g.add(new RoundedBoxGeometry(p.torsoW, p.torsoH, p.torsoD, 4, Math.min(p.torsoW, p.torsoD) * 0.32)),
    toon(c.top),
  );
  torso.position.y = hipY + p.torsoH / 2 - 0.04;
  body.add(torso);
  const torsoTop = torso.position.y + p.torsoH / 2;

  const head = new THREE.Group();
  head.position.y = torsoTop + p.headR * p.headLift;
  body.add(head);
  const skull = part(g.add(new THREE.SphereGeometry(p.headR, 32, 24)), toon(c.skin));
  head.add(skull);

  const makeArm = (sx: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (p.torsoW / 2 + p.armR * 0.75), torsoTop - p.armR * 1.5, 0);
    const arm = part(g.add(new THREE.CapsuleGeometry(p.armR, p.armLen, 6, 12)), toon(c.top));
    arm.position.y = -(p.armLen / 2 + p.armR * 0.4);
    pivot.add(arm);
    const hand = part(g.add(new THREE.SphereGeometry(p.armR * 1.3, 16, 12)), toon(c.hands ?? c.skin));
    hand.position.y = -(p.armLen + p.armR * 1.1);
    pivot.add(hand);
    body.add(pivot);
    return { pivot, hand };
  };
  const l = makeArm(-1);
  const r = makeArm(1);

  return { legs, body, torso, head, armL: l.pivot, armR: r.pivot, handL: l.hand, handR: r.hand, bodyBaseY: 0 };
}

/** 구 표면 위 (x, y) 지점의 z 좌표 */
function onSphere(r: number, x: number, y: number) {
  return Math.sqrt(Math.max(0, r * r - x * x - y * y));
}

function addEyes(head: THREE.Group, g: GeoBag, r: number, opts: { size?: number; spread?: number; y?: number } = {}) {
  const size = opts.size ?? 0.2;
  const spread = opts.spread ?? 0.34;
  const y = (opts.y ?? 0.06) * r;
  const white = g.add(new THREE.SphereGeometry(r * size, 16, 12));
  const pupil = g.add(new THREE.SphereGeometry(r * size * 0.52, 12, 10));
  for (const sx of [-1, 1]) {
    const x = sx * spread * r;
    const z = onSphere(r * 0.93, x, y);
    const eye = part(white, toon(EYE_WHITE), { outline: false });
    eye.scale.set(0.85, 1.2, 0.55);
    eye.position.set(x, y, z);
    eye.lookAt(x * 3, y * 3, z * 3);
    head.add(eye);
    const pu = part(pupil, toon(DARK_INK), { outline: false });
    pu.position.set(x * 1.02, y + r * 0.01, z + r * size * 0.32);
    head.add(pu);
  }
}

// ───────────────────────── RIVET: 근거리 산탄형 정비공 ─────────────────────────
function buildRivet(def: FighterDef, root: THREE.Group, g: GeoBag): Rig {
  const c = def.palette;
  const p: Proportions = {
    torsoW: 0.62, torsoH: 0.5, torsoD: 0.42, headR: 0.4, headLift: 0.85,
    legR: 0.12, legLen: 0.16, legX: 0.15, armR: 0.095, armLen: 0.26, shoeH: 0.13,
  };
  const rig = buildHumanoid(root, g, p, { top: c.primary, legs: c.dark, shoes: '#3b2b25', skin: c.skin });
  const r = p.headR;

  addEyes(rig.head, g, r, { size: 0.21, spread: 0.33, y: 0.02 });
  // 웃는 입
  const mouth = part(g.add(new THREE.TorusGeometry(r * 0.13, r * 0.035, 6, 16, Math.PI)), toon(DARK_INK), { outline: false });
  const my = -r * 0.32;
  mouth.position.set(0, my, onSphere(r * 0.98, 0, my));
  mouth.rotation.z = Math.PI;
  rig.head.add(mouth);
  // 작업모: 돔 + 챙
  const cap = part(g.add(new THREE.SphereGeometry(r * 1.05, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.4)), toon(c.secondary));
  cap.rotation.x = -0.18;
  rig.head.add(cap);
  const brim = part(g.add(new RoundedBoxGeometry(r * 1.25, 0.05, r * 0.7, 2, 0.022)), toon(c.secondary));
  brim.position.set(0, r * 0.4, r * 0.82);
  brim.rotation.x = 0.1;
  rig.head.add(brim);
  const badge = part(g.add(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.03, 16)), toon(c.accent));
  badge.rotation.x = Math.PI / 2 - 0.55;
  badge.position.set(0, r * 0.68, r * 0.76);
  rig.head.add(badge);

  // 멜빵 + 허리띠
  const belt = part(g.add(new RoundedBoxGeometry(p.torsoW * 1.04, 0.08, p.torsoD * 1.06, 2, 0.03)), toon(c.dark));
  belt.position.y = rig.torso.position.y - p.torsoH * 0.36;
  rig.body.add(belt);
  for (const sx of [-1, 1]) {
    const strap = part(g.add(new RoundedBoxGeometry(0.08, p.torsoH * 0.9, 0.03, 1, 0.012)), toon(c.secondary), { outline: false });
    strap.position.set(sx * p.torsoW * 0.26, rig.torso.position.y, p.torsoD / 2 + 0.005);
    rig.body.add(strap);
  }

  // 리벳 캐논(오른손)
  rig.armR.rotation.set(-0.5, 0, 0.25);
  rig.armL.rotation.set(-0.35, 0, -0.12);
  const gun = new THREE.Group();
  gun.position.copy(rig.handR.position);
  gun.rotation.set(0.5, 0.7, 0);
  const gunBody = part(g.add(new RoundedBoxGeometry(0.22, 0.22, 0.42, 3, 0.06)), toon(c.secondary));
  gunBody.position.z = 0.08;
  gun.add(gunBody);
  const barrel = part(g.add(new THREE.CylinderGeometry(0.1, 0.13, 0.34, 18)), toon(METAL));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.42;
  gun.add(barrel);
  const muzzle = part(g.add(new THREE.TorusGeometry(0.1, 0.03, 8, 18)), toon('#5b6378'));
  muzzle.position.z = 0.6;
  gun.add(muzzle);
  const drum = part(g.add(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 18)), toon(c.accent));
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.14, 0.02, 0.1);
  gun.add(drum);
  rig.armR.add(gun);
  return rig;
}

// ───────────────────────── VOLLEY: 원거리 연사형 저격수 ─────────────────────────
function buildVolley(def: FighterDef, root: THREE.Group, g: GeoBag): Rig {
  const c = def.palette;
  const p: Proportions = {
    torsoW: 0.5, torsoH: 0.6, torsoD: 0.36, headR: 0.35, headLift: 0.9,
    legR: 0.11, legLen: 0.24, legX: 0.13, armR: 0.085, armLen: 0.3, shoeH: 0.12,
  };
  const rig = buildHumanoid(root, g, p, { top: c.primary, legs: c.secondary, shoes: '#1a1a2a', skin: c.skin, hands: '#24304f' });
  const r = p.headR;

  // 허리띠 + 주머니
  const vBelt = part(g.add(new RoundedBoxGeometry(p.torsoW * 1.05, 0.08, p.torsoD * 1.08, 2, 0.03)), toon(c.secondary));
  vBelt.position.y = rig.torso.position.y - p.torsoH * 0.38;
  rig.body.add(vBelt);
  for (const sx of [-1, 1]) {
    const pouch = part(g.add(new RoundedBoxGeometry(0.12, 0.12, 0.08, 2, 0.03)), toon(c.accent));
    pouch.position.set(sx * p.torsoW * 0.32, vBelt.position.y - 0.02, p.torsoD * 0.55);
    rig.body.add(pouch);
  }
  // 목도리
  const scarf = part(g.add(new THREE.TorusGeometry(r * 0.62, 0.07, 10, 22)), toon(c.secondary));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = rig.torso.position.y + p.torsoH / 2 + 0.02;
  rig.body.add(scarf);

  // 머리카락(뒤로 뻗친 뿔 머리)
  const hairMat = toon('#1b2242');
  const hairCap = part(g.add(new THREE.SphereGeometry(r * 1.04, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.45)), hairMat);
  hairCap.rotation.x = -0.35;
  rig.head.add(hairCap);
  const spikeGeo = g.add(new THREE.ConeGeometry(r * 0.32, r * 0.95, 10));
  [
    [0, 0.75, -0.35, -1.0],
    [-0.38, 0.6, -0.4, -1.15],
    [0.38, 0.6, -0.4, -1.15],
  ].forEach(([x, y, z, rx]) => {
    const s = part(spikeGeo, hairMat);
    s.position.set(x * r, y * r, z * r);
    s.rotation.set(rx, 0, -x * 1.2);
    rig.head.add(s);
  });

  // 바이저(눈 대신)
  const visor = part(g.add(new RoundedBoxGeometry(r * 1.75, r * 0.42, r * 0.6, 3, r * 0.15)), toon('#121a36'));
  visor.position.set(0, r * 0.12, r * 0.66);
  rig.head.add(visor);
  const glow = new THREE.Mesh(g.add(new RoundedBoxGeometry(r * 1.45, r * 0.12, 0.02, 1, 0.008)), new THREE.MeshBasicMaterial({ color: c.accent }));
  glow.position.set(0, r * 0.12, r * 0.97);
  rig.head.add(glow);
  // 안테나
  const ant = part(g.add(new THREE.CylinderGeometry(0.015, 0.015, r * 0.9, 6)), toon(METAL));
  ant.position.set(r * 0.92, r * 0.55, -r * 0.1);
  ant.rotation.z = -0.25;
  rig.head.add(ant);
  const antTip = new THREE.Mesh(g.add(new THREE.SphereGeometry(0.05, 10, 8)), new THREE.MeshBasicMaterial({ color: c.accent }));
  antTip.position.set(r * 1.03, r * 1.0, -r * 0.1);
  rig.head.add(antTip);

  // 장총: 가슴 앞에 비스듬히 든다(양손)
  rig.armR.rotation.set(-0.7, 0, -0.45);
  rig.armL.rotation.set(-1.05, 0, 0.75);
  const rifle = new THREE.Group();
  rifle.position.set(0.02, rig.torso.position.y + 0.02, p.torsoD / 2 + 0.17);
  rifle.rotation.set(0.15, 0, 0.75);
  const stock = part(g.add(new RoundedBoxGeometry(0.13, 0.62, 0.11, 2, 0.04)), toon(c.secondary));
  rifle.add(stock);
  const rBarrel = part(g.add(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 10)), toon(METAL));
  rBarrel.position.y = 0.56;
  rifle.add(rBarrel);
  const scope = part(g.add(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 12)), toon('#2b3150'));
  scope.position.set(0, 0.12, 0.1);
  rifle.add(scope);
  const lens = new THREE.Mesh(g.add(new THREE.CircleGeometry(0.035, 12)), new THREE.MeshBasicMaterial({ color: c.accent }));
  lens.rotation.x = -Math.PI / 2;
  lens.position.set(0, 0.245, 0.1);
  rifle.add(lens);
  const muzzle = new THREE.Mesh(g.add(new THREE.SphereGeometry(0.045, 10, 8)), new THREE.MeshBasicMaterial({ color: c.accent }));
  muzzle.position.y = 0.84;
  rifle.add(muzzle);
  rig.body.add(rifle);
  return rig;
}

// ───────────────────────── BOULDER: 근접 탱커 채석장 일꾼 ─────────────────────────
function buildBoulder(def: FighterDef, root: THREE.Group, g: GeoBag): Rig {
  const c = def.palette;
  const p: Proportions = {
    torsoW: 0.98, torsoH: 0.74, torsoD: 0.7, headR: 0.3, headLift: 0.62,
    legR: 0.16, legLen: 0.1, legX: 0.24, armR: 0.13, armLen: 0.3, shoeH: 0.15,
  };
  const rig = buildHumanoid(root, g, p, { top: c.primary, legs: '#4b3b2e', shoes: '#2a2320', skin: c.skin, hands: c.secondary });
  const r = p.headR;

  // 큰 돌 주먹
  rig.handL.scale.setScalar(1.35);
  rig.handR.scale.setScalar(1.35);
  rig.armL.rotation.set(-0.15, 0, -0.32);
  rig.armR.rotation.set(-0.15, 0, 0.32);

  addEyes(rig.head, g, r, { size: 0.19, spread: 0.36, y: 0.02 });
  // 화난 눈썹
  const browGeo = g.add(new RoundedBoxGeometry(r * 0.5, r * 0.13, r * 0.14, 1, r * 0.05));
  for (const sx of [-1, 1]) {
    const brow = part(browGeo, toon(DARK_INK), { outline: false });
    const x = sx * r * 0.34;
    const y = r * 0.3;
    brow.position.set(x, y, onSphere(r * 1.0, x, y));
    brow.rotation.z = sx * -0.38;
    rig.head.add(brow);
  }
  // 안전모
  const hat = part(g.add(new THREE.SphereGeometry(r * 1.08, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.45)), toon(c.accent));
  hat.position.y = r * 0.05;
  rig.head.add(hat);
  const rim = part(g.add(new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.05, 28)), toon(c.accent));
  rim.position.y = r * 0.22;
  rig.head.add(rim);
  const lamp = new THREE.Mesh(g.add(new THREE.CircleGeometry(r * 0.17, 14)), new THREE.MeshBasicMaterial({ color: '#fff6c8' }));
  lamp.position.set(0, r * 0.6, r * 0.93);
  lamp.rotation.x = -0.6;
  rig.head.add(lamp);

  // 돌 어깨 보호대
  const rockGeo = g.add(new THREE.IcosahedronGeometry(0.26, 0));
  for (const sx of [-1, 1]) {
    const rock = part(rockGeo, toon(c.secondary));
    rock.position.set(sx * (p.torsoW / 2 + 0.02), rig.torso.position.y + p.torsoH * 0.38, 0);
    rock.rotation.set(0.4, sx * 0.6, 0.3);
    rock.scale.set(1.1, 0.85, 1);
    rig.body.add(rock);
  }
  // 허리띠 + 버클
  const belt = part(g.add(new RoundedBoxGeometry(p.torsoW * 1.03, 0.11, p.torsoD * 1.04, 2, 0.04)), toon('#3a2a1e'));
  belt.position.y = rig.torso.position.y - p.torsoH * 0.34;
  rig.body.add(belt);
  const buckle = part(g.add(new RoundedBoxGeometry(0.16, 0.12, 0.04, 1, 0.02)), toon(c.accent));
  buckle.position.set(0, belt.position.y, p.torsoD * 0.53);
  rig.body.add(buckle);
  return rig;
}

const BUILDERS: Partial<Record<FighterId, (def: FighterDef, root: THREE.Group, g: GeoBag) => Rig>> = {
  rivet: buildRivet,
  volley: buildVolley,
  boulder: buildBoulder,
};

/** 캐릭터마다 다른 대기 동작 속도 */
const IDLE: Partial<Record<FighterId, { speed: number; bob: number }>> = {
  rivet: { speed: 2.6, bob: 0.025 },
  volley: { speed: 2.0, bob: 0.018 },
  boulder: { speed: 1.6, bob: 0.03 },
};

export function buildFighterModel(def: FighterDef, opts: { shadow?: boolean } = {}): FighterModel {
  const root = new THREE.Group();
  root.name = `fighter:${def.id}`;
  const g = new GeoBag();
  const builder = BUILDERS[def.id] ?? buildRivet;
  const rig = builder(def, root, g);
  if (opts.shadow !== false) root.add(blobShadow(def.id === 'boulder' ? 0.85 : 0.65));

  const baseArmL = rig.armL.rotation.x;
  const baseArmR = rig.armR.rotation.x;
  const idle = IDLE[def.id] ?? { speed: 2.2, bob: 0.02 };
  const phase = Math.random() * Math.PI * 2;
  let celebrateT = -1;
  let moving = false;
  /** 0(서 있음)~1(걷기) 사이를 부드럽게 오간다 */
  let walk = 0;
  let walkPhase = 0;
  let recoil = 0;

  return {
    id: def.id,
    root,
    update(t, dt) {
      walk += ((moving ? 1 : 0) - walk) * Math.min(1, dt * 12);
      if (moving) walkPhase += dt * 13;
      const stride = Math.sin(walkPhase);
      const s = Math.sin(t * idle.speed + phase);
      rig.body.position.y = rig.bodyBaseY + s * idle.bob * (1 - walk) + Math.abs(stride) * 0.06 * walk;
      rig.body.rotation.x = 0.12 * walk;
      rig.legs[0]!.rotation.x = stride * 0.6 * walk;
      rig.legs[1]!.rotation.x = -stride * 0.6 * walk;
      rig.torso.scale.set(1 + s * 0.012, 1 + s * 0.02, 1 + s * 0.012);
      rig.head.rotation.y = Math.sin(t * 0.55 + phase) * 0.14 * (1 - walk);
      rig.head.rotation.z = Math.sin(t * 0.9 + phase) * 0.04;
      rig.armL.rotation.x = baseArmL + Math.sin(t * idle.speed + phase + 0.8) * 0.05 - stride * 0.25 * walk;
      rig.armR.rotation.x = baseArmR + Math.sin(t * idle.speed + phase + 1.6) * 0.04;

      if (recoil > 0) {
        recoil = Math.max(0, recoil - dt * 6);
        rig.body.position.z = -recoil * 0.12;
        rig.armR.rotation.x = baseArmR - recoil * 0.5;
      } else {
        rig.body.position.z = 0;
      }

      if (celebrateT >= 0) {
        celebrateT += dt;
        const d = 0.7;
        const k = Math.min(1, celebrateT / d);
        rig.body.position.y += Math.sin(Math.PI * k) * 0.35;
        rig.body.rotation.y = (1 - Math.pow(1 - k, 3)) * Math.PI * 2;
        if (k >= 1) {
          celebrateT = -1;
          rig.body.rotation.y = 0;
        }
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
      g.dispose();
      root.removeFromParent();
    },
  };
}
