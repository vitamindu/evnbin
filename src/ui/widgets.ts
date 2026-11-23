import { el, icon, onTap } from '../core/dom';
import { sfx } from '../audio/sfx';
import { getFighter, type FighterId, type Role } from '../data/fighters';
import { getProfile, onProfileChange } from '../state/profile';
import { ICONS, type IconName } from './icons';

/** 외곽선 글자 */
export function txt(text: string, className = ''): HTMLSpanElement {
  return el('span', `t-outline ${className}`.trim(), [text]);
}

/** 기본 버튼. sound=false면 효과음 없음 */
export function button(className: string, children: (Node | string)[], fn: () => void, sound: 'tap' | 'back' | 'select' | false = 'tap') {
  const b = el('button', `btn ${className}`, children);
  b.type = 'button';
  onTap(b, () => {
    if (sound) sfx(sound);
    fn();
  });
  return b;
}

export function iconEl(name: IconName, className = 'ico') {
  return icon(ICONS[name], className);
}

const ROLE_ICON: Record<Role, IconName> = { scatter: 'scatter', marksman: 'marksman', tank: 'tank', sniper: 'sniper', thrower: 'scatter', control: 'marksman', brawler: 'tank', bouncer: 'marksman' };

export function roleChip(id: FighterId) {
  const f = getFighter(id);
  const chip = el('span', 'role-chip', [iconEl(ROLE_ICON[f.role]), txt(f.roleLabel)]);
  chip.style.setProperty('--c', f.palette.primary);
  return chip;
}

/** 코인·크리스탈 표시. 프로필이 바뀌면 자동 갱신 */
export function currencyBar(onTapAny: () => void) {
  const coins = txt('0');
  const crystals = txt('0');
  const render = () => {
    const p = getProfile();
    // 관리자 계정은 코인·다이아가 무한(레벨 업·스킨에 들지 않는다)
    coins.textContent = p.admin ? '∞' : p.coins.toLocaleString('en-US');
    crystals.textContent = p.admin ? '∞' : p.crystals.toLocaleString('en-US');
  };
  render();
  onProfileChange(render);
  return el('div', 'currencies', [
    button('currency', [iconEl('coin'), coins], onTapAny),
    button('currency', [iconEl('crystal'), crystals], onTapAny),
  ]);
}

/** 화면 상단의 뒤로 가기 + 제목 줄 */
export function header(title: string, onBack: () => void, right?: HTMLElement) {
  return el('div', 'hdr', [
    button('btn-back', [iconEl('back')], onBack, 'back'),
    txt(title, 'hdr-title'),
    el('div', 'hdr-spacer'),
    right ?? null,
  ]);
}

/** pointerup 직후 따라오는 click 하나를 화면 어디서든 무시한다(최대 500ms) */
function swallowNextClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.removeEventListener('click', stop, true);
  };
  window.addEventListener('click', stop, true);
  window.setTimeout(() => window.removeEventListener('click', stop, true), 500);
}

/** 손가락 드래그(캐릭터 돌리기)와 짧은 탭을 구분한다. dx는 설계 좌표(px) 기준. */
export function attachDrag(
  target: HTMLElement,
  h: { onStart?(): void; onDrag(dx: number): void; onEnd?(): void; onTap?(): void },
) {
  let lastX = 0;
  let moved = 0;
  let active = -1;
  const scale = () => Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
  target.addEventListener('pointerdown', (e) => {
    if (active !== -1) return;
    active = e.pointerId;
    lastX = e.clientX;
    moved = 0;
    target.setPointerCapture(e.pointerId);
    h.onStart?.();
  });
  target.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    const dx = (e.clientX - lastX) / scale();
    lastX = e.clientX;
    moved += Math.abs(dx);
    h.onDrag(dx);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = -1;
    h.onEnd?.();
    if (moved < 8 && e.type === 'pointerup' && h.onTap) {
      // 탭으로 화면이 바뀌면, 같은 탭의 click이 새 화면의 버튼을 눌러 버린다(유령 클릭). 바로 뒤 click 하나를 삼킨다.
      swallowNextClick();
      h.onTap();
    }
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
