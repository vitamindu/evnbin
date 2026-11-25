import '../../styles/online.css';
import { el } from '../../core/dom';
import { FIGHTERS, type FighterId } from '../../data/fighters';
import type { AppContext } from '../context';
import { portrait } from '../online/widgets';
import { button, iconEl, roleChip, txt } from '../widgets';
import { equippedSkin, getProfile } from '../../state/profile';

/** 캐릭터 고르기 팝업(온라인 방·이름 카드에서). 고르면 onPick 후 닫는다 */
export function openFighterPicker(ctx: AppContext, current: FighterId, onPick: (id: FighterId) => void) {
  const cards = FIGHTERS.map((f) => {
    const c = button(
      `fp-card${f.id === current ? ' is-selected' : ''}`,
      [portrait(ctx, f.id, 'portrait fp-portrait', equippedSkin(getProfile(), f.id)),txt(f.name, 'fp-name'), roleChip(f.id)],
      () => {
        close();
        if (f.id !== current) onPick(f.id);
      },
      'select',
    );
    c.dataset.fighter = f.id;
    return c;
  });
  const overlay = el('div', 'overlay', [
    el('div', 'fp-panel panel', [
      el('div', 'mp-head', [txt('캐릭터 선택', 'mp-title'), button('btn-close', [iconEl('close')], () => close(), 'back')]),
      el('div', 'fp-cards', cards),
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  function close() {
    overlay.remove();
  }
  ctx.overlayLayer.append(overlay);
}
