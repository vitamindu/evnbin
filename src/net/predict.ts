/**
 * 내 캐릭터 이동 예측과 보정. Network 담당. DOM·Three.js import 금지(단위 테스트에서 그대로 쓴다).
 *
 * - 입력을 보낼 때마다(틱마다) 같은 규칙(moveCircle)으로 바로 움직인다.
 * - 서버 snap이 오면: ack 이하 입력은 버리고, 서버 위치에서 남은 입력을 다시 적용한다(보정).
 * - 서버에서 내가 돌진·점프·넉백 중이거나 죽어 있으면 예측하지 않는다(active=false, 서버 상태를 그린다).
 *
 * 이동 규칙은 src/game/sim.ts stepFighter의 이동 부분과 같아야 한다:
 *   move = clampLen(input.move, 1); len > 0.05 이면 moveCircle(grid, pos, r, move × moveSpeed × TICK_DT)
 */
import { getFighter, type FighterId } from '../data/fighters';
import { TICK_DT, type Fighter, type Vec2 } from '../game/types';
import { angleOf, clampLen, len } from '../game/vec';
import { moveCircle, type Grid } from '../game/world';

export interface PendingInput {
  seq: number;
  move: Vec2;
}

/** 서버 상태에서 이어서 예측할 수 있는가(일반 이동이 가능한 상태) */
export function isPredictable(f: Fighter | undefined): f is Fighter {
  return !!f && f.alive && (f.action === null || f.action.kind === 'burst');
}

/** 한 틱 이동(서버 Sim과 같은 규칙) */
export function stepMove(grid: Grid, pos: Vec2, radius: number, moveSpeed: number, input: Vec2): { pos: Vec2; moved: boolean; dir: number | null } {
  const m = clampLen(input, 1);
  if (len(m) <= 0.05) return { pos, moved: false, dir: null };
  const speed = moveSpeed * TICK_DT;
  const next = moveCircle(grid, pos, radius, m.x * speed, m.y * speed);
  return { pos: next, moved: Math.hypot(next.x - pos.x, next.y - pos.y) > 1e-4, dir: angleOf(m) };
}

export class Predictor {
  /** 예측한 현재 위치(active일 때만 의미 있음) */
  pos: Vec2 = { x: 0, y: 0 };
  facing = 0;
  moving = false;
  /** 예측이 내 캐릭터를 움직이는 중인가 */
  active = false;
  /** 서버가 아직 처리하지 않은(ack 안 된) 입력 */
  readonly pending: PendingInput[] = [];
  private readonly radius: number;
  private readonly moveSpeed: number;
  /** 마지막 서버 상태가 연사(burst) 중이면 방향은 서버 값을 따른다 */
  private lockFacing = false;

  constructor(
    private readonly grid: Grid,
    fighterId: FighterId,
    radius: number,
  ) {
    this.radius = radius;
    this.moveSpeed = getFighter(fighterId).moveSpeed;
  }

  reset() {
    this.pending.length = 0;
    this.active = false;
    this.moving = false;
  }

  /** 이번 틱 입력을 보냈다: 기록하고 바로 움직인다 */
  applyLocal(seq: number, move: Vec2) {
    this.pending.push({ seq, move });
    // 서버가 오래 답하지 않을 때 무한히 쌓이지 않게(약 4초)
    if (this.pending.length > 120) this.pending.shift();
    if (!this.active) return;
    const r = stepMove(this.grid, this.pos, this.radius, this.moveSpeed, move);
    this.pos = r.pos;
    this.moving = r.moved;
    if (r.dir !== null && !this.lockFacing) this.facing = r.dir;
  }

  /**
   * 서버 snap 도착. ack까지 처리됐다. server = snap 속 내 파이터.
   * 돌려주는 값: 보정 전후 예측 위치 차이(보정량). 예측을 새로 시작하거나 멈췄으면 null.
   */
  reconcile(ack: number, server: Fighter | undefined): Vec2 | null {
    while (this.pending.length && this.pending[0]!.seq <= ack) this.pending.shift();
    const wasActive = this.active;
    const before = { ...this.pos };
    if (!isPredictable(server)) {
      this.active = false;
      this.moving = false;
      return null;
    }
    this.lockFacing = server.action?.kind === 'burst';
    let p = { ...server.pos };
    let facing = server.facing;
    let moving = server.moving;
    for (const inp of this.pending) {
      const r = stepMove(this.grid, p, this.radius, this.moveSpeed, inp.move);
      p = r.pos;
      moving = r.moved;
      if (r.dir !== null && !this.lockFacing) facing = r.dir;
    }
    this.pos = p;
    this.facing = facing;
    this.moving = moving;
    this.active = true;
    return wasActive ? { x: p.x - before.x, y: p.y - before.y } : null;
  }
}
