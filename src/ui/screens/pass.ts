import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { sfx } from '../../audio/sfx';
import { getSkin } from '../../data/skins';
import {
  PASS_TIERS,
  PASS_XP,
  PREMIUM_PRICE,
  SEASON_NAME,
  XP_PER_TIER,
  normalizePass,
  rewardOf,
  tierOf,
  type PassReward,
  type PassTrack,
} from '../../data/pass';
import { getProfile, onProfileChange } from '../../state/profile';
import { accountErrorCode, accountErrorText, buyPremiumPass, claimPass, getAccount } from '../account/accountApi';
import type { AppContext } from '../context';
import { toast } from '../overlays/toast';
import { button, currencyBar, header, iconEl, txt } from '../widgets';

/**
 * 시즌 패스 화면(로비 왼쪽 아래 카드). 표는 src/data/pass.ts.
 * 위: 지금 단계·경험치 막대·프리미엄 버튼. 아래: 단계를 가로로 넘기며 무료(위)·프리미엄(아래) 보상을 누르면 받는다.
 */
export function createPassScreen(ctx: AppContext): Screen {
  let busy = false;
  let confirmEl: HTMLElement | null = null;

  const tierNum = txt('0', 'ps-tier-num');
  const xpFill = el('i');
  const xpText = txt('', 'ps-xp-text');
  const premiumBtn = button('ps-premium', [], () => premiumTap(), false);
  const top = el('div', 'ps-top panel', [
    el('div', 'ps-season', [txt(SEASON_NAME, 'ps-season-name'), txt(`경기마다 경험치 · 승리 ${PASS_XP.win} / 무승부 ${PASS_XP.draw} / 패배 ${PASS_XP.loss}`, 'ps-season-sub')]),
    el('div', 'ps-progress', [el('span', 'ps-tier', [txt('단계', 'ps-tier-label'), tierNum, txt(`/ ${PASS_TIERS}`, 'ps-tier-max')]), el('div', 'ps-xp', [el('span', 'bar ps-bar', [xpFill]), xpText])]),
    premiumBtn,
  ]);
  const track = el('div', 'ps-track');
  const labels = el('div', 'ps-labels', [txt('무료', 'ps-label is-free'), txt('프리미엄', 'ps-label is-premium')]);
  const root = el('div', 'pass-screen', [header('시즌 패스', () => ctx.go.lobby(), currencyBar(() => ctx.go.shop())), top, el('div', 'ps-body', [labels, track])]);

  const rewardArt = (r: PassReward): Node[] => {
    if (r.skin) {
      const skin = getSkin(r.skin)!;
      const img = el('img', 'ps-skin');
      img.src = ctx.skinPortraits[skin.id] ?? ctx.portraits[skin.fighterId];
      img.alt = '';
      img.draggable = false;
      return [img, txt('스킨', 'ps-amt')];
    }
    if (r.boxes) return [iconEl('box'), txt(`×${r.boxes}`, 'ps-amt')];
    if (r.gems) return [iconEl('crystal'), txt(String(r.gems), 'ps-amt')];
    return [iconEl('coin'), txt(String(r.coins ?? 0), 'ps-amt')];
  };

  const cell = (t: PassTrack, tier: number) => {
    const p = getProfile();
    const pass = normalizePass(p.pass);
    const reached = tier <= tierOf(pass.xp);
    const claimed = (t === 'free' ? pass.claimedFree : pass.claimedPremium).includes(tier);
    const locked = t === 'premium' && !pass.premium;
    const state = claimed ? 'claimed' : !reached ? 'future' : locked ? 'locked' : 'ready';
    const b = button(`ps-cell is-${t} is-${state}`, [
      ...rewardArt(rewardOf(t, tier)),
      state === 'claimed' ? el('span', 'ps-check', [iconEl('check')]) : '',
      state === 'locked' ? el('span', 'ps-lock', [txt('🔒')]) : '',
      state === 'ready' ? txt('받기', 'ps-get') : '',
    ], () => void claim(t, tier, state), false);
    b.dataset.tier = String(tier);
    b.dataset.track = t;
    return b;
  };

  const render = () => {
    const p = getProfile();
    const pass = normalizePass(p.pass);
    const reached = tierOf(pass.xp);
    tierNum.textContent = String(reached);
    const inTier = reached >= PASS_TIERS ? XP_PER_TIER : pass.xp % XP_PER_TIER;
    xpFill.style.width = `${(inTier / XP_PER_TIER) * 100}%`;
    xpText.textContent = reached >= PASS_TIERS ? '모든 단계 완료!' : `${inTier} / ${XP_PER_TIER} XP`;
    premiumBtn.classList.toggle('is-owned', pass.premium);
    premiumBtn.replaceChildren(
      ...(pass.premium ? [iconEl('check'), txt('프리미엄 적용 중')] : [txt('프리미엄 열기'), el('span', 'ps-price', [iconEl('crystal'), txt(p.admin ? '무료' : String(PREMIUM_PRICE))])]),
    );
    const cols: HTMLElement[] = [];
    for (let tier = 1; tier <= PASS_TIERS; tier++) {
      const col = el('div', `ps-col${tier <= reached ? ' is-reached' : ''}`, [cell('free', tier), el('span', 'ps-num', [txt(String(tier))]), cell('premium', tier)]);
      cols.push(col);
    }
    track.replaceChildren(...cols);
  };

  const gotText = (g: { coins: number; gems: number; boxes: number; skin?: string }) =>
    [g.coins ? `코인 ${g.coins}` : '', g.gems ? `다이아 ${g.gems}` : '', g.boxes ? `파이터 상자 ${g.boxes}개` : '', g.skin ? `${getSkin(g.skin)?.name} 스킨` : '']
      .filter(Boolean)
      .join(', ');

  async function claim(t: PassTrack, tier: number, state: string) {
    if (!getAccount()) return toast('로그인하면 시즌 패스를 쓸 수 있어요');
    if (state === 'claimed') return;
    if (state === 'future') return toast(`${tier}단계까지 경험치를 모으면 받을 수 있어요`);
    if (state === 'locked') return premiumTap();
    if (busy) return;
    busy = true;
    try {
      const r = await claimPass(tier, t);
      sfx('select');
      toast(`${gotText(r.got)} 받았어요!`);
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      busy = false;
    }
  }

  function premiumTap() {
    if (!getAccount()) return toast('로그인하면 시즌 패스를 쓸 수 있어요');
    const p = getProfile();
    if (normalizePass(p.pass).premium) return toast('이미 프리미엄이에요');
    if (!p.admin && p.crystals < PREMIUM_PRICE) return toast(`프리미엄은 다이아 ${PREMIUM_PRICE}개가 필요해요`);
    closeConfirm();
    const ov = el('div', 'overlay', [
      el('div', 'confirm-panel panel', [
        txt('프리미엄 패스를 열까요?', 'cf-title'),
        el('p', 'cf-note', [`이번 시즌 프리미엄 보상(다이아·상자·스킨)을 받을 수 있어요. 이미 지난 단계 보상도 받을 수 있어요.`]),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
          button('cp-btn is-go ps-confirm', [iconEl('crystal'), txt(p.admin ? '무료' : String(PREMIUM_PRICE))], async () => {
            closeConfirm();
            if (busy) return;
            busy = true;
            try {
              await buyPremiumPass();
              sfx('select');
              toast('프리미엄 패스가 열렸어요!');
            } catch (e) {
              toast(accountErrorText(accountErrorCode(e)));
            } finally {
              busy = false;
            }
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
      // 받을 수 있는 첫 단계(없으면 지금 단계)가 왼쪽 끝에 오게
      const ready = track.querySelector<HTMLElement>('.ps-cell.is-ready');
      const tier = ready ? Number(ready.dataset.tier) : Math.max(1, tierOf(normalizePass(getProfile().pass).xp));
      const col = track.children[tier - 1] as HTMLElement | undefined;
      track.scrollLeft = col ? Math.max(0, col.offsetLeft - (track.children[0] as HTMLElement).offsetLeft) : 0;
    },
    onHide() {
      closeConfirm();
    },
  };
}

/** 로비 카드용: 받을 수 있는 보상 수 */
export function passReadyCount(): number {
  const pass = normalizePass(getProfile().pass);
  const reached = tierOf(pass.xp);
  let n = 0;
  for (let t = 1; t <= reached; t++) {
    if (!pass.claimedFree.includes(t)) n++;
    if (pass.premium && !pass.claimedPremium.includes(t)) n++;
  }
  return n;
}
