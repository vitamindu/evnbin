import { sfx } from '../../audio/sfx';
import type { EntityId, SimEvent } from '../../game/types';

/**
 * 전투 효과음·진동. 소리는 타이틀의 첫 탭에서 잠금이 풀린 뒤에만 난다(sfx가 알아서 무시).
 */
export class BattleFeedback {
  private lastHitSound = 0;
  private charged = false;

  /** 발사 입력 직후. 손가락 입력이면 짧게 진동(지원 기기만) */
  fired(touch: boolean) {
    if (touch) navigator.vibrate?.(8);
  }

  empty() {
    sfx('empty');
  }

  denied() {
    sfx('deny');
  }

  /** 궁극기 게이지가 막 찼을 때 한 번 */
  superCharge(k: number) {
    const full = k >= 1;
    if (full && !this.charged) sfx('charged');
    this.charged = full;
  }

  reset(superCharge: number) {
    this.charged = superCharge >= 1;
  }

  onEvents(events: readonly SimEvent[], playerId: EntityId) {
    for (const e of events) {
      switch (e.type) {
        case 'attack':
          if (e.unitId === playerId) sfx(e.isSuper ? 'blast' : 'shoot');
          break;
        case 'hit': {
          if (e.targetId === playerId) sfx('hurt');
          else if (e.sourceId === playerId) {
            // 산탄 여러 발이 한꺼번에 맞아도 한 번만
            const now = performance.now();
            if (now - this.lastHitSound > 70) {
              this.lastHitSound = now;
              sfx('hit');
            }
          }
          break;
        }
        case 'death':
          if (e.unitId === playerId) sfx('ko');
          break;
        default:
          break;
      }
    }
  }
}
