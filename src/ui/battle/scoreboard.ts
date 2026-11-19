import { el } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { TICK_RATE, type EntityId, type MatchState, type SimEvent, type SimView, type Team } from '../../game/types';
import { iconEl, txt } from '../widgets';

/**
 * teamfight HUD. UI 담당.
 * - 위 가운데 점수판: 왼쪽 내 팀(파랑), 가운데 남은 시간(match.ticksLeft, 30틱/초), 오른쪽 상대 팀(빨강).
 *   점수 밑 막대는 목표 점수까지의 진행. 마지막 10초는 시간이 빨갛게 뛴다.
 * - KO 알림(오른쪽 위): 'score' 사건마다 "쓰러뜨린 사람 → 쓰러진 사람" 한 줄, 4초 뒤 사라진다.
 * - 경기 끝 배너: VICTORY! / DEFEAT / DRAW.
 * 값이 바뀔 때만 DOM에 쓴다.
 */
export class Scoreboard {
  readonly el: HTMLElement;
  private readonly mine: HTMLElement;
  private readonly theirs: HTMLElement;
  private readonly mineBar: HTMLElement;
  private readonly theirsBar: HTMLElement;
  private readonly time: HTMLElement;
  private readonly target: HTMLElement;
  private last = { a: -1, b: -1, secs: -2, target: -1 };
  private flipA = false;
  private flipB = false;

  constructor() {
    this.mine = txt('0', 'sb-num');
    this.theirs = txt('0', 'sb-num');
    this.mineBar = el('i');
    this.theirsBar = el('i');
    this.time = txt('2:30', 'sb-time');
    this.target = txt('10 KO 선승', 'sb-target');
    this.el = el('div', 'scoreboard', [
      el('div', 'sb-team sb-blue', [this.mine, el('span', 'sb-bar', [this.mineBar])]),
      el('div', 'sb-clock', [this.time, this.target]),
      el('div', 'sb-team sb-red', [this.theirs, el('span', 'sb-bar', [this.theirsBar])]),
    ]);
  }

  reset() {
    this.last = { a: -1, b: -1, secs: -2, target: -1 };
  }

  update(match: MatchState, myTeam: Team) {
    const a = match.score[myTeam];
    const b = match.score[myTeam === 0 ? 1 : 0];
    const goal = match.targetScore;
    if (a !== this.last.a) {
      if (this.last.a >= 0 && a > this.last.a) this.bump(this.mine, (this.flipA = !this.flipA));
      this.last.a = a;
      this.mine.textContent = String(a);
      this.mineBar.style.transform = `scaleX(${goal > 0 ? Math.min(1, a / goal) : 0})`;
    }
    if (b !== this.last.b) {
      if (this.last.b >= 0 && b > this.last.b) this.bump(this.theirs, (this.flipB = !this.flipB));
      this.last.b = b;
      this.theirs.textContent = String(b);
      this.theirsBar.style.transform = `scaleX(${goal > 0 ? Math.min(1, b / goal) : 0})`;
    }
    if (goal !== this.last.target) {
      this.last.target = goal;
      this.target.textContent = goal > 0 ? `${goal} KO 선승` : 'KO 많은 팀 승리';
    }
    const secs = match.ticksLeft < 0 ? -1 : Math.ceil(match.ticksLeft / TICK_RATE);
    if (secs !== this.last.secs) {
      this.last.secs = secs;
      this.time.textContent = secs < 0 ? '--:--' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.el.classList.toggle('is-hurry', secs >= 0 && secs <= 10 && match.winner === null);
    }
  }

  private bump(n: HTMLElement, flip: boolean) {
    n.classList.toggle('bump-a', flip);
    n.classList.toggle('bump-b', !flip);
  }
}

/** 이름표: 엔티티 id → 이름(온라인은 MatchStartInfo.roster, 없으면 캐릭터 이름) */
export type NameOf = (id: EntityId) => string;

const FEED_MAX = 4;
const FEED_LIFE = 4000;

export class KoFeed {
  readonly el: HTMLElement;
  private rows: { el: HTMLElement; at: number }[] = [];

  constructor() {
    this.el = el('div', 'ko-feed');
  }

  clear() {
    this.rows = [];
    this.el.replaceChildren();
  }

  onEvents(events: readonly SimEvent[], state: SimView, myId: EntityId, nameOf: NameOf) {
    const me = state.getUnit(myId);
    if (!me) return;
    for (const e of events) {
      if (e.type !== 'score') continue;
      const killer = state.getUnit(e.killerId);
      const victim = state.getUnit(e.victimId);
      const side = (team: Team | undefined) => (team === me.team ? 'is-blue' : 'is-red');
      const row = el('div', `kf-row${e.killerId === myId || e.victimId === myId ? ' is-me' : ''}`, [
        txt(nameOf(e.killerId), `kf-name ${side(killer?.team ?? e.team)}`),
        iconEl('attack', 'ico kf-ico'),
        txt(nameOf(e.victimId), `kf-name ${side(victim?.team ?? (e.team === 0 ? 1 : 0))}`),
      ]);
      this.el.prepend(row);
      this.rows.unshift({ el: row, at: performance.now() });
    }
    while (this.rows.length > FEED_MAX) this.rows.pop()!.el.remove();
  }

  /** 오래된 줄 지우기(매 프레임, 가볍게) */
  frame() {
    const now = performance.now();
    while (this.rows.length && now - this.rows[this.rows.length - 1]!.at > FEED_LIFE) this.rows.pop()!.el.remove();
  }
}

/** 기본 이름: 캐릭터 이름 */
export function fighterNameOf(state: SimView): NameOf {
  return (id) => {
    const u = state.getUnit(id);
    return u?.type === 'fighter' ? getFighter(u.fighterId).name : '허수아비';
  };
}

/** 경기 끝 배너 */
export class MatchBanner {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;

  constructor() {
    this.title = txt('', 'mb-title');
    this.sub = txt('', 'mb-sub');
    this.el = el('div', 'match-banner', [el('div', 'mb-rays'), this.title, this.sub]);
    this.el.hidden = true;
  }

  show(winner: Team | -1, myTeam: Team, score: [number, number]) {
    const outcome = winner === -1 ? 'draw' : winner === myTeam ? 'win' : 'lose';
    this.el.dataset.outcome = outcome;
    this.title.textContent = outcome === 'win' ? '승리!' : outcome === 'lose' ? '패배' : '무승부';
    const a = score[myTeam];
    const b = score[myTeam === 0 ? 1 : 0];
    this.sub.textContent = `${a} - ${b}`;
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }
}
