import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { FIGHTERS, getFighter } from '../../data/fighters';
import { ShowcaseView } from '../../render/views/showcaseView';
import { getProfile, onProfileChange, totalTrophies } from '../../state/profile';
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

  const sideBtn = (label: string, ico: IconName, fn: () => void, badge?: string) =>
    button('side-btn', [iconEl(ico), txt(label), badge ? el('span', 'badge t-outline', [badge]) : null].filter(Boolean) as Node[], fn);

  // ── 왼쪽 위: 프로필 + 트로피
  const pName = txt('', 'pc-name');
  const pTag = el('span', 'pc-sub', ['']);
  const avatar = el('span', 'avatar t-outline', ['']);
  const profileCard = button('profile-card', [avatar, el('span', 'pc-text', [pName, pTag])], comingSoon);
  const trophyNum = txt('0', 'tc-num');
  const trophyFill = el('i');
  const trophyNext = el('span', 'tc-next', ['']);
  const trophyCard = button(
    'trophy-card',
    [iconEl('trophy', 'ico tc-ico'), el('span', 'tc-body', [el('span', 'tc-row', [trophyNum, trophyNext]), el('span', 'bar', [trophyFill])])],
    comingSoon,
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
    el('span', 'np-chip np-power', [txt('POWER', 'np-label'), platePower]),
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
    [iconEl('pass', 'ico pass-ico'), el('span', 'pass-text', [txt('SEASON PASS', 'pass-title'), txt('SEASON 1', 'pass-sub')])],
    comingSoon,
  );
  // 모드 카드: 지금 고른 모드(설정에 저장). 탭하면 모드 선택 팝업, PLAY는 그 모드로 시작
  const modeIco = el('span', 'mode-ico-wrap');
  const modeName = txt('', 'mode-name');
  const modeMap = txt('', 'mode-map');
  const modeTag = txt('MODE', 'mode-tag');
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
    modeTag.textContent = `MODE · ${m.online ? 'ONLINE' : 'OFFLINE'}`;
  };
  renderMode();
  onSettingsChange(renderMode);
  const playBtn = button(
    'btn-play',
    [txt('PLAY')],
    () => {
      if (getSettings().playMode !== 'teamfight') return ctx.go.battle();
      // 오프라인(게스트)으로 들어왔으면 온라인 전에 로그인
      if (isOfflineGuest()) {
        toast('LOG IN TO PLAY ONLINE · 온라인은 로그인 후');
        return ctx.go.login();
      }
      ctx.go.online();
    },
    'select',
  );

  const root = el('div', 'lobby', [
    hit,
    el('div', 'lb-top-left', [profileCard, trophyCard]),
    el('div', 'lb-top-right', [currencyBar(comingSoon), button('icon-btn', [iconEl('gear')], () => openSettings(ctx))]),
    el('div', 'lb-side lb-side-left', [
      sideBtn('SHOP', 'shop', comingSoon),
      sideBtn('FIGHTERS', 'fighters', () => ctx.go.fighters(), String(FIGHTERS.length)),
      sideBtn('NEWS', 'news', comingSoon),
    ]),
    el('div', 'lb-side lb-side-right', [
      sideBtn('FRIENDS', 'friends', comingSoon),
      sideBtn('PARTY', 'party', comingSoon),
      sideBtn('CREW', 'crew', comingSoon),
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
    avatar.textContent = p.name.charAt(0);
    avatar.style.setProperty('--c', f.palette.primary);
    const total = totalTrophies(p);
    const m = trophyMilestone(total);
    trophyNum.textContent = String(total);
    trophyNext.textContent = `/ ${m.next}`;
    trophyFill.style.width = `${((total - m.prev) / (m.next - m.prev)) * 100}%`;
    plateRole.replaceChildren(roleChip(f.id));
    plateName.textContent = f.name;
    plateTrophy.textContent = String(p.fighters[f.id].trophies);
    platePower.textContent = String(p.fighters[f.id].power);
    nameplate.style.setProperty('--c', f.palette.primary);
    view.setFighter(f.id);
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
