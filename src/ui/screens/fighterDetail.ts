import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { FIGHTERS, STAT_MAX, getFighter, type FighterDef, type FighterId } from '../../data/fighters';
import { ShowcaseView } from '../../render/views/showcaseView';
import { equippedSkin, getProfile, onProfileChange, ownsSkin, updateProfile } from '../../state/profile';
import { SKIN_SHOP_OPEN, skinsOf } from '../../data/skins';
import { accountErrorCode, accountErrorText, buySkin, equipSkin, getAccount } from '../account/accountApi';
import { sfx } from '../../audio/sfx';
import type { AppContext } from '../context';
import { toast } from '../overlays/toast';
import { attachDrag, button, header, iconEl, roleChip, txt } from '../widgets';

function rangeLabel(r: number) {
  if (r < 3.5) return '아주 짧음';
  if (r < 5.6) return '짧음';
  if (r < 6.65) return '보통';
  return '김';
}
function speedLabel(s: number) {
  if (s < 2.27) return '느림';
  if (s < 2.46) return '보통';
  return '빠름';
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

  const selectLabel = txt('선택');
  const selectBtn = button('btn-select', [selectLabel], () => {
    if (getProfile().selected === current) return;
    updateProfile((p) => {
      p.selected = current;
    });
    view.celebrate();
    sfx('select');
    toast(`${getFighter(current).name} 선택!`);
  }, false);

  // ───── 스킨: 기본 + 이 캐릭터의 스킨. 누르면 미리 보고, 가진 것이면 바로 입는다 ─────
  let preview: string | undefined;
  let busy = false;
  const skinBar = el('div', 'skin-bar');
  const skinState = (id: string | undefined) => {
    const p = getProfile();
    if (equippedSkin(p, current) === id) return '착용 중';
    if (!id || ownsSkin(p, id)) return '착용';
    const def = skinsOf(current).find((k) => k.id === id)!;
    return SKIN_SHOP_OPEN ? `${def.price} 코인` : '관리자 전용';
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!getAccount()) {
      toast('로그인하면 스킨을 쓸 수 있어요');
      return;
    }
    if (busy) return;
    busy = true;
    try {
      await fn();
      sfx('select');
      toast(ok);
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      busy = false;
      renderSkins();
    }
  };
  const tapSkin = (id: string | undefined, name: string) => {
    const again = preview === id;
    preview = id;
    view.setFighter(current, preview);
    const p = getProfile();
    if (!id || ownsSkin(p, id)) {
      if (equippedSkin(p, current) !== id) void run(() => equipSkin(current, id ?? null), `${name} 착용!`);
    } else if (again && SKIN_SHOP_OPEN) {
      void run(() => buySkin(id), `${name} 구매!`);
    }
    renderSkins();
  };
  const renderSkins = () => {
    const list = skinsOf(current);
    skinBar.hidden = list.length === 0;
    if (!list.length) return;
    const chip = (id: string | undefined, name: string) => {
      const b = button('skin-chip', [txt(name, 'skin-name'), txt(skinState(id), 'skin-state')], () => tapSkin(id, name));
      b.classList.toggle('is-preview', preview === id);
      b.classList.toggle('is-locked', !!id && !ownsSkin(getProfile(), id));
      return b;
    };
    skinBar.replaceChildren(chip(undefined, '기본'), ...list.map((k) => chip(k.id, k.name)));
  };

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
    skinBar,
    selectBtn,
  ]);

  const renderSelect = () => {
    const sel = getProfile().selected === current;
    selectBtn.classList.toggle('is-selected', sel);
    selectLabel.textContent = sel ? '선택됨' : '선택';
  };

  const render = (f: FighterDef) => {
    root.style.setProperty('--c', f.palette.primary);
    document.documentElement.style.setProperty('--fighter', f.palette.primary);
    titleName.textContent = f.name;
    titleRole.replaceChildren(roleChip(f.id));
    tagline.textContent = f.tagline;
    const a = f.attack;
    stats.replaceChildren(
      statRow('체력', f.hp, STAT_MAX.hp, String(f.hp)),
      statRow(
        '피해량',
        (a.damageFar ?? a.damage) * a.count,
        STAT_MAX.damage,
        a.damageFar ? `${a.damage}–${a.damageFar}` : a.count > 1 ? `${a.damage} × ${a.count}` : String(a.damage),
      ),
      statRow('사거리', a.range, STAT_MAX.range, rangeLabel(a.range)),
      statRow('이동 속도', f.moveSpeed, STAT_MAX.speed, speedLabel(f.moveSpeed)),
    );
    abilities.replaceChildren(
      abilityCard('기본 공격', a.name, a.description, 'ab-attack'),
      abilityCard('궁극기', f.super.name, f.super.description, 'ab-super'),
    );
    renderSelect();
  };

  const setFighter = (id: FighterId) => {
    current = id;
    preview = equippedSkin(getProfile(), id);
    view.setFighter(id, preview);
    render(getFighter(id));
    renderSkins();
  };

  onProfileChange(() => {
    renderSelect();
    renderSkins();
  });

  const screen: Screen & { setFighter(id: FighterId): void } = {
    el: root,
    bg: 'detail',
    onShow: () => ctx.stage.setView(view),
    setFighter,
  };
  setFighter(current);
  return screen;
}
