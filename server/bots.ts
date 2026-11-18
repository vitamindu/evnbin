/**
 * 봇 조종 어댑터. 실제 판단은 Gameplay 담당의 src/game/bot.ts(botInput).
 * 봇 코드에서 예외가 나도 서버 틱이 멈추지 않도록 감싸고, 그 틱은 가만히 있게 한다.
 */
import { botInput } from '../src/game/bot';
import type { Sim } from '../src/game/sim';
import type { EntityId, FighterInput } from '../src/game/types';

let warned = false;

export function botInputFor(sim: Sim, id: EntityId): FighterInput {
  try {
    return botInput(sim, id);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error('[bot] botInput failed; bots stay idle this tick', err);
    }
    return { move: { x: 0, y: 0 } };
  }
}
