import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../config';
import { getFighter } from '../../data/fighters';
import { getSkin, type SkinEffects } from '../../data/skins';
import type { EntityId, Fighter, SimEvent, SimView, Team, Unit, Vec2 } from '../../game/types';
import type { Grid } from '../../game/world';
import { isVisibleTo } from '../../game/visibility';
import { buildFighterModel, type FighterModel } from '../fighterModel';
import { addStandardLights, toon } from '../toon';
import { MapRenderer } from '../world/mapRenderer';
import { buildDummyModel, type DummyModel } from './dummyModel';
import { ChainLine, ChainSprite, burstTexture, type ChainPath } from './chainFx';
import { BALL_FRICTION, BALL_KICK_SPEED, BALL_POWER_KICK_SPEED, BALL_STOP_SPEED, CHAIN_HAND_SPREAD, LOB_MIN_DIST } from '../../game/rules';

/**
 * 전투 화면의 3D 표현. Lead 담당.
 * 시뮬레이션(평면 x, y)을 3D(x, 0, z=y)로 옮겨 그린다. 틱 사이는 보간한다.
 */

const MODEL_SCALE = 0.85;
/** 발밑 팀 표시 원: 나 / 아군 / 적 */
const TEAM_RING = { me: '#3ec8ff', ally: '#4f8bff', enemy: '#ff4f5e' };
const CAM_PITCH = THREE.MathUtils.degToRad(56);
const CAM_DIST = 17;
const LOB_HEIGHT = 2.6;

interface UnitVisual {
  unit: Unit;
  model: FighterModel | DummyModel;
  prev: Vec2;
  curr: Vec2;
  facingPrev: number;
  facingCurr: number;
  hidden: boolean;
}

interface ShotVisual {
  obj: THREE.Group;
  prev: Vec2;
  curr: Vec2;
  /** 사슬 투사체(Chainer E·R): 쏜 사람 손에서 탄 머리까지 이어지는 사슬 */
  chain?: ChainPath;
  ownerId?: EntityId;
}

/** 투사체 몸통 색(카툰 명암을 받는다). 빛 테두리·꼬리는 이 색을 흰색 쪽으로 섞은 밝은 색 */
const SHOT_COLOR: Record<string, string> = {
  rivet: '#ee5a00',
  volley: '#1554e0',
  boulder: '#4d5270',
  hinako: '#ec2a7c',
  dummy: '#cf1d2c',
  /** 우리 팀 탄환(캐릭터와 상관없이) */
  ally: '#1e63f0',
  /** 상대 팀 탄환(캐릭터와 상관없이) */
  enemy: '#e01b2b',
};

/** 가로(u) 방향으로 앞→뒤 투명해지고, 세로(v) 가장자리가 부드러운 꼬리 텍스처 */
function trailTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 32;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = Math.abs(y / (h - 1) - 0.5) * 2; // 0 가운데 ~ 1 가장자리
    const edge = Math.max(0, 1 - v * v);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1); // 0 탄 쪽 ~ 1 꼬리 끝
      const a = Math.pow(1 - u, 1.6) * edge;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 부드러운 원형 그림자 텍스처 */
function softDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** 앞(x=0)에서 뒤(x=-len)로 가늘어지는 평평한 꼬리 띠(XZ 평면) */
function trailGeometry(len: number, w0: number, w1: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([0, 0, -w0 / 2, 0, 0, w0 / 2, -len, 0, -w1 / 2, -len, 0, w1 / 2]);
  const uv = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  return geo;
}

interface Effect {
  obj: THREE.Object3D;
  age: number;
  dur: number;
  step(k: number): void;
  dispose(): void;
}

/** 조준 표시: 누구의 어떤 공격을 어느 방향으로 (aim 길이 0~1 = 사거리 비율) */
export interface AimSpec {
  unitId: EntityId;
  which: 'attack' | 'super';
  aim: Vec2;
  superSourceId?: Fighter['fighterId'];
  range?: number;
  kindOverride?: 'dash' | 'chain' | 'melee';
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
/** 평면 각도 → 모델 y 회전(모델 정면 +z) */
const yawOf = (facing: number) => Math.PI / 2 - facing;

export class BattleView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  private readonly grid: Grid;
  private readonly map: MapRenderer;
  private readonly units = new Map<EntityId, UnitVisual>();
  private readonly shots = new Map<EntityId, ShotVisual>();
  private readonly lobs = new Map<EntityId, { shell: THREE.Mesh; marker: THREE.Mesh; from: Vec2; to: Vec2; start: number; end: number; land?: number; slam?: boolean; chains?: ChainPath[]; ownerId?: EntityId; color?: string; radius?: number }>();
  private readonly chainMats = new Map<string, THREE.MeshBasicMaterial>();
  private effects: Effect[] = [];
  private readonly shotGeo = new THREE.SphereGeometry(0.22, 14, 10);
  private readonly shotKits = new Map<boolean, { core: THREE.BufferGeometry; halo: THREE.BufferGeometry; trail: THREE.BufferGeometry; shadow: THREE.BufferGeometry; r: number }>();
  private readonly trailTex = trailTexture();
  private readonly dotTex = softDotTexture();
  private readonly shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', map: this.dotTex, transparent: true, opacity: 0.32, depthWrite: false });
  private readonly glowMats = new Map<string, { halo: THREE.MeshBasicMaterial; trail: THREE.MeshBasicMaterial }>();
  private dustTimer = 0;
  /** 지대(SHARD 서리 지대 등): 서리 원판 + 팀 색 테두리 */
  private readonly zones = new Map<EntityId, THREE.Group>();
  /** 크리스탈 러시: 바닥의 크리스탈(오리지널 디자인: 깎인 보석 + 바닥 빛 고리) */
  private readonly crystals = new Map<EntityId, THREE.Group>();
  /** 파이터 볼의 공(모델, 이전/현재 위치, 들고 있는 사람) */
  private ballView: { root: THREE.Group; prev: Vec2; curr: Vec2; carrierId: EntityId | null; spin: number } | null = null;
  private readonly crystalGeo = new THREE.OctahedronGeometry(0.32, 0).scale(0.8, 1.25, 0.8);
  private readonly crystalMat = new THREE.MeshToonMaterial({ color: '#b46cff', emissive: new THREE.Color('#5a1fa8'), emissiveIntensity: 0.5 });
  private readonly crystalRingGeo = new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2);
  private readonly crystalRingMat = new THREE.MeshBasicMaterial({ color: '#e2c6ff', transparent: true, opacity: 0.6, depthWrite: false });
  private readonly camTarget = new THREE.Vector3();
  private camInit = false;
  private w = 1;
  private h = 1;
  private simTick = 0;
  private aim: AimSpec | null = null;
  private readonly aimRoot = new THREE.Group();
  private readonly aimShapes = new Map<string, THREE.Object3D>();
  private readonly ballAimGroup = new THREE.Group();
  private readonly ballAimLineGeo = new THREE.PlaneGeometry(1, 0.12).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  private readonly ballAimLineMat = new THREE.MeshBasicMaterial({ color: '#79e8ff', transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide });
  private readonly ballAimEndGeo = new THREE.RingGeometry(0.2, 0.28, 24).rotateX(-Math.PI / 2);
  private readonly ballAimEndMat = new THREE.MeshBasicMaterial({ color: '#79e8ff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  private readonly ballAimDotGeo = new THREE.CircleGeometry(0.055, 8).rotateX(-Math.PI / 2);
  private readonly ballAimDots: THREE.Mesh[] = [];
  private readonly ballAimDotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  private readonly ballHaloGeo = new THREE.TorusGeometry(0.53, 0.055, 8, 32);
  private readonly ballHaloMat = new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.9, depthWrite: false });
  private readonly raycaster = new THREE.Raycaster();
  readonly followId: EntityId;
  /** 보는 사람의 팀(발밑 원·탄환 색 기준) */
  private myTeam: Team = 0;

  /** 유닛이 입은 스킨(세션이 첫 snapshot 전에 정한다) */
  skinOf: (id: EntityId) => string | undefined = () => undefined;

  /** viewerTeam: 보는 사람의 팀(바닥 출발 지점 색. 발밑 원·탄환은 sim에서 다시 읽는다) */
  constructor(grid: Grid, followId: EntityId, viewerTeam: Team = 0) {
    this.myTeam = viewerTeam;
    this.grid = grid;
    this.followId = followId;
    this.scene.background = new THREE.Color('#1c2a52');
    addStandardLights(this.scene);
    this.map = new MapRenderer(grid, viewerTeam);
    const line = new THREE.Mesh(this.ballAimLineGeo, this.ballAimLineMat);
    line.position.y = 0.09;
    line.renderOrder = 5;
    const end = new THREE.Mesh(this.ballAimEndGeo, this.ballAimEndMat);
    end.name = 'ball-aim-end';
    end.position.y = 0.1;
    end.renderOrder = 6;
    this.ballAimGroup.add(line, end);
    for (let i = 0; i < 14; i++) {
      const dot = new THREE.Mesh(this.ballAimDotGeo, this.ballAimDotMat);
      dot.position.y = 0.11;
      dot.renderOrder = 7;
      this.ballAimDots.push(dot);
      this.ballAimGroup.add(dot);
    }
    this.ballAimGroup.visible = false;
    this.aimRoot.add(this.ballAimGroup);
    this.scene.add(this.map.object, this.aimRoot);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  // ───────────── 시뮬레이션 → 화면 ─────────────

  /** 시뮬레이션이 한 틱 진행한 직후 호출: 이전/현재 상태를 기록한다 */
  snapshot(sim: SimView) {
    this.simTick = sim.tick;
    // 내 팀은 sim에서 바로 읽는다(위쪽 팀이면 내 모델이 팀원보다 늦게 만들어진다)
    this.myTeam = sim.getUnit(this.followId)?.team ?? this.myTeam;
    const seen = new Set<EntityId>();
    for (const u of sim.units) {
      seen.add(u.id);
      let v = this.units.get(u.id);
      if (!v) {
        const model = u.type === 'fighter' ? buildFighterModel(getFighter(u.fighterId), { skin: this.skinOf(u.id) }) : buildDummyModel(u.behavior);
        model.root.scale.setScalar(MODEL_SCALE);
        model.root.userData.unitId = u.id;
        if (u.type === 'fighter') model.root.add(this.teamRing(u));
        this.scene.add(model.root);
        v = { unit: u, model, prev: { ...u.pos }, curr: { ...u.pos }, facingPrev: u.facing, facingCurr: u.facing, hidden: false };
        this.units.set(u.id, v);
      }
      v.unit = u;
      // 순간이동(부활 등)은 보간하지 않는다
      const jump = Math.hypot(u.pos.x - v.curr.x, u.pos.y - v.curr.y) > 2;
      v.prev = jump ? { ...u.pos } : v.curr;
      v.curr = { ...u.pos };
      v.facingPrev = v.facingCurr;
      v.facingCurr = u.facing;
      v.model.setMoving(u.type === 'fighter' ? u.moving : false);
      v.hidden = !u.alive || this.hiddenFromViewer(sim, u);
    }
    for (const [id, v] of this.units) {
      if (!seen.has(id)) {
        v.model.dispose();
        this.units.delete(id);
      }
    }

    const shotSeen = new Set<EntityId>();
    for (const p of sim.projectiles) {
      shotSeen.add(p.id);
      let s = this.shots.get(p.id);
      if (!s) {
        const owner = sim.getUnit(p.ownerId);
        const isChainShot = !!(p.chainSkill || p.stealsSuper);
        const fxSuper = p.isSuper ? this.skinFx(p.ownerId)?.superShot : undefined;
        const skinChain = isChainShot && !!this.skinFx(p.ownerId)?.chain;
        const obj = skinChain ? new THREE.Group() : isChainShot ? this.buildChainHead(owner) : fxSuper ? this.buildFxShot(owner, fxSuper) : this.buildShot(owner, p.isSuper);
        obj.rotation.y = -Math.atan2(p.vel.y, p.vel.x);
        // 넓은 탄(REAPER 궁극기 등): 판정 반지름에 맞춰 키운다
        const base = p.isSuper ? 0.24 : 0.18;
        if (p.radius > base + 0.01) obj.scale.setScalar(p.radius / base);
        this.scene.add(obj);
        s = { obj, prev: { ...p.pos }, curr: { ...p.pos } };
        if (isChainShot) {
          s.chain = this.makeChain(p.ownerId, this.shotColor(owner), 1, 0.45);
          s.ownerId = p.ownerId;
          this.scene.add(s.chain.mesh);
        }
        this.shots.set(p.id, s);
      } else {
        s.prev = s.curr;
        s.curr = { ...p.pos };
      }
    }
    for (const [id, s] of this.shots) {
      if (!shotSeen.has(id)) {
        s.chain?.dispose();
        s.obj.removeFromParent();
        this.shots.delete(id);
      }
    }

    const crySeen = new Set<EntityId>();
    this.syncBall(sim);
    for (const c of sim.crystals ?? []) {
      crySeen.add(c.id);
      if (!this.crystals.has(c.id)) {
        const g = new THREE.Group();
        const gem = new THREE.Mesh(this.crystalGeo, this.crystalMat);
        gem.name = 'gem';
        const ring = new THREE.Mesh(this.crystalRingGeo, this.crystalRingMat);
        ring.position.y = 0.03;
        g.add(gem, ring);
        g.position.set(c.pos.x, 0, c.pos.y);
        g.userData.phase = (c.id * 0.7) % (Math.PI * 2);
        this.scene.add(g);
        this.crystals.set(c.id, g);
      } else {
        this.crystals.get(c.id)!.position.set(c.pos.x, 0, c.pos.y);
      }
    }
    for (const [id, g] of this.crystals) {
      if (!crySeen.has(id)) {
        g.removeFromParent();
        this.crystals.delete(id);
      }
    }

    const zoneSeen = new Set<EntityId>();
    const myTeam = sim.getUnit(this.followId)?.team ?? 0;
    for (const z of sim.zones ?? []) {
      zoneSeen.add(z.id);
      if (this.zones.has(z.id)) continue;
      const g = new THREE.Group();
      const fillMat = new THREE.MeshBasicMaterial({ color: '#bff3ff', transparent: true, opacity: 0.35, depthWrite: false });
      const fill = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 40).rotateX(-Math.PI / 2), fillMat);
      const ringMat = new THREE.MeshBasicMaterial({ color: z.team === myTeam ? SHOT_COLOR.ally! : SHOT_COLOR.enemy!, transparent: true, opacity: 0.8, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.radius - 0.12, z.radius, 48).rotateX(-Math.PI / 2), ringMat);
      fill.position.y = 0.04;
      ring.position.y = 0.05;
      g.add(fill, ring);
      // 서리 결정 몇 개
      for (let i = 0; i < 6; i++) {
        const a2 = (i / 6) * Math.PI * 2;
        const m = new THREE.Mesh(this.crystalGeo, this.crystalRingMat);
        m.scale.setScalar(0.45);
        m.position.set(Math.cos(a2) * z.radius * 0.55, 0.2, Math.sin(a2) * z.radius * 0.55);
        g.add(m);
      }
      g.position.set(z.pos.x, 0, z.pos.y);
      this.scene.add(g);
      this.zones.set(z.id, g);
    }
    for (const [id, g] of this.zones) {
      if (zoneSeen.has(id)) continue;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry !== this.crystalGeo) m.geometry.dispose();
      });
      g.removeFromParent();
      this.zones.delete(id);
    }

    const lobSeen = new Set<EntityId>();
    for (const l of sim.lobs) {
      lobSeen.add(l.id);
      if (!this.lobs.has(l.id)) {
        const owner = sim.getUnit(l.ownerId);
        const baseColor = this.shotColor(owner);
        const shellMat = new THREE.MeshToonMaterial({ color: baseColor });
        const shell = new THREE.Mesh(this.shotGeo, shellMat);
        const shellGlow = new THREE.Mesh(this.shotGeo, this.glow(baseColor).halo);
        shellGlow.scale.setScalar(1.4);
        shell.add(shellGlow);
        shell.scale.setScalar(1.1);
        shell.visible = !l.slam; // 사슬 내려치기는 날아가는 구슬이 없다(사슬이 뻗어 내리친다)
        // 사슬 내려치기는 폭탄이 아니라 공격이라 경고 원도 팀 색(우리 파랑 / 상대 빨강)
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0.1, l.aoeRadius - 0.08), l.aoeRadius, 40),
          new THREE.MeshBasicMaterial({ color: l.slam ? baseColor : '#ff5a5a', transparent: true, opacity: 0.55, depthWrite: false }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(l.to.x, 0.04, l.to.y);
        this.scene.add(shell, marker);
        shell.userData.baseColor = baseColor;
        let chains: ChainPath[] | undefined;
        if (l.slam) {
          chains = [this.makeChain(l.ownerId, baseColor, 0.95), this.makeChain(l.ownerId, baseColor, 0.95)];
          for (const c of chains) this.scene.add(c.mesh);
        }
        this.lobs.set(l.id, {
          shell, marker, from: l.from, to: l.to, start: l.startTick, end: l.endTick, land: l.landTick,
          ...(l.slam ? { slam: true, chains, ownerId: l.ownerId, color: baseColor, radius: l.aoeRadius } : {}),
        });
      }
    }
    for (const [id, l] of this.lobs) {
      if (!lobSeen.has(id)) {
        if (l.slam) this.slamImpact(l.to, l.color ?? '#ff4b4b', l.radius ?? 1, l.ownerId);
        for (const c of l.chains ?? []) c.dispose();
        l.shell.removeFromParent();
        l.marker.removeFromParent();
        l.marker.geometry.dispose();
        (l.marker.material as THREE.Material).dispose();
        (l.shell.material as THREE.Material).dispose();
        this.lobs.delete(id);
      }
    }
  }

  /** 내 팀에게 보이지 않는 유닛(수풀 속 적 등). 규칙은 src/game/visibility.ts */
  private hiddenFromViewer(sim: SimView, u: Unit): boolean {
    const me = sim.getUnit(this.followId);
    return me ? !isVisibleTo(sim, u, me.team) : false;
  }

  /** 발밑 팀 색 원(모델 크기에 맞춰 함께 커진다) */
  private teamRing(u: Unit): THREE.Mesh {
    // 보는 사람 기준: 나 / 같은 팀 / 상대 팀
    const color = u.id === this.followId ? TEAM_RING.me : u.team === this.myTeam ? TEAM_RING.ally : TEAM_RING.enemy;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.renderOrder = -1;
    return ring;
  }

  private shotColor(owner: Unit | undefined): string {
    if (!owner) return SHOT_COLOR.enemy!;
    // 규칙: 우리 팀 탄환은 무조건 파란색, 상대 팀은 무조건 빨간색(CLAUDE.md)
    return owner.team === this.myTeam ? SHOT_COLOR.ally! : SHOT_COLOR.enemy!;
  }

  /** 몸통 재질(카툰 명암) */
  private shotMaterial(owner: Unit | undefined, _isSuper: boolean): THREE.Material {
    return toon(this.shotColor(owner));
  }

  private glow(color: string) {
    let g = this.glowMats.get(color);
    if (!g) {
      const light = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45);
      g = {
        halo: new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0.5, depthWrite: false }),
        trail: new THREE.MeshBasicMaterial({ color: light, map: this.trailTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      };
      this.glowMats.set(color, g);
    }
    return g;
  }

  /**
   * 투사체: 카툰 명암을 받는 둥근 탄 + 밝은 반투명 빛 테두리 + 뒤로 흐려지는 꼬리 + 흐릿한 바닥 그림자.
   * 로컬 +x가 진행 방향(그룹을 y축으로 돌려서 맞춘다).
   */
  private buildShot(owner: Unit | undefined, isSuper: boolean): THREE.Group {
    let kit = this.shotKits.get(isSuper);
    if (!kit) {
      const r = isSuper ? 0.25 : 0.19;
      const len = isSuper ? 0.42 : 0.3;
      const core = new THREE.CapsuleGeometry(r, len, 6, 14).rotateZ(Math.PI / 2);
      const halo = new THREE.CapsuleGeometry(r * 1.45, len * 1.1, 6, 14).rotateZ(Math.PI / 2);
      const trailLen = isSuper ? 2.0 : 1.5;
      const trail = trailGeometry(trailLen, r * 2.3, r * 0.5).translate(-len / 2, 0, 0);
      const shadow = new THREE.PlaneGeometry(len + r * 3, r * 2.6).rotateX(-Math.PI / 2);
      kit = { core, halo, trail, shadow, r };
      this.shotKits.set(isSuper, kit);
    }
    const color = this.shotColor(owner);
    const glow = this.glow(color);
    const g = new THREE.Group();
    const trail = new THREE.Mesh(kit.trail, glow.trail);
    trail.renderOrder = 1;
    const halo = new THREE.Mesh(kit.halo, glow.halo);
    halo.renderOrder = 2;
    const core = new THREE.Mesh(kit.core, this.shotMaterial(owner, isSuper));
    core.renderOrder = 3;
    const shadow = new THREE.Mesh(kit.shadow, this.shadowMat);
    shadow.position.y = -0.56;
    g.add(shadow, trail, halo, core);
    return g;
  }

  applyEvents(events: readonly SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'attack': {
          const v = this.units.get(e.unitId);
          v?.model.attack();
          const trail = this.skinFx(e.unitId)?.trail;
          if (trail && v && v.unit.type === 'fighter') {
            const spec = e.isSuper ? getFighter(v.unit.fighterId).super : getFighter(v.unit.fighterId).attack;
            if (spec.kind === 'dash') this.fxTrail(trail, this.shotColor(v.unit), v.curr, e.dir, spec.range);
          }
          break;
        }
        case 'hit': {
          const v = this.units.get(e.targetId);
          if (v && 'hit' in v.model) v.model.hit();
          const hitFx = this.skinFx(e.sourceId)?.hit;
          if (hitFx) this.fxHit(hitFx, this.shotColor(this.units.get(e.sourceId)?.unit), e.pos, e.isSuper);
          const color = e.targetId === this.followId ? '#ff3658' : e.sourceId === this.followId ? '#ffe14d' : e.isSuper ? '#ff9d37' : '#ffffff';
          this.hitImpact(e.pos, color, e.targetId === this.followId ? 0.9 : e.sourceId === this.followId ? 0.82 : e.isSuper ? 0.65 : 0.5);
          break;
        }
        case 'death':
          this.puff(e.pos);
          break;
        case 'crystalPickup': {
          const v = this.units.get(e.unitId);
          if (v) this.spark({ x: v.model.root.position.x, y: v.model.root.position.z }, '#d9a8ff', 0.6);
          break;
        }
        case 'crystalDrop':
          this.ring(e.pos, 1.2, '#c48bff');
          break;
        case 'ballPickup': {
          const v = this.units.get(e.unitId);
          const pos = v ? { x: v.model.root.position.x, y: v.model.root.position.z } : { x: 0, y: 0 };
          this.ring(pos, 1.8, '#ffe14d');
          this.ring(pos, 1.05, '#ffffff');
          this.spark({ x: pos.x, y: pos.y }, '#fff4aa', 0.9);
          break;
        }
        case 'explode':
          this.ring(e.pos, e.radius, e.isSuper ? '#ffe14d' : '#ff9a3c');
          break;
        case 'melee': {
          // Chainer 패시브(주변 360도 원형 타격)는 사슬을 휘두르는 회오리, 그 밖은 부채꼴 휘두르기
          const u = this.units.get(e.unitId)?.unit;
          const fx = this.skinFx(e.unitId);
          if (e.spreadDeg >= 360 && u?.type === 'fighter' && getFighter(u.fighterId).chainKit) {
            if (fx?.whirl) this.whirlImage(e.unitId, e.range, fx.whirl);
            else this.chainWhirl(e.unitId, e.range);
          } else if (e.at && fx?.wave) this.waveImage(e.at, this.shotColor(this.units.get(e.unitId)?.unit), fx.wave);
          else this.arc(e.unitId, e.dir, e.range, e.spreadDeg);
          break;
        }
        case 'wallsBroken':
          for (const t of e.tiles) this.debris({ x: t.x + 0.5, y: t.y + 0.5 });
          break;
        case 'projectileEnd':
          if (e.reason === 'wall') this.spark(e.pos, '#d9c7a0', 0.3);
          break;
        default:
          break;
      }
    }
  }

  /** 공: 처음 보이면 만들고, 위치·들고 있는 사람을 기록한다 */
  private syncBall(sim: SimView) {
    const b = sim.ball;
    if (!b) {
      if (this.ballView) {
        this.ballView.root.removeFromParent();
        this.ballView = null;
      }
      return;
    }
    if (!this.ballView) {
      const root = new THREE.Group();
      root.name = 'ball';
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshToonMaterial({ color: '#ffffff' }));
      body.name = 'ball-body';
      // 공 무늬(어두운 띠 두 줄) + 외곽선
      for (const rot of [0, Math.PI / 2]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: '#2b2f6b' }));
        band.rotation.y = rot;
        body.add(band);
      }
      const outline = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 14), new THREE.MeshBasicMaterial({ color: '#1a1530', side: THREE.BackSide }));
      body.add(outline);
      root.add(body);
      const halo = new THREE.Mesh(this.ballHaloGeo, this.ballHaloMat);
      halo.name = 'ball-halo';
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.08;
      halo.visible = false;
      root.add(halo);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      shadow.name = 'ball-shadow';
      root.add(shadow);
      this.scene.add(root);
      this.ballView = { root, prev: { ...b.pos }, curr: { ...b.pos }, carrierId: b.carrierId, spin: 0 };
    }
    const v = this.ballView;
    const jumped = Math.hypot(b.pos.x - v.curr.x, b.pos.y - v.curr.y) > 3; // 킥오프로 가운데 돌아감
    v.prev = jumped ? { ...b.pos } : v.curr;
    v.curr = { ...b.pos };
    v.carrierId = b.carrierId;
  }

  // ───────────── 매 프레임 ─────────────

  /** alpha: 이전 틱→현재 틱 사이 진행률(0~1) */
  frame(t: number, dt: number, alpha: number) {
    const tickF = this.simTick + alpha;
    for (const v of this.units.values()) {
      const x = lerp(v.prev.x, v.curr.x, alpha);
      const y = lerp(v.prev.y, v.curr.y, alpha);
      let h = 0;
      const act = v.unit.type === 'fighter' ? v.unit.action : null;
      if (act?.kind === 'leap') {
        const k = Math.min(1, Math.max(0, (tickF - act.startTick) / Math.max(1, act.endTick - act.startTick)));
        const dist = Math.hypot(act.to.x - act.from.x, act.to.y - act.from.y);
        h = 4 * (0.8 + dist * 0.18) * k * (1 - k);
      }
      v.model.root.position.set(x, h, y);
      v.model.root.rotation.y = yawOf(lerpAngle(v.facingPrev, v.facingCurr, Math.min(1, alpha * 1.5)));
      v.model.root.visible = !v.hidden;
      v.model.update(t, dt);
    }
    for (const s of this.shots.values()) {
      s.obj.position.set(lerp(s.prev.x, s.curr.x, alpha), 0.6, lerp(s.prev.y, s.curr.y, alpha));
      if (s.chain) {
        const owner = s.ownerId !== undefined ? this.units.get(s.ownerId) : undefined;
        const o = owner ? owner.model.root.position : s.obj.position;
        const to = s.obj.position;
        const dx = to.x - o.x;
        const dz = to.z - o.z;
        const dl = Math.max(0.001, Math.hypot(dx, dz));
        s.chain.setPath({ x: o.x + (dx / dl) * 0.3, y: 0.6, z: o.z + (dz / dl) * 0.3 }, { x: to.x, y: 0.6, z: to.z }, 1);
      }
    }
    for (const l of this.lobs.values()) {
      if (l.slam) {
        // 양손에서 직선으로 뻗은 사슬 두 가닥이 조준 지점에서 만난다(처음 0.17초 동안 뻗고, 터질 때까지 팽팽). 원은 점점 진해진다
        const k = Math.min(1, Math.max(0, (tickF - l.start) / Math.max(1, l.end - l.start)));
        (l.marker.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.5 * k;
        const owner = l.ownerId !== undefined ? this.units.get(l.ownerId) : undefined;
        const op = owner ? owner.model.root.position : { x: l.from.x, z: l.from.y };
        const dirX = l.to.x - op.x;
        const dirZ = l.to.y - op.z;
        const dl = Math.max(0.001, Math.hypot(dirX, dirZ));
        const px = -dirZ / dl;
        const pz = dirX / dl;
        const reach = 1 - Math.pow(1 - Math.min(1, (tickF - l.start) / 5), 3);
        (l.chains ?? []).forEach((c, i) => {
          const side = i === 0 ? 1 : -1;
          c.setPath({ x: op.x + px * CHAIN_HAND_SPREAD * side, y: 0.55, z: op.z + pz * CHAIN_HAND_SPREAD * side }, { x: l.to.x, y: 0.3, z: l.to.y }, reach);
        });
        continue;
      }
      const total = Math.max(1, l.end - l.start);
      const dist = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y);
      // 짧게 던지는 폭탄(점프 폭탄 등)은 0.3초 만에 떨어져 바닥에서 깜빡이다 터진다. 긴 포물선은 끝까지 날아간다.
      // landTick이 있으면(FUSE 등) 그때 떨어져 터질 때까지 깜빡인다
      const flight = l.land !== undefined ? Math.max(1, l.land - l.start) : dist < 2 ? Math.min(total, 9) : total;
      const e = tickF - l.start;
      const k = Math.min(1, Math.max(0, e / flight));
      const height = dist < 2 ? 1.2 : LOB_HEIGHT;
      l.shell.position.set(lerp(l.from.x, l.to.x, k), 0.3 + 4 * height * k * (1 - k), lerp(l.from.y, l.to.y, k));
      if (k >= 1) {
        const left = Math.max(0, (l.end - tickF) / 30);
        const freq = left > 1 ? 3 : left > 0.4 ? 7 : 14;
        const on = Math.sin(t * freq * Math.PI * 2) > 0;
        (l.shell.material as THREE.MeshToonMaterial).color.set(on ? '#ffffff' : this.shotColorFromMarker(l));
        l.shell.scale.setScalar(1.1 + (on ? 0.15 : 0));
      }
    }
    for (const g of this.zones.values()) g.rotation.y = t * 0.3;
    if (this.ballView) {
      const bv = this.ballView;
      const body = bv.root.getObjectByName('ball-body')!;
      const carrier = bv.carrierId !== null ? this.units.get(bv.carrierId) : undefined;
      if (carrier && !carrier.hidden) {
        // 든 사람 앞쪽 발밑에 붙인다(바라보는 방향)
        const p = carrier.model.root.position;
        const yaw = carrier.model.root.rotation.y;
        bv.root.position.set(p.x + Math.sin(yaw) * 0.55, 0, p.z + Math.cos(yaw) * 0.55);
        body.position.y = 0.32 + Math.abs(Math.sin(t * 9)) * 0.08;
        body.scale.setScalar(1.12 + 0.06 * (0.5 + 0.5 * Math.sin(t * 8)));
        const halo = bv.root.getObjectByName('ball-halo') as THREE.Mesh | undefined;
        if (halo) {
          halo.visible = true;
          halo.rotation.y = t * 1.8;
          halo.scale.setScalar(1 + 0.12 * Math.sin(t * 8));
          this.ballHaloMat.opacity = 0.72 + 0.2 * (0.5 + 0.5 * Math.sin(t * 8));
        }
      } else {
        const x = lerp(bv.prev.x, bv.curr.x, alpha);
        const y = lerp(bv.prev.y, bv.curr.y, alpha);
        const moved = Math.hypot(x - bv.root.position.x, y - bv.root.position.z);
        bv.spin += moved / 0.3;
        bv.root.position.set(x, 0, y);
        body.position.y = 0.3;
        body.scale.setScalar(1);
        body.rotation.x = bv.spin;
        const halo = bv.root.getObjectByName('ball-halo') as THREE.Mesh | undefined;
        if (halo) halo.visible = false;
      }
      bv.root.visible = !carrier?.hidden;
    }
    for (const g of this.crystals.values()) {
      const gem = g.getObjectByName('gem')!;
      const ph = g.userData.phase as number;
      gem.position.y = 0.6 + Math.sin(t * 2.4 + ph) * 0.1;
      gem.rotation.y = t * 1.6 + ph;
    }
    // 돌진 중이면 발밑에서 먼지
    this.dustTimer -= dt;
    if (this.dustTimer <= 0) {
      this.dustTimer = 0.07;
      for (const v of this.units.values()) {
        if (v.unit.type === 'fighter' && v.unit.action?.kind === 'dash') {
          this.dust({ x: v.model.root.position.x, y: v.model.root.position.z });
        }
      }
    }
    this.effects = this.effects.filter((e) => {
      e.age += dt;
      const k = Math.min(1, e.age / e.dur);
      e.step(k);
      if (k >= 1) {
        e.dispose();
        return false;
      }
      return true;
    });

    const me = this.units.get(this.followId);
    const focus = me ? me.model.root.position : new THREE.Vector3(this.grid.width / 2, 0, this.grid.height / 2);
    this.updateAim(me);
    this.map.update(t, dt, me ? { x: focus.x, y: focus.z } : null);
    this.updateCamera(focus, dt);
  }

  private updateCamera(focus: THREE.Vector3, dt: number) {
    // 맵 가장자리 밖을 너무 많이 보여주지 않도록 초점을 제한한다
    const halfH = CAM_DIST * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * (this.w / this.h);
    const clamp = (v: number, size: number, half: number, margin: number) =>
      size <= half * 2 - margin * 2 ? size / 2 : Math.min(Math.max(v, half - margin), size - half + margin);
    const tx = clamp(focus.x, this.grid.width, halfW * 0.9, 1);
    const tz = clamp(focus.z, this.grid.height, halfH * 0.75, 1.5);
    const goal = new THREE.Vector3(tx, 0, tz);
    if (!this.camInit) {
      this.camTarget.copy(goal);
      this.camInit = true;
    } else {
      this.camTarget.lerp(goal, 1 - Math.exp(-dt * 8));
    }
    this.camera.position.set(
      this.camTarget.x,
      CAM_DIST * Math.sin(CAM_PITCH),
      this.camTarget.z + CAM_DIST * Math.cos(CAM_PITCH),
    );
    this.camera.lookAt(this.camTarget);
  }

  // ───────────── 조준 표시 ─────────────

  setAim(spec: AimSpec | null) {
    this.aim = spec;
  }

  private aimShape(fighterId: string, which: 'attack' | 'super', rangeOverride?: number, kindOverride?: AimSpec['kindOverride']): THREE.Object3D {
    const key = `${fighterId}|${which}|${rangeOverride ?? ''}|${kindOverride ?? ''}|${this.skinOf(this.followId) ?? ''}`;
    let obj = this.aimShapes.get(key);
    if (obj) return obj;
    const def = getFighter(fighterId as Fighter['fighterId']);
    const sourceDef = which === 'super' && this.aim?.superSourceId ? getFighter(this.aim.superSourceId) : def;
    const d = which === 'attack' ? def.attack : sourceDef.super;
    // 사슬 내려치기(Chainer Q)는 직선이 아니라 조준 지점의 원
    const slamRadius = which === 'attack' && !kindOverride && 'chainSlam' in d && d.chainSlam ? d.chainSlam.radius : 0;
    const kind = slamRadius ? 'lob' : (kindOverride ?? d.kind);
    const range = rangeOverride ?? d.range;
    const color = which === 'attack' ? '#ffffff' : '#ffd23f';
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const flat = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      group.add(m);
      return m;
    };
    switch (kind) {
      case 'spread':
      case 'melee': {
        const spread = THREE.MathUtils.degToRad(kindOverride === 'melee' ? 360 : Math.max(8, d.spreadDeg));
        // 로컬 +x 방향을 중심으로 한 부채꼴 (평면 → 회전 후 월드 +x)
        flat(new THREE.CircleGeometry(range, 40, -spread / 2, spread));
        break;
      }
      case 'burst':
      case 'dash': {
        const width = kind === 'dash' ? 0.9 : 0.35;
        const geo = new THREE.PlaneGeometry(range, width);
        geo.translate(range / 2, 0, 0);
        flat(geo);
        break;
      }
      case 'chain':
      case 'steal': {
        const geo = new THREE.PlaneGeometry(range, 0.35);
        geo.translate(range / 2, 0, 0);
        flat(geo);
        break;
      }
      case 'radial':
        flat(new THREE.CircleGeometry(range, 48));
        break;
      case 'lob': {
        const r = slamRadius || ('aoeRadius' in d && d.aoeRadius) || 1.5;
        const target = flat(new THREE.CircleGeometry(r, 40));
        target.name = 'lobTarget';
        if (slamRadius) {
          // 사슬 내려치기: 목표 원 + 양손에서 뻗어 조준 지점에서 만나는 직선 사슬 두 가닥(위치는 setAim이 매 프레임 갱신)
          flat(new THREE.RingGeometry(r - 0.07, r, 40));
          const chains = [this.makeChain(this.followId, SHOT_COLOR.ally!, 0.75), this.makeChain(this.followId, SHOT_COLOR.ally!, 0.75)]; // 내 조준이라 우리 팀 파랑
          for (const c of chains) group.add(c.mesh);
          group.userData.chains = chains;
          group.userData.slam = true;
        }
        break;
      }
      case 'leap': {
        flat(new THREE.CircleGeometry(0.7, 32));
        flat(new THREE.RingGeometry(0.8, 0.95, 32));
        break;
      }
    }
    obj = group;
    obj.position.y = 0.03;
    obj.userData.kind = kind;
    obj.userData.range = range;
    this.aimRoot.add(obj);
    this.aimShapes.set(key, obj);
    return obj;
  }

  private updateAim(me: UnitVisual | undefined) {
    for (const o of this.aimShapes.values()) o.visible = false;
    this.ballAimGroup.visible = false;
    const a = this.aim;
    if (!a) return;
    const v = this.units.get(a.unitId) ?? me;
    if (!v || v.unit.type !== 'fighter' || !v.unit.alive) return;
    if (this.ballView?.carrierId === v.unit.id) {
      const manual = Math.hypot(a.aim.x, a.aim.y) > 0.02;
      let dir = manual ? Math.atan2(a.aim.y, a.aim.x) : v.unit.facing;
      if (!manual) {
        const goal = this.grid.goalTiles[v.unit.team === 0 ? 1 : 0];
        if (goal.length) {
          const x = goal.reduce((sum, tile) => sum + tile.x + 0.5, 0) / goal.length;
          const y = goal.reduce((sum, tile) => sum + tile.y + 0.5, 0) / goal.length;
          dir = Math.atan2(y - v.unit.pos.y, x - v.unit.pos.x);
        }
      }
      const power = a.which === 'super';
      const color = power ? '#ffd34d' : '#79e8ff';
      const distance = this.ballTravelDistance(power ? BALL_POWER_KICK_SPEED : BALL_KICK_SPEED);
      this.ballAimLineMat.color.set(color);
      this.ballAimEndMat.color.set(color);
      this.ballAimGroup.position.set(this.ballView.root.position.x, 0, this.ballView.root.position.z);
      this.ballAimGroup.rotation.y = -dir;
      this.ballAimGroup.getObjectByName('ball-aim-end')!.position.x = distance;
      const line = this.ballAimGroup.children[0] as THREE.Mesh;
      line.scale.x = distance;
      for (let i = 0; i < this.ballAimDots.length; i++) this.ballAimDots[i]!.position.x = (distance * (i + 1)) / (this.ballAimDots.length + 1);
      this.ballAimGroup.visible = true;
      return;
    }
    const shape = this.aimShape(a.which === 'super' && a.superSourceId ? a.superSourceId : v.unit.fighterId, a.which, a.range, a.kindOverride);
    shape.visible = true;
    const p = v.model.root.position;
    const dir = Math.atan2(a.aim.y, a.aim.x);
    const k = Math.min(1, Math.hypot(a.aim.x, a.aim.y));
    if (shape.userData.kind === 'lob' || shape.userData.kind === 'leap') {
      const r = shape.userData.range as number;
      const kk = shape.userData.kind === 'leap' ? Math.max(2 / r, k) : k;
      shape.position.set(p.x + Math.cos(dir) * r * kk, 0.03, p.z + Math.sin(dir) * r * kk);
      shape.rotation.y = 0;
      if (shape.userData.slam) {
        // 조준 지점 원을 기준(원점)으로, 내 위치에서 양손 사슬이 모이는 모양. 최소 거리는 sim의 LOB_MIN_DIST와 같다
        const d = Math.max(LOB_MIN_DIST, r * kk);
        const sx = -Math.cos(dir) * d;
        const sz = -Math.sin(dir) * d;
        const px = -Math.sin(dir);
        const pz = Math.cos(dir);
        (shape.userData.chains as ChainPath[]).forEach((c, i) => {
          const side = i === 0 ? 1 : -1;
          c.setPath({ x: sx + px * CHAIN_HAND_SPREAD * side, y: 0.5, z: sz + pz * CHAIN_HAND_SPREAD * side }, { x: 0, y: 0.25, z: 0 }, 1);
        });
      }
    } else {
      shape.position.set(p.x, 0.03, p.z);
      shape.rotation.y = -dir;
    }
  }

  /** 바닥에서 멈출 때까지 공이 굴러갈 대략적인 거리를 틱 단위로 계산한다. */
  private ballTravelDistance(initialSpeed: number) {
    let speed = initialSpeed;
    let distance = 0;
    for (let i = 0; i < 180 && speed > 0; i++) {
      distance += speed / 30;
      speed = Math.max(0, speed - BALL_FRICTION / 30);
      if (speed < BALL_STOP_SPEED) speed = 0;
    }
    return distance;
  }

  // ───────────── 좌표 변환(UI용) ─────────────

  /** 평면 위치(높이 h)를 UI 설계 좌표(1280×800 기준 px)로 */
  toDesign(pos: Vec2, height = 0): { x: number; y: number; onScreen: boolean } {
    const v = new THREE.Vector3(pos.x, height, pos.y).project(this.camera);
    const s = Math.min(this.w / DESIGN_WIDTH, this.h / DESIGN_HEIGHT);
    return {
      x: (((v.x + 1) / 2) * this.w) / s,
      y: (((1 - v.y) / 2) * this.h) / s,
      onScreen: v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1,
    };
  }

  /** 유닛의 화면 위치(보간된 현재 위치, 머리 위 높이 h) */
  unitToDesign(id: EntityId, height = 1.5): { x: number; y: number; onScreen: boolean } | null {
    const v = this.units.get(id);
    if (!v || v.hidden) return null;
    const p = v.model.root.position;
    return this.toDesign({ x: p.x, y: p.z }, height);
  }

  /** UI 설계 좌표 → 바닥(평면) 위치 */
  groundAtDesign(dx: number, dy: number): Vec2 | null {
    const s = Math.min(this.w / DESIGN_WIDTH, this.h / DESIGN_HEIGHT);
    const ndc = new THREE.Vector2(((dx * s) / this.w) * 2 - 1, -(((dy * s) / this.h) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    return ok ? { x: hit.x, y: hit.z } : null;
  }

  // ───────────── 효과 ─────────────

  // ───────────── 사슬 이펙트(Chainer) ─────────────

  /** 사슬 고리 재질(팀 색을 흰색 쪽으로 조금 섞은 밝은 색). 색·투명도별로 공유 */
  private chainMat(color: string, opacity: number): THREE.MeshBasicMaterial {
    const key = `${color}|${opacity}`;
    let m = this.chainMats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35),
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
        depthTest: false,
      });
      this.chainMats.set(key, m);
    }
    return m;
  }

  /** 사슬 한 가닥: 소유자의 스킨에 사슬 이미지가 있으면 이미지 사슬, 없으면 3D 고리 사슬 */
  private makeChain(ownerId: EntityId | undefined, color: string, opacity = 1, width = 0.55): ChainPath {
    const path = ownerId !== undefined ? this.skinFx(ownerId)?.chain : undefined;
    return path ? new ChainSprite(this.fxTexture(path), color, opacity, 1.9, width) : new ChainLine(this.chainMat(color, opacity));
  }

  /** Chainer 패시브(스킨): 소용돌이 고리 이미지가 몸 둘레에서 빠르게 돈다(두 겹이 서로 반대로) */
  private whirlImage(unitId: EntityId, range: number, path: string) {
    const v = this.units.get(unitId);
    if (!v) return;
    const color = new THREE.Color(this.shotColor(v.unit)).lerp(new THREE.Color('#ffffff'), 0.2).multiplyScalar(1.6);
    const group = new THREE.Group();
    group.name = 'chain-whirl-image';
    const size = range * 2.3;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const layers = [1, 0.78].map((scale, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: this.fxTexture(path), color, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 6 + i;
      m.scale.setScalar(scale);
      group.add(m);
      return { m, mat, dir: i === 0 ? 1 : -1 };
    });
    this.addEffect(group, 0.45, (k) => {
      const p = v.model.root.position;
      group.position.set(p.x, 0.35, p.z);
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const pop = 0.6 + 0.4 * Math.min(1, k * 4);
      for (const l of layers) {
        l.m.rotation.y = l.dir * k * Math.PI * 7; // 0.45초 동안 세 바퀴 반(고속)
        l.m.scale.setScalar((l.dir === 1 ? 1 : 0.78) * pop);
        l.mat.opacity = (l.dir === 1 ? 1 : 0.75) * fade;
      }
    }, () => {
      geo.dispose();
      for (const l of layers) l.mat.dispose();
    });
  }

  /** Chainer W(스킨): 맞은 대상에게 겹쳐 터지는 충격파. 이미지의 아래쪽 끝이 터지는 중심 */
  private waveImage(at: Vec2, teamColor: string, path: string) {
    const mat = new THREE.SpriteMaterial({
      map: this.fxTexture(path),
      color: new THREE.Color(teamColor).lerp(new THREE.Color('#ffffff'), 0.2).multiplyScalar(1.6),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const s = new THREE.Sprite(mat);
    s.center.set(0.3, 0.12);
    s.position.set(at.x, 0.2, at.y);
    s.renderOrder = 7;
    this.addEffect(s, 0.5, (k) => {
      const g = 0.75 + Math.min(1, k * 3) * 0.35;
      s.scale.set(1.9 * g * (356 / 512), 1.9 * g, 1); // 이미지 가로세로 비율(356×512)
      mat.opacity = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
    }, () => mat.dispose());
  }

  /** 사슬 투사체의 머리(E·R): 뾰족한 갈고리 날. 진행 방향 +x */
  private buildChainHead(owner: Unit | undefined): THREE.Group {
    const color = this.shotColor(owner);
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 6).rotateZ(-Math.PI / 2), toon(color));
    head.position.x = 0.1;
    head.renderOrder = 6;
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.64, 6).rotateZ(-Math.PI / 2), this.glow(color).halo);
    glow.position.x = 0.1;
    g.add(head, glow);
    return g;
  }

  /**
   * Chainer 패시브: 사슬이 몸 둘레의 원 궤도를 따라 고속으로 돈다. 사슬 모양은 거의 안 보이고,
   * 유성우처럼 꼬리를 끄는 빛줄기 열 개가 궤도를 돌며 지나간다(머리에 아주 짧은 사슬 조각만 비친다).
   * 빛줄기마다 궤도 반지름·속도·높이·꼬리 길이가 달라 겹겹이 흩날리는 느낌이다. 0.4초.
   * 중심은 매 프레임 쓴 사람의 현재 위치다.
   */
  private chainWhirl(unitId: EntityId, range: number) {
    const v = this.units.get(unitId);
    if (!v) return;
    const color = this.shotColor(v.unit);
    const group = new THREE.Group();
    group.name = 'chain-whirl';
    const trailMat = this.glow(color).trail.clone();
    const linkMat = this.chainMat(color, 1).clone();
    linkMat.transparent = true;
    const N = 10;
    const geos: THREE.BufferGeometry[] = [];
    const streaks = Array.from({ length: N }, (_, i) => {
      const len = 1.0 + (i % 3) * 0.4;
      const geo = trailGeometry(len, 0.34, 0.03);
      geos.push(geo);
      const trail = new THREE.Mesh(geo, trailMat);
      trail.renderOrder = 6;
      const link = new ChainLine(linkMat);
      group.add(trail, link.mesh);
      return {
        trail,
        link,
        phase: (i / N) * Math.PI * 2 + (i % 3) * 0.35,
        turns: 2.6 + (i % 4) * 0.45, // 0.4초 동안 도는 바퀴 수(고속)
        r: range * (0.78 + 0.22 * (i / (N - 1))),
        y: 0.3 + (i % 5) * 0.11,
      };
    });
    const ringGeo = new THREE.RingGeometry(range - 0.05, range, 56).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, depthTest: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 4;
    group.add(ring);
    trailMat.depthTest = false;
    this.addEffect(group, 0.4, (k) => {
      const p = v.model.root.position;
      for (const st of streaks) {
        const a = st.phase + k * st.turns * Math.PI * 2;
        const hx = p.x + Math.cos(a) * st.r;
        const hz = p.z + Math.sin(a) * st.r;
        st.trail.position.set(hx, st.y, hz);
        st.trail.rotation.y = -(a + Math.PI / 2); // 진행 방향(반시계)으로 꼬리가 뒤에 남는다
        const back = a - 0.5 / st.r;
        st.link.setPath(
          { x: p.x + Math.cos(back) * st.r, y: st.y, z: p.z + Math.sin(back) * st.r },
          { x: hx, y: st.y, z: hz },
          1,
        );
      }
      ring.position.set(p.x, 0.05, p.z);
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      trailMat.opacity = fade;
      linkMat.opacity = 0.7 * fade;
      ringMat.opacity = 0.25 * fade;
    }, () => {
      for (const st of streaks) st.link.dispose();
      for (const g of geos) g.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      trailMat.dispose();
      linkMat.dispose();
    });
  }

  /** 사슬이 바닥을 내리친 순간: 원 안을 번쩍이는 빛줄기 + 퍼지는 고리 */
  private slamImpact(to: Vec2, color: string, radius: number, ownerId?: EntityId) {
    const blast = ownerId !== undefined ? this.skinFx(ownerId)?.blast : undefined;
    const size = radius * (blast ? 3.4 : 2.7);
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: blast ? this.fxTexture(blast) : burstTexture(),
      color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), blast ? 0.2 : 0.4).multiplyScalar(blast ? 1.7 : 1.4),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(to.x, 0.25, to.y);
    m.renderOrder = 6;
    this.addEffect(m, 0.8, (k) => {
      m.scale.setScalar(0.55 + k * 0.7);
      m.rotation.y = k * 0.5;
      mat.opacity = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
    }, () => (geo.dispose(), mat.dispose()));
  }

  // ───────────── 전설 스킨 이펙트(흑백 이미지 × 팀 색) ─────────────

  private fxTextures = new Map<string, THREE.Texture>();
  private fxMats = new Map<string, THREE.MeshBasicMaterial>();

  /** 이 유닛(파이터)이 입은 스킨의 이펙트. 없으면 undefined */
  private skinFx(id: EntityId): SkinEffects | undefined {
    return getSkin(this.skinOf(id))?.effects;
  }

  private fxTexture(path: string): THREE.Texture {
    let t = this.fxTextures.get(path);
    if (!t) {
      t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${path}`);
      t.colorSpace = THREE.SRGBColorSpace;
      this.fxTextures.set(path, t);
    }
    return t;
  }

  /** 팀 색으로 칠한 이펙트 재질(공유). 규칙: 우리 팀 파랑, 상대 빨강 */
  private fxMat(path: string, color: string): THREE.MeshBasicMaterial {
    const key = `${path}|${color}`;
    let m = this.fxMats.get(key);
    if (!m) {
      const c = new THREE.Color(color).multiplyScalar(1.6);
      m = new THREE.MeshBasicMaterial({ map: this.fxTexture(path), color: c, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      this.fxMats.set(key, m);
    }
    return m;
  }

  /** 이미지 탄: 바닥과 나란한 판. 크기는 snapshot에서 판정 반지름에 맞춰 키운다 */
  private buildFxShot(owner: Unit | undefined, path: string): THREE.Group {
    const g = new THREE.Group();
    const size = 0.24 * 2 * 1.5;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.36, size).rotateX(-Math.PI / 2), this.fxMat(path, this.shotColor(owner)));
    plane.renderOrder = 3;
    g.add(plane);
    return g;
  }

  /** 돌진 잔상: 출발점에서 dir 방향으로 len 길이의 띠, 서서히 사라진다 */
  private fxTrail(path: string, color: string, from: Vec2, dir: number, len: number) {
    const mat = this.fxMat(path, color).clone();
    const geo = new THREE.PlaneGeometry(len * 1.15, len * 0.5).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(from.x + Math.cos(dir) * len * 0.5, 0.25, from.y + Math.sin(dir) * len * 0.5);
    m.rotation.y = -dir;
    m.renderOrder = 2;
    this.addEffect(m, 0.7, (k) => {
      mat.opacity = k < 0.1 ? k / 0.1 : 1 - Math.pow((k - 0.1) / 0.9, 2);
    }, () => (geo.dispose(), mat.dispose()));
  }

  /** 적중: 맞은 자리에서 솟아오르는 이미지(카메라를 향함) */
  private fxHit(path: string, color: string, pos: Vec2, big: boolean) {
    const mat = new THREE.SpriteMaterial({ map: this.fxTexture(path), color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, depthWrite: false, depthTest: false });
    const s = new THREE.Sprite(mat);
    const w = big ? 2.2 : 1.5;
    s.center.set(0.5, 0.15);
    s.position.set(pos.x, 0.1, pos.y);
    s.renderOrder = 4;
    this.addEffect(s, 0.4, (k) => {
      const g = 0.7 + Math.min(1, k * 3) * 0.5;
      s.scale.set(w * g, w * 0.57 * g, 1);
      mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }, () => mat.dispose());
  }

  private addEffect(obj: THREE.Object3D, dur: number, step: (k: number) => void, dispose: () => void) {
    this.scene.add(obj);
    this.effects.push({ obj, age: 0, dur, step, dispose: () => (obj.removeFromParent(), dispose()) });
  }

  private spark(pos: Vec2, color: string, size: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(size * 0.5, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, 0.7, pos.y);
    this.addEffect(m, 0.22, (k) => {
      m.scale.setScalar(0.6 + k * 1.4);
      m.rotation.y = k * 3;
      mat.opacity = 1 - k;
    }, () => (geo.dispose(), mat.dispose()));
  }

  /** 맞은 위치에 역할별 색의 큰 충격 고리와 밝은 중심광을 표시한다. */
  private hitImpact(pos: Vec2, color: string, size: number) {
    this.ring(pos, size, color);
    this.spark(pos, color, size * 0.9);
    this.spark({ x: pos.x - size * 0.25, y: pos.y + size * 0.12 }, '#ffffff', size * 0.36);
    this.spark({ x: pos.x + size * 0.2, y: pos.y - size * 0.2 }, color, size * 0.42);
  }

  private shotColorFromMarker(l: { shell: THREE.Mesh }): string {
    return (l.shell.userData.baseColor as string) ?? '#ff2f92';
  }

  private dust(pos: Vec2) {
    const mat = new THREE.MeshBasicMaterial({ color: '#d8c49a', transparent: true, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.28, 10, 8);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x + (Math.random() - 0.5) * 0.4, 0.15, pos.y + (Math.random() - 0.5) * 0.4);
    this.addEffect(m, 0.45, (k) => {
      m.scale.setScalar(0.6 + k * 1.2);
      m.position.y = 0.15 + k * 0.3;
      mat.opacity = 0.8 * (1 - k);
    }, () => (geo.dispose(), mat.dispose()));
  }

  private puff(pos: Vec2) {
    const mat = new THREE.MeshBasicMaterial({ color: '#e8ecff', transparent: true, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.6, 16, 12);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, 0.6, pos.y);
    this.addEffect(m, 0.5, (k) => {
      m.scale.setScalar(0.5 + k * 1.6);
      mat.opacity = 0.9 * (1 - k);
    }, () => (geo.dispose(), mat.dispose()));
  }

  private ring(pos: Vec2, radius: number, color: string) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.RingGeometry(0.8, 1, 48);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.06, pos.y);
    this.addEffect(m, 0.35, (k) => {
      m.scale.setScalar(Math.max(0.05, radius * (0.3 + 0.7 * k)));
      mat.opacity = 1 - k;
    }, () => (geo.dispose(), mat.dispose()));
  }

  private arc(unitId: EntityId, dir: number, range: number, spreadDeg: number) {
    const v = this.units.get(unitId);
    if (!v) return;
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.CircleGeometry(range, 32, -spread / 2, spread);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(m);
    holder.position.set(v.model.root.position.x, 0.08, v.model.root.position.z);
    holder.rotation.y = -dir;
    this.addEffect(holder, 0.2, (k) => {
      mat.opacity = 0.6 * (1 - k);
    }, () => (geo.dispose(), mat.dispose()));
  }

  private debris(pos: Vec2) {
    const mat = new THREE.MeshLambertMaterial({ color: '#b0744a', transparent: true });
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const group = new THREE.Group();
    const parts: { m: THREE.Mesh; vx: number; vy: number; vz: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 6) * Math.PI * 2 + Math.random();
      parts.push({ m, vx: Math.cos(a) * 2.5, vy: 3 + Math.random() * 2, vz: Math.sin(a) * 2.5 });
      group.add(m);
    }
    group.position.set(pos.x, 0.5, pos.y);
    const dur = 0.6;
    this.addEffect(group, dur, (k) => {
      const t = k * dur;
      for (const p of parts) {
        p.m.position.set(p.vx * t, p.vy * t - 9 * t * t, p.vz * t);
        p.m.rotation.set(t * 8, t * 6, 0);
      }
      mat.opacity = 1 - k * k;
    }, () => (geo.dispose(), mat.dispose()));
  }

  dispose() {
    for (const v of this.units.values()) v.model.dispose();
    for (const e of this.effects) e.dispose();
    this.map.dispose();
    this.shotGeo.dispose();
    for (const k of this.shotKits.values()) for (const g of [k.core, k.halo, k.trail, k.shadow]) g.dispose();
    for (const g of this.glowMats.values()) (g.halo.dispose(), g.trail.dispose());
    this.trailTex.dispose();
    this.crystalGeo.dispose();
    this.crystalMat.dispose();
    this.crystalRingGeo.dispose();
    this.crystalRingMat.dispose();
    this.ballAimLineGeo.dispose();
    this.ballAimLineMat.dispose();
    this.ballAimEndGeo.dispose();
    this.ballAimEndMat.dispose();
    this.ballAimDotGeo.dispose();
    this.ballAimDotMat.dispose();
    this.ballHaloGeo.dispose();
    this.ballHaloMat.dispose();
    this.dotTex.dispose();
    this.shadowMat.dispose();
    this.scene.clear();
  }
}
