import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';

/**
 * UI 레이어를 1280×800 설계 좌표로 맞춘다.
 * 화면이 16:10보다 넓거나 좁으면 UI 무대가 그 방향으로 늘어나서, 모서리에 붙은 요소는 항상 실제 화면 모서리에 붙는다.
 */
export function setupLayout(ui: HTMLElement, onResize: (w: number, h: number) => void) {
  const fit = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
    ui.style.width = `${w / s}px`;
    ui.style.height = `${h / s}px`;
    ui.style.transform = `scale(${s})`;
    document.documentElement.style.setProperty('--ui-scale', String(s));
    document.documentElement.classList.toggle('is-portrait', h > w);
    onResize(w, h);
  };
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
}
