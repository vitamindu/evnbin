import { GAME_TITLE, GAME_VERSION } from '../../config';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { TitleView } from '../../render/views/titleView';
import type { Stage } from '../../render/stage';
import { txt } from '../widgets';

/**
 * 타이틀(로그인 자리) 화면. 지금은 "터치해서 시작"만 있고, 로그인은 이후 단계에서 이 화면에 붙인다.
 * 첫 터치에서 소리 잠금 해제·전체화면·가로 고정을 같이 처리한다(브라우저는 사용자 터치 안에서만 허용).
 */
export function createTitleScreen(stage: Stage, onStart: () => void) {
  const view = new TitleView();
  const words = GAME_TITLE.split(' ');
  const logo = el(
    'div',
    'title-logo',
    words.map((w, i) => {
      const word = el('div', `logo-word logo-word-${i}`, [el('span', '', [w])]);
      word.dataset.text = w;
      return word;
    }),
  );
  const barFill = el('i');
  const loader = el('div', 'title-loader', [el('div', 'bar', [barFill]), txt('LOADING', 'title-loading-label')]);
  const tap = txt('TAP TO START', 'title-tap');
  tap.hidden = true;
  const footer = el('div', 'title-footer', [`v${GAME_VERSION} · PROTOTYPE`]);
  const root = el('div', 'title', [logo, loader, tap, footer]);

  let ready = false;
  root.addEventListener('click', () => {
    if (!ready) return;
    ready = false;
    onStart();
  });

  const screen: Screen & { setProgress(p: number): void; setReady(): void } = {
    el: root,
    bg: 'title',
    onShow: () => stage.setView(view),
    setProgress(p) {
      barFill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
    },
    setReady() {
      ready = true;
      loader.hidden = true;
      tap.hidden = false;
    },
  };
  return screen;
}
