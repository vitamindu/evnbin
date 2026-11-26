/**
 * 플레이어 한 명의 입력 큐. 서버 틱마다 take()를 한 번 부른다.
 *
 * 규칙
 * - 이동: 받은 입력을 순서대로 틱마다 하나씩 쓴다(작은 지터 버퍼). 밀린 입력이 maxBacklog개를 넘으면
 *   오래된 것은 버리고 가장 최근 이동만 쓴다 → 지연이 쌓이지 않는다. maxBacklog=0이면 "틱마다 마지막 이동".
 * - 큐가 비면: 마지막 이동을 holdTicks 동안 유지하고(지터로 늦게 온 입력 대비) 그 뒤에는 멈춘다.
 *   유지한 틱만큼 나중에 밀린 입력 하나를 건너뛴다(이동 거리가 클라이언트 예측과 같아지도록).
 * - 공격·궁극기는 1회성: 이동 입력을 버리거나 합쳐도 사라지지 않고, 틱마다 하나씩 차례로 나간다.
 * - ack: 처리했거나 건너뛴 마지막 입력 seq(클라이언트 예측 보정용).
 */
import type { Aim, FighterInput, Vec2 } from '../src/game/types';

export interface QueuedInput {
  seq: number;
  move: Vec2;
  attack?: Aim;
  super?: Aim;
  skill?: Aim;
}

export interface InputQueueOptions {
  /** 이동 입력을 몇 개까지 쌓아 둘지(초과분은 버린다). 기본 2 */
  maxBacklog?: number;
  /** 입력이 끊겼을 때 마지막 이동을 유지할 틱 수. 기본 6(0.2초) */
  holdTicks?: number;
  /** 쌓아 둘 1회성 행동 최대 개수 */
  maxOneShots?: number;
}

const ZERO: Vec2 = { x: 0, y: 0 };
/** 한꺼번에 받을 수 있는 입력 수(악의적이거나 고장 난 클라이언트 대비) */
const MAX_QUEUE = 64;

export class InputQueue {
  private queue: QueuedInput[] = [];
  private attacks: Aim[] = [];
  private supers: Aim[] = [];
  private skills: Aim[] = [];
  private lastMove: Vec2 = ZERO;
  private idleTicks = 0;
  private debt = 0;
  /** 받은 가장 큰 seq */
  lastSeq = 0;
  /** 처리한 마지막 seq */
  ack = 0;
  private readonly maxBacklog: number;
  private readonly holdTicks: number;
  private readonly maxOneShots: number;

  constructor(opts: InputQueueOptions = {}) {
    this.maxBacklog = Math.max(0, opts.maxBacklog ?? 2);
    this.holdTicks = Math.max(0, opts.holdTicks ?? 6);
    this.maxOneShots = Math.max(1, opts.maxOneShots ?? 3);
  }

  /** 대기 중인 이동 입력 수 */
  get backlog(): number {
    return this.queue.length;
  }

  /** 재접속 등: 처음부터 다시(seq도 0부터 받는다) */
  reset() {
    this.queue = [];
    this.attacks = [];
    this.supers = [];
    this.skills = [];
    this.lastMove = ZERO;
    this.idleTicks = 0;
    this.debt = 0;
    this.lastSeq = 0;
    this.ack = 0;
  }

  /** 입력 도착. 이미 받은 seq 이하이면 무시하고 false */
  push(input: QueuedInput): boolean {
    if (!(input.seq > this.lastSeq)) return false;
    this.lastSeq = input.seq;
    this.queue.push(input);
    while (this.queue.length > MAX_QUEUE) this.drop(this.queue.shift()!);
    return true;
  }

  /** 서버 틱 하나 분량의 입력 */
  take(): FighterInput {
    let move: Vec2;
    if (this.queue.length === 0) {
      this.idleTicks++;
      if (this.idleTicks <= this.holdTicks) {
        move = this.lastMove;
        if (Math.hypot(move.x, move.y) > 0.05) this.debt = Math.min(this.debt + 1, this.maxBacklog + 2);
      } else {
        move = ZERO;
        this.lastMove = ZERO;
        this.debt = 0;
      }
    } else {
      this.idleTicks = 0;
      // 유지했던 틱만큼, 그리고 너무 밀렸으면 오래된 입력을 건너뛴다(1회성 행동은 남긴다)
      while (this.queue.length > 1 && (this.debt > 0 || this.queue.length > this.maxBacklog + 1)) {
        this.drop(this.queue.shift()!);
        if (this.debt > 0) this.debt--;
      }
      const e = this.queue.shift()!;
      this.drop(e);
      move = e.move;
      this.lastMove = move;
    }
    const input: FighterInput = { move: { x: move.x, y: move.y } };
    if (this.supers.length) input.super = { aim: this.supers.shift()! };
    else if (this.skills.length) input.skill = { aim: this.skills.shift()! };
    else if (this.attacks.length) input.attack = { aim: this.attacks.shift()! };
    return input;
  }

  /** 입력을 처리(또는 건너뜀): ack 갱신, 1회성 행동은 보관 */
  private drop(e: QueuedInput) {
    this.ack = Math.max(this.ack, e.seq);
    if (e.attack !== undefined && this.attacks.length < this.maxOneShots) this.attacks.push(e.attack);
    if (e.super !== undefined && this.supers.length < this.maxOneShots) this.supers.push(e.super);
    if (e.skill !== undefined && this.skills.length < this.maxOneShots) this.skills.push(e.skill);
  }
}
