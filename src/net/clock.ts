/**
 * 서버 틱 시계 추정. Network 담당. DOM·Three.js import 금지(단위 테스트에서 그대로 쓴다).
 *
 * snap이 도착할 때마다 "도착 시각 기준 서버 틱"을 표본으로 받는다.
 *  - 표본이 추정보다 앞서면(빨리 도착) 빠르게 따라가고, 뒤처지면(늦게 도착) 아주 천천히 따라간다.
 *    → 추정은 "가장 빨리 도착한 경우"에 붙고, 늦게 온 패킷(지터)에 흔들리지 않는다.
 *  - 얼마나 늦게 오는지(지터)를 따로 재서 보간 지연을 자동으로 늘린다.
 */
import { TICK_RATE } from '../game/types';

const TICK_MS = 1000 / TICK_RATE;

export class ServerClock {
  /** 서버 틱 − 로컬 시각(틱 단위). null이면 아직 모름 */
  private offset: number | null = null;
  /** 최근 지터(틱). 늦게 온 정도의 감쇠 최댓값 */
  jitterTicks = 0;

  get ready(): boolean {
    return this.offset !== null;
  }

  reset() {
    this.offset = null;
    this.jitterTicks = 0;
  }

  /** snap(서버 틱 serverTick)이 로컬 시각 localMs에 도착했다 */
  observe(serverTick: number, localMs: number) {
    const sample = serverTick - localMs / TICK_MS;
    if (this.offset === null || Math.abs(sample - this.offset) > 15) {
      // 처음이거나 크게 어긋남(탭이 멈췄다 돌아옴 등): 바로 맞춘다
      this.offset = sample;
      this.jitterTicks = 0;
      return;
    }
    if (sample > this.offset) {
      this.offset += (sample - this.offset) * 0.25;
      this.jitterTicks *= 0.99;
    } else {
      const late = this.offset - sample;
      this.offset += (sample - this.offset) * 0.01;
      this.jitterTicks = Math.max(late, this.jitterTicks * 0.99);
    }
  }

  /** 로컬 시각 localMs에서의 서버 틱 추정(소수) */
  serverTick(localMs: number): number {
    return (this.offset ?? 0) + localMs / TICK_MS;
  }
}
