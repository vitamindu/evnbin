import '../../styles/online.css';
import { el } from '../../core/dom';
import type { MatchMode } from '../../game/types';
import { getSettings, updateSettings } from '../../state/settings';
import type { AppContext } from '../context';
import type { IconName } from '../icons';
import { button, iconEl, txt } from '../widgets';

/** 모드 카드·선택 팝업에 쓰는 모드 소개 */
export interface ModeInfo {
  id: MatchMode;
  name: string;
  map: string;
  icon: IconName;
  online: boolean;
  blurb: string;
  facts: string[];
}

export const MODES: Record<MatchMode, ModeInfo> = {
  training: {
    id: 'training',
    name: '연습장',
    map: 'TRAINING YARD',
    icon: 'modeTraining',
    online: false,
    blurb: '허수아비를 상대로 마음껏 연습해요',
    facts: ['혼자', '시간 제한 없음'],
  },
  teamfight: {
    id: 'teamfight',
    name: '팀 대결',
    map: 'BLOSSOM ARENA',
    icon: 'modeTeamfight',
    online: true,
    blurb: '방 코드로 친구들과 한판 붙어요',
    facts: ['3 대 3', '10 KO 선승', '2:30'],
  },
  crystal: {
    id: 'crystal',
    name: '크리스탈 러시',
    map: 'BLOSSOM ARENA',
    icon: 'modeRush',
    online: true,
    blurb: '가운데 크리스탈을 모아 끝까지 지켜요',
    facts: ['3 대 3', '10개 + 12초 버티기'],
  },
};

/** 모드 선택 팝업: 두 장의 큰 카드. 고르면 설정에 저장하고 닫는다 */
export function openModePicker(ctx: AppContext, onPicked?: (m: MatchMode) => void) {
  const current = getSettings().playMode;
  const card = (m: ModeInfo) => {
    const art = el('span', 'mp-art', [el('span', 'mp-burst'), iconEl(m.icon, 'ico mp-ico'), txt(m.online ? '온라인' : '오프라인', 'mp-net')]);
    const c = button(
      `mp-card mp-${m.id}${m.id === current ? ' is-selected' : ''}`,
      [
        art,
        el('span', 'mp-body', [
          txt(m.name, 'mp-name'),
          txt(m.map, 'mp-map'),
          el('span', 'mp-blurb', [m.blurb]),
          el('span', 'mp-facts', m.facts.map((f) => txt(f, 'mp-fact'))),
        ]),
        m.id === current ? txt('선택됨', 'mp-selected') : null,
      ].filter(Boolean) as Node[],
      () => {
        updateSettings({ playMode: m.id });
        close();
        onPicked?.(m.id);
      },
      'select',
    );
    c.dataset.mode = m.id;
    return c;
  };

  const overlay = el('div', 'overlay', [
    el('div', 'mp-panel', [
      el('div', 'mp-head', [txt('모드 선택', 'mp-title'), button('btn-close', [iconEl('close')], () => close(), 'back')]),
      el('div', 'mp-cards', [card(MODES.training), card(MODES.teamfight), card(MODES.crystal)]),
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
