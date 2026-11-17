import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../config';
import { getFighter } from '../../data/fighters';
import type { EntityId, Fighter, SimEvent, SimView, Unit, Vec2 } from '../../game/types';
import type { Grid } from '../../game/world';
import { isVisibleTo } from '../../game/visibility';
import { buildFighterModel, type FighterModel } from '../fighterModel';
import { addStandardLights } from '../toon';
import { MapRenderer } from '../world/mapRenderer';
import { buildDummyModel, type DummyModel } from './dummyModel';

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
  mesh: THREE.Mesh;
  prev: Vec2;
  curr: Vec2;
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
  private readonly lobs = new Map<EntityId, { shell: THREE.Mesh; marker: THREE.Mesh; from: Vec2; to: Vec2; start: number; end: number }>();
  private effects: Effect[] = [];
  private readonly shotGeo = new THREE.SphereGeometry(0.13, 10, 8);
  private readonly shotMats = new Map<string, THREE.MeshBasicMaterial>();
  private readonly camTarget = new THREE.Vector3();
  private camInit = false;
  private w = 1;
  private h = 1;
  private simTick = 0;
  private aim: AimSpec | null = null;
  private readonly aimRoot = new THREE.Group();
  private readonly aimShapes = new Map<string, THREE.Object3D>();
  private readonly raycaster = new THREE.Raycaster();
  readonly followId: EntityId;

  constructor(grid: Grid, followId: EntityId) {
    this.grid = grid;
    this.followId = followId;
    this.scene.background = new THREE.Color('#1c2a52');
    addStandardLights(this.scene);
    this.map = new MapRenderer(grid);
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
    const seen = new Set<EntityId>();
    for (const u of sim.units) {
      seen.add(u.id);
      let v = this.units.get(u.id);
      if (!v) {
        const model = u.type === 'fighter' ? buildFighterModel(getFighter(u.fighterId)) : buildDummyModel(u.behavior);
        model.root.scale.setScalar(MODEL_SCALE);
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
        const mesh = new THREE.Mesh(this.shotGeo, this.shotMaterial(owner, p.isSuper));
        mesh.scale.setScalar(p.isSuper ? 1.35 : 1);
        this.scene.add(mesh);
        s = { mesh, prev: { ...p.pos }, curr: { ...p.pos } };
        this.shots.set(p.id, s);
      } else {
        s.prev = s.curr;
        s.curr = { ...p.pos };
      }
    }
    for (const [id, s] of this.shots) {
      if (!shotSeen.has(id)) {
        s.mesh.removeFromParent();
        this.shots.delete(id);
      }
    }

    const lobSeen = new Set<EntityId>();
    for (const l of sim.lobs) {
      lobSeen.add(l.id);
      if (!this.lobs.has(l.id)) {
        const owner = sim.getUnit(l.ownerId);
        const shell = new THREE.Mesh(this.shotGeo, this.shotMaterial(owner, l.isSuper));
        shell.scale.setScalar(1.8);
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0.1, l.aoeRadius - 0.08), l.aoeRadius, 40),
          new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.55, depthWrite: false }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(l.to.x, 0.04, l.to.y);
        this.scene.add(shell, marker);
        this.lobs.set(l.id, { shell, marker, from: l.from, to: l.to, start: l.startTick, end: l.endTick });
      }
    }
    for (const [id, l] of this.lobs) {
      if (!lobSeen.has(id)) {
        l.shell.removeFromParent();
        l.marker.removeFromParent();
        l.marker.geometry.dispose();
        (l.marker.material as THREE.Material).dispose();
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
    const color = u.id === this.followId ? TEAM_RING.me : u.team === 0 ? TEAM_RING.ally : TEAM_RING.enemy;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.renderOrder = -1;
    return ring;
  }

  private shotMaterial(owner: Unit | undefined, isSuper: boolean) {
    const color = owner?.type === 'fighter' ? getFighter(owner.fighterId).palette.accent : '#ff6060';
    const key = `${color}|${isSuper}`;
    let m = this.shotMats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: isSuper ? '#ffe14d' : color });
      this.shotMats.set(key, m);
    }
    return m;
  }

  applyEvents(events: readonly SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'attack':
          this.units.get(e.unitId)?.model.attack();
          break;
        case 'hit': {
          const v = this.units.get(e.targetId);
          if (v && 'hit' in v.model) v.model.hit();
          this.spark(e.pos, e.isSuper ? '#ffe14d' : '#ffffff', e.isSuper ? 0.7 : 0.45);
          break;
        }
        case 'death':
          this.puff(e.pos);
          break;
        case 'explode':
          this.ring(e.pos, e.radius, e.isSuper ? '#ffe14d' : '#ff9a3c');
          break;
        case 'melee':
          this.arc(e.unitId, e.dir, e.range, e.spreadDeg);
          break;
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
      s.mesh.position.set(lerp(s.prev.x, s.curr.x, alpha), 0.65, lerp(s.prev.y, s.curr.y, alpha));
    }
    for (const l of this.lobs.values()) {
      const k = Math.min(1, Math.max(0, (tickF - l.start) / Math.max(1, l.end - l.start)));
      l.shell.position.set(lerp(l.from.x, l.to.x, k), 0.6 + 4 * LOB_HEIGHT * k * (1 - k), lerp(l.from.y, l.to.y, k));
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

  private aimShape(fighterId: string, which: 'attack' | 'super'): THREE.Object3D {
    const key = `${fighterId}|${which}`;
    let obj = this.aimShapes.get(key);
    if (obj) return obj;
    const def = getFighter(fighterId as Fighter['fighterId']);
    const d = which === 'attack' ? def.attack : def.super;
    const color = which === 'attack' ? '#ffffff' : '#ffd23f';
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const flat = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      group.add(m);
      return m;
    };
    switch (d.kind) {
      case 'spread':
      case 'melee': {
        const spread = THREE.MathUtils.degToRad(Math.max(8, d.spreadDeg));
        // 로컬 +x 방향을 중심으로 한 부채꼴 (평면 → 회전 후 월드 +x)
        flat(new THREE.CircleGeometry(d.range, 40, -spread / 2, spread));
        break;
      }
      case 'burst':
      case 'dash': {
        const width = d.kind === 'dash' ? 0.9 : 0.45;
        const geo = new THREE.PlaneGeometry(d.range, width);
        geo.translate(d.range / 2, 0, 0);
        flat(geo);
        break;
      }
      case 'radial':
        flat(new THREE.CircleGeometry(d.range, 48));
        break;
      case 'lob': {
        const r = ('aoeRadius' in d && d.aoeRadius) || 1.5;
        const target = flat(new THREE.CircleGeometry(r, 40));
        target.name = 'lobTarget';
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
    obj.userData.kind = d.kind;
    obj.userData.range = d.range;
    this.aimRoot.add(obj);
    this.aimShapes.set(key, obj);
    return obj;
  }

  private updateAim(me: UnitVisual | undefined) {
    for (const o of this.aimShapes.values()) o.visible = false;
    const a = this.aim;
    if (!a) return;
    const v = this.units.get(a.unitId) ?? me;
    if (!v || v.unit.type !== 'fighter' || !v.unit.alive) return;
    const shape = this.aimShape(v.unit.fighterId, a.which);
    shape.visible = true;
    const p = v.model.root.position;
    const dir = Math.atan2(a.aim.y, a.aim.x);
    const k = Math.min(1, Math.hypot(a.aim.x, a.aim.y));
    if (shape.userData.kind === 'lob' || shape.userData.kind === 'leap') {
      const r = shape.userData.range as number;
      const kk = shape.userData.kind === 'leap' ? Math.max(2 / r, k) : k;
      shape.position.set(p.x + Math.cos(dir) * r * kk, 0.03, p.z + Math.sin(dir) * r * kk);
      shape.rotation.y = 0;
    } else {
      shape.position.set(p.x, 0.03, p.z);
      shape.rotation.y = -dir;
    }
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
    for (const m of this.shotMats.values()) m.dispose();
    this.scene.clear();
  }
}
