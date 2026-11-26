import { el } from '../../core/dom';
import { iconEl } from '../widgets';

/**
 * 전투 조작부의 보이는 부분(조이스틱·버튼). 입력 판정은 `input.ts`가 하고, 여기서는 그리기만 한다.
 * 모든 요소는 pointer-events: none 이며 위치·손잡이 이동은 transform으로만 바꾼다.
 */

/** 조이스틱 반경(설계 px). 이동·공격·궁극기 공통 */
export const STICK_R = 80;

export type StickState = 'idle' | 'held' | 'aiming' | 'cancel';

/** 화면 왼쪽 절반 어디든 누르면 그 자리에 나타나는 이동 조이스틱 */
export class MoveStickView {
  readonly el: HTMLElement;
  private readonly knob: HTMLElement;

  constructor() {
    this.knob = el('div', 'stick-knob', [el('div', 'knob-face')]);
    this.el = el('div', 'stick stick-move', [el('div', 'stick-base'), this.knob]);
  }

  /** 조이스틱 중심(설계 px) */
  place(x: number, y: number) {
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  setKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  }

  setActive(on: boolean) {
    this.el.classList.toggle('is-active', on);
  }
}

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

/** 오른쪽 아래 고정 조준 스틱(공격) 또는 궁극기 버튼 */
export class AimStickView {
  readonly el: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly ringFill: SVGCircleElement | null = null;
  private readonly tag: HTMLElement | null;
  private state: StickState = 'idle';
  private charge = -1;
  private ready: boolean | null = null;

  constructor(kind: 'attack' | 'super' | 'skill') {
    const face = el('div', 'knob-face', [iconEl(kind === 'skill' ? 'chain' : kind, 'ico knob-ico'), el('i', 'knob-x')]);
    this.knob = el('div', 'stick-knob', [face]);
    const parts: HTMLElement[] = [el('div', 'stick-base')];
    if (kind === 'super') {
      const ring = el('div', 'super-ring');
      ring.innerHTML =
        `<svg viewBox="0 0 128 128" aria-hidden="true">` +
        `<circle class="ring-track" cx="64" cy="64" r="${RING_R}"/>` +
        `<circle class="ring-fill" cx="64" cy="64" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>` +
        `</svg>`;
      this.ringFill = ring.querySelector('.ring-fill');
      parts.push(el('div', 'super-glow'), ring);
    }
    parts.push(this.knob);
    this.tag = kind === 'skill' || kind === 'super' ? el('span', 'stick-tag', [kind === 'skill' ? 'E' : '']) : null;
    if (this.tag) parts.push(this.tag);
    this.el = el('div', `stick stick-${kind}`, parts);
  }

  setTag(text: string) {
    if (this.tag && this.tag.textContent !== text) this.tag.textContent = text;
  }

  setWReady(ready: boolean) {
    this.el.classList.toggle('is-w-ready', ready);
  }

  setKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  }

  setState(s: StickState) {
    if (s === this.state) return;
    this.el.classList.remove(`is-${this.state}`);
    this.state = s;
    this.el.classList.add(`is-${s}`);
  }

  /** 궁극기 충전 0~1. 바뀐 경우에만 DOM을 건드린다 */
  setCharge(k: number) {
    const q = Math.round(Math.min(1, Math.max(0, k)) * 200) / 200;
    if (q !== this.charge && this.ringFill) {
      this.charge = q;
      this.ringFill.style.strokeDashoffset = (RING_C * (1 - q)).toFixed(2);
    }
    const ready = q >= 1;
    if (ready !== this.ready) {
      this.ready = ready;
      this.el.classList.toggle('is-ready', ready);
      this.el.classList.toggle('is-charging', !ready);
    }
  }

  /** 충전 안 됐을 때 누르면 살짝 흔든다(애니메이션 재시작은 두 이름을 번갈아 써서 reflow 없이) */
  private shakeFlip = false;
  shake() {
    this.shakeFlip = !this.shakeFlip;
    this.el.classList.toggle('shake-a', this.shakeFlip);
    this.el.classList.toggle('shake-b', !this.shakeFlip);
  }
}
