import type { FighterId } from '../data/fighters';
import type { ScreenManager } from '../core/screens';
import type { Stage } from '../render/stage';

/** 화면들이 공유하는 앱 상태와 이동 함수 */
export interface AppContext {
  stage: Stage;
  screens: ScreenManager;
  /** 오버레이(토스트, 팝업)를 붙이는 층. 화면 전환과 무관하게 유지된다. */
  overlayLayer: HTMLElement;
  portraits: Record<FighterId, string>;
  go: {
    lobby(): void;
    fighters(): void;
    fighterDetail(id: FighterId): void;
  };
}
