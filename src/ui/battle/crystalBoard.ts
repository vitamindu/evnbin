import { el } from '../../core/dom';
import { TICK_RATE, type MatchState, type Team } from '../../game/types';
import { iconEl, txt } from '../widgets';

/**
 * 크리스탈 러시 HUD. UI 담당.
 * - 위 가운데: 우리 팀 크리스탈 합계(파랑) · 남은 시간 · 상대 팀 합계(빨강). 수는 match.crystals.
 * - 카운트다운(match.countdownTicks ≥ 0)이면 그 아래 큰 숫자 + 누구의 카운트다운인지.
 * - 카운트다운이 시작·취소되면 알림(상태 변화로 판단해서 사건이 빠져도 맞는다).
 * 머리 위 "들고 있는 수"는 hud.ts가 그린다.
 */
export class CrystalBoard {
  readonly el: HTMLElement;
  readonly countdown: HTMLElement;
  private readonly mine: HTMLElement;
  private readonly theirs: HTMLElement;
  private readonly time: HTMLElement;
  private readonly cdNum: HTMLElement;
  private readonly cdCap: HTMLElement;
  private last = { a: -1, b: -1, secs: -2, cd: -2, cdTeam: undefined as Team | null | undefined };
  private flipA = false;
  private flipB = false;
  private flipCd = false;
  private readonly notify: (text: string) => void;

  constructor(notify: (text: string) => void) {
    this.notify = notify;
    this.mine = txt('0', 'sb-num');
    this.theirs = txt('0', 'sb-num');
    this.time = txt('3:00', 'sb-time');
    this.el = el('div', 'scoreboard crystal-board', [
      el('div', 'sb-team sb-blue', [el('span', 'cb-row', [iconEl('rushGem', 'ico cb-gem'), this.mine])]),
      el('div', 'sb-clock', [this.time, txt('10개 + 12초', 'sb-target')]),
      el('div', 'sb-team sb-red', [el('span', 'cb-row', [this.theirs, iconEl('rushGem', 'ico cb-gem')])]),
    ]);
    this.cdNum = txt('12', 'cd-num');
    this.cdCap = txt('', 'cd-cap');
    this.countdown = el('div', 'crystal-countdown', [this.cdCap, this.cdNum]);
    this.countdown.hidden = true;
  }

  reset() {
    this.last = { a: -1, b: -1, secs: -2, cd: -2, cdTeam: undefined };
    this.countdown.hidden = true;
  }

  update(match: MatchState, myTeam: Team) {
    const other: Team = myTeam === 0 ? 1 : 0;
    const totals = match.crystals ?? match.score;
    const a = totals[myTeam];
    const b = totals[other];
    if (a !== this.last.a) {
      if (this.last.a >= 0 && a > this.last.a) this.bump(this.mine, (this.flipA = !this.flipA));
      this.last.a = a;
      this.mine.textContent = String(a);
    }
    if (b !== this.last.b) {
      if (this.last.b >= 0 && b > this.last.b) this.bump(this.theirs, (this.flipB = !this.flipB));
      this.last.b = b;
      this.theirs.textContent = String(b);
    }
    const secs = match.ticksLeft < 0 ? -1 : Math.ceil(match.ticksLeft / TICK_RATE);
    if (secs !== this.last.secs) {
      this.last.secs = secs;
      this.time.textContent = secs < 0 ? '--:--' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.el.classList.toggle('is-hurry', secs >= 0 && secs <= 10 && match.winner === null);
    }

    const ticks = match.countdownTicks ?? -1;
    const team = ticks >= 0 && match.winner === null ? (match.countdownTeam ?? null) : null;
    if (team !== this.last.cdTeam) {
      const prev = this.last.cdTeam;
      this.last.cdTeam = team;
      this.countdown.hidden = team === null;
      if (team !== null) {
        const ours = team === myTeam;
        this.countdown.className = `crystal-countdown ${ours ? 'is-blue' : 'is-red'}`;
        this.cdCap.textContent = ours ? '우리 팀 승리까지' : '상대 팀 승리까지';
        this.notify(ours ? '우리 팀 카운트다운 시작! 크리스탈을 지켜요' : '상대 팀 카운트다운! 크리스탈을 빼앗아요');
      } else if (prev !== undefined && prev !== null && match.winner === null) {
        this.notify('카운트다운이 멈췄어요!');
      }
    }
    if (team !== null) {
      const s = Math.max(0, Math.ceil(ticks / TICK_RATE));
      if (s !== this.last.cd) {
        this.last.cd = s;
        this.cdNum.textContent = String(s);
        this.flipCd = !this.flipCd;
        this.cdNum.classList.toggle('pop-a', this.flipCd);
        this.cdNum.classList.toggle('pop-b', !this.flipCd);
      }
    } else {
      this.last.cd = -2;
    }
  }

  private bump(n: HTMLElement, flip: boolean) {
    n.classList.toggle('bump-a', flip);
    n.classList.toggle('bump-b', !flip);
  }
}
