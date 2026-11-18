/**
 * 고정 주기 루프(드리프트 보정). setTimeout은 늦게 깨어나기 쉬우므로 "다음 목표 시각"을 기준으로 다시 잡는다.
 * 늦었으면 밀린 틱을 몰아서 실행하고(최대 maxCatchUp), 그보다 더 밀리면 따라잡기를 포기한다.
 */
import { performance } from 'node:perf_hooks';

export class FixedLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private next = 0;
  private running = false;
  /** 따라잡기를 포기한 횟수(서버가 너무 바쁨) */
  skipped = 0;
  /** 실행한 틱 수 */
  ticks = 0;

  constructor(
    private readonly periodMs: number,
    private readonly onTick: () => void,
    private readonly maxCatchUp = 5,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** delayMs 뒤 첫 틱 */
  start(delayMs = 0) {
    if (this.running) return;
    this.running = true;
    this.next = this.now() + Math.max(delayMs, this.periodMs);
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (!this.running) return;
    const delay = Math.max(0, this.next - this.now());
    this.timer = setTimeout(this.run, delay);
  }

  private readonly run = () => {
    this.timer = null;
    if (!this.running) return;
    const now = this.now();
    let n = 0;
    while (this.running && now >= this.next && n < this.maxCatchUp) {
      this.ticks++;
      this.onTick();
      this.next += this.periodMs;
      n++;
    }
    if (now - this.next > this.periodMs * this.maxCatchUp) {
      this.skipped++;
      this.next = now + this.periodMs;
    }
    this.schedule();
  };
}
