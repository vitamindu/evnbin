import { rankLabel, rankOf } from '../../data/ranks';
import { openRanks } from '../overlays/ranks';
import { rankEmblemSvg } from '../rankEmblem';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { FIGHTERS, getFighter } from '../../data/fighters';
import { ShowcaseView } from '../../render/views/showcaseView';
import { openProfile } from '../overlays/profile';
import { boxCountLabel, openBoxes } from '../overlays/box';
import { fillAvatar } from '../avatar';
import { equippedSkin, getProfile, onProfileChange, totalTrophies } from '../../state/profile';
import { getSettings, onSettingsChange } from '../../state/settings';
import type { AppContext } from '../context';
import { MODES, openModePicker } from '../overlays/modePicker';
import { openSettings } from '../overlays/settings';
import { comingSoon, toast } from '../overlays/toast';
import { isOfflineGuest } from '../account/session';
import { attachDrag, button, currencyBar, iconEl, roleChip, txt } from '../widgets';
import type { IconName } from '../icons';

/** 다음 트로피 보상 구간 */
function trophyMilestone(n: number): { prev: number; next: number } {
  const steps = [0, 10, 25, 50, 100, 200, 350, 500, 750, 1000];
  for (let i = 1; i < steps.length; i++) {
    const next = steps[i]!;
    if (n < next) return { prev: steps[i - 1]!, next };
  }
  const base = Math.floor(n / 500) * 500;
  return { prev: base, next: base + 500 };
}

export function createLobbyScreen(ctx: AppContext): Screen {
  const view = new ShowcaseView({
    fov: 26,
    camPos: [0, 1.35, 7.6],
    lookAtY: 0.86,
    ndcX: 0,
    baseYaw: 0.3,
    returnToBase: true,
  });

  /** data-btn = 아이콘 이름(shop, fighters, …): 글자와 무관한 E2E 선택자 */
  const sideBtn = (label: string, ico: IconName, fn: () => void, badge?: string) => {
    const b = button('side-btn', [iconEl(ico), txt(label), badge ? el('span', 'badge t-outline', [badge]) : null].filter(Boolean) as Node[], fn);
    b.dataset.btn = ico;
    return b;
  };

  // ── 왼쪽 위: 프로필 + 트로피
  const pName = txt('', 'pc-name');
  const pTag = el('span', 'pc-sub', ['']);
  const avatar = el('span', 'avatar');
  const profileCard = button('profile-card', [avatar, el('span', 'pc-text', [pName, pTag])], () => openProfile(ctx));
  const rankIco = el('span', 'ico tc-ico');
  const trophyNum = txt('0', 'tc-num');
  const trophyFill = el('i');
  const trophyNext = el('span', 'tc-next', ['']);
  const trophyCard = button(
    'trophy-card',
    [rankIco, el('span', 'tc-body', [el('span', 'tc-row', [trophyNum, trophyNext]), el('span', 'bar', [trophyFill])])],
    () => openRanks(ctx),
  );

  // ── 가운데: 이름표 + 캐릭터 드래그 영역 + 파티 슬롯
  const plateRole = el('span', 'np-role');
  const plateName = txt('', 'np-name');
  const plateTrophy = txt('0', 'np-num');
  const platePower = txt('1', 'np-num');
  const nameplate = el('div', 'nameplate', [
    plateRole,
    plateName,
    el('span', 'np-chip', [iconEl('trophy'), plateTrophy]),
    el('span', 'np-chip np-power', [txt('파워', 'np-label'), platePower]),
  ]);
  const hit = el('div', 'stage-hit');
  attachDrag(hit, {
    onStart: () => view.setDragging(true),
    onDrag: (dx) => view.rotateBy(dx),
    onEnd: () => view.setDragging(false),
    onTap: () => ctx.go.fighters(),
  });
  const slotL = button('party-slot slot-left', [iconEl('plus')], comingSoon);
  const slotR = button('party-slot slot-right', [iconEl('plus')], comingSoon);

  // ── 아래: 시즌 패스, 모드, 플레이
  const passCard = button(
    'pass-card',
    [iconEl('pass', 'ico pass-ico'), el('span', 'pass-text', [txt('시즌 패스', 'pass-title'), txt('시즌 1', 'pass-sub')])],
    comingSoon,
  );
  // 모드 카드: 지금 고른 모드(설정에 저장). 탭하면 모드 선택 팝업, PLAY는 그 모드로 시작
  const modeIco = el('span', 'mode-ico-wrap');
  const modeName = txt('', 'mode-name');
  const modeMap = txt('', 'mode-map');
  const modeTag = txt('모드', 'mode-tag');
  const modeCard = button(
    'mode-card',
    [modeIco, el('span', 'mode-text', [modeName, modeMap]), modeTag, iconEl('next', 'ico mode-more')],
    () => openModePicker(ctx),
  );
  const renderMode = () => {
    const m = MODES[getSettings().playMode];
    modeCard.dataset.mode = m.id;
    modeIco.replaceChildren(iconEl(m.icon, 'ico mode-ico'));
    modeName.textContent = m.name;
    modeMap.textContent = m.map;
    modeTag.textContent = `모드 · ${m.online ? '온라인' : '오프라인'}`;
  };
  renderMode();
  onSettingsChange(renderMode);
  const playBtn = button(
    'btn-play',
    [txt('PLAY')],
    () => {
      if (getSettings().playMode === 'training') return ctx.go.battle();
      // 오프라인(게스트)으로 들어왔으면 온라인 전에 로그인
      if (isOfflineGuest()) {
        toast('온라인은 로그인한 뒤에 할 수 있어요');
        return ctx.go.login();
      }
      ctx.go.online();
    },
    'select',
  );

  // 파이터 상자: 남은 개수 배지(0이면 숨김, 관리자는 ∞)
  const boxBadge = el('span', 'badge t-outline');
  const boxBtn = sideBtn('상자', 'box', () => openBoxes(ctx));
  boxBtn.append(boxBadge);

  const root = el('div', 'lobby', [
    hit,
    el('div', 'lb-top-left', [profileCard, trophyCard]),
    el('div', 'lb-top-right', [currencyBar(comingSoon), button('icon-btn', [iconEl('gear')], () => openSettings(ctx))]),
    el('div', 'lb-side lb-side-left', [
      sideBtn('상점', 'shop', comingSoon),
      sideBtn('캐릭터', 'fighters', () => ctx.go.fighters(), String(FIGHTERS.length)),
      sideBtn('소식', 'news', comingSoon),
      boxBtn,
    ]),
    el('div', 'lb-side lb-side-right', [
      sideBtn('친구', 'friends', () => ctx.go.friends()),
      sideBtn('파티', 'party', comingSoon),
      sideBtn('길드', 'crew', () => ctx.go.guild()),
    ]),
    nameplate,
    slotL,
    slotR,
    passCard,
    modeCard,
    playBtn,
  ]);

  const render = () => {
    const p = getProfile();
    const f = getFighter(p.selected);
    pName.textContent = p.name;
    pTag.textContent = `#${p.tag}`;
    fillAvatar(avatar, p.name, p.avatar);
    boxBadge.textContent = boxCountLabel();
    boxBadge.hidden = boxBadge.textContent === '0';
    avatar.style.setProperty('--c', f.palette.primary);
    const total = totalTrophies(p);
    void trophyMilestone(total);
    const rk = rankOf(p.rankPoints ?? 0);
    rankIco.innerHTML = rankEmblemSvg(rk.tier.id, 'lobby');
    trophyNum.textContent = rankLabel(rk);
    trophyNext.textContent = `${rk.points} RP`;
    trophyFill.style.width = rk.to === null ? '100%' : `${((rk.points - rk.from) / (rk.to - rk.from)) * 100}%`;
    plateRole.replaceChildren(roleChip(f.id));
    plateName.textContent = f.name;
    plateTrophy.textContent = String(p.fighters[f.id].trophies);
    platePower.textContent = String(p.fighters[f.id].power);
    nameplate.style.setProperty('--c', f.palette.primary);
    view.setFighter(f.id, equippedSkin(p, f.id));
  };
  render();
  onProfileChange(render);

  return {
    el: root,
    bg: 'lobby',
    onShow: () => {
      render();
      ctx.stage.setView(view);
    },
  };
}
