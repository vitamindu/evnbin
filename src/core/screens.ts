/** 화면(씬) 전환 관리. 한 번에 하나의 화면만 UI 레이어에 붙는다. */
export interface Screen {
  el: HTMLElement;
  /** data-bg 값: 배경 테마 */
  bg: string;
  onShow?(): void;
  onHide?(): void;
}

export class ScreenManager {
  private current: Screen | null = null;
  private readonly app: HTMLElement;
  private readonly ui: HTMLElement;

  constructor(app: HTMLElement, ui: HTMLElement) {
    this.app = app;
    this.ui = ui;
  }

  show(next: Screen) {
    const prev = this.current;
    if (prev === next) return;
    if (prev) {
      prev.onHide?.();
      prev.el.remove();
    }
    this.current = next;
    this.app.dataset.bg = next.bg;
    next.el.classList.add('screen');
    this.ui.prepend(next.el);
    next.onShow?.();
  }

  get active(): Screen | null {
    return this.current;
  }
}
