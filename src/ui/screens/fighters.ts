import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { FIGHTERS, type FighterDef } from '../../data/fighters';
import { getProfile, onProfileChange } from '../../state/profile';
import type { AppContext } from '../context';
import { comingSoon } from '../overlays/toast';
import { button, currencyBar, header, iconEl, roleChip, txt } from '../widgets';

/** 캐릭터 목록 화면 */
export function createFightersScreen(ctx: AppContext): Screen {
  const grid = el('div', 'fighter-grid');

  const card = (f: FighterDef) => {
    const p = getProfile();
    const prog = p.fighters[f.id];
    const img = el('img');
    img.src = ctx.portraits[f.id];
    img.alt = f.name;
    img.draggable = false;
    const c = button(
      'fcard',
      [
        el('span', 'fcard-portrait', [
          img,
          el('span', 'fcard-power', [txt('파워'), txt(String(prog.power), 'fcard-power-num')]),
          el('span', 'fcard-trophy', [iconEl('trophy'), txt(String(prog.trophies))]),
          p.selected === f.id ? txt('선택됨', 'fcard-selected') : null,
        ].filter(Boolean) as Node[]),
        el('span', 'fcard-info', [txt(f.name, 'fcard-name'), roleChip(f.id)]),
      ],
      () => ctx.go.fighterDetail(f.id),
    );
    c.style.setProperty('--c', f.palette.primary);
    c.classList.toggle('is-selected', p.selected === f.id);
    c.dataset.fighter = f.id;
    return c;
  };

  const soonCard = button(
    'fcard fcard-soon',
    [el('span', 'fcard-portrait', [txt('?', 'fcard-q')]), el('span', 'fcard-info', [txt('곧 추가', 'fcard-name')])],
    comingSoon,
  );

  const render = () => grid.replaceChildren(...FIGHTERS.map(card), ...(FIGHTERS.length % 4 ? [soonCard] : []));
  render();
  onProfileChange(render);

  const root = el('div', 'fighters', [
    header('캐릭터', () => ctx.go.lobby(), currencyBar(() => ctx.go.shop())),
    el('div', 'fighters-count', [txt(`${FIGHTERS.length} / ${FIGHTERS.length} 보유`)]),
    grid,
  ]);

  return {
    el: root,
    bg: 'fighters',
    onShow: () => {
      render();
      ctx.stage.setView(null);
    },
  };
}
