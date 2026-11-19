import { GAME_TITLE, GAME_VERSION } from '../../config';
import { el } from '../../core/dom';
import { enterFullscreen, exitFullscreen, isFullscreen, isStandalone } from '../../core/device';
import { getServerUrl, setServerUrl } from '../../net/config';
import { resetProfile } from '../../state/profile';
import { getSettings, updateSettings } from '../../state/settings';
import type { AppContext } from '../context';
import { getAccount, logout } from '../account/accountApi';
import { getOnlineClient } from '../online/clientFactory';
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
  /** data-row: 글자와 무관한 E2E 선택자 */
  const row = (id: string, label: string, control: HTMLElement) => {
    const r = el('div', 'set-row', [txt(label, 'set-label'), control]);
    r.dataset.row = id;
    return r;
  };

  const toggle = (get: () => string, onTap: () => void | Promise<void>) => {
    const label = txt(get());
    const b = button('btn-toggle', [label], async () => {
      await onTap();
      label.textContent = get();
    });
    return b;
  };

  const fullscreen = toggle(
    () => (isFullscreen() ? '켬' : '끔'),
    async () => {
      if (isStandalone()) return;
      if (isFullscreen()) await exitFullscreen();
      else await enterFullscreen();
    },
  );
  const quality = toggle(
    () => (getSettings().quality === 'high' ? '높음' : '낮음'),
    () => updateSettings({ quality: getSettings().quality === 'high' ? 'low' : 'high' }),
  );
  const fps = toggle(
    () => (getSettings().showFps ? '켬' : '끔'),
    () => updateSettings({ showFps: !getSettings().showFps }),
  );
  let armed = false;
  const resetLabel = txt('초기화');
  const reset = button('btn-toggle btn-danger', [resetLabel], () => {
    if (!armed) {
      armed = true;
      resetLabel.textContent = '정말요?';
      return;
    }
    resetProfile();
    armed = false;
    resetLabel.textContent = '초기화';
    toast('진행을 초기화했어요');
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
      toast('ws:// 또는 wss:// 주소를 넣어 주세요');
      server.value = getServerUrl();
      return;
    }
    setServerUrl(url);
    server.value = getServerUrl();
    toast('서버 주소를 저장했어요');
  });

  // 계정: 이름 + 로그아웃(로그인 안 했으면 OFFLINE + 로그인)
  const acct = getAccount();
  const accountCtl = el('div', 'set-account', [
    txt(acct ? acct.username : '오프라인', `set-acct-name${acct ? '' : ' is-off'}`),
    button(`btn-toggle ${acct ? 'btn-danger btn-logout' : 'btn-login'}`, [txt(acct ? '로그아웃' : '로그인')], async () => {
      overlay.remove();
      if (acct) {
        const c = getOnlineClient();
        if (c.room) c.leaveRoom();
        if (c.status !== 'disconnected') c.disconnect();
        await logout();
        toast('로그아웃했어요');
      }
      ctx.go.login();
    }),
  ]);

  const dpr = window.devicePixelRatio || 1;
  const info = el('p', 'set-info', [
    `${GAME_TITLE} v${GAME_VERSION} · screen ${window.innerWidth}×${window.innerHeight} @${dpr}x` +
      ` (${Math.round(window.innerWidth * dpr)}×${Math.round(window.innerHeight * dpr)}) · ${isStandalone() ? 'installed app' : 'browser'}`,
  ]);

  const overlay = el('div', 'overlay', [
    el('div', 'set-panel panel', [
      el('div', 'set-head', [txt('설정', 'set-title'), button('btn-close', [iconEl('close')], () => overlay.remove(), 'back')]),
      row('account', '계정', accountCtl),
      row('fullscreen', '전체 화면', fullscreen),
      row('graphics', '그래픽', quality),
      row('fps', 'FPS 표시', fps),
      acct ? null : row('reset', '진행 초기화', reset),
      row('server', '서버', server),
      info,
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  ctx.overlayLayer.append(overlay);
}
