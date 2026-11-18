import { GAME_TITLE, GAME_VERSION } from '../../config';
import { el } from '../../core/dom';
import { enterFullscreen, exitFullscreen, isFullscreen, isStandalone } from '../../core/device';
import { getServerUrl, setServerUrl } from '../../net/config';
import { resetProfile } from '../../state/profile';
import { getSettings, updateSettings } from '../../state/settings';
import type { AppContext } from '../context';
import { toast } from './toast';
import { button, iconEl, txt } from '../widgets';

/**
 * 입력한 서버 주소를 웹소켓 주소로 다듬는다. 비우면 기본값(''), 쓸 수 없으면 null.
 * http(s)://는 ws(s)://로, 스킴이 없으면 이 페이지가 https면 wss://, 아니면 ws://를 붙인다.
 */
function normalizeServerUrl(raw: string): string | null {
  let v = raw.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) v = v.replace(/^http/i, 'ws');
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${v}`;
  if (!/^wss?:\/\/[^\s/]+/i.test(v)) return null;
  try {
    new URL(v);
  } catch {
    return null;
  }
  return v;
}

/** 설정 팝업: 전체화면, 그래픽 품질, FPS 표시, 진행 초기화, 서버 주소, 기기 정보 */
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

  // 서버 주소(온라인 TEAM FIGHT). 바꾸면(포커스를 잃거나 Enter) 저장한다
  const server = el('input', 'set-input');
  server.type = 'url';
  server.inputMode = 'url';
  server.spellcheck = false;
  server.autocomplete = 'off';
  server.setAttribute('autocapitalize', 'off');
  server.enterKeyHint = 'done';
  server.placeholder = 'ws://192.168.0.10:8787';
  server.value = getServerUrl();
  server.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') server.blur();
  });
  server.addEventListener('change', () => {
    const url = normalizeServerUrl(server.value);
    if (url === null) {
      toast('USE ws:// OR wss://');
      server.value = getServerUrl();
      return;
    }
    setServerUrl(url);
    server.value = getServerUrl();
    toast('SERVER SAVED');
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
      row('SERVER', server),
      info,
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  ctx.overlayLayer.append(overlay);
}
