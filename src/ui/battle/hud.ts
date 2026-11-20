import type { BattleLike } from '../../battle/types';
import { el } from '../../core/dom';
import { TICK_RATE, type EntityId, type SimEvent, type Unit, type Vec2 } from '../../game/types';
import { iconEl, txt } from '../widgets';

/**
 * 전투 HUD. UI 담당.
 * - 살아 있는 모든 유닛 머리 위 체력 막대 + 숫자(아군 초록, 적 빨강). 내 막대 아래에는 탄창 칸(재장전 진행 표시).
 * - 'hit' 사건으로 피해 숫자(같은 대상에게 짧은 시간 안에 들어온 피해는 하나로 합친다).
 * - 내가 쓰러지면 가운데 부활 카운트다운.
 * 성능: 요소는 미리 만들어 재사용하고, 위치는 transform: translate3d로만 옮기며, 매 프레임 레이아웃을 읽지 않는다.
 * 값이 바뀐 경우에만 DOM에 쓴다.
 */

/** 머리 위 막대를 붙일 높이(월드 유닛) */
const HEAD_FIGHTER = 1.7;
const HEAD_DUMMY = 1.4;
/** 피해 숫자: 수명(초), 합치는 시간(초), 떠오르는 거리(px), 동시에 보일 수 있는 개수 */
const POP_LIFE = 0.85;
const POP_MERGE = 0.3;
const POP_RISE = 46;
/** 막대·숫자를 가리지 않도록 머리 위 기준점에서 띄우는 거리(px) */
const POP_LIFT = 66;
const POP_POOL = 24;

interface UnitBar {
  id: EntityId;
  root: HTMLElement;
  fill: HTMLElement;
  lag: HTMLElement;
  num: HTMLElement;
  ammo: { box: HTMLElement; segs: HTMLElement[]; vals: number[] } | null;
  /** 크리스탈 러시: 들고 있는 크리스탈 수(머리 위) */
  gems: HTMLElement;
  gemNum: HTMLElement;
  gemCount: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  shown: boolean;
  seen: number;
}

interface Pop {
  root: HTMLElement;
  label: HTMLElement;
  active: boolean;
  targetId: EntityId;
  pos: Vec2;
  /** 대상 머리 높이 */
  height: number;
  amount: number;
  age: number;
  /** 마지막으로 피해가 합쳐진 뒤 지난 시간 */
  sinceAdd: number;
  jitter: number;
  kind: string;
}

export class BattleHud {
  readonly el: HTMLElement;
  private readonly barLayer: HTMLElement;
  private readonly popLayer: HTMLElement;
  private readonly veil: HTMLElement;
  private readonly respawn: HTMLElement;
  private readonly respawnNum: HTMLElement;
  private readonly bars = new Map<EntityId, UnitBar>();
  private readonly pops: Pop[] = [];
  private session: BattleLike | null = null;
  private frameNo = 0;
  private last = 0;
  private dead: boolean | null = null;
  private countdown = -1;
  private flip = false;
  private ammoFlip = false;
  private readonly onDead: (dead: boolean) => void;

  constructor(onDead: (dead: boolean) => void) {
    this.onDead = onDead;
    this.barLayer = el('div', 'hud-bars');
    this.popLayer = el('div', 'hud-pops');
    for (let i = 0; i < POP_POOL; i++) {
      const label = txt('', 'pop-label');
      const root = el('div', 'pop', [label]);
      root.hidden = true;
      this.popLayer.append(root);
      this.pops.push({ root, label, active: false, targetId: -1, pos: { x: 0, y: 0 }, height: 0, amount: 0, age: 0, sinceAdd: 0, jitter: 0, kind: '' });
    }
    this.veil = el('div', 'ko-veil');
    this.respawnNum = txt('3', 'respawn-num');
    this.respawn = el('div', 'respawn', [txt('쓰러졌어요!', 'respawn-title'), txt('부활까지', 'respawn-sub'), this.respawnNum]);
    this.respawn.hidden = true;
    this.el = el('div', 'hud', [this.barLayer, this.popLayer, this.veil, this.respawn]);
  }

  bind(session: BattleLike) {
    this.unbind();
    this.session = session;
    this.last = performance.now();
    this.dead = null;
    this.countdown = -1;
  }

  unbind() {
    this.session = null;
    for (const b of this.bars.values()) b.root.remove();
    this.bars.clear();
    for (const p of this.pops) {
      p.active = false;
      p.root.hidden = true;
    }
    this.respawn.hidden = true;
    this.veil.classList.remove('is-on');
  }

  // ───────────── 사건 ─────────────

  onEvents(events: readonly SimEvent[]) {
    const s = this.session;
    if (!s) return;
    for (const e of events) {
      if (e.type !== 'hit' || e.damage <= 0) continue;
      const kind = e.targetId === s.playerId ? 'taken' : e.isSuper ? 'super' : e.sourceId === s.playerId ? 'dealt' : 'other';
      this.addPop(e.targetId, e.pos, e.damage, kind);
    }
  }

  private addPop(targetId: EntityId, pos: Vec2, damage: number, kind: string) {
    // 같은 대상에게 방금 뜬 숫자가 있으면 합친다(산탄 5발이 숫자 5개로 겹치지 않게)
    let p = this.pops.find((q) => q.active && q.targetId === targetId && q.kind === kind && q.sinceAdd < POP_MERGE);
    if (p) {
      p.amount += damage;
      p.sinceAdd = 0;
      p.age = Math.min(p.age, 0.06);
    } else {
      p = this.pops.find((q) => !q.active) ?? this.pops.reduce((a, b) => (b.age > a.age ? b : a));
      const u = this.session?.state.getUnit(targetId);
      p.active = true;
      p.targetId = targetId;
      p.pos = { ...pos };
      p.height = u?.type === 'dummy' ? HEAD_DUMMY : HEAD_FIGHTER;
      p.amount = damage;
      p.age = 0;
      p.sinceAdd = 0;
      p.jitter = (Math.random() - 0.5) * 36;
      if (p.kind !== kind) {
        p.root.className = `pop is-${kind}`;
        p.kind = kind;
      }
      p.root.hidden = false;
    }
    p.label.textContent = String(Math.round(p.amount));
  }

  /** 탄이 없는데 쐈을 때 탄창 칸을 흔든다 */
  flashAmmo() {
    const s = this.session;
    const bar = s ? this.bars.get(s.playerId) : undefined;
    if (!bar?.ammo) return;
    this.ammoFlip = !this.ammoFlip;
    bar.ammo.box.classList.toggle('shake-a', this.ammoFlip);
    bar.ammo.box.classList.toggle('shake-b', !this.ammoFlip);
  }

  // ───────────── 매 프레임 ─────────────

  frame() {
    const s = this.session;
    if (!s) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frameNo++;

    const me = s.player;
    for (const u of s.state.units) this.updateBar(s, u, u.team === me.team);
    for (const [id, b] of this.bars) {
      if (b.seen !== this.frameNo) {
        b.root.remove();
        this.bars.delete(id);
      }
    }
    this.updatePops(s, dt);
    this.updateRespawn(s);
  }

  private makeBar(u: Unit, isMe: boolean, ally: boolean): UnitBar {
    const fill = el('i', 'ub-fill');
    const lag = el('i', 'ub-lag');
    const num = txt('', 'ub-num');
    const gemNum = txt('0', 'ub-gem-num');
    const gems = el('div', 'ub-gems', [iconEl('rushGem', 'ico ub-gem'), gemNum]);
    gems.hidden = true;
    const children: HTMLElement[] = [gems, num, el('div', 'ub-bar', [lag, fill])];
    let ammo: UnitBar['ammo'] = null;
    if (isMe && u.type === 'fighter') {
      const segs: HTMLElement[] = [];
      const cells: HTMLElement[] = [];
      for (let i = 0; i < u.maxAmmo; i++) {
        const b = el('b');
        segs.push(b);
        cells.push(el('i', '', [b]));
      }
      const box = el('div', 'ub-ammo', cells);
      ammo = { box, segs, vals: segs.map(() => -1) };
      children.push(box);
    }
    const cls = `ub ${isMe ? 'is-me' : ally ? 'is-ally' : 'is-enemy'} is-${u.type}`;
    const root = el('div', cls, [el('div', 'ub-in', children)]);
    root.hidden = true;
    this.barLayer.append(root);
    return { id: u.id, root, fill, lag, num, ammo, gems, gemNum, gemCount: 0, hp: -1, maxHp: -1, x: NaN, y: NaN, shown: false, seen: 0 };
  }

  private updateBar(s: BattleLike, u: Unit, ally: boolean) {
    let b = this.bars.get(u.id);
    if (!b) {
      b = this.makeBar(u, u.id === s.playerId, ally);
      this.bars.set(u.id, b);
    }
    b.seen = this.frameNo;
    const p = u.alive ? s.view.unitToDesign(u.id, u.type === 'dummy' ? HEAD_DUMMY : HEAD_FIGHTER) : null;
    const show = !!p && p.onScreen;
    if (show !== b.shown) {
      b.shown = show;
      b.root.hidden = !show;
      // 다시 나타날 때(부활) 깎이는 꼬리 애니메이션 없이 바로 맞춘다
      if (show) b.hp = -1;
    }
    if (!show || !p) return;

    const x = Math.round(p.x * 10) / 10;
    const y = Math.round(p.y * 10) / 10;
    if (x !== b.x || y !== b.y) {
      b.x = x;
      b.y = y;
      b.root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    if (u.hp !== b.hp || u.maxHp !== b.maxHp) {
      const k = Math.max(0, Math.min(1, u.hp / u.maxHp));
      const snap = b.hp < 0 || u.hp > b.hp;
      b.fill.style.transform = `scaleX(${k.toFixed(4)})`;
      // 꼬리(lag)는 피해일 때만 천천히 따라오고, 회복·처음 표시는 바로 맞춘다
      b.lag.classList.toggle('is-snap', snap);
      b.lag.style.transform = `scaleX(${k.toFixed(4)})`;
      b.num.textContent = String(Math.ceil(u.hp));
      b.hp = u.hp;
      b.maxHp = u.maxHp;
    }

    const carried = u.type === 'fighter' ? (u.crystals ?? 0) : 0;
    if (carried !== b.gemCount) {
      b.gemCount = carried;
      b.gems.hidden = carried <= 0;
      b.gemNum.textContent = String(carried);
    }

    if (b.ammo && u.type === 'fighter') {
      const a = b.ammo;
      for (let i = 0; i < a.segs.length; i++) {
        const v = Math.round(Math.max(0, Math.min(1, u.ammo - i)) * 50) / 50;
        if (v === a.vals[i]) continue;
        const prev = a.vals[i]!;
        a.vals[i] = v;
        const seg = a.segs[i]!;
        seg.style.transform = `scaleX(${v})`;
        seg.classList.toggle('is-full', v >= 1);
        // 방금 찬 칸은 반짝
        if (v >= 1 && prev >= 0 && prev < 1) seg.parentElement!.classList.add('is-pop');
        else if (v < 1) seg.parentElement!.classList.remove('is-pop');
      }
    }
  }

  private updatePops(s: BattleLike, dt: number) {
    for (const p of this.pops) {
      if (!p.active) continue;
      p.age += dt;
      p.sinceAdd += dt;
      if (p.age >= POP_LIFE) {
        p.active = false;
        p.root.hidden = true;
        continue;
      }
      const at = s.view.toDesign(p.pos, p.height);
      if (!at.onScreen) {
        p.root.style.opacity = '0';
        continue;
      }
      const k = p.age / POP_LIFE;
      // 튀어나옴(0~0.12초) → 위로 떠오르며 사라짐
      const popK = Math.min(1, p.age / 0.12);
      const scale = 1 + 0.7 * (1 - popK) * (1 - popK);
      const rise = POP_RISE * (1 - (1 - k) * (1 - k));
      const alpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      const x = at.x + p.jitter;
      const y = at.y - POP_LIFT - rise;
      p.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      p.root.style.opacity = alpha.toFixed(3);
    }
  }

  private updateRespawn(s: BattleLike) {
    const me = s.player;
    const dead = !me.alive;
    if (dead !== this.dead) {
      this.dead = dead;
      this.respawn.hidden = !dead;
      this.veil.classList.toggle('is-on', dead);
      this.countdown = -1;
      this.onDead(dead);
    }
    if (!dead) return;
    const secs = Math.max(1, Math.ceil((me.respawnTick - s.state.tick) / TICK_RATE));
    if (secs !== this.countdown) {
      this.countdown = secs;
      this.respawnNum.textContent = String(secs);
      // 숫자가 바뀔 때마다 튀어나오는 애니메이션(두 이름을 번갈아 써서 reflow 없이 재시작)
      this.flip = !this.flip;
      this.respawnNum.classList.toggle('pop-a', this.flip);
      this.respawnNum.classList.toggle('pop-b', !this.flip);
    }
  }
}
