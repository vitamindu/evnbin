import { getFighter, type FighterDef, type SuperKind } from '../data/fighters';
import { resolveAim, resolveLeapAim } from './aim';
import { angleDiff, lerpVec, segmentCircle, segmentCircleT } from './geom';
import { Rng } from './rng';
import {
  DASH_BREAK_MARGIN,
  DEFAULT_FUSE,
  DEFAULT_LEAP_TIME,
  DEFAULT_LOB_AOE,
  DEFAULT_PROJECTILE_SPEED,
  DUMMY_HP,
  DUMMY_RADIUS,
  DUMMY_REGEN_DELAY_TICKS,
  DUMMY_REGEN_PER_SEC,
  DUMMY_RESPAWN_TICKS,
  EPS,
  FIGHTER_RESPAWN_TICKS,
  KNOCKBACK_TICKS,
  LEAP_BOMB_RING,
  LEAP_LAND_SEARCH,
  MIN_LEAP_DIST,
  PATROL_HALF_WIDTH,
  PATROL_SPEED,
  PROJECTILE_RADIUS,
  REGEN_DELAY_TICKS,
  REGEN_PER_SEC,
  REVEAL_TICKS,
  SUPER_PROJECTILE_RADIUS,
  TEAMFIGHT_TARGET_SCORE,
  TEAMFIGHT_TICKS,
  TURRET_DAMAGE,
  TURRET_INTERVAL_TICKS,
  TURRET_RANGE,
  TURRET_SHOT_RADIUS,
  TURRET_SHOT_RANGE,
  TURRET_SHOT_SPEED,
  fighterRadius,
  secToTicks,
} from './rules';
import { isHittable } from './status';
import {
  TICK_DT,
  TICK_RATE,
  type Aim,
  type Dummy,
  type EntityId,
  type Fighter,
  type FighterAction,
  type FighterInput,
  type Lob,
  type Projectile,
  type SimEvent,
  type SimView,
  type SpawnFighter,
  type Team,
  type Unit,
  type Vec2,
  type MatchMode,
  type MatchState,
} from './types';
import { angleOf, clampLen, dist, fromAngle, len } from './vec';
import { isVisibleTo } from './visibility';
import {
  Grid,
  breakWallsInCircle,
  circleBlocked,
  hasLineOfSight,
  isInBush,
  moveCircle,
  sweepCircle,
  type MapDef,
} from './world';

export { segmentCircle } from './geom';

/**
 * 전투 시뮬레이션. Gameplay 담당.
 *
 * 한 틱(step)의 순서
 *  1. 부활      2. 넉백 이동      3. 파이터(재장전·돌진·이동·공격·연사)
 *  4. 더미(patrol·turret)      5. 투사체·lob      6. 체력 회복      7. wallsBroken 사건
 *
 * 결정적: 같은 시드·같은 입력이면 같은 결과. Math.random 금지(필요하면 this.rng).
 */

export interface SimOptions {
  map: MapDef;
  seed: number;
  /** 경기 방식(기본 training) */
  mode?: MatchMode;
  fighters: SpawnFighter[];
  /** 맵의 더미 생성 여부(연습장) */
  dummies: boolean;
}

/** 한 번의 공격(기본 또는 궁극기)을 실행하는 값. AttackDef/SuperDef를 같은 모양으로 맞춘 것 */
export interface ShotSpec {
  kind: SuperKind;
  isSuper: boolean;
  damage: number;
  count: number;
  spreadDeg: number;
  burstInterval: number;
  range: number;
  projectileSpeed: number;
  breaksWalls: boolean;
  knockback: number;
  /** burst: 좌우로 번갈아 띄우는 발사 위치(타일). SuperDef에는 이 필드가 없어 궁극기는 0 */
  lateralOffset: number;
  /** lob: 착탄 범위 */
  aoeRadius: number;
  /** 거리 비례 피해: 사거리 끝에서의 피해량(기본 공격만) */
  damageFar?: number;
  /** 모든 대상 관통 */
  pierce: boolean;
  /** spread: 탄마다 속도 ±비율 */
  speedJitter: number;
  /** leap: 공중에 떠 있는 시간(초) */
  leapTime: number;
  /** leap: 폭탄이 터지기까지(초) */
  fuse: number;
}

export function shotSpec(def: FighterDef, isSuper: boolean): ShotSpec {
  if (isSuper) {
    const s = def.super;
    return {
      kind: s.kind,
      isSuper: true,
      damage: s.damage,
      count: Math.max(1, s.count),
      spreadDeg: s.spreadDeg,
      burstInterval: s.burstInterval,
      range: s.range,
      projectileSpeed: s.projectileSpeed || DEFAULT_PROJECTILE_SPEED,
      breaksWalls: s.breaksWalls,
      knockback: s.knockback,
      lateralOffset: s.lateralOffset ?? 0,
      pierce: s.pierce ?? false,
      speedJitter: s.speedJitter ?? 0,
      aoeRadius: s.aoeRadius ?? DEFAULT_LOB_AOE,
      leapTime: s.leapTime ?? DEFAULT_LEAP_TIME,
      fuse: s.fuse ?? DEFAULT_FUSE,
    };
  }
  const a = def.attack;
  return {
    kind: a.kind,
    isSuper: false,
    damage: a.damage,
    count: Math.max(1, a.count),
    spreadDeg: a.spreadDeg,
    burstInterval: a.burstInterval,
    range: a.range,
    projectileSpeed: a.projectileSpeed || DEFAULT_PROJECTILE_SPEED,
    breaksWalls: false,
    knockback: 0,
    lateralOffset: a.lateralOffset ?? 0,
    pierce: a.pierce ?? false,
    speedJitter: a.speedJitter ?? 0,
    aoeRadius: a.aoeRadius ?? DEFAULT_LOB_AOE,
    damageFar: a.damageFar,
    leapTime: DEFAULT_LEAP_TIME,
    fuse: DEFAULT_FUSE,
  };
}

/**
 * 거리 비례 피해. damageFar가 있으면 damage + (damageFar − damage) × clamp(traveled / range, 0, 1)을
 * 정수로 반올림한다(피해 숫자 표시용). 없으면 damage 그대로.
 */
export function distanceDamage(p: Pick<Projectile, 'damage' | 'damageFar' | 'range'>, traveled: number): number {
  if (p.damageFar === undefined || !p.range || p.range <= 0) return p.damage;
  const k = Math.max(0, Math.min(1, traveled / p.range));
  return Math.round(p.damage + (p.damageFar - p.damage) * k);
}

/** 넉백 상태(파이터는 action 'knockback'과 같은 값) */
interface KnockState {
  vx: number;
  vy: number;
  untilTick: number;
}

/**
 * 계약의 Dummy에는 넉백 상태 필드가 없어서, 시뮬레이션 안에서만 붙여 쓴다.
 * (Lead에게 제안: Dummy 또는 UnitBase에 넉백 상태를 넣기)
 */
type SimDummy = Dummy & { knock?: KnockState | null };

type BurstAction = Extract<FighterAction, { kind: 'burst' }>;
type DashAction = Extract<FighterAction, { kind: 'dash' }>;

const NEVER = -9999;

export class Sim implements SimView {
  /** 경기 진행 상태(점수·시간). teamfight 규칙은 Gameplay 담당 */
  match: MatchState = { mode: 'training', score: [0, 0], targetScore: 0, ticksLeft: -1, winner: null };
  readonly grid: Grid;
  readonly rng: Rng;
  tick = 0;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  lobs: Lob[] = [];
  private nextId = 1;
  private events: SimEvent[] = [];
  /** 이번 틱에 부서진 벽(틱 끝에 wallsBroken 하나로 알린다) */
  private broken: Vec2[] = [];
  private readonly byId = new Map<EntityId, Unit>();
  /** 이번 틱에 받은 넉백 방향의 합(같은 틱 여러 발을 하나로 합친다) */
  private readonly knockAcc = new Map<EntityId, { sx: number; sy: number; distance: number; fx: number; fy: number }>();

  constructor(opts: SimOptions) {
    this.grid = new Grid(opts.map);
    this.rng = new Rng(opts.seed);
    if ((opts.mode ?? 'training') === 'teamfight') {
      this.match = { mode: 'teamfight', score: [0, 0], targetScore: TEAMFIGHT_TARGET_SCORE, ticksLeft: TEAMFIGHT_TICKS, winner: null };
    }
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
        radius: fighterRadius(spec.fighterId),
        hp: def.hp,
        maxHp: def.hp,
        alive: true,
        respawnTick: 0,
        facing: defaultFacing(spec.team),
        lastCombatTick: NEVER,
        ammo: def.attack.ammo,
        maxAmmo: def.attack.ammo,
        superCharge: 0,
        inBush: isInBush(this.grid, spawn),
        revealedUntil: 0,
        moving: false,
        action: null,
      };
      this.addUnit(f);
    }
    if (opts.dummies) {
      for (const d of this.grid.dummySpawns) {
        const dummy: SimDummy = {
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
          facing: defaultFacing(1),
          lastCombatTick: NEVER,
          knock: null,
        };
        this.resetDummyBehavior(dummy);
        this.addUnit(dummy);
      }
    }
  }

  private addUnit(u: Unit) {
    this.units.push(u);
    this.byId.set(u.id, u);
  }

  getUnit(id: EntityId): Unit | undefined {
    return this.byId.get(id);
  }

  /** 한 틱 진행. inputs: 파이터 id → 입력 */
  step(inputs: ReadonlyMap<EntityId, FighterInput>): SimEvent[] {
    this.tick++;
    this.events = [];
    this.broken = [];
    this.knockAcc.clear();
    // 경기가 끝난 뒤: 입력·부활·회복·더미 행동은 멈추고, 이미 시작된 행동(연사·돌진·점프)과
    // 날아가는 탄은 끝까지 진행하되 피해·넉백·충전은 없다(over 확인)
    const over = this.over;
    if (!over) for (const u of this.units) if (!u.alive && this.tick >= u.respawnTick) this.respawn(u);
    for (const u of this.units) if (u.alive) this.stepKnockback(u);
    for (const u of this.units) if (u.alive && u.type === 'fighter') this.stepFighter(u, over ? undefined : inputs.get(u.id));
    if (!over) for (const u of this.units) if (u.alive && u.type === 'dummy') this.stepDummy(u);
    this.stepProjectiles();
    this.stepLobs();
    if (!over) for (const u of this.units) if (u.alive) this.regen(u);
    if (this.broken.length) this.events.push({ type: 'wallsBroken', tiles: dedupeTiles(this.broken) });
    if (!this.over) this.stepMatchClock();
    return this.events;
  }

  /** 경기가 끝났는가(training은 끝나지 않는다) */
  get over(): boolean {
    return this.match.winner !== null;
  }

  // ───────────── 경기(teamfight) ─────────────

  /** 남은 시간을 한 틱 줄이고, 0이 되면 점수로 승패를 정한다 */
  private stepMatchClock() {
    const m = this.match;
    if (m.ticksLeft <= 0) return; // -1: 무제한
    m.ticksLeft--;
    if (m.ticksLeft === 0) this.endMatch(m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1);
  }

  /** 파이터 u가 sourceId에게 쓰러졌다: teamfight면 상대 팀 득점, 목표 점수에 닿으면 경기 끝 */
  private scoreKo(u: Unit, sourceId: EntityId) {
    const m = this.match;
    if (m.mode !== 'teamfight' || this.over || u.type !== 'fighter') return;
    const killer = this.getUnit(sourceId);
    if (!killer || killer.team === u.team) return;
    m.score[killer.team]++;
    this.events.push({ type: 'score', team: killer.team, score: [m.score[0], m.score[1]], killerId: killer.id, victimId: u.id });
    if (m.targetScore > 0 && m.score[killer.team] >= m.targetScore) this.endMatch(killer.team);
  }

  private endMatch(winner: Team | -1) {
    if (this.over) return;
    this.match.winner = winner;
    this.events.push({ type: 'matchEnd', winner, score: [this.match.score[0], this.match.score[1]] });
  }

  // ───────────── 파이터 ─────────────

  private stepFighter(f: Fighter, input: FighterInput | undefined) {
    const def = getFighter(f.fighterId);
    if (f.ammo < f.maxAmmo) {
      f.ammo = Math.min(f.maxAmmo, f.ammo + TICK_DT / def.attack.reload);
      if (f.ammo > f.maxAmmo - EPS) f.ammo = f.maxAmmo;
    }
    f.moving = false;

    // 점프·넉백(2단계에서 이미 밀려남)·돌진 중에는 이동·공격 입력을 받지 않는다
    if (f.action?.kind === 'leap') {
      this.stepLeap(f, f.action);
      return;
    }
    if (f.action?.kind === 'knockback') {
      f.inBush = isInBush(this.grid, f.pos);
      return;
    }
    if (f.action?.kind === 'dash') {
      this.stepDash(f, f.action);
      f.inBush = isInBush(this.grid, f.pos);
      return;
    }

    const move = input ? clampLen(input.move, 1) : { x: 0, y: 0 };
    if (len(move) > 0.05) {
      const speed = def.moveSpeed * TICK_DT;
      const next = moveCircle(this.grid, f.pos, f.radius, move.x * speed, move.y * speed);
      f.moving = dist(next, f.pos) > 1e-4;
      f.pos = next;
      f.facing = angleOf(move);
    }
    f.inBush = isInBush(this.grid, f.pos);

    // 새 공격: 진행 중인 행동(연사 포함)이 없을 때만. 궁극기가 나가면 같은 틱의 기본 공격은 무시
    if (!f.action && input) {
      if (input.super && f.superCharge >= 1 - EPS) {
        this.startAttack(f, def, true, input.super.aim);
      } else if (input.attack) {
        if (f.ammo >= 1 - EPS) this.startAttack(f, def, false, input.attack.aim);
        else this.events.push({ type: 'noAmmo', unitId: f.id });
      }
    }

    if (f.action?.kind === 'burst') this.continueBurst(f, f.action);
  }

  private startAttack(f: Fighter, def: FighterDef, isSuper: boolean, aim: Aim) {
    const spec = shotSpec(def, isSuper);
    const { dir, ratio } = spec.kind === 'leap' ? resolveLeapAim(this, f, aim) : resolveAim(this, f, aim, spec.range);
    if (isSuper) f.superCharge = 0;
    else f.ammo = Math.max(0, f.ammo - 1);
    f.facing = dir;
    this.markCombat(f);
    this.events.push({ type: 'attack', unitId: f.id, isSuper, dir });
    switch (spec.kind) {
      case 'spread':
        this.fireSpread(f, spec, dir);
        break;
      case 'radial':
        this.fireRadial(f, spec, dir);
        break;
      case 'burst': {
        const act: BurstAction = { kind: 'burst', remaining: spec.count, nextTick: this.tick, dir, isSuper };
        f.action = act;
        this.continueBurst(f, act);
        break;
      }
      case 'dash':
        f.action = { kind: 'dash', dir, remaining: spec.range, speed: spec.projectileSpeed, hitIds: [] };
        break;
      case 'melee':
        this.doMelee(f, spec, dir);
        break;
      case 'lob':
        this.fireLob(f, spec, dir, ratio);
        break;
      case 'leap':
        this.startLeap(f, spec, dir, ratio);
        break;
    }
  }

  /** 공격했다: 회복 대기 다시 시작, 수풀 노출 */
  private markCombat(f: Fighter) {
    f.lastCombatTick = this.tick;
    f.revealedUntil = this.tick + REVEAL_TICKS;
  }

  private fireSpread(f: Fighter, spec: ShotSpec, dir: number) {
    const spread = (spec.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < spec.count; i++) {
      const k = spec.count > 1 ? i / (spec.count - 1) - 0.5 : 0;
      const mul = spec.speedJitter > 0 ? 1 + spec.speedJitter * (this.rng.next() * 2 - 1) : 1;
      this.spawnShot(f, spec, dir + k * spread, 0, mul);
    }
  }

  private fireRadial(f: Fighter, spec: ShotSpec, dir: number) {
    for (let i = 0; i < spec.count; i++) this.spawnShot(f, spec, dir + (i * Math.PI * 2) / spec.count, 0);
  }

  /** 연사: 이번 틱까지 나가야 할 탄을 쏜다. 다 쏘면 행동 끝 */
  private continueBurst(f: Fighter, act: BurstAction) {
    const spec = shotSpec(getFighter(f.fighterId), act.isSuper);
    const interval = Math.max(0, spec.burstInterval) * TICK_RATE;
    f.facing = act.dir;
    while (act.remaining > 0 && this.tick + 1e-6 >= act.nextTick) {
      const index = spec.count - act.remaining;
      // 한 발짜리 연사(저격 등)는 옆으로 띄우지 않는다
      const side = spec.lateralOffset && spec.count > 1 ? (index % 2 === 0 ? 1 : -1) * spec.lateralOffset : 0;
      this.spawnShot(f, spec, act.dir, side);
      act.remaining--;
      act.nextTick += interval;
      this.markCombat(f);
    }
    if (act.remaining <= 0 && f.action === act) f.action = null;
  }

  /**
   * 직선 투사체 하나. 몸 중심에서 출발한다(벽에 붙어 있어도 벽 안에서 시작하지 않게).
   * lateral: 진행 방향 기준 옆으로 띄우는 거리(+ = 진행 방향의 오른쪽, 화면 기준).
   */
  private spawnShot(owner: Unit, spec: ShotSpec, dir: number, lateral: number, speedMul = 1) {
    const radius = spec.isSuper ? SUPER_PROJECTILE_RADIUS : PROJECTILE_RADIUS;
    const maxLat = Math.max(0, owner.radius - radius);
    const lat = Math.sign(lateral) * Math.min(Math.abs(lateral), maxLat);
    const c = Math.cos(dir);
    const s = Math.sin(dir);
    this.projectiles.push({
      id: this.nextId++,
      type: 'projectile',
      ownerId: owner.id,
      team: owner.team,
      pos: { x: owner.pos.x - s * lat, y: owner.pos.y + c * lat },
      vel: fromAngle(dir, spec.projectileSpeed * speedMul),
      radius,
      damage: spec.damage,
      remaining: spec.range,
      isSuper: spec.isSuper,
      breaksWalls: spec.breaksWalls,
      knockback: spec.knockback,
      ...(spec.damageFar !== undefined ? { damageFar: spec.damageFar, range: spec.range } : {}),
      pierce: spec.pierce,
      hitIds: [],
    });
  }

  /** 근접: 전방 부채꼴 안, 시야가 트인 적에게 즉시 피해 */
  private doMelee(f: Fighter, spec: ShotSpec, dir: number) {
    this.events.push({ type: 'melee', unitId: f.id, isSuper: spec.isSuper, dir, range: spec.range, spreadDeg: spec.spreadDeg });
    const half = (spec.spreadDeg * Math.PI) / 360;
    if (spec.breaksWalls) {
      const c = { x: f.pos.x + Math.cos(dir) * spec.range * 0.5, y: f.pos.y + Math.sin(dir) * spec.range * 0.5 };
      this.broken.push(...breakWallsInCircle(this.grid, c, spec.range * 0.5));
    }
    for (const u of this.units) {
      if (!isHittable(u) || u.team === f.team) continue;
      const d = dist(f.pos, u.pos);
      if (d - u.radius > spec.range) continue;
      const tol = d > u.radius ? Math.asin(u.radius / d) : Math.PI;
      if (Math.abs(angleDiff(angleOf({ x: u.pos.x - f.pos.x, y: u.pos.y - f.pos.y }), dir)) > half + tol) continue;
      if (!hasLineOfSight(this.grid, f.pos, u.pos)) continue;
      this.damage(u, spec.damage, f.id, spec.isSuper);
      if (u.alive && spec.knockback > 0) this.applyKnockback(u, u.pos.x - f.pos.x, u.pos.y - f.pos.y, spec.knockback, dir);
      if (!spec.isSuper) this.chargeFromHit(f);
    }
  }

  /** 포물선: 조준 비율만큼 떨어진 지점에 비행 시간 뒤 범위 피해 */
  private fireLob(f: Fighter, spec: ShotSpec, dir: number, ratio: number) {
    const d = spec.range * Math.max(0, Math.min(1, ratio));
    const to = {
      x: Math.max(0, Math.min(this.grid.width, f.pos.x + Math.cos(dir) * d)),
      y: Math.max(0, Math.min(this.grid.height, f.pos.y + Math.sin(dir) * d)),
    };
    const flight = Math.max(1, Math.round((dist(f.pos, to) / spec.projectileSpeed) * TICK_RATE));
    this.lobs.push({
      id: this.nextId++,
      type: 'lob',
      ownerId: f.id,
      team: f.team,
      from: { ...f.pos },
      to,
      startTick: this.tick,
      endTick: this.tick + flight,
      damage: spec.damage,
      aoeRadius: spec.aoeRadius,
      isSuper: spec.isSuper,
      breaksWalls: spec.breaksWalls,
    });
  }

  /**
   * 돌진 한 틱: 앞쪽의 부서지는 벽을 부수고 직선으로 나아간다.
   * 단단한 벽·물·맵 끝에 막히면 막히기 직전에서 멈추고 돌진을 끝낸다.
   * 지나간 경로에 닿은 적은 한 번씩 피해 + 넉백.
   */
  private stepDash(f: Fighter, act: DashAction) {
    const spec = shotSpec(getFighter(f.fighterId), true);
    f.facing = act.dir;
    this.markCombat(f);
    const stepLen = Math.min(act.speed * TICK_DT, act.remaining);
    const dx = Math.cos(act.dir);
    const dy = Math.sin(act.dir);
    const from = { ...f.pos };
    const target = { x: from.x + dx * stepLen, y: from.y + dy * stepLen };
    if (spec.breaksWalls) this.broken.push(...breakWallsInCircle(this.grid, target, f.radius + DASH_BREAK_MARGIN));

    let to = target;
    let blocked = false;
    if (circleBlocked(this.grid, target.x, target.y, f.radius)) {
      blocked = true;
      to = from;
      const n = Math.max(1, Math.ceil(stepLen / 0.02));
      for (let i = 1; i <= n; i++) {
        const p = { x: from.x + (dx * stepLen * i) / n, y: from.y + (dy * stepLen * i) / n };
        if (circleBlocked(this.grid, p.x, p.y, f.radius)) break;
        to = p;
      }
    }
    f.pos = to;
    f.moving = dist(from, to) > 1e-4;
    act.remaining -= stepLen;

    for (const u of this.units) {
      if (!isHittable(u) || u.team === f.team || act.hitIds.includes(u.id)) continue;
      if (!segmentCircle(from, to, u.pos, f.radius + u.radius)) continue;
      act.hitIds.push(u.id);
      this.damage(u, spec.damage, f.id, true);
      if (u.alive && spec.knockback > 0) this.applyKnockback(u, u.pos.x - to.x, u.pos.y - to.y, spec.knockback, act.dir);
    }

    if (blocked || act.remaining <= 1e-6) {
      if (f.action === act) f.action = null;
    }
  }

  /**
   * 점프(leap) 시작: 목표 = 현재 위치 + dir × max(MIN_LEAP_DIST, range × ratio).
   * 벽·물을 넘어가고, 착지 지점은 findLanding으로 맵 안의 막히지 않은 곳으로 고른다.
   * 뛴 자리에 count개의 폭탄(lob)을 반지름 LEAP_BOMB_RING 원 위에 균등하게 떨어뜨린다(첫 폭탄은 점프 반대 방향).
   */
  private startLeap(f: Fighter, spec: ShotSpec, dir: number, ratio: number) {
    const from = { ...f.pos };
    const d = Math.max(MIN_LEAP_DIST, spec.range * Math.max(0, Math.min(1, ratio)));
    const raw = { x: from.x + Math.cos(dir) * d, y: from.y + Math.sin(dir) * d };
    const to = this.findLanding(from, raw, f.radius);
    const ticks = Math.max(1, secToTicks(spec.leapTime));
    f.action = { kind: 'leap', from, to, startTick: this.tick, endTick: this.tick + ticks };
    f.moving = false;
    f.inBush = false;

    const fuse = Math.max(1, secToTicks(spec.fuse));
    for (let i = 0; i < spec.count; i++) {
      const a = dir + Math.PI + (i * Math.PI * 2) / spec.count;
      this.lobs.push({
        id: this.nextId++,
        type: 'lob',
        ownerId: f.id,
        team: f.team,
        from: { ...from },
        to: this.clampToMap({ x: from.x + Math.cos(a) * LEAP_BOMB_RING, y: from.y + Math.sin(a) * LEAP_BOMB_RING }),
        startTick: this.tick,
        endTick: this.tick + fuse,
        damage: spec.damage,
        aoeRadius: spec.aoeRadius,
        isSuper: true,
        breaksWalls: spec.breaksWalls,
      });
    }
  }

  /**
   * 반지름 r인 몸이 내려앉을 곳. target이 막히지 않았으면 그대로.
   * 막혔으면 target에서 LEAP_LAND_SEARCH 안의 가장 가까운 빈 곳(0.1타일 간격 동심원, 같은 거리면 출발점 쪽부터),
   * 그것도 없으면 target에서 출발점 쪽으로 직선을 따라 물러나며 처음 비는 곳. 맵 밖은 막힌 것으로 본다.
   */
  private findLanding(from: Vec2, target: Vec2, r: number): Vec2 {
    const free = (p: Vec2) => !circleBlocked(this.grid, p.x, p.y, r);
    if (free(target)) return { ...target };
    const back = Math.atan2(from.y - target.y, from.x - target.x);
    const RING = 0.1;
    for (let k = 1; k * RING <= LEAP_LAND_SEARCH + 1e-9; k++) {
      const rr = k * RING;
      const n = Math.max(8, Math.ceil((Math.PI * 2 * rr) / RING));
      for (let i = 0; i < n; i++) {
        const a = back + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * ((Math.PI * 2) / n);
        const p = { x: target.x + Math.cos(a) * rr, y: target.y + Math.sin(a) * rr };
        if (free(p)) return p;
      }
    }
    const total = dist(from, target);
    const STEP = 0.05;
    for (let k = 1; k * STEP < total; k++) {
      const p = lerpVec(target, from, (k * STEP) / total);
      if (free(p)) return p;
    }
    return { ...from };
  }

  private clampToMap(p: Vec2): Vec2 {
    return { x: Math.max(0, Math.min(this.grid.width, p.x)), y: Math.max(0, Math.min(this.grid.height, p.y)) };
  }

  /** 점프 중: from→to로 직선 이동. endTick에 착지하고, 그 틱에는 아직 이동·공격하지 않는다 */
  private stepLeap(f: Fighter, act: Extract<FighterAction, { kind: 'leap' }>) {
    const span = Math.max(1, act.endTick - act.startTick);
    const k = Math.max(0, Math.min(1, (this.tick - act.startTick) / span));
    f.pos = lerpVec(act.from, act.to, k);
    if (dist(act.from, act.to) > 1e-9) f.facing = Math.atan2(act.to.y - act.from.y, act.to.x - act.from.x);
    f.moving = false;
    f.inBush = false;
    if (this.tick >= act.endTick) {
      f.pos = { ...act.to };
      if (f.action === act) f.action = null;
      f.inBush = isInBush(this.grid, f.pos);
    }
  }

  // ───────────── 더미 ─────────────

  private resetDummyBehavior(d: Dummy) {
    if (d.behavior === 'patrol') {
      d.patrolFrom = { x: d.spawn.x - PATROL_HALF_WIDTH, y: d.spawn.y };
      d.patrolTo = { x: d.spawn.x + PATROL_HALF_WIDTH, y: d.spawn.y };
      d.patrolForward = true;
    }
    if (d.behavior === 'turret') d.nextFireTick = this.tick + TURRET_INTERVAL_TICKS;
  }

  private stepDummy(d: Dummy) {
    if ((d as SimDummy).knock) return; // 밀려나는 중에는 아무것도 하지 않는다
    if (d.behavior === 'patrol') this.stepPatrol(d);
    else if (d.behavior === 'turret') this.stepTurret(d);
  }

  /** 시작점 기준 좌우 PATROL_HALF_WIDTH 타일을 오간다. 끝에 닿거나 벽에 막히면 반대로 */
  private stepPatrol(d: Dummy) {
    const forward = d.patrolForward !== false;
    const goal = (forward ? d.patrolTo : d.patrolFrom) ?? d.spawn;
    const gx = goal.x - d.pos.x;
    const gy = goal.y - d.pos.y;
    const l = Math.hypot(gx, gy);
    if (l < 1e-3) {
      d.patrolForward = !forward;
      return;
    }
    const step = Math.min(PATROL_SPEED * TICK_DT, l);
    const next = moveCircle(this.grid, d.pos, d.radius, (gx / l) * step, (gy / l) * step);
    const moved = dist(next, d.pos);
    d.pos = next;
    d.facing = Math.atan2(gy, gx);
    if (l <= step + 1e-9 || moved < step * 0.5) d.patrolForward = !forward;
  }

  /** TURRET_INTERVAL마다 사거리 안·보이는·시야가 트인 가장 가까운 적 파이터에게 느린 탄 */
  private stepTurret(d: Dummy) {
    const target = this.turretTarget(d);
    if (!target) return;
    const dir = Math.atan2(target.pos.y - d.pos.y, target.pos.x - d.pos.x);
    d.facing = dir;
    if (this.tick < (d.nextFireTick ?? 0)) return;
    d.nextFireTick = this.tick + TURRET_INTERVAL_TICKS;
    d.lastCombatTick = this.tick;
    this.projectiles.push({
      id: this.nextId++,
      type: 'projectile',
      ownerId: d.id,
      team: d.team,
      pos: { ...d.pos },
      vel: fromAngle(dir, TURRET_SHOT_SPEED),
      radius: TURRET_SHOT_RADIUS,
      damage: TURRET_DAMAGE,
      remaining: TURRET_SHOT_RANGE,
      isSuper: false,
      breaksWalls: false,
      knockback: 0,
      pierce: false,
      hitIds: [],
    });
    this.events.push({ type: 'attack', unitId: d.id, isSuper: false, dir });
  }

  private turretTarget(d: Dummy): Fighter | null {
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.type !== 'fighter' || !isHittable(u) || u.team === d.team) continue;
      const dd = dist(d.pos, u.pos);
      if (dd > TURRET_RANGE || dd >= bestD) continue;
      if (!isVisibleTo(this, u, d.team)) continue;
      if (!hasLineOfSight(this.grid, d.pos, u.pos)) continue;
      best = u;
      bestD = dd;
    }
    return best;
  }

  // ───────────── 투사체 ─────────────

  private stepProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) if (this.stepProjectile(p)) keep.push(p);
    this.projectiles = keep;
  }

  /**
   * 투사체 한 틱. 계속 날아가면 true.
   * 경로 위에서 처음 닿는 적을 찾고, 그 지점까지 벽 스윕을 한다(벽이 먼저면 벽에서 멈춤).
   * breaksWalls면 지나가는 부서지는 벽을 부수며 계속 간다(단단한 벽에서만 멈춤).
   */
  private stepProjectile(p: Projectile): boolean {
    const speed = len(p.vel);
    const stepLen = Math.min(speed * TICK_DT, p.remaining);
    if (speed < 1e-9 || stepLen <= 0) {
      this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...p.pos }, reason: 'range' });
      return false;
    }
    const to = { x: p.pos.x + (p.vel.x / speed) * stepLen, y: p.pos.y + (p.vel.y / speed) * stepLen };

    /** 이번 틱 전까지 날아간 거리(range가 있는 투사체만 의미 있음) */
    const flown = p.range !== undefined ? p.range - p.remaining : 0;
    const hits: { u: Unit; t: number }[] = [];
    for (const u of this.units) {
      // 점프 중인 유닛은 투사체가 그대로 지나간다
      if (!isHittable(u) || u.team === p.team || p.hitIds.includes(u.id)) continue;
      const t = segmentCircleT(p.pos, to, u.pos, u.radius + p.radius);
      if (t >= 0) hits.push({ u, t });
    }
    hits.sort((a, b) => a.t - b.t || a.u.id - b.u.id);

    const first = hits[0];
    const reach = !p.pierce && first ? lerpVec(p.pos, to, first.t) : to;
    const sweep = sweepCircle(this.grid, p.pos, reach, p.radius, p.breaksWalls ? { breakWalls: true } : {});
    if (sweep.broken.length) this.broken.push(...sweep.broken);
    const traveled = sweep.hit ? dist(p.pos, sweep.point) : dist(p.pos, reach);

    if (p.pierce) {
      for (const h of hits) {
        if (sweep.hit && h.t * stepLen > traveled + 1e-9) break;
        p.hitIds.push(h.u.id);
        this.projectileHit(p, h.u, flown + h.t * stepLen);
      }
    } else if (first && !sweep.hit) {
      const at = { ...reach };
      const traveled = flown + dist(p.pos, reach);
      p.pos = at;
      this.projectileHit(p, first.u, traveled);
      this.events.push({ type: 'projectileEnd', id: p.id, pos: at, reason: 'hit' });
      return false;
    }

    if (sweep.hit) {
      p.pos = { ...sweep.point };
      p.remaining -= traveled;
      this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...p.pos }, reason: 'wall' });
      return false;
    }
    p.pos = to;
    p.remaining -= stepLen;
    if (p.remaining <= 1e-3) {
      this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...p.pos }, reason: 'range' });
      return false;
    }
    return true;
  }

  /** traveled: 발사 지점부터 맞은 지점까지 날아간 거리(거리 비례 피해용) */
  private projectileHit(p: Projectile, u: Unit, traveled: number) {
    if (this.over) return; // 경기가 끝난 뒤의 탄은 아무 효과 없음
    this.damage(u, distanceDamage(p, traveled), p.ownerId, p.isSuper);
    if (u.alive && p.knockback > 0) this.applyKnockback(u, p.vel.x, p.vel.y, p.knockback, angleOf(p.vel));
    if (!p.isSuper) {
      const owner = this.getUnit(p.ownerId);
      if (owner?.type === 'fighter') this.chargeFromHit(owner);
    }
  }

  private stepLobs() {
    if (!this.lobs.length) return;
    const keep: Lob[] = [];
    for (const l of this.lobs) {
      if (this.tick < l.endTick) {
        keep.push(l);
        continue;
      }
      this.events.push({ type: 'explode', pos: { ...l.to }, radius: l.aoeRadius, isSuper: l.isSuper });
      if (l.breaksWalls) this.broken.push(...breakWallsInCircle(this.grid, l.to, l.aoeRadius));
      const owner = this.getUnit(l.ownerId);
      for (const u of this.units) {
        if (!isHittable(u) || u.team === l.team) continue;
        if (dist(u.pos, l.to) > l.aoeRadius + u.radius) continue;
        this.damage(u, l.damage, l.ownerId, l.isSuper);
        if (!l.isSuper && owner?.type === 'fighter') this.chargeFromHit(owner);
      }
    }
    this.lobs = keep;
  }

  // ───────────── 피해·넉백·충전·회복·부활 ─────────────

  /** 기본 공격 적중 1회분 궁극기 충전. 1이 되는 순간 superReady */
  private chargeFromHit(f: Fighter) {
    if (f.superCharge >= 1 || this.over) return;
    f.superCharge = Math.min(1, f.superCharge + getFighter(f.fighterId).attack.superChargePerHit);
    if (f.superCharge >= 1 - EPS) {
      f.superCharge = 1;
      this.events.push({ type: 'superReady', unitId: f.id });
    }
  }

  private damage(u: Unit, amount: number, sourceId: EntityId, isSuper: boolean) {
    if (!isHittable(u) || amount <= 0 || this.over) return;
    u.hp = Math.max(0, u.hp - amount);
    u.lastCombatTick = this.tick;
    const killed = u.hp <= 0;
    this.events.push({ type: 'hit', targetId: u.id, sourceId, damage: amount, pos: { ...u.pos }, isSuper, killed });
    if (killed) this.kill(u, sourceId);
  }

  private kill(u: Unit, sourceId: EntityId) {
    u.alive = false;
    u.respawnTick = this.tick + (u.type === 'fighter' ? FIGHTER_RESPAWN_TICKS : DUMMY_RESPAWN_TICKS);
    if (u.type === 'fighter') {
      u.action = null;
      u.moving = false;
    } else {
      (u as SimDummy).knock = null;
    }
    this.events.push({ type: 'death', unitId: u.id, pos: { ...u.pos } });
    this.scoreKo(u, sourceId);
  }

  /**
   * (dirX, dirY) 방향으로 distance 타일만큼 KNOCKBACK_TICKS 동안 밀어낸다.
   * 같은 틱에 여러 번 맞으면(산탄 여러 발) 방향은 맞은 방향들의 합, 거리는 가장 긴 값 하나만 적용한다.
   * 돌진 중인 파이터는 밀리지 않는다. 방향 벡터가 0이면 fallbackDir(라디안) 방향.
   */
  private applyKnockback(u: Unit, dirX: number, dirY: number, distance: number, fallbackDir: number) {
    if (!isHittable(u) || distance <= 0 || this.over) return;
    if (u.type === 'fighter' && u.action?.kind === 'dash') return;
    let l = Math.hypot(dirX, dirY);
    if (l < 1e-6) {
      dirX = Math.cos(fallbackDir);
      dirY = Math.sin(fallbackDir);
      l = 1;
    }
    let acc = this.knockAcc.get(u.id);
    if (acc) {
      acc.sx += dirX / l;
      acc.sy += dirY / l;
      acc.distance = Math.max(acc.distance, distance);
    } else {
      acc = { sx: dirX / l, sy: dirY / l, distance, fx: dirX / l, fy: dirY / l };
      this.knockAcc.set(u.id, acc);
    }
    let sl = Math.hypot(acc.sx, acc.sy);
    let ux = acc.sx;
    let uy = acc.sy;
    if (sl < 1e-6) {
      ux = acc.fx;
      uy = acc.fy;
      sl = 1;
    }
    const speed = acc.distance / (KNOCKBACK_TICKS * TICK_DT);
    const k: KnockState = { vx: (ux / sl) * speed, vy: (uy / sl) * speed, untilTick: this.tick + KNOCKBACK_TICKS };
    if (u.type === 'fighter') {
      u.action = { kind: 'knockback', ...k };
      u.moving = false;
    } else {
      (u as SimDummy).knock = k;
    }
  }

  /** 넉백 이동: 맞은 다음 틱부터 untilTick까지 매 틱 밀려나고, 그 다음 틱에 풀린다 */
  private stepKnockback(u: Unit) {
    const k = knockOf(u);
    if (!k) return;
    if (this.tick > k.untilTick) {
      if (u.type === 'fighter') u.action = null;
      else (u as SimDummy).knock = null;
      return;
    }
    u.pos = moveCircle(this.grid, u.pos, u.radius, k.vx * TICK_DT, k.vy * TICK_DT);
  }

  private regen(u: Unit) {
    if (u.hp >= u.maxHp) return;
    const dummy = u.type === 'dummy';
    if (this.tick - u.lastCombatTick < (dummy ? DUMMY_REGEN_DELAY_TICKS : REGEN_DELAY_TICKS)) return;
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * (dummy ? DUMMY_REGEN_PER_SEC : REGEN_PER_SEC) * TICK_DT);
  }

  private respawn(u: Unit) {
    u.alive = true;
    u.hp = u.maxHp;
    u.pos = { ...u.spawn };
    u.facing = defaultFacing(u.team);
    u.lastCombatTick = NEVER;
    if (u.type === 'fighter') {
      u.ammo = u.maxAmmo;
      u.action = null;
      u.moving = false;
      u.revealedUntil = 0;
      u.inBush = isInBush(this.grid, u.pos);
    } else {
      (u as SimDummy).knock = null;
      this.resetDummyBehavior(u);
    }
    this.events.push({ type: 'respawn', unitId: u.id });
  }
}

function defaultFacing(team: Team): number {
  return team === 0 ? 0 : Math.PI;
}

function knockOf(u: Unit): KnockState | null {
  if (u.type === 'fighter') return u.action?.kind === 'knockback' ? u.action : null;
  return (u as SimDummy).knock ?? null;
}

function dedupeTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const t of tiles) {
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
