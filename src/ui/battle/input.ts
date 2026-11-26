import type { BattleLike } from '../../battle/types';
import { getFighter } from '../../data/fighters';
import type { Vec2 } from '../../game/types';
import type { UiMetrics } from './metrics';
import { AimStickView, MoveStickView, STICK_R } from './sticks';

/**
 * 전투 조작. UI 담당.
 * 터치(docs/03 "조작"):
 *  - 왼쪽 절반 아무 곳: 그 자리에 이동 조이스틱(반경 80, 데드존 12%). 반경 밖으로 끌면 받침이 따라온다.
 *  - 오른쪽 아래 공격 스틱(중심 1140,640): 20px 미만으로 떼면 자동 조준, 끌면 조준선, 떼면 발사,
 *    끈 뒤 시작점 20px 안으로 되돌리면 취소.
 *  - 궁극기 버튼(중심 1010,700): 같은 방식. 게이지가 차지 않았으면 흔들리기만 한다.
 *  - 손가락마다 pointerId로 따로 추적(이동 + 조준 동시에).
 * PC: WASD/방향키 이동, 왼쪽 클릭 = 클릭한 바닥 쪽으로 공격, 오른쪽 클릭 = 궁극기, Space = 자동 공격, E = 자동 궁극기.
 */

const DEAD_ZONE = 0.12;
/** 자동 조준 ↔ 수동 조준 경계(설계 px) */
const AIM_MIN = 20;
/** 공격 스틱 중심: 오른쪽·아래 모서리에서 떨어진 거리(1280×800에서 (1140, 640)) */
const ATTACK_FROM_EDGE = { right: 140, bottom: 160 };
const ATTACK_HIT_R = 100;
/** 궁극기 버튼 중심(1280×800에서 (1010, 700)) */
const SUPER_FROM_EDGE = { right: 270, bottom: 100 };
const SUPER_HIT_R = 66;
/** 손을 뗀 이동 조이스틱이 쉬는 자리(왼쪽 아래 모서리 기준) */
const MOVE_IDLE_FROM_EDGE = { left: 190, bottom: 170 };

type Which = 'attack' | 'super';

interface MoveTrack {
  kind: 'move';
  id: number;
  cx: number;
  cy: number;
  vec: Vec2;
}

interface AimTrack {
  kind: 'aim';
  id: number;
  which: Which;
  x0: number;
  y0: number;
  aim: Vec2;
  /** 20px 이상 끌어서 수동 조준이 된 적이 있는가 */
  aimed: boolean;
  /** 수동 조준 후 시작점 근처로 돌아와 취소 상태인가 */
  cancel: boolean;
  /** 플레이어가 쓰러지는 등으로 무효가 됨 */
  dead: boolean;
  touch: boolean;
}

export interface InputFeedback {
  /** 발사 입력을 보냈다(touch=손가락 입력) */
  fired(which: Which, touch: boolean): void;
  /** 탄이 없을 때 공격을 눌렀다 */
  empty(): void;
  /** 궁극기가 안 찼는데 눌렀다 */
  denied(): void;
}

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE',
]);

export class BattleInput {
  readonly moveStick = new MoveStickView();
  readonly attackStick = new AimStickView('attack');
  readonly superStick = new AimStickView('super');

  private session: BattleLike | null = null;
  private root: HTMLElement | null = null;
  private readonly metrics: UiMetrics;
  private readonly feedback: InputFeedback;
  private readonly keys = new Set<string>();
  private keyMove: Vec2 = { x: 0, y: 0 };
  private move: MoveTrack | null = null;
  private aimTrack: AimTrack | null = null;

  constructor(metrics: UiMetrics, feedback: InputFeedback) {
    this.metrics = metrics;
    this.feedback = feedback;
    this.attackStick.setState('idle');
    this.superStick.setState('idle');
    this.superStick.setCharge(0);
    this.layout();
  }

  /** 창 크기가 바뀌면 쉬는 이동 조이스틱 위치를 다시 잡는다 */
  layout() {
    if (!this.move) this.moveStick.place(MOVE_IDLE_FROM_EDGE.left, this.metrics.height - MOVE_IDLE_FROM_EDGE.bottom);
  }

  bind(session: BattleLike, root: HTMLElement) {
    this.unbind();
    this.session = session;
    this.root = root;
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onCancel);
    root.addEventListener('lostpointercapture', this.onCancel);
    root.addEventListener('contextmenu', this.onContextMenu);
    root.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    // 포커스가 버튼에 남아 있으면 Space가 그 버튼을 누르므로 비워 둔다
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  unbind() {
    const root = this.root;
    if (root) {
      root.removeEventListener('pointerdown', this.onDown);
      root.removeEventListener('pointermove', this.onMove);
      root.removeEventListener('pointerup', this.onUp);
      root.removeEventListener('pointercancel', this.onCancel);
      root.removeEventListener('lostpointercapture', this.onCancel);
      root.removeEventListener('contextmenu', this.onContextMenu);
      root.removeEventListener('touchmove', this.onTouchMove);
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    this.releaseAll();
    this.session = null;
    this.root = null;
  }

  /** 매 프레임(session.onFrame): 궁극기 게이지, 사망 시 조준 무효화 */
  frame() {
    const s = this.session;
    if (!s) return;
    const p = s.player;
    this.superStick.setCharge(p.superCharge);
    const t = this.aimTrack;
    if (t && !t.dead && !p.alive) {
      t.dead = true;
      this.showAim(t);
    }
  }

  // ───────────── 위치 판정 ─────────────

  private attackCenter() {
    return { x: this.metrics.width - ATTACK_FROM_EDGE.right, y: this.metrics.height - ATTACK_FROM_EDGE.bottom };
  }

  private superCenter() {
    return { x: this.metrics.width - SUPER_FROM_EDGE.right, y: this.metrics.height - SUPER_FROM_EDGE.bottom };
  }

  /** 두 버튼의 판정 원이 겹치면 (거리 / 판정 반경)이 작은 쪽 */
  private hitControl(x: number, y: number): Which | null {
    const a = this.attackCenter();
    const s = this.superCenter();
    const ka = Math.hypot(x - a.x, y - a.y) / ATTACK_HIT_R;
    const ks = Math.hypot(x - s.x, y - s.y) / SUPER_HIT_R;
    if (ka >= 1 && ks >= 1) return null;
    return ka <= ks ? 'attack' : 'super';
  }

  // ───────────── 포인터 ─────────────

  private readonly onDown = (e: PointerEvent) => {
    const s = this.session;
    if (!s || !this.root) return;
    // 나가기 등 진짜 버튼 위의 터치는 버튼이 처리한다
    if ((e.target as Element | null)?.closest?.('button')) return;
    const { x, y } = this.metrics.toDesign(e.clientX, e.clientY);
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0 && e.button !== 2) return;

    const ctl = mouse && e.button === 2 ? null : this.hitControl(x, y);
    if (ctl) {
      if (this.aimTrack) return; // 조준은 한 번에 하나
      if (ctl === 'super' && s.player.superCharge < 1) {
        this.superStick.shake();
        this.feedback.denied();
        return;
      }
      this.aimTrack = {
        kind: 'aim',
        id: e.pointerId,
        which: ctl,
        x0: x,
        y0: y,
        aim: { x: 0, y: 0 },
        aimed: false,
        cancel: false,
        dead: !s.player.alive,
        touch: !mouse,
      };
      this.showAim(this.aimTrack);
    } else if (mouse) {
      // PC: 클릭한 바닥 지점 쪽으로 바로 발사
      this.fireAtGround(x, y, e.button === 2 ? 'super' : 'attack');
      e.preventDefault();
      return;
    } else if (x < this.metrics.width / 2) {
      if (this.move) return;
      this.move = { kind: 'move', id: e.pointerId, cx: x, cy: y, vec: { x: 0, y: 0 } };
      this.moveStick.place(x, y);
      this.moveStick.setKnob(0, 0);
      this.moveStick.setActive(true);
      this.syncMove();
    } else {
      return;
    }
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 끝난 포인터 */
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    const m = this.move;
    const a = this.aimTrack;
    if (m && m.id === e.pointerId) {
      const { x, y } = this.metrics.toDesign(e.clientX, e.clientY);
      let dx = x - m.cx;
      let dy = y - m.cy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        // 반경 밖으로 끌면 받침이 손가락을 따라온다(방향 전환이 빨라진다)
        m.cx += (dx / d) * (d - STICK_R);
        m.cy += (dy / d) * (d - STICK_R);
        dx = x - m.cx;
        dy = y - m.cy;
        this.moveStick.place(m.cx, m.cy);
      }
      this.moveStick.setKnob(dx, dy);
      const k = Math.min(1, Math.hypot(dx, dy) / STICK_R);
      // 데드존 밖이면 항상 최고 속도(docs/03: 가속 없음)
      m.vec = k < DEAD_ZONE ? { x: 0, y: 0 } : { x: dx / (k * STICK_R), y: dy / (k * STICK_R) };
      this.syncMove();
    } else if (a && a.id === e.pointerId) {
      const { x, y } = this.metrics.toDesign(e.clientX, e.clientY);
      const dx = x - a.x0;
      const dy = y - a.y0;
      const d = Math.hypot(dx, dy);
      if (d >= AIM_MIN) a.aimed = true;
      a.cancel = a.aimed && d < AIM_MIN;
      const k = Math.min(1, d / STICK_R);
      a.aim = d > 0 ? { x: (dx / d) * k, y: (dy / d) * k } : { x: 0, y: 0 };
      this.showAim(a);
    }
  };

  private readonly onUp = (e: PointerEvent) => this.end(e.pointerId, true);
  private readonly onCancel = (e: PointerEvent) => this.end(e.pointerId, false);

  private end(id: number, release: boolean) {
    if (this.move && this.move.id === id) {
      this.move = null;
      this.moveStick.setActive(false);
      this.moveStick.setKnob(0, 0);
      this.layout();
      this.syncMove();
    }
    const a = this.aimTrack;
    if (a && a.id === id) {
      this.aimTrack = null;
      if (release && !a.dead && !a.cancel) this.fire(a.which, a.aimed ? a.aim : null, a.touch);
      this.showAim(null, a.which);
    }
  }

  private readonly onContextMenu = (e: Event) => e.preventDefault();

  /**
   * 전투 화면은 touch-action: none이라 핀치·스크롤이 이미 막혀 있고, 크롬은 이때 touchmove를 취소 불가로 보낸다.
   * 전역 멀티터치 가드(core/device.ts)가 그런 touchmove에 preventDefault를 부르면 콘솔 오류가 쌓이므로
   * (이동 + 조준 두 손가락마다) 취소할 수 없는 touchmove는 여기서 멈춘다.
   */
  private readonly onTouchMove = (e: TouchEvent) => {
    if (!e.cancelable) e.stopPropagation();
  };

  /** 모든 손가락·키를 놓은 상태로(창 포커스 잃음, 화면 나감) */
  private readonly releaseAll = () => {
    if (this.move) this.end(this.move.id, false);
    if (this.aimTrack) this.end(this.aimTrack.id, false);
    this.keys.clear();
    this.keyMove = { x: 0, y: 0 };
    this.syncMove();
  };

  // ───────────── 조준 표시 ─────────────

  /** 스틱 모양 + 3D 조준선을 트랙 상태에 맞춘다. null이면 둘 다 끈다 */
  private showAim(t: AimTrack | null, which?: Which) {
    const s = this.session;
    const w = t?.which ?? which ?? 'attack';
    const view = w === 'attack' ? this.attackStick : this.superStick;
    if (!t) {
      view.setState('idle');
      view.setKnob(0, 0);
      s?.view.setAim(null);
      return;
    }
    const ballCarrier = !!s && s.state.ball?.carrierId === s.playerId;
    const manual = t.aimed && !t.cancel && !t.dead;
    view.setState(t.dead ? 'idle' : t.cancel ? 'cancel' : t.aimed ? 'aiming' : 'held');
    view.setKnob(t.aim.x * STICK_R, t.aim.y * STICK_R);
    // 화면 오른쪽 = +x, 아래 = +y. 전투 카메라는 회전(yaw) 없이 북쪽을 보므로 그대로 바닥 방향이 된다.
    if (s) s.view.setAim((manual || ballCarrier) && !t.cancel && !t.dead ? { unitId: s.playerId, which: t.which, aim: t.aim } : null);
  }

  // ───────────── 발사 ─────────────

  private fire(which: Which, aim: Vec2 | null, touch: boolean) {
    const s = this.session;
    if (!s) return;
    const p = s.player;
    if (!p.alive) return;
    if (which === 'attack') {
      if (p.ammo < 1) this.feedback.empty();
      s.queueAttack(aim);
    } else {
      if (p.superCharge < 1) {
        this.superStick.shake();
        this.feedback.denied();
        return;
      }
      s.queueSuper(aim);
    }
    this.feedback.fired(which, touch);
  }

  /** PC 마우스: 설계 좌표 (x, y) 아래 바닥 지점 쪽으로. 사거리보다 멀면 길이 1로 자른다 */
  private fireAtGround(x: number, y: number, which: Which) {
    const s = this.session;
    if (!s) return;
    const g = s.view.groundAtDesign(x, y);
    if (!g) return;
    const p = s.player;
    const def = getFighter(p.fighterId);
    const range = which === 'attack' ? def.attack.range : def.super.range;
    const dx = (g.x - p.pos.x) / range;
    const dy = (g.y - p.pos.y) / range;
    const l = Math.hypot(dx, dy);
    this.fire(which, l > 1 ? { x: dx / l, y: dy / l } : { x: dx, y: dy }, false);
  }

  // ───────────── 키보드 ─────────────

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.fire('attack', null, false);
    if (e.code === 'KeyE') this.fire('super', null, false);
    this.updateKeyMove();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    this.keys.delete(e.code);
    this.updateKeyMove();
  };

  private updateKeyMove() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y) || 1;
    this.keyMove = { x: x / l, y: y / l };
    this.syncMove();
  }

  /** 이동 입력: 터치 조이스틱을 쥐고 있으면 그것, 아니면 키보드 */
  private syncMove() {
    const s = this.session;
    if (!s) return;
    const v = this.move ? this.move.vec : this.keyMove;
    s.controls.move = { x: v.x, y: v.y };
  }
}
