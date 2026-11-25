import { el } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { button, txt } from '../widgets';
import { myPortraitSrc } from '../portraits';

/**
 * 매칭 대기 화면(흐름 확인용 임시). 전투·서버가 붙으면 실제 매칭 상태로 바뀐다.
 */
export function openMatchmaking(ctx: AppContext) {
  const p = getProfile();
  const f = getFighter(p.selected);
  const me = el('span', 'mm-slot mm-me');
  const img = el('img');
  img.src = myPortraitSrc(ctx, f.id);
  img.alt = f.name;
  me.append(img);
  me.style.setProperty('--c', f.palette.primary);

  const empty = () => el('span', 'mm-slot mm-empty', [txt('?')]);
  const time = txt('0:00', 'mm-time');

  const overlay = el('div', 'overlay', [
    el('div', 'mm-panel panel', [
      txt('상대 찾는 중', 'mm-title'),
      el('div', 'mm-dots', [el('i'), el('i'), el('i')]),
      txt('TRAINING YARD', 'mm-mode'),
      el('div', 'mm-teams', [
        el('div', 'mm-team mm-blue', [me, empty(), empty()]),
        txt('VS', 'mm-vs'),
        el('div', 'mm-team mm-red', [empty(), empty(), empty()]),
      ]),
      time,
      el('p', 'mm-note', ['온라인 3대3은 게임 서버가 필요해요.']),
      button('btn-cancel', [txt('취소')], () => close(), 'back'),
    ]),
  ]);

  const started = performance.now();
  const timer = window.setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);

  function close() {
    window.clearInterval(timer);
    overlay.remove();
  }

  ctx.overlayLayer.append(overlay);
}
