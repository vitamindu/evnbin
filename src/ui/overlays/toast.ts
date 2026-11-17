import { el } from '../../core/dom';

let layer: HTMLElement | null = null;

export function initToast(overlayLayer: HTMLElement) {
  layer = el('div', 'toast-layer');
  overlayLayer.append(layer);
}

export function toast(message: string) {
  if (!layer) return;
  layer.replaceChildren();
  const t = el('div', 'toast t-outline', [message]);
  layer.append(t);
  t.addEventListener('animationend', () => t.remove());
}

/** 아직 구현하지 않은 기능 */
export function comingSoon() {
  toast('COMING SOON');
}
