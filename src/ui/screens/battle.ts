import '../../styles/battle.css';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { BattleSession } from '../../battle/session';
import { TRAINING_YARD } from '../../data/maps/training';
import { getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { BattleFeedback } from '../battle/feedback';
import { BattleHud } from '../battle/hud';
import { BattleInput } from '../battle/input';
import { UiMetrics } from '../battle/metrics';
import { button, iconEl, txt } from '../widgets';

/**
 * 전투 화면(연습장). UI 담당.
 * 조작은 `ui/battle/input.ts`, 머리 위 체력·피해 숫자·부활 카운트다운은 `ui/battle/hud.ts`.
 * 시뮬레이션과 3D는 BattleSession(Lead)이 맡고, 이 화면은 session.onFrame / onEvents로만 갱신한다.
 *
 * QA: 주소에 `?qa`가 있으면 `window.__fgBattle`로 현재 세션을 연다(E2E에서 상태 확인용).
 */
export function createBattleScreen(ctx: AppContext): Screen {
  let session: BattleSession | null = null;
  const qa = new URLSearchParams(location.search).has('qa');

  const feedback = new BattleFeedback();
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

  const exitBtn = button('btn-battle-exit', [iconEl('back')], () => ctx.go.lobby(), 'back');
  const label = txt('TRAINING YARD', 'battle-label');
  const controls = el('div', 'battle-controls', [input.moveStick.el, input.superStick.el, input.attackStick.el]);
  const root = el('div', 'battle', [hud.el, controls, label, exitBtn]);
  if (navigator.maxTouchPoints > 0) root.classList.add('has-touch');

  return {
    el: root,
    bg: 'battle',
    onShow() {
      const s = new BattleSession({ fighterId: getProfile().selected, map: TRAINING_YARD });
      session = s;
      metrics.attach();
      hud.bind(s);
      input.bind(s, root);
      feedback.reset(s.player.superCharge);
      s.onEvents = (events) => {
        hud.onEvents(events);
        feedback.onEvents(events, s.playerId);
      };
      s.onFrame = () => {
        input.frame();
        hud.frame();
        feedback.superCharge(s.player.superCharge);
      };
      ctx.stage.setView(s);
      if (qa) (window as unknown as { __fgBattle?: BattleSession }).__fgBattle = s;
    },
    onHide() {
      input.unbind();
      hud.unbind();
      metrics.detach();
      root.classList.remove('is-dead');
      ctx.stage.setView(null);
      session?.dispose();
      session = null;
      if (qa) delete (window as unknown as { __fgBattle?: BattleSession }).__fgBattle;
    },
  };
}
