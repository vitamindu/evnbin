import { getFighter } from '../data/fighters';
import { Rng } from './rng';
import {
  TICK_DT,
  TICK_RATE,
  type Dummy,
  type EntityId,
  type Fighter,
  type FighterInput,
  type Lob,
  type Projectile,
  type SimEvent,
  type SimView,
  type SpawnFighter,
  type Unit,
} from './types';
import { angleOf, clampLen, dist, fromAngle, len } from './vec';
import { Grid, moveCircle, sweepCircle, isInBush, type MapDef } from './world';

/**
 * 전투 시뮬레이션. Gameplay 담당.
 * (현재는 Lead가 만든 초기 뼈대: 이동, 탄창·재장전, spread/burst 직선 투사체, 피해·사망·부활만 있다)
 */

export interface SimOptions {
  map: MapDef;
  seed: number;
  fighters: SpawnFighter[];
  /** 맵의 더미 생성 여부(연습장) */
  dummies: boolean;
}

const FIGHTER_RADIUS = 0.4;
const DUMMY_RADIUS = 0.45;
const DUMMY_HP = 6000;
const RESPAWN_TICKS = 3 * TICK_RATE;
const PROJECTILE_RADIUS = 0.18;

export class Sim implements SimView {
  readonly grid: Grid;
  readonly rng: Rng;
  tick = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  lobs: Lob[] = [];
  private nextId = 1;
  private events: SimEvent[] = [];

  constructor(opts: SimOptions) {
    this.grid = new Grid(opts.map);
    this.rng = new Rng(opts.seed);
    for (const spec of opts.fighters) {
      const spawns = this.grid.teamSpawns[spec.team];
      const spawn = spawns[spec.spawnIndex % Math.max(1, spawns.length)] ?? { x: 2, y: 2 };
      const def = getFighter(spec.fighterId);
      const f: Fighter = {
        id: this.nextId++,
        type: 'fighter',
        fighterId: spec.fighterId,
        controller: spec.controller,
        team: spec.team,
        pos: { ...spawn },
        spawn: { ...spawn },
        radius: FIGHTER_RADIUS,
        hp: def.hp,
        maxHp: def.hp,
        alive: true,
        respawnTick: 0,
        facing: spec.team === 0 ? 0 : Math.PI,
        lastCombatTick: -9999,
        ammo: def.attack.ammo,
        maxAmmo: def.attack.ammo,
        superCharge: 0,
        inBush: false,
        revealedUntil: 0,
        moving: false,
        action: null,
      };
      this.units.push(f);
    }
    if (opts.dummies) {
      for (const d of this.grid.dummySpawns) {
        const dummy: Dummy = {
          id: this.nextId++,
          type: 'dummy',
          behavior: d.behavior,
          team: 1,
          pos: { ...d.pos },
          spawn: { ...d.pos },
          radius: DUMMY_RADIUS,
          hp: DUMMY_HP,
          maxHp: DUMMY_HP,
          alive: true,
          respawnTick: 0,
          facing: Math.PI,
          lastCombatTick: -9999,
        };
        this.units.push(dummy);
      }
    }
  }

  getUnit(id: EntityId): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** 한 틱 진행. inputs: 파이터 id → 입력 */
  step(inputs: ReadonlyMap<EntityId, FighterInput>): SimEvent[] {
    this.tick++;
    this.events = [];
    for (const u of this.units) {
      if (!u.alive) {
        if (this.tick >= u.respawnTick) this.respawn(u);
        continue;
      }
      if (u.type === 'fighter') this.stepFighter(u, inputs.get(u.id));
    }
    this.stepProjectiles();
    return this.events;
  }

  private stepFighter(f: Fighter, input: FighterInput | undefined) {
    const def = getFighter(f.fighterId);
    // 재장전
    if (f.ammo < f.maxAmmo) f.ammo = Math.min(f.maxAmmo, f.ammo + TICK_DT / def.attack.reload);

    // 이동
    f.moving = false;
    const move = input ? clampLen(input.move, 1) : { x: 0, y: 0 };
    if (len(move) > 0.05) {
      const speed = def.moveSpeed * TICK_DT;
      const next = moveCircle(this.grid, f.pos, f.radius, move.x * speed, move.y * speed);
      f.moving = dist(next, f.pos) > 1e-4;
      f.pos = next;
      f.facing = angleOf(move);
    }
    f.inBush = isInBush(this.grid, f.pos);

    // 기본 공격(초기 뼈대: 방향 조준만, 자동 조준이면 바라보는 방향)
    if (input?.attack && f.ammo >= 1) {
      f.ammo -= 1;
      const aim = input.attack.aim;
      const dir = aim && len(aim) > 0.01 ? angleOf(aim) : f.facing;
      f.facing = dir;
      f.lastCombatTick = this.tick;
      this.fire(f, dir, false);
      this.events.push({ type: 'attack', unitId: f.id, isSuper: false, dir });
    }
  }

  private fire(f: Fighter, dir: number, isSuper: boolean) {
    const a = getFighter(f.fighterId).attack;
    const spread = (a.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < a.count; i++) {
      const k = a.count > 1 && a.kind === 'spread' ? i / (a.count - 1) - 0.5 : 0;
      const d = dir + k * spread;
      const vel = fromAngle(d, a.projectileSpeed || 12);
      const start = { x: f.pos.x + Math.cos(d) * f.radius, y: f.pos.y + Math.sin(d) * f.radius };
      this.projectiles.push({
        id: this.nextId++,
        type: 'projectile',
        ownerId: f.id,
        team: f.team,
        pos: start,
        vel,
        radius: PROJECTILE_RADIUS,
        damage: a.damage,
        remaining: a.range,
        isSuper,
        breaksWalls: false,
        knockback: 0,
        pierce: false,
        hitIds: [],
      });
    }
  }

  private stepProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const stepLen = Math.min(len(p.vel) * TICK_DT, p.remaining);
      const dir = angleOf(p.vel);
      const to = { x: p.pos.x + Math.cos(dir) * stepLen, y: p.pos.y + Math.sin(dir) * stepLen };
      const sweep = sweepCircle(this.grid, p.pos, to, p.radius);
      const end = sweep.point;
      // 유닛 적중(선분 근처 판정)
      let hitUnit: Unit | null = null;
      for (const u of this.units) {
        if (!u.alive || u.team === p.team || p.hitIds.includes(u.id)) continue;
        if (segmentCircle(p.pos, end, u.pos, u.radius + p.radius)) {
          hitUnit = u;
          break;
        }
      }
      if (hitUnit) {
        this.damage(hitUnit, p.damage, p.ownerId, p.isSuper);
        this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...hitUnit.pos }, reason: 'hit' });
        continue;
      }
      p.remaining -= dist(p.pos, end);
      p.pos = end;
      if (sweep.hit) {
        this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...end }, reason: 'wall' });
        continue;
      }
      if (p.remaining <= 1e-3) {
        this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...end }, reason: 'range' });
        continue;
      }
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private damage(u: Unit, amount: number, sourceId: EntityId, isSuper: boolean) {
    u.hp = Math.max(0, u.hp - amount);
    u.lastCombatTick = this.tick;
    const killed = u.hp <= 0;
    this.events.push({ type: 'hit', targetId: u.id, sourceId, damage: amount, pos: { ...u.pos }, isSuper, killed });
    if (killed) {
      u.alive = false;
      u.respawnTick = this.tick + RESPAWN_TICKS;
      this.events.push({ type: 'death', unitId: u.id, pos: { ...u.pos } });
    }
  }

  private respawn(u: Unit) {
    u.alive = true;
    u.hp = u.maxHp;
    u.pos = { ...u.spawn };
    if (u.type === 'fighter') {
      u.ammo = u.maxAmmo;
      u.action = null;
    }
    this.events.push({ type: 'respawn', unitId: u.id });
  }
}

/** 선분 ab가 중심 c, 반지름 r 원과 만나는가 */
export function segmentCircle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, r: number): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + abx * t - c.x;
  const py = a.y + aby * t - c.y;
  return px * px + py * py <= r * r;
}
