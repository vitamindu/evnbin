import { el } from '../../core/dom';
import { sfx } from '../../audio/sfx';
import { BOX_NAME, boxTotals, type BoxItem } from '../../data/boxes';
import { getProfile, onProfileChange } from '../../state/profile';
import { accountErrorCode, accountErrorText, getAccount, openBox } from '../account/accountApi';
import type { AppContext } from '../context';
import { toast } from './toast';
import { button, iconEl, txt } from '../widgets';

/** 지금 열 수 있는 상자 수 */
export const boxCountLabel = () => String(getProfile().boxes ?? 0);

/**
 * 파이터 상자 창: 상자를 누르거나 "열기" → 서버가 연 결과를 한 칸씩 보여 준다.
 */
export function openBoxes(ctx: AppContext) {
  if (!getAccount()) {
    toast('로그인하면 파이터 상자를 열 수 있어요');
    return;
  }
  const count = txt('', 'bx-count');
  const boxIco = el('span', 'bx-box', [iconEl('box')]);
  const items = el('div', 'bx-items');
  const totals = el('div', 'bx-totals');
  let busy = false;

  const openBtnLabel = txt('열기');
  const openBtn = button('bx-open', [openBtnLabel], () => void doOpen(), false);
  const boxBtn = button('bx-box-btn', [boxIco], () => void doOpen(), false);

  const render = () => {
    const p = getProfile();
    count.textContent = `보유 ${boxCountLabel()}개`;
    const has = (p.boxes ?? 0) > 0;
    openBtn.classList.toggle('is-empty', !has);
  };

  const showItems = (list: BoxItem[]) => {
    items.replaceChildren(
      ...list.map((it, i) => {
        const card = el('div', `bx-item is-${it.kind}`, [iconEl(it.kind === 'coins' ? 'coin' : 'crystal'), txt(`+${it.amount}`, 'bx-amt')]);
        card.style.animationDelay = `${0.12 + i * 0.16}s`;
        return card;
      }),
    );
    const t = boxTotals(list);
    totals.replaceChildren(
      txt(`${list.length}개 획득`, 'bx-n'),
      t.coins ? el('span', 'bx-sum', [iconEl('coin'), txt(String(t.coins))]) : '',
      t.gems ? el('span', 'bx-sum', [iconEl('crystal'), txt(String(t.gems))]) : '',
    );
    totals.style.animationDelay = `${0.2 + list.length * 0.16}s`;
  };

  async function doOpen() {
    if (busy) return;
    const p = getProfile();
    if ((p.boxes ?? 0) < 1) {
      toast('열 수 있는 상자가 없어요. 온라인 경기에서 이기면 1개!');
      return;
    }
    busy = true;
    panel.classList.remove('is-open');
    boxIco.classList.add('is-shaking');
    sfx('select');
    try {
      const [r] = await Promise.all([openBox(), new Promise((res) => setTimeout(res, 550))]);
      showItems(r.items);
      panel.classList.add('is-open');
      openBtnLabel.textContent = '한 번 더 열기';
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      boxIco.classList.remove('is-shaking');
      busy = false;
    }
  }

  render();
  const off = onProfileChange(render);
  const close = () => {
    off();
    overlay.remove();
  };
  const panel = el('div', 'bx-panel panel', [
    el('div', 'set-head', [txt(BOX_NAME, 'set-title'), count, button('btn-close', [iconEl('close')], close, 'back')]),
    boxBtn,
    items,
    totals,
    openBtn,
  ]);
  const overlay = el('div', 'overlay', [panel]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  ctx.overlayLayer.append(overlay);
}
