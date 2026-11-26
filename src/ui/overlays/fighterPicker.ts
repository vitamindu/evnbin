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
  const cardList = overlay.querySelector<HTMLElement>('.fp-cards')!;
  let pointer: { id: number; startY: number; startScroll: number; moved: boolean } | null = null;
  let suppressClickUntil = 0;
  cardList.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointer = { id: e.pointerId, startY: e.clientY, startScroll: cardList.scrollTop, moved: false };
  });
  cardList.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dy = e.clientY - pointer.startY;
    if (!pointer.moved && Math.abs(dy) < 6) return;
    pointer.moved = true;
    if (!cardList.hasPointerCapture(e.pointerId)) cardList.setPointerCapture(e.pointerId);
    cardList.scrollTop = pointer.startScroll - dy;
    e.preventDefault();
  });
  const endScroll = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (pointer.moved) suppressClickUntil = performance.now() + 350;
    pointer = null;
  };
  cardList.addEventListener('pointerup', endScroll);
  cardList.addEventListener('pointercancel', endScroll);
  cardList.addEventListener('click', (e) => {
    if (performance.now() > suppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  function close() {
    overlay.remove();
  }
  ctx.overlayLayer.append(overlay);
}
