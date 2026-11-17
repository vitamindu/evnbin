import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../config';

/**
 * 화면(px) ↔ UI 설계 좌표 변환값을 캐시한다. `src/core/layout.ts`와 같은 식.
 * 포인터 이벤트마다 getComputedStyle로 --ui-scale을 읽지 않도록, 창 크기가 바뀔 때만 다시 계산한다.
 */
export class UiMetrics {
  /** 실제 px / 설계 px */
  scale = 1;
  /** UI 무대 크기(설계 px). 16:10보다 넓은 화면이면 width가 1280보다 크다 */
  width = DESIGN_WIDTH;
  height = DESIGN_HEIGHT;
  private listening = false;
  private readonly onChange: () => void;

  /** onChange: attach() 이후 크기가 바뀔 때마다 호출 */
  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
    this.read();
  }

  private read() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.scale = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT) || 1;
    this.width = w / this.scale;
    this.height = h / this.scale;
  }

  private readonly measure = () => {
    this.read();
    this.onChange();
  };

  attach() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('resize', this.measure);
    window.visualViewport?.addEventListener('resize', this.measure);
    this.measure();
  }

  detach() {
    this.listening = false;
    window.removeEventListener('resize', this.measure);
    window.visualViewport?.removeEventListener('resize', this.measure);
  }

  /** 포인터 clientX/Y → 설계 좌표 */
  toDesign(clientX: number, clientY: number): { x: number; y: number } {
    return { x: clientX / this.scale, y: clientY / this.scale };
  }
}
