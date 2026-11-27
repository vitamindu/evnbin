import { powerMult } from '../data/power';
import { getFighter, type FighterDef, type FighterId, type SuperKind } from '../data/fighters';
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
  CRYSTAL_COUNTDOWN_TICKS,
  CRYSTAL_DROP_SPREAD,
  CRYSTAL_FIRST_SPAWN_TICKS,
  CRYSTAL_MATCH_TICKS,
  CRYSTAL_MAX_ON_FLOOR,
  CRYSTAL_RADIUS,
  CRYSTAL_SPAWN_INTERVAL_TICKS,
  CRYSTAL_SPAWN_SCATTER,
  CRYSTAL_WIN_COUNT,
  LOB_FLIGHT_TICKS,
  LOB_MIN_DIST,
  LOB_SPACING,
  ZONE_HIT_TICKS,
  ZONE_MIN_DIST,
  BALL_BOUNCE_DAMP,
  BALL_CARRY_OFFSET,
  BALL_FRICTION,
  BALL_KICKOFF_TICKS,
  BALL_KICK_SPEED,
  BALL_MATCH_TICKS,
  BALL_POWER_KICK_SPEED,
  BALL_RADIUS,
  BALL_REPICK_TICKS,
  BALL_STOP_SPEED,
  BALL_TARGET_SCORE,
  BALL_WATER_MIN_SPEED,
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
  type Ball,
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
  type Crystal,
  type Zone,
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
  Tile,
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
  /** 벽에 닿으면 튕기는 횟수(0이면 벽에서 사라짐) */
  bounces: number;
  /** leap: true면 폭탄 대신 착지 지점 내려찍기 */
  slam: boolean;
  /** spread: 탄마다 속도 ±비율 */
  speedJitter: number;
  /** 데이터에 탄속이 있었는가(lob은 0이면 고정 비행 시간) */
  speedGiven: boolean;
  /** 기본 공격 파편 */
  split?: { count: number; damage: number; range: number; speed: number };
  /** zone 궁극기 */
  zone?: { radius: number; duration: number; slow: number; dps: number };
  /** leap: 공중에 떠 있는 시간(초) */
  leapTime: number;
  /** leap: 폭탄이 터지기까지(초) */
  fuse: number;
  /** lob: 땅에 떨어진 뒤 터지기까지(초) */
  lobFuse: number;
  /** 투사체 반지름(없으면 기본) */
  projectileRadius?: number;
  /** leap: 폭탄·내려찍기 없이 이동만 */
  moveOnly?: boolean;
  /** Chainer Q: 바닥을 내리치는 사슬(반지름, 터지기까지 틱) */
  chainSlam?: { radius: number; delayTicks: number };
  /** 복사 궁극기 효과 출처 */
  superSourceId?: FighterId;
}

export function shotSpec(def: FighterDef, isSuper: boolean, superSourceId?: FighterId): ShotSpec {
  if (isSuper) {
    const s = superSourceId ? getFighter(superSourceId).super : def.super;
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
      bounces: s.bounces ?? 0,
      slam: s.slam ?? false,
      speedJitter: s.speedJitter ?? 0,
      speedGiven: s.projectileSpeed > 0,
      zone: s.zone,
      aoeRadius: s.aoeRadius ?? DEFAULT_LOB_AOE,
      leapTime: s.leapTime ?? DEFAULT_LEAP_TIME,
      fuse: s.fuse ?? DEFAULT_FUSE,
      lobFuse: s.kind === 'lob' ? (s.fuse ?? 0) : 0,
      ...(s.projectileRadius ? { projectileRadius: s.projectileRadius } : {}),
      ...(s.moveOnly ? { moveOnly: true } : {}),
      ...(superSourceId ? { superSourceId } : {}),
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
    bounces: a.bounces ?? 0,
    slam: false,
    speedJitter: a.speedJitter ?? 0,
    speedGiven: a.projectileSpeed > 0,
    split: a.split,
    aoeRadius: a.aoeRadius ?? DEFAULT_LOB_AOE,
    damageFar: a.damageFar,
    leapTime: DEFAULT_LEAP_TIME,
    fuse: DEFAULT_FUSE,
    lobFuse: a.kind === 'lob' ? (a.fuse ?? 0) : 0,
    ...(a.chainSlam ? { chainSlam: { radius: a.chainSlam.radius, delayTicks: Math.max(1, secToTicks(a.chainSlam.delay)) } } : {}),
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
  /** 크리스탈 러시: 바닥의 크리스탈(규칙은 Gameplay 담당) */
  crystals: Crystal[] = [];
  /** 파이터 볼의 공(다른 모드는 null) */
  ball: Ball | null = null;
  /** 지대(서리 지대 등). 규칙은 Gameplay 담당 */
  zones: Zone[] = [];
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
  /** 공격 묶음 번호(넉백 한 번 규칙) */
  private nextGroup = 1;
  /** 파편으로 갈라지는 본탄 → 파편 값 */
  private readonly splitters = new Map<EntityId, { count: number; damage: number; range: number; speed: number }>();
  /** stepProjectile 동안 마지막으로 맞힌 유닛 */
  private lastHitId: EntityId | null = null;
  /** 지대별·유닛별 아직 주지 않은 소수 피해 */
  private readonly zoneAcc = new Map<string, number>();
  /** lob id → 넉백 거리 */
  private readonly lobKnock = new Map<EntityId, number>();
  /** 대상별로 이미 넉백을 준 탄 묶음 */
  private readonly knockedBy = new Map<EntityId, Set<number>>();
  private readonly knockAcc = new Map<EntityId, { sx: number; sy: number; distance: number; fx: number; fy: number }>();

  constructor(opts: SimOptions) {
    this.grid = new Grid(opts.map);
    this.rng = new Rng(opts.seed);
    if ((opts.mode ?? 'training') === 'teamfight') {
      this.match = { mode: 'teamfight', score: [0, 0], targetScore: TEAMFIGHT_TARGET_SCORE, ticksLeft: TEAMFIGHT_TICKS, winner: null };
    } else if (opts.mode === 'crystal') {
      this.match = {
        mode: 'crystal',
        score: [0, 0],
        targetScore: CRYSTAL_WIN_COUNT,
        ticksLeft: CRYSTAL_MATCH_TICKS,
        winner: null,
        crystals: [0, 0],
        countdownTicks: -1,
        countdownTeam: null,
      };
    } else if (opts.mode === 'ball') {
      this.match = { mode: 'ball', score: [0, 0], targetScore: BALL_TARGET_SCORE, ticksLeft: BALL_MATCH_TICKS, winner: null, kickoffTicks: 0 };
    }
    for (const spec of opts.fighters) {
      const spawns = this.grid.teamSpawns[spec.team];
      const spawn = spawns[spec.spawnIndex % Math.max(1, spawns.length)] ?? { x: 2, y: 2 };
      const def = getFighter(spec.fighterId);
      const hp = Math.round(def.hp * powerMult(spec.power));
      const f: Fighter = {
        id: this.nextId++,
        type: 'fighter',
        fighterId: spec.fighterId,
        controller: spec.controller,
        team: spec.team,
        pos: { ...spawn },
        spawn: { ...spawn },
        radius: fighterRadius(spec.fighterId),
        hp,
        maxHp: hp,
        ...(spec.power && spec.power > 1 ? { power: spec.power } : {}),
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
      if (this.match.mode === 'crystal') f.crystals = 0;
      this.addUnit(f);
    }
    // 공은 파이터 다음에 만든다: 파이터 id는 명단 순서대로 1, 2, 3…이어야 한다(src/net/roster.ts)
    if (this.match.mode === 'ball') {
      const at = this.grid.ballSpawn;
      if (at) this.ball = { id: this.nextId++, type: 'ball', pos: { ...at }, vel: { x: 0, y: 0 }, carrierId: null, noPickupUntil: 0, kickerId: null };
    }
    if (opts.dummies && this.match.mode !== 'ball') {
      for (const d of this.grid.dummySpawns) {
        const dummy: SimDummy = {
          id: this.nextId++,
          type: 'dummy',
          behavior: d.behavior,
          ...(d.axis ? { patrolAxis: d.axis } : {}),
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
    // 파이터 볼 킥오프 대기: 모두(탄·지대 포함) 멈춘다
    if ((this.match.kickoffTicks ?? 0) > 0) {
      this.stepKickoff();
      return this.events;
    }
    // 경기가 끝난 뒤: 입력·부활·회복·더미 행동은 멈추고, 이미 시작된 행동(연사·돌진·점프)과
    // 날아가는 탄은 끝까지 진행하되 피해·넉백·충전은 없다(over 확인)
    const over = this.over;
    if (!over) for (const u of this.units) if (!u.alive && this.tick >= u.respawnTick) this.respawn(u);
    for (const u of this.units) if (u.alive) this.stepKnockback(u);
    for (const u of this.units) if (u.alive && u.type === 'fighter') this.stepFighter(u, over ? undefined : inputs.get(u.id));
    if (!over) for (const u of this.units) if (u.alive && u.type === 'dummy') this.stepDummy(u);
    this.stepProjectiles();
    this.stepLobs();
    if (!over) this.stepZones();
    if (!over && this.match.mode === 'crystal') this.stepCrystals();
    if (!over && this.ball) this.stepBall();
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

  // ───────────── 크리스탈 러시 ─────────────

  /** 다음 크리스탈 생성 틱 */
  private nextCrystalTick = CRYSTAL_FIRST_SPAWN_TICKS;
  private nextSpawnPoint = 0;

  /**
   * 한 틱: 생성(CRYSTAL_FIRST_SPAWN_TICKS 뒤 CRYSTAL_SPAWN_INTERVAL_TICKS마다, 바닥에 CRYSTAL_MAX_ON_FLOOR개까지),
   * 줍기(닿으면), 팀 합계(match.crystals = match.score), 카운트다운(합계 CRYSTAL_WIN_COUNT 이상이고 상대보다 많으면).
   */
  private stepCrystals() {
    const m = this.match;
    if (this.tick >= this.nextCrystalTick) {
      this.nextCrystalTick += CRYSTAL_SPAWN_INTERVAL_TICKS;
      const points = this.grid.crystalSpawns;
      if (points.length && this.crystals.length < CRYSTAL_MAX_ON_FLOOR) {
        const base = points[this.nextSpawnPoint++ % points.length]!;
        this.placeCrystal(base, CRYSTAL_SPAWN_SCATTER, true);
      }
    }

    for (const u of this.units) {
      if (u.type !== 'fighter' || !isHittable(u) || !this.crystals.length) continue;
      const r = u.radius + CRYSTAL_RADIUS;
      const keep: Crystal[] = [];
      for (const c of this.crystals) {
        const dx = c.pos.x - u.pos.x;
        const dy = c.pos.y - u.pos.y;
        if (dx * dx + dy * dy <= r * r) {
          u.crystals = (u.crystals ?? 0) + 1;
          this.events.push({ type: 'crystalPickup', unitId: u.id, crystalId: c.id, carried: u.crystals });
        } else keep.push(c);
      }
      this.crystals = keep;
    }

    this.updateCrystalTotals();
    const t = m.crystals!;
    const leader: Team | null = t[0] >= CRYSTAL_WIN_COUNT && t[0] > t[1] ? 0 : t[1] >= CRYSTAL_WIN_COUNT && t[1] > t[0] ? 1 : null;
    if (leader === null) {
      if (m.countdownTeam != null) {
        m.countdownTeam = null;
        m.countdownTicks = -1;
        this.events.push({ type: 'countdown', team: null, ticks: -1 });
      }
    } else if (m.countdownTeam !== leader) {
      m.countdownTeam = leader;
      m.countdownTicks = CRYSTAL_COUNTDOWN_TICKS;
      this.events.push({ type: 'countdown', team: leader, ticks: CRYSTAL_COUNTDOWN_TICKS });
    } else {
      m.countdownTicks = (m.countdownTicks ?? CRYSTAL_COUNTDOWN_TICKS) - 1;
      if (m.countdownTicks <= 0) {
        m.countdownTicks = 0;
        this.endMatch(leader);
      }
    }
  }

  /** 팀별 들고 있는 크리스탈 합계. score에도 같은 값(점수판·시간 끝 판정용) */
  private updateCrystalTotals() {
    const t: [number, number] = [0, 0];
    for (const u of this.units) if (u.type === 'fighter') t[u.team] += u.crystals ?? 0;
    this.match.crystals = t;
    this.match.score = [t[0], t[1]];
  }

  /** around에서 spread 안의 걸을 수 있는 곳에 크리스탈 하나(못 찾으면 around 그대로) */
  private placeCrystal(around: Vec2, spread: number, announce: boolean) {
    let pos = { ...around };
    for (let i = 0; i < 12; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * spread;
      const p = { x: around.x + Math.cos(a) * r, y: around.y + Math.sin(a) * r };
      if (!circleBlocked(this.grid, p.x, p.y, CRYSTAL_RADIUS)) {
        pos = p;
        break;
      }
    }
    const c: Crystal = { id: this.nextId++, type: 'crystal', pos };
    this.crystals.push(c);
    if (announce) this.events.push({ type: 'crystalSpawn', id: c.id, pos: { ...pos } });
    return c;
  }

  /** 쓰러진 파이터가 들고 있던 크리스탈을 그 자리 주변에 흩뿌린다 */
  private dropCrystals(f: Fighter) {
    const n = f.crystals ?? 0;
    if (this.match.mode !== 'crystal' || n <= 0) return;
    f.crystals = 0;
    for (let i = 0; i < n; i++) this.placeCrystal(f.pos, CRYSTAL_DROP_SPREAD, false);
    this.events.push({ type: 'crystalDrop', unitId: f.id, pos: { ...f.pos }, count: n });
    this.updateCrystalTotals();
  }

  private endMatch(winner: Team | -1) {
    if (this.over) return;
    this.match.winner = winner;
    this.events.push({ type: 'matchEnd', winner, score: [this.match.score[0], this.match.score[1]] });
  }

  // ───────────── 파이터 볼 ─────────────

  /** 강슛으로 굴러가는 중(지나가는 부서지는 벽을 부순다). 멈추거나 누가 주우면 끝 */

  /**
   * 한 틱: 굴러가는 공 이동(마찰·벽 튕김) → 줍기 → 든 공은 운반자를 따라감 → 골 판정.
   * 골: 놓인 공의 중심이 팀 T의 골대 칸이거나, 운반자가 상대 팀 T의 골대 칸에 들어가면 T의 상대 팀 득점.
   */
  private stepBall() {
    const b = this.ball!;
    if (b.carrierId === null) this.rollBall(b);

    if (b.carrierId === null) {
      for (const u of this.units) {
        if (u.type !== 'fighter' || !isHittable(u)) continue;
        if (u.id === b.kickerId && this.tick < b.noPickupUntil) continue;
        const r = u.radius + BALL_RADIUS;
        const dx = b.pos.x - u.pos.x;
        const dy = b.pos.y - u.pos.y;
        if (dx * dx + dy * dy > r * r) continue;
        b.carrierId = u.id;
        b.vel = { x: 0, y: 0 };
        if (u.action?.kind === 'burst') u.action = null;
        this.events.push({ type: 'ballPickup', unitId: u.id });
        break;
      }
    }

    const carrier = b.carrierId !== null ? this.getUnit(b.carrierId) : undefined;
    if (carrier) {
      b.pos = { x: carrier.pos.x + Math.cos(carrier.facing) * BALL_CARRY_OFFSET, y: carrier.pos.y + Math.sin(carrier.facing) * BALL_CARRY_OFFSET };
      const g = this.grid.goalAt(carrier.pos.x, carrier.pos.y);
      if (g !== null && g !== carrier.team) this.scoreGoal(g, carrier.id);
    } else {
      const g = this.grid.goalAt(b.pos.x, b.pos.y);
      // 자책골은 없다: 찬 사람 팀의 골대에는 공이 들어가지 않는다(rollBall에서 튕겨 나간다)
      if (g !== null && g !== this.kickerTeam(b)) this.scoreGoal(g, b.kickerId);
    }
  }

  /** 마지막으로 찬 사람의 팀(없으면 null) */
  private kickerTeam(b: Ball): Team | null {
    const k = b.kickerId !== null ? this.getUnit(b.kickerId) : undefined;
    return k ? k.team : null;
  }

  /**
   * 놓인 공 한 틱: 이번 틱 속도로 움직이며 벽에 튕기고(감쇠), 그 뒤 마찰로 느려진다. 물·수풀 위는 지나간다.
   * 강슛도 벽은 부수지 않는다. 찬 사람 팀의 골대 칸은 벽처럼 튕겨 낸다(자책골 없음).
   */
  private rollBall(b: Ball) {
    let speed = len(b.vel);
    if (speed <= 0) return;
    const own = this.kickerTeam(b);
    let budget = speed * TICK_DT;
    for (let i = 0; i < 4 && budget > 1e-9; i++) {
      const to = { x: b.pos.x + (b.vel.x / speed) * budget, y: b.pos.y + (b.vel.y / speed) * budget };
      const sweep = sweepCircle(this.grid, b.pos, to, BALL_RADIUS, {});
      if (!sweep.hit) {
        if (own !== null && this.grid.goalAt(to.x, to.y) === own) {
          // 우리 골대 입구에서 튕겨 나온다(골대는 맵 위·아래 끝이라 세로 방향을 뒤집는다)
          b.vel = { x: b.vel.x * BALL_BOUNCE_DAMP, y: -b.vel.y * BALL_BOUNCE_DAMP };
          speed = len(b.vel);
          break;
        }
        b.pos = to;
        break;
      }
      budget -= dist(b.pos, sweep.point);
      b.pos = { ...sweep.point };
      const r = reflectOffWalls(this.grid, b.pos, b.vel, BALL_RADIUS);
      b.vel = { x: r.x * BALL_BOUNCE_DAMP, y: r.y * BALL_BOUNCE_DAMP };
      speed = len(b.vel);
      budget *= BALL_BOUNCE_DAMP;
    }
    let next = Math.max(0, speed - BALL_FRICTION * TICK_DT);
    if (this.grid.get(Math.floor(b.pos.x), Math.floor(b.pos.y)) === Tile.Water) next = Math.max(next, BALL_WATER_MIN_SPEED);
    else if (next < BALL_STOP_SPEED) next = 0;
    if (next === 0 || speed < 1e-9) {
      b.vel = { x: 0, y: 0 };
    } else {
      b.vel = { x: (b.vel.x / speed) * next, y: (b.vel.y / speed) * next };
    }
  }

  /** 팀 team의 골대 가운데(골대가 없으면 null) */
  goalCenter(team: Team): Vec2 | null {
    const tiles = this.grid.goalTiles[team];
    if (!tiles.length) return null;
    let x = 0;
    let y = 0;
    for (const t of tiles) {
      x += t.x + 0.5;
      y += t.y + 0.5;
    }
    return { x: x / tiles.length, y: y / tiles.length };
  }

  /**
   * 공 차기. aim이 있으면 그 방향, 없으면(자동 조준) 상대 골대 가운데 쪽(골대가 없으면 바라보는 방향).
   * power: 강슛(궁극기 게이지 소모). 기본 슛은 탄창 한 칸을 쓴다.
   */
  private kickBall(f: Fighter, aim: Aim, power: boolean) {
    const b = this.ball!;
    let dir = f.facing;
    if (aim && len(aim) > 1e-3) dir = angleOf(aim);
    else {
      const goal = this.goalCenter(f.team === 0 ? 1 : 0);
      if (goal && dist(goal, f.pos) > 1e-6) dir = angleOf({ x: goal.x - f.pos.x, y: goal.y - f.pos.y });
    }
    if (power) f.superCharge = 0;
    f.facing = dir;
    f.revealedUntil = this.tick + REVEAL_TICKS;
    b.carrierId = null;
    b.pos = { ...f.pos };
    b.vel = fromAngle(dir, power ? BALL_POWER_KICK_SPEED : BALL_KICK_SPEED);
    b.kickerId = f.id;
    b.noPickupUntil = this.tick + BALL_REPICK_TICKS;
    this.events.push({ type: 'ballKick', unitId: f.id, isSuper: power, dir });
  }

  /** 운반자가 쓰러졌다: 그 자리에 공을 내려놓는다 */
  private dropBall(f: Fighter | Unit) {
    const b = this.ball!;
    b.carrierId = null;
    b.pos = { ...f.pos };
    b.vel = { x: 0, y: 0 };
    this.events.push({ type: 'ballDrop', unitId: f.id, pos: { ...b.pos } });
  }

  /** 팀 goalOf의 골대에 골: 상대 팀 득점. 목표 점수면 경기 끝, 아니면 킥오프 대기 */
  private scoreGoal(goalOf: Team, scorerId: EntityId | null) {
    const m = this.match;
    if (this.over) return;
    const team: Team = goalOf === 0 ? 1 : 0;
    m.score[team]++;
    const b = this.ball!;
    b.carrierId = null;
    b.vel = { x: 0, y: 0 };
    this.events.push({ type: 'goal', team, score: [m.score[0], m.score[1]], scorerId });
    if (m.targetScore > 0 && m.score[team] >= m.targetScore) this.endMatch(team);
    else m.kickoffTicks = BALL_KICKOFF_TICKS;
  }

  /** 킥오프 대기 한 틱. 끝나면 모두 출발 지점에서 가득 찬 상태로, 탄·지대는 지우고, 공은 가운데로 */
  private stepKickoff() {
    const m = this.match;
    m.kickoffTicks = (m.kickoffTicks ?? 0) - 1;
    for (const u of this.units) if (u.type === 'fighter') u.moving = false;
    if (m.kickoffTicks > 0) return;
    m.kickoffTicks = 0;
    this.projectiles = [];
    this.lobs = [];
    this.zones = [];
    this.splitters.clear();
    this.lobKnock.clear();
    this.zoneAcc.clear();
    this.knockedBy.clear();
    for (const u of this.units) this.respawn(u);
    const b = this.ball;
    const at = this.grid.ballSpawn;
    if (b && at) {
      b.pos = { ...at };
      b.vel = { x: 0, y: 0 };
      b.carrierId = null;
      b.kickerId = null;
      b.noPickupUntil = 0;
    }
  }

  // ───────────── 파이터 ─────────────

  private stepFighter(f: Fighter, input: FighterInput | undefined) {
    const def = getFighter(f.fighterId);
    if (f.ammo < f.maxAmmo) {
      f.ammo = Math.min(f.maxAmmo, f.ammo + TICK_DT / def.attack.reload);
      if (f.ammo > f.maxAmmo - EPS) f.ammo = f.maxAmmo;
    }
    f.moving = false;
    // 시간이 지나면 저절로 차는 궁극기(FISTER)
    if (def.superChargePerSec && f.superCharge < 1 && !this.over) {
      f.superCharge = Math.min(1, f.superCharge + def.superChargePerSec * TICK_DT);
      if (f.superCharge >= 1 - EPS) {
        f.superCharge = 1;
        this.events.push({ type: 'superReady', unitId: f.id });
      }
    }

    if (f.copiedSuperId && this.tick >= (f.copiedSuperExpiresTick ?? 0)) {
      f.copiedSuperId = undefined;
      f.copiedSuperExpiresTick = undefined;
      f.superCharge = 0;
      this.events.push({ type: 'superCopyExpired', unitId: f.id });
    }
    if (f.stunnedUntilTick && this.tick < f.stunnedUntilTick) {
      f.moving = false;
      f.inBush = isInBush(this.grid, f.pos);
      return;
    }
    if (f.stunnedUntilTick && this.tick >= f.stunnedUntilTick) f.stunnedUntilTick = undefined;

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
    if (f.action?.kind === 'chainDash') {
      this.stepChainDash(f, f.action);
      f.inBush = isInBush(this.grid, f.pos);
      return;
    }

    const move = input ? clampLen(input.move, 1) : { x: 0, y: 0 };
    if (len(move) > 0.05) {
      const speed = def.moveSpeed * TICK_DT * (1 - this.slowAt(f));
      const next = moveCircle(this.grid, f.pos, f.radius, move.x * speed, move.y * speed);
      f.moving = dist(next, f.pos) > 1e-4;
      f.pos = next;
      f.facing = angleOf(move);
    }
    f.inBush = isInBush(this.grid, f.pos);

    // 공을 든 파이터: 공격 입력 = 차기, 궁극기 입력 = 강슛(게이지가 찼을 때). 보통 공격·궁극기는 못 쓴다
    if (this.ball?.carrierId === f.id) {
      if (input?.super && f.superCharge >= 1 - EPS) this.kickBall(f, input.super.aim, true);
      else if (input?.attack) {
        if (f.ammo >= 1 - EPS) {
          f.ammo = Math.max(0, f.ammo - 1);
          this.kickBall(f, input.attack.aim, false);
        } else {
          this.events.push({ type: 'noAmmo', unitId: f.id });
        }
      }
      return;
    }

    // 새 공격: 진행 중인 행동(연사 포함)이 없을 때만. 궁극기가 나가면 같은 틱의 기본 공격은 무시
    if (!f.action && input) {
      if (input.super && f.superCharge >= 1 - EPS) {
        this.startAttack(f, def, true, input.super.aim);
      } else if (input.skill && f.fighterId === 'chainer') {
        this.useChainSkill(f, input.skill.aim);
      } else if (input.attack) {
        if (f.ammo >= 1 - EPS) this.startAttack(f, def, false, input.attack.aim);
        else this.events.push({ type: 'noAmmo', unitId: f.id });
      }
    }

    if (f.action?.kind === 'burst') this.continueBurst(f, f.action);
  }

  private startAttack(f: Fighter, def: FighterDef, isSuper: boolean, aim: Aim) {
    const superSourceId = isSuper && f.fighterId === 'chainer' ? f.copiedSuperId : undefined;
    const spec = shotSpec(def, isSuper, superSourceId);
    const { dir, ratio } = spec.kind === 'leap' ? resolveLeapAim(this, f, aim, spec.slam ? spec.range : undefined) : resolveAim(this, f, aim, spec.range);
    if (isSuper) {
      f.superCharge = 0;
      if (superSourceId) {
        f.copiedSuperId = undefined;
        f.copiedSuperExpiresTick = undefined;
      }
    }
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
      case 'chain':
        this.fireChainSlam(f, spec, dir, ratio);
        break;
      case 'steal':
        this.launchSuperSteal(f, spec, dir);
        break;
      case 'burst': {
        const act: BurstAction = { kind: 'burst', remaining: spec.count, nextTick: this.tick, dir, isSuper, ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}) };
        f.action = act;
        this.continueBurst(f, act);
        break;
      }
      case 'dash':
        f.action = { kind: 'dash', dir, remaining: spec.range, speed: spec.projectileSpeed, hitIds: [], isSuper, ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}) };
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
      case 'zone':
        this.placeZone(f, spec, dir, ratio);
        break;
    }
    if (!isSuper && def.chainKit && f.passiveStacks && f.passiveStacks > 0) {
      f.passiveStacks--;
      const passive = shotSpec(def, false);
      this.doMelee(f, { ...passive, kind: 'melee', damage: def.chainKit.passiveDamage, range: def.chainKit.passiveRadius, spreadDeg: 360 }, dir);
    }
  }

  private addChainStack(f: Fighter) {
    const kit = getFighter(f.fighterId).chainKit;
    if (!kit) return;
    f.passiveStacks = Math.min(kit.passiveMaxStacks, (f.passiveStacks ?? 0) + 1);
  }

  private useChainSkill(f: Fighter, aim: Aim) {
    const def = getFighter(f.fighterId);
    const kit = def.chainKit;
    if (!kit || f.action) return;
    if (f.chainSkillPhase === 'chainFlight') return;
    if (f.chainSkillPhase === 'w') {
      let target: Unit | undefined;
      let best = Infinity;
      for (const u of this.units) {
        if (!isHittable(u) || u.team === f.team) continue;
        const d = dist(f.pos, u.pos);
        if (d - u.radius > kit.wRange || d >= best || !hasLineOfSight(this.grid, f.pos, u.pos)) continue;
        target = u;
        best = d;
      }
      if (!target) return;
      this.markCombat(f);
      const amount = Math.round(target.maxHp * kit.wMaxHpDamage);
      const dealt = this.damage(target, amount, f.id, false);
      if (dealt > 0) this.heal(f, Math.round(dealt * kit.wHealFraction));
      this.addChainStack(f);
      f.chainSkillPhase = undefined;
      this.events.push({ type: 'melee', unitId: f.id, isSuper: false, dir: angleOf({ x: target.pos.x - f.pos.x, y: target.pos.y - f.pos.y }), range: kit.wRange, spreadDeg: 24 });
      return;
    }
    if (f.chainSkillPhase === 'chain') {
      const { dir } = resolveAim(this, f, aim, kit.chainRange);
      const spec = shotSpec(def, false);
      this.markCombat(f);
      f.facing = dir;
      this.events.push({ type: 'attack', unitId: f.id, isSuper: false, dir });
      this.spawnShot(f, { ...spec, kind: 'chain', damage: kit.chainDamage, range: kit.chainRange }, dir, 0);
      this.projectiles[this.projectiles.length - 1]!.chainSkill = true;
      f.chainSkillPhase = 'chainFlight';
      return;
    }
    if (this.tick < (f.chainSkillReadyTick ?? 0)) return;
    const { dir } = resolveAim(this, f, aim, kit.dashRange);
    f.chainSkillReadyTick = this.tick + secToTicks(kit.skillCooldown);
    f.chainSkillPhase = 'chain';
    this.addChainStack(f);
    f.facing = dir;
    this.markCombat(f);
    this.events.push({ type: 'attack', unitId: f.id, isSuper: false, dir });
    f.action = { kind: 'chainDash', dir, remaining: kit.dashRange, speed: 9 };
  }

  private launchSuperSteal(f: Fighter, spec: ShotSpec, dir: number) {
    this.spawnShot(f, { ...spec, damage: 0, pierce: false }, dir, 0);
    this.projectiles[this.projectiles.length - 1]!.stealsSuper = true;
  }

  private stepChainDash(f: Fighter, act: Extract<FighterAction, { kind: 'chainDash' }>) {
    f.facing = act.dir;
    const stepLen = Math.min(act.speed * TICK_DT, act.remaining);
    const from = { ...f.pos };
    const dx = Math.cos(act.dir);
    const dy = Math.sin(act.dir);
    const target = { x: from.x + dx * stepLen, y: from.y + dy * stepLen };
    if (circleBlocked(this.grid, target.x, target.y, f.radius)) {
      let to = from;
      const n = Math.max(1, Math.ceil(stepLen / 0.02));
      for (let i = 1; i <= n; i++) {
        const p = { x: from.x + (dx * stepLen * i) / n, y: from.y + (dy * stepLen * i) / n };
        if (circleBlocked(this.grid, p.x, p.y, f.radius)) break;
        to = p;
      }
      f.pos = to;
      f.action = null;
      return;
    }
    f.pos = target;
    f.moving = dist(from, target) > 1e-4;
    act.remaining -= stepLen;
    if (act.remaining <= 1e-6 && f.action === act) f.action = null;
  }

  /** 공격했다: 회복 대기 다시 시작, 수풀 노출 */
  private markCombat(f: Fighter) {
    f.lastCombatTick = this.tick;
    f.revealedUntil = this.tick + REVEAL_TICKS;
  }

  private fireSpread(f: Fighter, spec: ShotSpec, dir: number) {
    const group = this.nextGroup++;
    const spread = (spec.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < spec.count; i++) {
      const k = spec.count > 1 ? i / (spec.count - 1) - 0.5 : 0;
      const mul = spec.speedJitter > 0 ? 1 + spec.speedJitter * (this.rng.next() * 2 - 1) : 1;
      this.spawnShot(f, spec, dir + k * spread, 0, mul, group);
    }
  }

  private fireRadial(f: Fighter, spec: ShotSpec, dir: number) {
    const group = this.nextGroup++;
    for (let i = 0; i < spec.count; i++) this.spawnShot(f, spec, dir + (i * Math.PI * 2) / spec.count, 0, 1, group);
  }

  /** 연사: 이번 틱까지 나가야 할 탄을 쏜다. 다 쏘면 행동 끝 */
  private continueBurst(f: Fighter, act: BurstAction) {
    const spec = shotSpec(getFighter(f.fighterId), act.isSuper, act.superSourceId);
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
  private spawnShot(owner: Unit, spec: ShotSpec, dir: number, lateral: number, speedMul = 1, groupId?: number) {
    const radius = spec.projectileRadius ?? (spec.isSuper ? SUPER_PROJECTILE_RADIUS : PROJECTILE_RADIUS);
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
      ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}),
      breaksWalls: spec.breaksWalls,
      knockback: spec.knockback,
      ...(spec.damageFar !== undefined ? { damageFar: spec.damageFar, range: spec.range } : {}),
      pierce: spec.pierce,
      ...(spec.bounces > 0 ? { bounces: spec.bounces } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      hitIds: [],
    });
    if (spec.split && spec.split.count > 0) this.splitters.set(this.projectiles[this.projectiles.length - 1]!.id, spec.split);
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
      this.damage(u, spec.damage, f.id, spec.isSuper, spec.superSourceId);
      if (u.alive && spec.knockback > 0) this.applyKnockback(u, u.pos.x - f.pos.x, u.pos.y - f.pos.y, spec.knockback, dir);
    }
  }

  /** 포물선: 조준 비율만큼 떨어진 지점에 비행 시간 뒤 범위 피해 */
  /**
   * 포물선: 조준 비율만큼(최소 LOB_MIN_DIST) 떨어진 지점에 count개를 조준과 수직으로 LOB_SPACING 간격으로 나란히.
   * 비행 시간은 데이터 탄속(없으면 LOB_FLIGHT_TICKS). 궁극기 넉백은 폭발 중심에서 밀어낸다.
   */
  /**
   * Chainer Q: 조준한 바닥 지점(사거리 안, 최소 LOB_MIN_DIST)을 사슬로 내리친다.
   * 날아가는 탄이 아니라 지점 판정: delayTicks 뒤 반지름 안의 모든 적이 같은 틱에 피해를 받는다(stepLobs).
   */
  private fireChainSlam(f: Fighter, spec: ShotSpec, dir: number, ratio: number) {
    const slam = spec.chainSlam;
    if (!slam) return;
    const d = Math.max(LOB_MIN_DIST, spec.range * Math.max(0, Math.min(1, ratio)));
    const to = this.clampToMap({ x: f.pos.x + Math.cos(dir) * d, y: f.pos.y + Math.sin(dir) * d });
    this.lobs.push({
      id: this.nextId++,
      type: 'lob',
      ownerId: f.id,
      team: f.team,
      from: { ...f.pos },
      to,
      startTick: this.tick,
      endTick: this.tick + slam.delayTicks,
      damage: spec.damage,
      aoeRadius: slam.radius,
      isSuper: false,
      breaksWalls: false,
      slam: true,
    });
  }

  private fireLob(f: Fighter, spec: ShotSpec, dir: number, ratio: number) {
    const d = Math.max(LOB_MIN_DIST, spec.range * Math.max(0, Math.min(1, ratio)));
    const cx = f.pos.x + Math.cos(dir) * d;
    const cy = f.pos.y + Math.sin(dir) * d;
    const px = -Math.sin(dir);
    const py = Math.cos(dir);
    for (let i = 0; i < spec.count; i++) {
      const off = (i - (spec.count - 1) / 2) * LOB_SPACING;
      const to = this.clampToMap({ x: cx + px * off, y: cy + py * off });
      const flight = spec.speedGiven ? Math.max(1, Math.round((dist(f.pos, to) / spec.projectileSpeed) * TICK_RATE)) : LOB_FLIGHT_TICKS;
      const id = this.nextId++;
      const fuseTicks = Math.round(spec.lobFuse * TICK_RATE);
      this.lobs.push({
        id,
        type: 'lob',
        ownerId: f.id,
        team: f.team,
        from: { ...f.pos },
        to,
        startTick: this.tick,
        endTick: this.tick + flight + fuseTicks,
        ...(fuseTicks > 0 ? { landTick: this.tick + flight } : {}),
        damage: spec.damage,
        aoeRadius: spec.aoeRadius,
        isSuper: spec.isSuper,
        ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}),
        breaksWalls: spec.breaksWalls,
      });
      if (spec.knockback > 0) this.lobKnock.set(id, spec.knockback);
    }
  }


  /**
   * 돌진 한 틱: 앞쪽의 부서지는 벽을 부수고 직선으로 나아간다.
   * 단단한 벽·물·맵 끝에 막히면 막히기 직전에서 멈추고 돌진을 끝낸다.
   * 지나간 경로에 닿은 적은 한 번씩 피해 + 넉백.
   */
  private stepDash(f: Fighter, act: DashAction) {
    const isSuper = act.isSuper ?? true;
    const spec = shotSpec(getFighter(f.fighterId), isSuper, act.superSourceId);
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
      this.damage(u, spec.damage, f.id, isSuper, spec.superSourceId);
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
    f.action = { kind: 'leap', from, to, startTick: this.tick, endTick: this.tick + ticks, ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}) };
    f.moving = false;
    f.inBush = false;

    if (spec.moveOnly) return; // 이동만(FISTER)
    if (spec.slam) return; // 내려찍기: 폭탄 없이 착지할 때 피해(stepLeap → slamLand)
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
      const spec = shotSpec(getFighter(f.fighterId), true, act.superSourceId);
      if (spec.slam) this.slamLand(f, spec, act);
    }
  }

  /**
   * 내려찍기 착지: 'explode' 사건(착지 지점, aoeRadius), breaksWalls면 둘레 벽 파괴,
   * 둘레(aoeRadius + 대상 반지름) 안의 적에게 damage 한 번 + 착지 지점 반대쪽으로 넉백 한 번.
   */
  private slamLand(f: Fighter, spec: ShotSpec, act: Extract<FighterAction, { kind: 'leap' }>) {
    const at = act.to;
    const leapDir = Math.atan2(act.to.y - act.from.y, act.to.x - act.from.x);
    this.events.push({ type: 'explode', pos: { ...at }, radius: spec.aoeRadius, isSuper: true });
    if (spec.breaksWalls) this.broken.push(...breakWallsInCircle(this.grid, at, spec.aoeRadius));
    for (const u of this.units) {
      if (!isHittable(u) || u.team === f.team) continue;
      if (dist(u.pos, at) > spec.aoeRadius + u.radius) continue;
      this.damage(u, spec.damage, f.id, true, spec.superSourceId);
      if (u.alive && spec.knockback > 0) this.applyKnockback(u, u.pos.x - at.x, u.pos.y - at.y, spec.knockback, leapDir);
    }
  }

  // ───────────── 더미 ─────────────

  private resetDummyBehavior(d: Dummy) {
    if (d.behavior === 'patrol') {
      // 맵 글자로 방향을 정한다: p = 좌우, q = 위아래
      if (d.patrolAxis === 'y') {
        d.patrolFrom = { x: d.spawn.x, y: d.spawn.y - PATROL_HALF_WIDTH };
        d.patrolTo = { x: d.spawn.x, y: d.spawn.y + PATROL_HALF_WIDTH };
      } else {
        d.patrolFrom = { x: d.spawn.x - PATROL_HALF_WIDTH, y: d.spawn.y };
        d.patrolTo = { x: d.spawn.x + PATROL_HALF_WIDTH, y: d.spawn.y };
      }
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
    const shards: Projectile[] = [];
    for (const p of this.projectiles) {
      this.lastHitId = null;
      if (this.stepProjectile(p)) {
        keep.push(p);
        continue;
      }
      if (p.chainSkill) {
        const owner = this.getUnit(p.ownerId);
        if (owner?.type === 'fighter' && owner.chainSkillPhase === 'chainFlight') owner.chainSkillPhase = undefined;
      }
      const split = this.splitters.get(p.id);
      if (split) {
        this.splitters.delete(p.id);
        if (!this.over) shards.push(...this.makeShards(p, split, this.lastHitId));
      }
    }
    this.projectiles = keep.concat(shards);
  }

  /**
   * 파편: 본탄이 맞거나 벽·사거리 끝에서 멈춘 자리에서 split.count개를 360도로 고르게(첫 파편은 본탄 진행 방향).
   * 다시 갈라지지 않고, 본탄이 맞힌 대상은 맞히지 않는다. 다음 틱부터 날아간다.
   */
  private makeShards(p: Projectile, split: { count: number; damage: number; range: number; speed: number }, hitId: EntityId | null): Projectile[] {
    const base = angleOf(p.vel);
    const out: Projectile[] = [];
    for (let i = 0; i < split.count; i++) {
      out.push({
        id: this.nextId++,
        type: 'projectile',
        ownerId: p.ownerId,
        team: p.team,
        pos: { ...p.pos },
        vel: fromAngle(base + (i * Math.PI * 2) / split.count, split.speed),
        radius: PROJECTILE_RADIUS,
        damage: split.damage,
        remaining: split.range,
        isSuper: false,
        breaksWalls: false,
        knockback: 0,
        pierce: false,
        hitIds: hitId !== null ? [hitId] : [],
      });
    }
    return out;
  }

  /** 지대: 조준 지점(최소 ZONE_MIN_DIST)에 바로 깔린다 */
  private placeZone(f: Fighter, spec: ShotSpec, dir: number, ratio: number) {
    const z = spec.zone;
    if (!z) return;
    const d = Math.max(ZONE_MIN_DIST, spec.range * Math.max(0, Math.min(1, ratio)));
    const pos = this.clampToMap({ x: f.pos.x + Math.cos(dir) * d, y: f.pos.y + Math.sin(dir) * d });
    this.zones.push({
      id: this.nextId++,
      type: 'zone',
      ownerId: f.id,
      team: f.team,
      pos,
      radius: z.radius,
      untilTick: this.tick + Math.max(1, secToTicks(z.duration)),
      slow: z.slow,
      dps: z.dps,
      ...(spec.superSourceId ? { superSourceId: spec.superSourceId } : {}),
    });
  }

  /** 지대 한 틱: 끝난 지대 정리, 안의 적에게 피해를 모아 ZONE_HIT_TICKS마다 정수로 준다 */
  private stepZones() {
    if (!this.zones.length) return;
    this.zones = this.zones.filter((z) => this.tick < z.untilTick);
    for (const z of this.zones) {
      for (const u of this.units) {
        if (!isHittable(u) || u.team === z.team) continue;
        if (dist(u.pos, z.pos) > z.radius + u.radius) continue;
        const key = `${z.id}:${u.id}`;
        const acc = (this.zoneAcc.get(key) ?? 0) + z.dps * TICK_DT;
        if ((this.tick - z.id) % ZONE_HIT_TICKS === 0 && acc >= 1) {
          const dmg = Math.floor(acc);
          this.zoneAcc.set(key, acc - dmg);
          this.damage(u, dmg, z.ownerId, true, z.superSourceId);
        } else this.zoneAcc.set(key, acc);
      }
    }
    if (this.zoneAcc.size > 64) {
      const live = new Set(this.zones.map((z) => z.id));
      for (const k of [...this.zoneAcc.keys()]) if (!live.has(Number(k.split(':')[0]))) this.zoneAcc.delete(k);
    }
  }

  /** 적 지대 안이면 가장 큰 감속 비율(0~1) */
  private slowAt(f: Fighter): number {
    let s = 0;
    for (const z of this.zones) if (z.team !== f.team && dist(f.pos, z.pos) <= z.radius + f.radius) s = Math.max(s, z.slow);
    return Math.min(1, s);
  }

  /**
   * 투사체 한 틱. 계속 날아가면 true.
   * 경로 위에서 처음 닿는 적을 찾고, 그 지점까지 벽 스윕을 한다(벽이 먼저면 벽에서 멈춤).
   * breaksWalls면 지나가는 부서지는 벽을 부수며 계속 간다(단단한 벽에서만 멈춤).
   */
  private stepProjectile(p: Projectile): boolean {
    let budget = Math.min(len(p.vel) * TICK_DT, p.remaining);
    // 튕길 때마다 이번 틱의 남은 이동 거리로 다시 스윕한다(튕김 횟수가 유한하므로 끝난다)
    for (;;) {
      const speed = len(p.vel);
      const stepLen = Math.min(budget, p.remaining);
      if (speed < 1e-9 || stepLen <= 0) {
        this.events.push({ type: 'projectileEnd', id: p.id, pos: { ...p.pos }, reason: 'range' });
        return false;
      }
      const to = { x: p.pos.x + (p.vel.x / speed) * stepLen, y: p.pos.y + (p.vel.y / speed) * stepLen };

      /** 이번 구간 전까지 날아간 거리(range가 있는 투사체만 의미 있음) */
      const flown = p.range !== undefined ? p.range - p.remaining : 0;
      const hits: { u: Unit; t: number }[] = [];
      for (const u of this.units) {
        // 점프 중인 유닛은 투사체가 그대로 지나간다
        if (!isHittable(u) || u.team === p.team || p.hitIds.includes(u.id)) continue;
        if (p.stealsSuper && u.type !== 'fighter') continue;
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
        const hitAt = flown + dist(p.pos, reach);
        p.pos = at;
        this.projectileHit(p, first.u, hitAt);
        this.events.push({ type: 'projectileEnd', id: p.id, pos: at, reason: 'hit' });
        return false;
      }

      if (sweep.hit) {
        p.pos = { ...sweep.point };
        p.remaining -= traveled;
        budget -= traveled;
        if ((p.bounces ?? 0) > 0 && p.remaining > 1e-3) {
          p.vel = reflectOffWalls(this.grid, p.pos, p.vel, p.radius);
          p.bounces = p.bounces! - 1;
          if (budget <= 1e-9) return true;
          continue;
        }
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
  }

  /** traveled: 발사 지점부터 맞은 지점까지 날아간 거리(거리 비례 피해용) */
  private projectileHit(p: Projectile, u: Unit, traveled: number) {
    if (this.over) return; // 경기가 끝난 뒤의 탄은 아무 효과 없음
    this.lastHitId = u.id;
    const owner = this.getUnit(p.ownerId);
    if (p.stealsSuper) {
      // 같은 Chainer(사슬 키트를 가진 파이터)에게는 무효: 아무것도 복사하지 않는다
      if (u.type === 'fighter' && owner?.type === 'fighter' && !getFighter(u.fighterId).chainKit) {
        const sourceId = u.copiedSuperId ?? u.fighterId;
        const kit = getFighter(owner.fighterId).chainKit;
        if (kit) {
          owner.copiedSuperId = sourceId;
          owner.copiedSuperExpiresTick = this.tick + secToTicks(kit.copiedSuperDuration);
          owner.superCharge = 1;
          this.events.push({ type: 'superCopied', unitId: owner.id, sourceId: u.id, fighterId: sourceId, expiresTick: owner.copiedSuperExpiresTick });
          this.events.push({ type: 'superReady', unitId: owner.id });
        }
      }
      return;
    }
    this.damage(u, distanceDamage(p, traveled), p.ownerId, p.isSuper, p.superSourceId);
    if (p.chainSkill) {
      if (u.type === 'fighter') {
        const untilTick = this.tick + secToTicks(getFighter('chainer').chainKit!.stunDuration);
        u.stunnedUntilTick = Math.max(u.stunnedUntilTick ?? 0, untilTick);
        u.action = null;
        u.moving = false;
        this.events.push({ type: 'stun', unitId: u.id, untilTick });
      }
      if (owner?.type === 'fighter') owner.chainSkillPhase = 'w';
    }
    if (u.alive && p.knockback > 0) {
      // 같은 공격 묶음의 탄은 한 대상을 한 번만 밀어낸다(피해는 탄마다)
      let done = this.knockedBy.get(u.id);
      if (p.groupId === undefined || !done?.has(p.groupId)) {
        if (p.groupId !== undefined) {
          if (!done) this.knockedBy.set(u.id, (done = new Set()));
          done.add(p.groupId);
          if (done.size > 32) done.delete(done.values().next().value as number);
        }
        // 묶음 넉백은 쏜 사람에서 대상으로 향하는 방향(가장 먼저 맞은 산탄의 비스듬한 방향이 아니라)
        const groupedOwner = p.groupId !== undefined ? this.getUnit(p.ownerId) : undefined;
        if (groupedOwner) this.applyKnockback(u, u.pos.x - groupedOwner.pos.x, u.pos.y - groupedOwner.pos.y, p.knockback, angleOf(p.vel));
        else this.applyKnockback(u, p.vel.x, p.vel.y, p.knockback, angleOf(p.vel));
      }
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
      for (const u of this.units) {
        if (!isHittable(u) || u.team === l.team) continue;
        if (dist(u.pos, l.to) > l.aoeRadius + u.radius) continue;
        if (l.slam && !hasLineOfSight(this.grid, l.to, u.pos)) continue; // 사슬 내려치기는 벽 너머를 못 때린다
        this.damage(u, l.damage, l.ownerId, l.isSuper, l.superSourceId);
        const kb = this.lobKnock.get(l.id);
        if (kb && u.alive) this.applyKnockback(u, u.pos.x - l.to.x, u.pos.y - l.to.y, kb, angleOf({ x: l.to.x - l.from.x, y: l.to.y - l.from.y }));
      }
      this.lobKnock.delete(l.id);
    }
    this.lobs = keep;
  }

  // ───────────── 피해·넉백·충전·회복·부활 ─────────────

  /** 피해 적중 1회분 궁극기 충전(기본 공격·궁극기 모두). 1이 되는 순간 superReady */
  private chargeFromHit(f: Fighter) {
    if (f.superCharge >= 1 || this.over) return;
    f.superCharge = Math.min(1, f.superCharge + getFighter(f.fighterId).attack.superChargePerHit);
    if (f.superCharge >= 1 - EPS) {
      f.superCharge = 1;
      this.events.push({ type: 'superReady', unitId: f.id });
    }
  }

  private damage(u: Unit, amount: number, sourceId: EntityId, isSuper: boolean, superSourceId?: FighterId): number {
    if (!isHittable(u) || amount <= 0 || this.over) return 0;
    // 캐릭터 레벨: 모든 피해(공격·궁극기·폭탄·지대)에 같은 배율
    const src = this.getUnit(sourceId);
    if (src?.type === 'fighter' && src.power && src.power > 1) amount = Math.round(amount * powerMult(src.power));
    const dealt = Math.min(u.hp, amount);
    u.hp = Math.max(0, u.hp - amount);
    u.lastCombatTick = this.tick;
    if (dealt > 0 && src?.type === 'fighter') this.chargeFromHit(src);
    // 흡혈: 실제로 깎은 체력의 비율만큼 공격한 파이터 회복
    if (src?.type === 'fighter' && src.alive) {
      const sdef = getFighter(superSourceId ?? src.fighterId);
      const ls = isSuper ? sdef.super.lifesteal : sdef.attack.lifesteal;
      if (ls && ls > 0 && dealt > 0) this.heal(src, Math.round(dealt * ls));
    }
    const killed = u.hp <= 0;
    this.events.push({ type: 'hit', targetId: u.id, sourceId, damage: amount, pos: { ...u.pos }, isSuper, killed });
    if (killed) this.kill(u, sourceId);
    return dealt;
  }

  private heal(u: Fighter, amount: number) {
    if (!u.alive || amount <= 0 || this.over) return;
    const healed = Math.min(amount, u.maxHp - u.hp);
    if (healed <= 0) return;
    u.hp += healed;
    this.events.push({ type: 'heal', targetId: u.id, amount: healed, pos: { ...u.pos } });
  }

  private kill(u: Unit, sourceId: EntityId) {
    u.alive = false;
    u.respawnTick = this.tick + (u.type === 'fighter' ? FIGHTER_RESPAWN_TICKS : DUMMY_RESPAWN_TICKS);
    if (u.type === 'fighter') {
      u.action = null;
      u.moving = false;
      u.chainSkillPhase = undefined;
      if (u.fighterId === 'chainer' && u.copiedSuperId) {
        u.copiedSuperId = undefined;
        u.copiedSuperExpiresTick = undefined;
        u.superCharge = 0;
      }
      u.stunnedUntilTick = undefined;
    } else {
      (u as SimDummy).knock = null;
    }
    this.events.push({ type: 'death', unitId: u.id, pos: { ...u.pos } });
    if (u.type === 'fighter') this.dropCrystals(u);
    if (this.ball?.carrierId === u.id) this.dropBall(u);
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
      u.chainSkillPhase = undefined;
      u.chainSkillReadyTick = undefined;
      u.passiveStacks = 0;
      u.copiedSuperId = undefined;
      u.copiedSuperExpiresTick = undefined;
      u.stunnedUntilTick = undefined;
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
  // 세로 맵: 팀0은 아래에서 위로(−y), 팀1은 위에서 아래로(+y)
  return team === 0 ? -Math.PI / 2 : Math.PI / 2;
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

/** 튕김 판정용: 반지름 r 원이 투사체를 막는 타일(벽·단단한 벽·맵 밖)과 겹치는가 */
function circleHitsProjectileWall(grid: Grid, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (!grid.blocksProjectile(tx, ty)) continue;
      const ox = x - Math.max(tx, Math.min(tx + 1, x));
      const oy = y - Math.max(ty, Math.min(ty + 1, y));
      if (ox * ox + oy * oy < r * r) return true;
    }
  }
  return false;
}

/** 튕김 탐침 거리(타일). 스윕이 벽 앞 SKIN(1e-4)에서 멈추므로 그보다 충분히 크게 */
const BOUNCE_PROBE = 0.02;

/**
 * 벽에 닿은 투사체의 반사 속도. 진행 방향의 x 성분만 더 가 봐서 막히면 세로 벽(x 반전),
 * y 성분만 더 가 봐서 막히면 가로 벽(y 반전). 둘 다 막히거나(안쪽 모서리) 둘 다 안 막히면(바깥 모서리) 둘 다 반전.
 */
export function reflectOffWalls(grid: Grid, pos: Vec2, vel: Vec2, r: number): Vec2 {
  const bx = vel.x !== 0 && circleHitsProjectileWall(grid, pos.x + Math.sign(vel.x) * BOUNCE_PROBE, pos.y, r);
  const by = vel.y !== 0 && circleHitsProjectileWall(grid, pos.x, pos.y + Math.sign(vel.y) * BOUNCE_PROBE, r);
  if (bx && !by) return { x: -vel.x, y: vel.y };
  if (by && !bx) return { x: vel.x, y: -vel.y };
  return { x: -vel.x, y: -vel.y };
}
