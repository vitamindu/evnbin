import '../../styles/battle.css';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { BattleSession } from '../../battle/session';
import { TRAINING_YARD } from '../../data/maps/training';
import { getFighter } from '../../data/fighters';
import { getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { button, iconEl, txt } from '../widgets';

/**
 * 전투 화면. UI 담당.
 * (현재는 Lead가 만든 초기 뼈대: 나가기 버튼 + PC 키보드/마우스 조작만 있다.
 *  터치 조이스틱·HUD는 UI 담당이 만든다.)
 */
export function createBattleScreen(ctx: AppContext): Screen {
  let session: BattleSession | null = null;
  const keys = new Set<string>();

  const exitBtn = button('btn-battle-exit', [iconEl('back')], () => ctx.go.lobby(), 'back');
  const label = txt('TRAINING YARD', 'battle-label');
  const hit = el('div', 'battle-hit');
  const root = el('div', 'battle', [hit, exitBtn, label]);

  const updateMove = () => {
    if (!session) return;
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y) || 1;
    session.controls.move = { x: x / l, y: y / l };
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') session?.queueAttack(null);
    if (e.code === 'KeyE') session?.queueSuper(null);
    updateMove();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateMove();
  };
  // 마우스로 바닥을 누르면 그 방향으로 공격(PC 테스트용)
  hit.addEventListener('pointerdown', (e) => {
    if (!session || e.pointerType === 'touch') return;
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const g = session.view.groundAtDesign(e.clientX / scale, e.clientY / scale);
    if (!g) return;
    const p = session.player.pos;
    const range = getFighter(session.player.fighterId).attack.range;
    const dx = (g.x - p.x) / range;
    const dy = (g.y - p.y) / range;
    const l = Math.hypot(dx, dy);
    const aim = l > 1 ? { x: dx / l, y: dy / l } : { x: dx, y: dy };
    if (e.button === 2) session.queueSuper(aim);
    else session.queueAttack(aim);
  });

  return {
    el: root,
    bg: 'battle',
    onShow() {
      session = new BattleSession({ fighterId: getProfile().selected, map: TRAINING_YARD });
      ctx.stage.setView(session);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    },
    onHide() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      keys.clear();
      ctx.stage.setView(null);
      session?.dispose();
      session = null;
    },
  };
}
