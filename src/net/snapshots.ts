/**
 * 스냅샷 버퍼와 보간. Network 담당. DOM·Three.js import 금지(단위 테스트에서 그대로 쓴다).
 *
 * 서버 snap을 틱 순서로 쌓아 두고, 원하는 (소수) 틱의 상태를 만든다.
 *  - 유닛: 앞뒤 snap 사이 위치·방향 보간. 이산 값(체력·생존 등)은 앞 snap 값(사건이 풀리는 시점과 맞춘다).
 *  - 투사체: 앞뒤에 다 있으면 보간, 사이에 끝났으면 projectileEnd 지점까지 직선, 사이에 생겼으면 뒤 snap에서 거꾸로.
 *  - lob: startTick ≤ 틱 < endTick 인 것.
 *  - 가장 최근 snap보다 뒤를 물으면 조금만(maxExtrapolate 틱) 앞질러 그린다.
 */
import type { EntityId, Lob, MatchState, Projectile, SimEvent, SimView, Unit, Vec2 , Crystal } from '../game/types';
import { TICK_DT } from '../game/types';

export interface BufferedSnap {
  tick: number;
  units: readonly Unit[];
  projectiles: readonly Projectile[];
  lobs: readonly Lob[];
  /** 바닥의 크리스탈(움직이지 않으므로 보간 없이 뒤 snap 것을 쓴다) */
  crystals?: readonly Crystal[];
  match: MatchState;
  /** 이 snap에 실려 온 사건(직전 snap 이후) */
  events: readonly SimEvent[];
}

/** 보간한 상태. 렌더러·HUD에 SimView로 넘긴다 */
export class NetSimView implements SimView {
  readonly byId = new Map<EntityId, Unit>();
  constructor(
    readonly tick: number,
    readonly units: Unit[],
    readonly projectiles: Projectile[],
    readonly lobs: Lob[],
    readonly match: MatchState,
    readonly crystals: Crystal[] = [],
  ) {
    for (const u of units) this.byId.set(u.id, u);
  }
  getUnit(id: EntityId): Unit | undefined {
    return this.byId.get(id);
  }
  /** id의 유닛을 바꿔 끼운다(내 캐릭터 예측 위치 반영) */
  replaceUnit(u: Unit) {
    const i = this.units.findIndex((x) => x.id === u.id);
    if (i >= 0) this.units[i] = u;
    else this.units.push(u);
    this.byId.set(u.id, u);
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** 이 거리보다 크게 움직이면(부활·순간이동) 보간하지 않는다 */
const TELEPORT_DIST = 2;

export class SnapshotBuffer {
  private readonly snaps: BufferedSnap[] = [];

  constructor(
    /** 보관할 snap 개수(15회/초 기준 약 2초) */
    private readonly capacity = 32,
  ) {}

  get size(): number {
    return this.snaps.length;
  }
  get latest(): BufferedSnap | undefined {
    return this.snaps[this.snaps.length - 1];
  }
  get oldest(): BufferedSnap | undefined {
    return this.snaps[0];
  }

  clear() {
    this.snaps.length = 0;
  }

  /** 새 snap. 이미 받은 틱 이하이면 무시하고 false */
  push(s: BufferedSnap): boolean {
    const last = this.latest;
    if (last && s.tick <= last.tick) return false;
    this.snaps.push(s);
    while (this.snaps.length > this.capacity) this.snaps.shift();
    return true;
  }

  /** 틱 t의 상태(보간). 버퍼가 비었으면 null */
  sample(t: number, maxExtrapolate = 3): NetSimView | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const first = this.snaps[0]!;
    const last = this.snaps[n - 1]!;
    if (t <= first.tick) return fromSnap(first, first.tick);
    if (t >= last.tick) {
      const prev = n > 1 ? this.snaps[n - 2]! : null;
      return extrapolate(prev, last, Math.min(t, last.tick + maxExtrapolate));
    }
    let i = n - 2;
    while (i > 0 && this.snaps[i]!.tick > t) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1]!;
    return interpolate(a, b, t);
  }
}

function fromSnap(s: BufferedSnap, tick: number): NetSimView {
  return new NetSimView(
    tick,
    s.units.map((u) => ({ ...u })),
    s.projectiles.map((p) => ({ ...p })),
    s.lobs.filter((l) => l.startTick <= tick && tick < l.endTick).map((l) => ({ ...l })),
    s.match,
    (s.crystals ?? []).map((c) => ({ ...c })),
  );
}

function interpolate(a: BufferedSnap, b: BufferedSnap, t: number): NetSimView {
  const span = Math.max(1e-6, b.tick - a.tick);
  const k = Math.min(1, Math.max(0, (t - a.tick) / span));

  const bUnits = new Map<EntityId, Unit>();
  for (const u of b.units) bUnits.set(u.id, u);
  const units: Unit[] = [];
  const seen = new Set<EntityId>();
  for (const u of a.units) {
    seen.add(u.id);
    const bu = bUnits.get(u.id);
    const c = { ...u, pos: { ...u.pos } } as Unit;
    if (bu && Math.hypot(bu.pos.x - u.pos.x, bu.pos.y - u.pos.y) <= TELEPORT_DIST) {
      c.pos = { x: lerp(u.pos.x, bu.pos.x, k), y: lerp(u.pos.y, bu.pos.y, k) };
      c.facing = lerpAngle(u.facing, bu.facing, k);
    }
    units.push(c);
  }
  for (const u of b.units) if (!seen.has(u.id)) units.push({ ...u });

  // 투사체
  const ends = new Map<EntityId, Vec2>();
  for (const e of b.events) if (e.type === 'projectileEnd') ends.set(e.id, e.pos);
  const bShots = new Map<EntityId, Projectile>();
  for (const p of b.projectiles) bShots.set(p.id, p);
  const projectiles: Projectile[] = [];
  const shotSeen = new Set<EntityId>();
  for (const p of a.projectiles) {
    shotSeen.add(p.id);
    const bp = bShots.get(p.id);
    if (bp) {
      projectiles.push({ ...p, pos: { x: lerp(p.pos.x, bp.pos.x, k), y: lerp(p.pos.y, bp.pos.y, k) } });
      continue;
    }
    // a와 b 사이에 끝났다: 끝난 지점까지만 직선으로
    const dt = (t - a.tick) * TICK_DT;
    const pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
    const end = ends.get(p.id);
    if (end) {
      const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
      const toEnd = ((end.x - p.pos.x) * p.vel.x + (end.y - p.pos.y) * p.vel.y) / speed;
      if (speed * dt >= toEnd) continue; // 이미 끝남
    } else if (Math.hypot(p.vel.x, p.vel.y) * dt >= p.remaining) {
      continue;
    }
    projectiles.push({ ...p, pos });
  }
  for (const p of b.projectiles) {
    if (shotSeen.has(p.id)) continue;
    // a와 b 사이에 생겼다: b 위치에서 거꾸로. 쏜 사람 앞쪽에 있을 때만 보인다(아직 안 쏜 시점이면 숨김)
    const back = (b.tick - t) * TICK_DT;
    const speed = Math.hypot(p.vel.x, p.vel.y);
    const owner = bUnits.get(p.ownerId);
    if (owner && speed > 0) {
      const traveled = ((p.pos.x - owner.pos.x) * p.vel.x + (p.pos.y - owner.pos.y) * p.vel.y) / speed;
      if (speed * back > traveled + 0.05) continue;
    }
    projectiles.push({ ...p, pos: { x: p.pos.x - p.vel.x * back, y: p.pos.y - p.vel.y * back } });
  }

  // lob: 시작했고 아직 안 끝난 것
  const lobs: Lob[] = [];
  const lobSeen = new Set<EntityId>();
  for (const l of [...a.lobs, ...b.lobs]) {
    if (lobSeen.has(l.id)) continue;
    lobSeen.add(l.id);
    if (l.startTick <= t && t < l.endTick) lobs.push({ ...l });
  }

  return new NetSimView(t, units, projectiles, lobs, a.match, (b.crystals ?? []).map((c) => ({ ...c })));
}

function extrapolate(prev: BufferedSnap | null, last: BufferedSnap, t: number): NetSimView {
  const ahead = Math.max(0, t - last.tick);
  const view = fromSnap(last, t);
  if (ahead <= 0) return view;
  const dt = ahead * TICK_DT;
  // 유닛: 직전 두 snap의 속도로 조금만
  if (prev) {
    const span = Math.max(1, last.tick - prev.tick);
    const prevById = new Map<EntityId, Unit>();
    for (const u of prev.units) prevById.set(u.id, u);
    for (const u of view.units) {
      const p = prevById.get(u.id);
      if (!p || !u.alive || !p.alive) continue;
      const vx = (u.pos.x - p.pos.x) / span;
      const vy = (u.pos.y - p.pos.y) / span;
      if (Math.hypot(vx, vy) * span > TELEPORT_DIST) continue;
      u.pos = { x: u.pos.x + vx * ahead, y: u.pos.y + vy * ahead };
    }
  }
  for (const p of view.projectiles) {
    const step = Math.min(Math.hypot(p.vel.x, p.vel.y) * dt, p.remaining);
    const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
    p.pos = { x: p.pos.x + (p.vel.x / speed) * step, y: p.pos.y + (p.vel.y / speed) * step };
  }
  return view;
}
