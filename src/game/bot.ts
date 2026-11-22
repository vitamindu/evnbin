import { getFighter } from '../data/fighters';
import { nearestVisibleEnemy } from './aim';
import { isHittable } from './status';
import { isVisibleTo } from './visibility';
import type { Sim } from './sim';
import { TICK_DT, type Aim, type EntityId, type Fighter, type FighterInput, type Unit, type Vec2 } from './types';
import { circleBlocked, hasLineOfSight } from './world';

/**
 * 봇 조종. Gameplay 담당. 서버(빈자리 채우기)와 오프라인 모두에서 쓴다.
 *
 * botInput(sim, id)는 그 틱에 봇 파이터가 낼 입력을 돌려준다. 결정적이다: 난수는 sim.rng만 쓰고,
 * 틱 사이 기억(표적·반응 지연·옆걸음·끼임)은 Sim 인스턴스별로 이 모듈 안에 둔다.
 * 같은 시드·같은 호출 순서면 같은 결과. 매 틱 봇마다 유닛 수의 제곱 정도 계산(6명 기준 가볍다).
 *
 * 행동
 * - 표적: 가장 가까운 보이는(수풀 규칙) 맞힐 수 있는 적. 표적이 바뀌면 잠깐(반응 지연) 쏘지 않는다.
 * - 거리: 기본 공격 사거리의 KEEP_RANGE배를 유지(근거리 캐릭터는 붙고, 저격수는 떨어진다). 좌우로 조금씩 옆걸음.
 *   시야가 막혔으면 다가가며 각을 찾는다. 보이는 적이 없으면 맵 가운데 ↔ 상대 출발 지점을 오간다.
 * - 공격: 사거리 안 + 시야가 트였으면, 표적 방향(조준 흔들림 포함)으로. 공격 사이에 잠깐 쉰다.
 * - 궁극기: 게이지가 차면 쓸모 있을 때 쓴다. leap은 체력이 낮고 적이 가까울 때 적 반대쪽으로(내려찍기 leap은 사거리 안의 표적 위로),
 *   dash는 표적 쪽으로, 나머지(산탄·연사 등)는 궁극기 사거리 안의 표적 쪽으로.
 * - 후퇴: 체력이 RETREAT_HP 미만이면 출발 지점으로 돌아가 회복(RECOVERED_HP까지). 그동안은 가까운 적만 쏜다.
 * - 벽: 가려는 방향 앞이 막혔으면 조금씩 꺾어 본다. 그래도 몇 틱 동안 못 움직이면 옆으로 비켜 간다.
 */

/** 기본 공격 사거리의 이 비율 거리를 유지한다 */
export const KEEP_RANGE = 0.7;
/** 유지 거리 ± 이만큼(타일)은 다가가지도 물러나지도 않는다 */
export const RANGE_BAND = 0.6;
/** 옆걸음 비중(앞뒤 이동 1 대비) */
const STRAFE_WEIGHT = 0.45;
const STRAFE_MIN_TICKS = 25;
const STRAFE_MAX_TICKS = 60;
/** 표적을 새로 잡은 뒤 쏘기까지(틱) */
export const REACT_MIN_TICKS = 6;
export const REACT_MAX_TICKS = 12;
/** 공격 사이 쉬는 시간(틱) */
const ATTACK_GAP_MIN_TICKS = 8;
const ATTACK_GAP_MAX_TICKS = 18;
/** 조준 흔들림(라디안, ±) */
export const AIM_JITTER = 0.08;
/** 이 체력 비율 미만이면 후퇴, RECOVERED_HP 이상이면 다시 싸운다 */
export const RETREAT_HP = 0.3;
export const RECOVERED_HP = 0.85;
/** 후퇴 중에는 이 사거리 비율 안의 적만 쏜다 */
export const SELF_DEFENSE = 0.5;
/** leap 궁극기: 체력이 이 비율 미만이고 적이 사거리 안이면 도망친다 */
export const LEAP_HP = 0.4;
/** 움직이려 했는데 기대 이동의 STUCK_RATIO보다 덜 움직인 틱이 STUCK_TICKS번 이어지면 끼인 것 */
const STUCK_RATIO = 0.25;
export const STUCK_TICKS = 6;
export const SIDESTEP_TICKS = 15;
/**
 * 벽 피하기: 이만큼 앞(타일)을 미리 보고, 막혔으면 이 각도들로 꺾어 본다.
 * 한쪽(steerSign)으로 정하면 그쪽 각도를 모두 먼저 시도해서 벽을 따라 한 방향으로 돈다(좌우로 흔들리지 않게).
 */
const PROBE = 0.6;
const STEER_OFFSETS = [0.5, 1.0, 1.5, 2.0, 2.6];
// ── 크리스탈 러시 ──
/** 이 수 이상 들고 체력이 CAREFUL_HP 미만이면 출발 지점으로 물러난다 */
export const CAREFUL_CARRY = 3;
export const CAREFUL_HP = 0.6;
/** 이 거리 안의 보이는 적 운반자는 가장 가까운 적보다 먼저 노린다 */
export const CHASE_CARRIER_DIST = 12;
/** 표적이 사거리 + 이만큼보다 멀면 싸우러 가지 않고 바닥 크리스탈을 주우러 간다 */
export const ENGAGE_MARGIN = 2;
/** 우리 팀 카운트다운 중 운반자가 아닌 봇은 가장 가까운 우리 운반자 이 거리 안에 머문다 */
export const ESCORT_DIST = 2.5;

/** 웨이포인트에 이만큼 가까우면 다음으로 */
const WAYPOINT_REACHED = 1.5;

interface BotMemory {
  targetId: EntityId | null;
  /** 이 틱부터 공격 가능(반응 지연) */
  reactTick: number;
  nextAttackTick: number;
  strafeSign: 1 | -1;
  strafeUntil: number;
  retreating: boolean;
  lastPos: Vec2;
  /** 지난 틱에 낸 이동 입력 크기 */
  lastMoveLen: number;
  stuck: number;
  sidestepUntil: number;
  sidestepDir: number;
  /** 벽 피하기에서 먼저 꺾어 볼 쪽(흔들리지 않게 유지) */
  steerSign: 1 | -1;
  /** 보이는 적이 없을 때 오가는 지점 번호(0 = 맵 가운데, 1 = 상대 출발 지점) */
  waypoint: number;
}

const memories = new WeakMap<Sim, Map<EntityId, BotMemory>>();

function memoryOf(sim: Sim, f: Fighter): BotMemory {
  let all = memories.get(sim);
  if (!all) {
    all = new Map();
    memories.set(sim, all);
  }
  let m = all.get(f.id);
  if (!m) {
    m = {
      targetId: null,
      reactTick: 0,
      nextAttackTick: 0,
      strafeSign: 1,
      strafeUntil: 0,
      retreating: false,
      lastPos: { ...f.pos },
      lastMoveLen: 0,
      stuck: 0,
      sidestepUntil: 0,
      sidestepDir: 0,
      steerSign: f.id % 2 === 0 ? 1 : -1,
      waypoint: 0,
    };
    all.set(f.id, m);
  }
  return m;
}

const IDLE: FighterInput = { move: { x: 0, y: 0 } };

function randInt(sim: Sim, min: number, max: number): number {
  return min + Math.floor(sim.rng.next() * (max - min + 1));
}

function dirTo(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 0, y: 0 };
}

const dist = (a: Vec2, b: Vec2) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** 표적 방향 단위 벡터를 조준 흔들림만큼 돌린 조준값(길이 ratio) */
function jitteredAim(sim: Sim, from: Vec2, to: Vec2, ratio = 1): Aim {
  const a = Math.atan2(to.y - from.y, to.x - from.x) + (sim.rng.next() * 2 - 1) * AIM_JITTER;
  const r = Math.max(0.05, Math.min(1, ratio));
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** 보이는 적이 없을 때 가는 곳: 맵 가운데 ↔ 상대 팀 출발 지점 평균 */
function roamGoal(sim: Sim, f: Fighter, m: BotMemory): Vec2 {
  const center = { x: sim.grid.width / 2, y: sim.grid.height / 2 };
  const spawns = sim.grid.teamSpawns[f.team === 0 ? 1 : 0];
  let enemyHome = center;
  if (spawns.length) {
    let sx = 0;
    let sy = 0;
    for (const s of spawns) {
      sx += s.x;
      sy += s.y;
    }
    enemyHome = { x: sx / spawns.length, y: sy / spawns.length };
  }
  const goal = m.waypoint === 0 ? center : enemyHome;
  if (dist(f.pos, goal) < WAYPOINT_REACHED) {
    m.waypoint = 1 - m.waypoint;
    return m.waypoint === 0 ? center : enemyHome;
  }
  return goal;
}

/** 크리스탈 러시: 보이는 적 운반자 중 가장 많이 든(같으면 가까운) 유닛(CHASE_CARRIER_DIST 안) */
function enemyCarrier(sim: Sim, f: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bestN = 0;
  let bestD = Infinity;
  for (const u of sim.units) {
    if (u.type !== 'fighter' || u.team === f.team || !isHittable(u) || !(u.crystals! > 0)) continue;
    const d = dist(f.pos, u.pos);
    if (d > CHASE_CARRIER_DIST || !isVisibleTo(sim, u, f.team)) continue;
    if (u.crystals! > bestN || (u.crystals === bestN && d < bestD)) {
      best = u;
      bestN = u.crystals!;
      bestD = d;
    }
  }
  return best;
}

/**
 * 크리스탈 러시에서 싸울 상대가 가깝지 않을 때 갈 곳:
 * 우리 카운트다운 중이면 가장 가까운 우리 운반자 곁, 아니면 가장 가까운 바닥 크리스탈, 없으면 생성 지점.
 * 갈 곳이 없으면 null(평소 행동).
 */
function crystalErrand(sim: Sim, f: Fighter, ourCountdown: boolean): Vec2 | null {
  if (ourCountdown) {
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const u of sim.units) {
      if (u.type !== 'fighter' || u.id === f.id || u.team !== f.team || !u.alive || !(u.crystals! > 0)) continue;
      const d = dist(f.pos, u.pos);
      if (d < bd) {
        best = u;
        bd = d;
      }
    }
    if (best) return bd > ESCORT_DIST ? best.pos : null;
  }
  let near: Vec2 | null = null;
  let nd = Infinity;
  for (const c of sim.crystals) {
    const d = dist(f.pos, c.pos);
    if (d < nd) {
      near = c.pos;
      nd = d;
    }
  }
  if (near) return near;
  const spawn = sim.grid.crystalSpawns[0];
  return spawn && dist(f.pos, spawn) > WAYPOINT_REACHED ? spawn : null;
}

/** 가려는 방향 앞이 막혔으면 조금씩 꺾어 본다. 다 막혔으면 원래 방향 */
function steer(sim: Sim, f: Fighter, want: Vec2, m: BotMemory): Vec2 {
  const l = Math.sqrt(want.x * want.x + want.y * want.y);
  if (l < 1e-6) return want;
  const base = Math.atan2(want.y, want.x);
  const free = (a: number) => !circleBlocked(sim.grid, f.pos.x + Math.cos(a) * PROBE, f.pos.y + Math.sin(a) * PROBE, f.radius);
  if (free(base)) return want;
  for (const sign of [m.steerSign, m.steerSign === 1 ? -1 : 1] as const) {
    for (const off of STEER_OFFSETS) {
      const a = base + off * sign;
      if (free(a)) {
        m.steerSign = sign;
        return { x: Math.cos(a) * l, y: Math.sin(a) * l };
      }
    }
  }
  return want;
}

/** 궁극기를 지금 쓸 만한가. 쓸 만하면 조준값(null = 자동 조준), 아니면 undefined */
function superAim(sim: Sim, f: Fighter, target: Unit, d: number, los: boolean, retreating: boolean): Aim | undefined {
  const def = getFighter(f.fighterId);
  const s = def.super;
  switch (s.kind) {
    case 'leap':
      // 내려찍기: 궁극기 사거리 안의 표적 위로 뛰어든다(벽을 넘으므로 시야 무관)
      if (s.slam) return !retreating && d <= s.range ? jitteredAim(sim, f.pos, target.pos, d / s.range) : undefined;
      // 체력이 낮고 적이 가까우면 적 반대쪽으로 끝까지(자동 조준이 그렇게 뛴다)
      return f.hp / f.maxHp < LEAP_HP && d <= def.attack.range ? null : undefined;
    case 'dash':
      return !retreating && d <= s.range * 0.9 && los ? jitteredAim(sim, f.pos, target.pos) : undefined;
    case 'lob':
    case 'zone':
      return d <= s.range ? jitteredAim(sim, f.pos, target.pos, d / s.range) : undefined;
    default:
      return d - target.radius <= s.range * 0.85 && (los || s.breaksWalls) ? jitteredAim(sim, f.pos, target.pos) : undefined;
  }
}

/** 봇 파이터 id가 이번 틱에 낼 입력 */
export function botInput(sim: Sim, id: EntityId): FighterInput {
  const u = sim.getUnit(id);
  if (!u || u.type !== 'fighter' || !u.alive || sim.match.winner !== null) return IDLE;
  const f = u;
  const m = memoryOf(sim, f);
  const def = getFighter(f.fighterId);
  const range = def.attack.range;
  const tick = sim.tick;

  // 끼임 판정: 지난 틱에 움직이려 했는데 거의 못 움직였는가
  const expected = def.moveSpeed * TICK_DT * m.lastMoveLen;
  if (f.action === null && m.lastMoveLen > 0.5 && dist(f.pos, m.lastPos) < expected * STUCK_RATIO) m.stuck++;
  else m.stuck = 0;
  m.lastPos = { ...f.pos };

  // 돌진·점프·넉백 중에는 입력이 무시된다
  if (f.action && f.action.kind !== 'burst') {
    m.lastMoveLen = 0;
    return IDLE;
  }

  const hp = f.hp / f.maxHp;
  if (hp < RETREAT_HP) m.retreating = true;
  else if (hp >= RECOVERED_HP) m.retreating = false;

  if (tick >= m.strafeUntil) {
    m.strafeSign = sim.rng.next() < 0.5 ? 1 : -1;
    m.strafeUntil = tick + randInt(sim, STRAFE_MIN_TICKS, STRAFE_MAX_TICKS);
  }

  const crystalMode = sim.match.mode === 'crystal';
  const carried = f.crystals ?? 0;
  const ourCountdown = crystalMode && sim.match.countdownTeam === f.team;
  if (crystalMode && ((carried >= CAREFUL_CARRY && hp < CAREFUL_HP) || (ourCountdown && carried > 0))) m.retreating = true;

  const target = (crystalMode ? enemyCarrier(sim, f) : null) ?? nearestVisibleEnemy(sim, f);
  if ((target?.id ?? null) !== m.targetId) {
    m.targetId = target?.id ?? null;
    if (target) m.reactTick = tick + randInt(sim, REACT_MIN_TICKS, REACT_MAX_TICKS);
  }
  const d = target ? dist(f.pos, target.pos) : Infinity;
  const los = target ? hasLineOfSight(sim.grid, f.pos, target.pos) : false;

  // ── 이동 ──
  let want: Vec2 = { x: 0, y: 0 };
  const crystalGoal = crystalMode && !m.retreating && (!target || d > range + ENGAGE_MARGIN) ? crystalErrand(sim, f, ourCountdown) : null;
  if (m.retreating) {
    if (dist(f.pos, f.spawn) > 1) want = dirTo(f.pos, f.spawn);
  } else if (crystalGoal) {
    want = dirTo(f.pos, crystalGoal);
  } else if (target) {
    const to = dirTo(f.pos, target.pos);
    const keep = range * KEEP_RANGE;
    let radial = 0;
    if (!los || d > keep + RANGE_BAND) radial = 1;
    else if (d < keep - RANGE_BAND) radial = -1;
    const side = los ? STRAFE_WEIGHT * m.strafeSign : 0;
    want = { x: to.x * radial - to.y * side, y: to.y * radial + to.x * side };
  } else {
    want = dirTo(f.pos, roamGoal(sim, f, m));
  }

  if (m.stuck >= STUCK_TICKS) {
    // 끼였다: 벽을 도는 방향을 바꾸고, 잠깐 그쪽 옆으로 비켜 간다(조금 흔들어서)
    m.steerSign = m.steerSign === 1 ? -1 : 1;
    m.sidestepDir = Math.atan2(want.y, want.x) + m.steerSign * (Math.PI / 2 + (sim.rng.next() - 0.5) * 0.6);
    m.sidestepUntil = tick + SIDESTEP_TICKS;
    m.stuck = 0;
  }
  if (tick < m.sidestepUntil) want = { x: Math.cos(m.sidestepDir), y: Math.sin(m.sidestepDir) };

  // 방향만 쓰고 항상 최고 속도로
  const wl = Math.sqrt(want.x * want.x + want.y * want.y);
  if (wl > 1e-6) want = { x: want.x / wl, y: want.y / wl };
  const move = steer(sim, f, want, m);
  m.lastMoveLen = Math.sqrt(move.x * move.x + move.y * move.y);

  const input: FighterInput = { move };
  if (!target || f.action !== null || tick < m.reactTick) return input;

  // ── 궁극기 ──
  if (f.superCharge >= 1) {
    const aim = superAim(sim, f, target, d, los, m.retreating);
    if (aim !== undefined) {
      input.super = { aim };
      m.nextAttackTick = tick + randInt(sim, ATTACK_GAP_MIN_TICKS, ATTACK_GAP_MAX_TICKS);
      return input;
    }
  }

  // ── 기본 공격 ──
  const reach = m.retreating ? range * SELF_DEFENSE : range * 0.95;
  // lob은 벽을 넘으므로 시야가 없어도 되고, 조준 길이 = 거리 비율
  const lob = def.attack.kind === 'lob';
  if (f.ammo >= 1 && tick >= m.nextAttackTick && (los || lob) && d - target.radius <= reach) {
    input.attack = { aim: jitteredAim(sim, f.pos, target.pos, lob ? d / range : 1) };
    m.nextAttackTick = tick + randInt(sim, ATTACK_GAP_MIN_TICKS, ATTACK_GAP_MAX_TICKS);
  }
  return input;
}
