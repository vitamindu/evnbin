import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { sfx } from '../../audio/sfx';
import { RARITY_LABEL, getSkin } from '../../data/skins';
import { SHOP_ITEMS, shopDay, type ShopItem } from '../../data/shop';
import { getProfile, onProfileChange, ownsSkin } from '../../state/profile';
import { accountErrorCode, accountErrorText, buyShopItem, getAccount } from '../account/accountApi';
import type { AppContext } from '../context';
import { toast } from '../overlays/toast';
import { button, currencyBar, header, iconEl, txt } from '../widgets';

/**
 * 상점 화면(로비 "상점", 코인·다이아 표시). 상품은 src/data/shop.ts.
 * 카드를 가로로 늘어놓고 손가락으로 넘긴다. 다이아가 드는 상품은 한 번 더 묻는다.
 */
export function createShopScreen(ctx: AppContext): Screen {
  let busy = false;
  let confirmEl: HTMLElement | null = null;
  const strip = el('div', 'shop-strip');
  const root = el('div', 'shop-screen', [header('상점', () => ctx.go.lobby(), currencyBar(() => {})), strip]);

  const SECTION: Record<ShopItem['kind'], string> = { daily: '무료', box: '파이터 상자', coins: '코인', skin: '스킨' };

  const art = (item: ShopItem): HTMLElement => {
    if (item.kind === 'daily') return el('span', 'shop-art', [iconEl('star')]);
    if (item.kind === 'box') return el('span', `shop-art${item.boxes > 1 ? ' is-stack' : ''}`, [iconEl('box'), item.boxes > 1 ? txt(`×${item.boxes}`, 'shop-mult') : '']);
    if (item.kind === 'coins') return el('span', 'shop-art', [iconEl('coin')]);
    const skin = getSkin(item.skinId)!;
    const img = el('img');
    img.src = ctx.skinPortraits[skin.id] ?? ctx.portraits[skin.fighterId];
    img.alt = '';
    img.draggable = false;
    return el('span', 'shop-art is-skin', [img]);
  };

  /** 지금 이 상품 상태: 살 수 있음 / 오늘 받음 / 이미 가짐 */
  const stateOf = (item: ShopItem): 'buy' | 'claimed' | 'owned' => {
    const p = getProfile();
    if (item.kind === 'daily' && p.dailyClaimed === shopDay(Date.now())) return 'claimed';
    if (item.kind === 'skin' && ownsSkin(p, item.skinId)) return 'owned';
    return 'buy';
  };

  const priceEl = (item: ShopItem) => {
    const st = stateOf(item);
    if (st === 'claimed') return [txt('내일 다시')];
    if (st === 'owned') return [txt('보유 중')];
    if (item.kind === 'daily') return [txt('무료로 받기')];
    return [iconEl('crystal'), txt(getProfile().admin ? '무료' : String(item.price))];
  };

  const card = (item: ShopItem) => {
    const st = stateOf(item);
    const desc =
      item.kind === 'daily'
        ? `코인 ${item.coins}`
        : item.kind === 'box'
          ? '열면 코인·다이아 3~10개'
          : item.kind === 'coins'
            ? '레벨 업에 써요'
            : `${RARITY_LABEL[getSkin(item.skinId)!.rarity]} · ${getSkin(item.skinId)!.fighterId.toUpperCase()} 스킨`;
    const btn = button(`shop-buy is-${st}`, priceEl(item), () => tap(item), false);
    const c = el('div', `shop-card is-${item.kind} is-${st}`, [
      item.kind !== 'daily' && 'tag' in item && item.tag ? txt(item.tag, 'shop-tag') : '',
      art(item),
      txt(item.name, 'shop-name'),
      el('span', 'shop-desc', [desc]),
      btn,
    ]);
    c.dataset.item = item.id;
    return c;
  };

  const render = () => {
    const groups: HTMLElement[] = [];
    let last: ShopItem['kind'] | null = null;
    let cur: HTMLElement | null = null;
    for (const item of SHOP_ITEMS) {
      if (item.kind !== last) {
        last = item.kind;
        cur = el('div', 'shop-cards');
        groups.push(el('div', `shop-group is-${item.kind}`, [txt(SECTION[item.kind], 'shop-group-title'), cur]));
      }
      cur!.append(card(item));
    }
    strip.replaceChildren(...groups);
  };

  const gotText = (g: { coins: number; gems: number; boxes: number; skin?: string }) =>
    [g.coins ? `코인 ${g.coins.toLocaleString('en-US')}` : '', g.gems ? `다이아 ${g.gems}` : '', g.boxes ? `파이터 상자 ${g.boxes}개` : '', g.skin ? `${getSkin(g.skin)?.name} 스킨` : '']
      .filter(Boolean)
      .join(', ');

  async function buy(item: ShopItem) {
    if (busy) return;
    busy = true;
    try {
      const r = await buyShopItem(item.id);
      sfx('select');
      toast(`${gotText(r.got)} 받았어요!${r.got.boxes ? ' 상자 버튼에서 열 수 있어요' : ''}`);
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      busy = false;
      render();
    }
  }

  function tap(item: ShopItem) {
    if (!getAccount()) {
      toast('로그인하면 상점을 쓸 수 있어요');
      return;
    }
    const st = stateOf(item);
    if (st === 'claimed') return toast('오늘은 이미 받았어요. 내일 다시 와 주세요');
    if (st === 'owned') return toast('이미 가진 스킨이에요');
    if (item.kind === 'daily' || getProfile().admin) return void buy(item);
    if (getProfile().crystals < item.price) return toast('다이아가 부족해요');
    closeConfirm();
    const ov = el('div', 'overlay', [
      el('div', 'confirm-panel panel shop-confirm', [
        txt('살까요?', 'cf-title'),
        el('p', 'cf-note', [`${item.name}을(를) 다이아 ${item.price}개로 사요.`]),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
          button('cp-btn is-go shop-confirm-buy', [iconEl('crystal'), txt(String(item.price))], () => {
            closeConfirm();
            void buy(item);
          }),
        ]),
      ]),
    ]);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeConfirm();
    });
    confirmEl = ov;
    ctx.overlayLayer.append(ov);
  }
  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }

  onProfileChange(render);
  render();
  return {
    el: root,
    bg: 'online',
    onShow() {
      ctx.stage.setView(null);
      render();
      strip.scrollLeft = 0;
    },
    onHide() {
      closeConfirm();
    },
  };
}
