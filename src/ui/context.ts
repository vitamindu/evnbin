import type { BattleLike } from '../battle/types';
import type { FighterId } from '../data/fighters';
import type { ScreenManager } from '../core/screens';
import type { OnlineClient } from '../net/api';
import type { MatchResult, MatchStartInfo } from '../net/protocol';
import type { Stage } from '../render/stage';

/** 온라인 경기 하나를 전투 화면에 넘길 때 쓰는 묶음(OnlineEvents.matchStart + 클라이언트) */
export interface OnlineMatch {
  session: BattleLike;
  info: MatchStartInfo;
  client: OnlineClient;
}

/** 화면들이 공유하는 앱 상태와 이동 함수 */
export interface AppContext {
  stage: Stage;
  screens: ScreenManager;
  /** 오버레이(토스트, 팝업)를 붙이는 층. 화면 전환과 무관하게 유지된다. */
  overlayLayer: HTMLElement;
  portraits: Record<FighterId, string>;
  go: {
    /** 로그인 / 회원가입(저장된 토큰이 있으면 자동 로그인 후 로비) */
    login(): void;
    lobby(): void;
    fighters(): void;
    /** 친구 목록·추가(로비 친구 버튼) */
    friends(): void;
    guild(): void;
    shop(): void;
    pass(): void;
    ranking(): void;
    fighterDetail(id: FighterId): void;
    /** 인자 없으면 오프라인 연습장, 있으면 그 온라인 경기. 이미 전투 화면이면 새 세션으로 다시 붙는다 */
    battle(match?: OnlineMatch): void;
    /** 온라인 TEAM FIGHT: 연결 → 방 만들기 / 코드로 들어가기 → 방(이미 방에 있으면 바로 방) */
    /** auto: 파티용 자동 동작(방 만들기 / 코드로 들어가기) */
    online(auto?: { create: true } | { join: string }): void;
    /** 온라인 경기 결과 */
    results(result: MatchResult): void;
  };
}
