import { GAME_TITLE, GAME_VERSION } from '../../config';
import { el } from '../../core/dom';
import { enterFullscreen, exitFullscreen, isFullscreen, isStandalone } from '../../core/device';
import { resetProfile } from '../../state/profile';
import { getSettings, updateSettings } from '../../state/settings';
import type { AppContext } from '../context';
import { toast } from './toast';
import { button, iconEl, txt } from '../widgets';

/** 설정 팝업: 전체화면, 그래픽 품질, FPS 표시, 진행 초기화, 기기 정보 */
export function openSettings(ctx: AppContext) {
  const row = (label: string, control: HTMLElement) => el('div', 'set-row', [txt(label, 'set-label'), control]);

  const toggle = (get: () => string, onTap: () => void | Promise<void>) => {
    const label = txt(get());
    const b = button('btn-toggle', [label], async () => {
      await onTap();
      label.textContent = get();
    });
    return b;
  };

  const fullscreen = toggle(
    () => (isFullscreen() ? 'ON' : 'OFF'),
    async () => {
      if (isStandalone()) return;
      if (isFullscreen()) await exitFullscreen();
      else await enterFullscreen();
    },
  );
  const quality = toggle(
    () => (getSettings().quality === 'high' ? 'HIGH' : 'LOW'),
    () => updateSettings({ quality: getSettings().quality === 'high' ? 'low' : 'high' }),
  );
  const fps = toggle(
    () => (getSettings().showFps ? 'ON' : 'OFF'),
    () => updateSettings({ showFps: !getSettings().showFps }),
  );
  let armed = false;
  const resetLabel = txt('RESET');
  const reset = button('btn-toggle btn-danger', [resetLabel], () => {
    if (!armed) {
      armed = true;
      resetLabel.textContent = 'SURE?';
      return;
    }
    resetProfile();
    armed = false;
    resetLabel.textContent = 'RESET';
    toast('PROGRESS RESET');
  });

  const dpr = window.devicePixelRatio || 1;
  const info = el('p', 'set-info', [
    `${GAME_TITLE} v${GAME_VERSION} · screen ${window.innerWidth}×${window.innerHeight} @${dpr}x` +
      ` (${Math.round(window.innerWidth * dpr)}×${Math.round(window.innerHeight * dpr)}) · ${isStandalone() ? 'installed app' : 'browser'}`,
  ]);

  const overlay = el('div', 'overlay', [
    el('div', 'set-panel panel', [
      el('div', 'set-head', [txt('SETTINGS', 'set-title'), button('btn-close', [iconEl('close')], () => overlay.remove(), 'back')]),
      row('FULLSCREEN', fullscreen),
      row('GRAPHICS', quality),
      row('SHOW FPS', fps),
      row('RESET PROGRESS', reset),
      info,
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  ctx.overlayLayer.append(overlay);
}
