import '../../styles/battle.css';
import '../../styles/online.css';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { BattleSession } from '../../battle/session';
import type { BattleLike } from '../../battle/types';
import { TRAINING_YARD } from '../../data/maps/training';
import type { MatchResult } from '../../net/protocol';
import { getServerUrl } from '../../net/config';
import { getProfile } from '../../state/profile';
import type { AppContext, OnlineMatch } from '../context';
import { BattleFeedback } from '../battle/feedback';
import { BattleHud } from '../battle/hud';
import { BattleInput } from '../battle/input';
import { UiMetrics } from '../battle/metrics';
import { CrystalBoard } from '../battle/crystalBoard';
import { toast } from '../overlays/toast';
import { KoFeed, MatchBanner, Scoreboard, fighterNameOf, type NameOf } from '../battle/scoreboard';
import { pingMeter } from '../online/widgets';
import { button, iconEl, txt } from '../widgets';

/** 경기 끝 배너를 결과 화면 전에 보여 주는 시간(ms) */
const BANNER_MS = 2600;

/**
 * 전투 화면. UI 담당. 세션은 BattleLike(오프라인 연습장 BattleSession 또는 온라인 세션)만 쓴다.
 * 조작은 `ui/battle/input.ts`, 머리 위 체력·피해 숫자·부활 카운트다운은 `ui/battle/hud.ts`,
 * teamfight 점수판·KO 알림·끝 배너는 `ui/battle/scoreboard.ts`.
 * 이 화면은 session.onFrame / onEvents로만 갱신한다.
 *
 * 온라인: 오른쪽 위 핑, 나가기는 확인 후 방에서 나감, 연결이 끊기면 다시 연결/나가기 막,
 * OnlineEvents.matchEnd → 끝 배너 → 결과 화면.
 *
 * QA: 주소에 `?qa`가 있으면 `window.__fgBattle`로 현재 세션을 연다(E2E에서 상태 확인용).
 */
export function createBattleScreen(ctx: AppContext) {
  let session: BattleLike | null = null;
  let online: OnlineMatch | null = null;
  let pending: OnlineMatch | null = null;
  let nameOf: NameOf = () => '';
  let ended = false;
  let endAt = 0;
  let resultTimer = 0;
  let lostOnce = false;
  let confirmEl: HTMLElement | null = null;
  const unsubs: (() => void)[] = [];
  const qa = new URLSearchParams(location.search).has('qa');

  const feedback = new BattleFeedback();
  /** 체력이 낮을 때 맞으면 화면 가장자리가 붉게 번쩍인다 */
  const LOW_HP = 0.3;
  const lowHp = el('div', 'lowhp-vignette');
  const hud = new BattleHud((dead) => root.classList.toggle('is-dead', dead));
  const metrics = new UiMetrics(() => input.layout());
  const input: BattleInput = new BattleInput(metrics, {
    fired: (_which, touch) => feedback.fired(touch),
    empty: () => {
      feedback.empty();
      hud.flashAmmo();
    },
    denied: () => feedback.denied(),
  });
  const scoreboard = new Scoreboard();
  const crystalBoard = new CrystalBoard((text) => toast(text));
  const feed = new KoFeed();
  const banner = new MatchBanner();
  const ping = pingMeter('battle-ping');

  // 연결이 끊겼을 때 막
  const nvTitle = txt('', 'nv-title');
  const nvDots = el('div', 'mm-dots', [el('i'), el('i'), el('i')]);
  const nvButtons = el('div', 'cp-buttons');
  const netVeil = el('div', 'net-veil', [el('div', 'nv-box panel', [nvTitle, nvDots, nvButtons])]);
  netVeil.hidden = true;

  const exitBtn = button('btn-battle-exit', [iconEl('back')], () => exit(), 'back');
  const label = txt('TRAINING YARD', 'battle-label');
  const controls = el('div', 'battle-controls', [input.moveStick.el, input.superStick.el, input.attackStick.el]);
  const root = el('div', 'battle', [lowHp, hud.el, controls, label, scoreboard.el, crystalBoard.el, crystalBoard.countdown, ping.el, feed.el, banner.el, exitBtn, netVeil]);
  if (navigator.maxTouchPoints > 0) root.classList.add('has-touch');

  function exit() {
    if (!online) {
      ctx.go.lobby();
      return;
    }
    if (ended) return;
    confirmLeave();
  }

  function leaveMatch() {
    const m = online;
    closeConfirm();
    if (m && m.client.room) m.client.leaveRoom();
    ctx.go.online();
  }

  function confirmLeave() {
    closeConfirm();
    const ov = el('div', 'overlay', [
      el('div', 'confirm-panel panel', [
        txt('경기에서 나갈까요?', 'cf-title'),
        el('p', 'cf-note', ['나가도 남은 팀원은 계속 싸워요.']),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('계속하기')], () => closeConfirm(), 'back'),
          button('cp-btn is-danger', [txt('나가기')], () => leaveMatch()),
        ]),
      ]),
    ]);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeConfirm();
    });
    confirmEl = ov;
    ctx.overlayLayer.append(ov);
  }

  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }

  function showNet(state: 'ok' | 'connecting' | 'lost') {
    netVeil.hidden = state === 'ok';
    if (state === 'ok') return;
    nvDots.hidden = state !== 'connecting';
    nvTitle.textContent = state === 'connecting' ? '다시 연결 중' : '연결이 끊겼어요';
    const leave = button('cp-btn is-back', [txt('나가기')], () => leaveMatch(), 'back');
    if (state === 'connecting') {
      nvButtons.replaceChildren(leave);
      return;
    }
    const retry = button('cp-btn is-go', [txt('다시 연결')], () => {
      const c = online?.client;
      if (!c) return;
      const p = getProfile();
      c.connect(getServerUrl(), p.name, p.selected).catch(() => showNet('lost'));
    });
    nvButtons.replaceChildren(leave, retry);
  }

  /** 경기가 끝났다(점수판의 winner 또는 matchEnd). 배너는 한 번만 */
  function markEnded(winner: 0 | 1 | -1, score: [number, number]) {
    if (ended || !session) return;
    ended = true;
    endAt = performance.now();
    closeConfirm();
    root.classList.add('is-over');
    banner.show(winner, session.player.team, score);
  }

  function onMatchEnd(result: MatchResult) {
    markEnded(result.winner, result.score);
    window.clearTimeout(resultTimer);
    const wait = Math.max(600, BANNER_MS - (performance.now() - endAt));
    resultTimer = window.setTimeout(() => ctx.go.results(result), wait);
  }

  function setup() {
    const m = pending;
    const s: BattleLike = m ? m.session : new BattleSession({ fighterId: getProfile().selected, map: TRAINING_YARD });
    session = s;
    online = m;
    ended = false;
    lostOnce = false;
    // teamfight: KO 점수판 / crystal: 크리스탈 점수판 + 카운트다운. 둘 다 팀 경기(KO 알림·끝 배너)
    const mode = s.match.mode;
    const teamfight = mode !== 'training';
    const crystal = mode === 'crystal';
    root.classList.toggle('is-online', !!m);
    root.classList.toggle('is-teamfight', teamfight);
    root.classList.toggle('is-crystal', crystal);
    label.hidden = teamfight;
    scoreboard.el.hidden = !teamfight || crystal;
    crystalBoard.el.hidden = !crystal;
    feed.el.hidden = !teamfight;
    crystalBoard.reset();
    ping.el.hidden = !m;
    scoreboard.reset();
    feed.clear();
    banner.hide();
    showNet('ok');
    if (m) {
      const names = new Map(m.info.roster.map((r) => [r.entityId, r.name]));
      const fallback = fighterNameOf(s.state);
      nameOf = (id) => names.get(id) ?? fallback(id);
    } else {
      nameOf = fighterNameOf(s.state);
    }

    metrics.attach();
    hud.bind(s);
    input.bind(s, root);
    feedback.reset(s.player.superCharge);
    s.onEvents = (events) => {
      hud.onEvents(events);
      feedback.onEvents(events, s.playerId);
      const me = s.player;
      if (me.alive && me.hp / me.maxHp <= LOW_HP && events.some((e) => e.type === 'hit' && e.targetId === s.playerId)) {
        lowHp.classList.remove('is-on');
        void lowHp.offsetWidth; // 애니메이션 다시 시작
        lowHp.classList.add('is-on');
      }
      if (teamfight) feed.onEvents(events, s.state, s.playerId, nameOf);
    };
    s.onFrame = () => {
      input.frame();
      hud.frame();
      feedback.superCharge(s.player.superCharge);
      if (teamfight) {
        if (crystal) crystalBoard.update(s.match, s.player.team);
        else scoreboard.update(s.match, s.player.team);
        feed.frame();
        const w = s.match.winner;
        if (w !== null && !ended) markEnded(w, s.match.score);
      }
    };
    ctx.stage.setView(s);

    if (m) {
      const c = m.client;
      ping.set(c.pingMs);
      unsubs.push(
        c.on('ping', (ms) => ping.set(ms)),
        c.on('matchEnd', onMatchEnd),
        c.on('status', (st) => {
          if (st === 'connected') {
            showNet('ok');
          } else if (!ended) {
            lostOnce = true;
            showNet(st === 'connecting' ? 'connecting' : 'lost');
          }
        }),
        c.on('room', (r) => {
          // 다시 연결했더니 경기가 이미 끝나 방이 대기 중이면 방으로
          if (lostOnce && !ended && (!r || r.phase === 'lobby')) ctx.go.online();
        }),
      );
      if (c.status !== 'connected') showNet(c.status === 'connecting' ? 'connecting' : 'lost');
    }
    if (qa) (window as unknown as { __fgBattle?: BattleLike }).__fgBattle = s;
  }

  function teardown() {
    for (const u of unsubs.splice(0)) u();
    window.clearTimeout(resultTimer);
    closeConfirm();
    input.unbind();
    hud.unbind();
    metrics.detach();
    root.classList.remove('is-dead', 'is-over');
    ctx.stage.setView(null);
    session?.dispose();
    session = null;
    online = null;
    if (qa) delete (window as unknown as { __fgBattle?: BattleLike }).__fgBattle;
  }

  const screen: Screen & { configure(m: OnlineMatch | null): void; restart(): void } = {
    el: root,
    bg: 'battle',
    onShow: setup,
    onHide: teardown,
    /** 다음 onShow(또는 restart)에 쓸 경기. null이면 오프라인 연습장 */
    configure(m) {
      pending = m;
    },
    /** 이미 전투 화면일 때 새 세션으로 다시 붙는다(다시 연결 후 새 경기 등) */
    restart() {
      teardown();
      setup();
    },
  };
  return screen;
}
