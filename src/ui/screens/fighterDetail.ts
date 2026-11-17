import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { FIGHTERS, STAT_MAX, getFighter, type FighterDef, type FighterId } from '../../data/fighters';
import { ShowcaseView } from '../../render/views/showcaseView';
import { getProfile, onProfileChange, updateProfile } from '../../state/profile';
import { sfx } from '../../audio/sfx';
import type { AppContext } from '../context';
import { toast } from '../overlays/toast';
import { attachDrag, button, header, iconEl, roleChip, txt } from '../widgets';

function rangeLabel(r: number) {
  if (r < 5) return 'VERY SHORT';
  if (r < 8) return 'SHORT';
  if (r < 9.5) return 'NORMAL';
  return 'LONG';
}
function speedLabel(s: number) {
  if (s < 2.7) return 'SLOW';
  if (s < 2.95) return 'NORMAL';
  return 'FAST';
}

/** 캐릭터 상세 화면: 왼쪽 정보, 오른쪽 3D 모델, 오른쪽 아래 선택 버튼 */
export function createFighterDetailScreen(ctx: AppContext) {
  const view = new ShowcaseView({
    fov: 26,
    camPos: [0, 1.35, 8.2],
    lookAtY: 0.95,
    ndcX: 0.4,
    baseYaw: -0.3,
    returnToBase: false,
  });
  let current: FighterId = getProfile().selected;

  const titleName = txt('', 'detail-name');
  const titleRole = el('span', 'detail-role');
  const tagline = el('p', 'detail-tagline');
  const stats = el('div', 'stats panel');
  const abilities = el('div', 'abilities');

  const statRow = (label: string, value: number, max: number, text: string) => {
    const fill = el('i');
    fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
    return el('div', 'stat-row', [txt(label, 'stat-label'), el('span', 'stat-bar', [fill]), txt(text, 'stat-value')]);
  };
  const abilityCard = (kind: string, name: string, desc: string, cls: string) =>
    el('div', `ability panel ${cls}`, [txt(kind, 'ability-kind'), txt(name, 'ability-name'), el('p', 'ability-desc', [desc])]);

  const selectLabel = txt('SELECT');
  const selectBtn = button('btn-select', [selectLabel], () => {
    if (getProfile().selected === current) return;
    updateProfile((p) => {
      p.selected = current;
    });
    view.celebrate();
    sfx('select');
    toast(`${getFighter(current).name} SELECTED`);
  }, false);

  const step = (dir: number) => {
    const i = FIGHTERS.findIndex((f) => f.id === current);
    const next = FIGHTERS[(i + dir + FIGHTERS.length) % FIGHTERS.length]!;
    setFighter(next.id);
  };

  const hit = el('div', 'detail-hit');
  attachDrag(hit, {
    onStart: () => view.setDragging(true),
    onDrag: (dx) => view.rotateBy(dx),
    onEnd: () => view.setDragging(false),
  });

  const root = el('div', 'detail', [
    hit,
    header('', () => ctx.go.fighters()),
    el('div', 'detail-title', [titleName, titleRole]),
    el('div', 'detail-panel', [tagline, stats, abilities]),
    button('btn-arrow arrow-prev', [iconEl('prev')], () => step(-1)),
    button('btn-arrow arrow-next', [iconEl('next')], () => step(1)),
    selectBtn,
  ]);

  const renderSelect = () => {
    const sel = getProfile().selected === current;
    selectBtn.classList.toggle('is-selected', sel);
    selectLabel.textContent = sel ? 'SELECTED' : 'SELECT';
  };

  const render = (f: FighterDef) => {
    root.style.setProperty('--c', f.palette.primary);
    document.documentElement.style.setProperty('--fighter', f.palette.primary);
    titleName.textContent = f.name;
    titleRole.replaceChildren(roleChip(f.id));
    tagline.textContent = f.tagline;
    const a = f.attack;
    stats.replaceChildren(
      statRow('HEALTH', f.hp, STAT_MAX.hp, String(f.hp)),
      statRow(
        'DAMAGE',
        (a.damageFar ?? a.damage) * a.count,
        STAT_MAX.damage,
        a.damageFar ? `${a.damage}–${a.damageFar}` : a.count > 1 ? `${a.damage} × ${a.count}` : String(a.damage),
      ),
      statRow('RANGE', a.range, STAT_MAX.range, rangeLabel(a.range)),
      statRow('SPEED', f.moveSpeed, STAT_MAX.speed, speedLabel(f.moveSpeed)),
    );
    abilities.replaceChildren(
      abilityCard('ATTACK', a.name, a.description, 'ab-attack'),
      abilityCard('SUPER', f.super.name, f.super.description, 'ab-super'),
    );
    renderSelect();
  };

  const setFighter = (id: FighterId) => {
    current = id;
    view.setFighter(id);
    render(getFighter(id));
  };

  onProfileChange(renderSelect);

  const screen: Screen & { setFighter(id: FighterId): void } = {
    el: root,
    bg: 'detail',
    onShow: () => ctx.stage.setView(view),
    setFighter,
  };
  setFighter(current);
  return screen;
}
