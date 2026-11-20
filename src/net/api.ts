import type { FighterId } from '../data/fighters';
import type { MatchMode, Team } from '../game/types';
import type { BattleLike } from '../battle/types';
import type { MatchResult, MatchStartInfo, RoomState } from './protocol';

/**
 * UI가 쓰는 온라인 기능 계약. Lead 관리. 구현은 Network 담당(src/net/client.ts 의 createOnlineClient).
 */
export type OnlineStatus = 'disconnected' | 'connecting' | 'connected';

export interface OnlineEvents {
  status: OnlineStatus;
  room: RoomState | null;
  /** 경기 시작: 이 세션을 전투 화면에 넘긴다 */
  matchStart: { info: MatchStartInfo; session: BattleLike };
  matchEnd: MatchResult;
  error: { code: string; message: string };
  /** 왕복 지연(ms) */
  ping: number;
}

export interface OnlineClient {
  readonly status: OnlineStatus;
  readonly playerId: string | null;
  readonly room: RoomState | null;
  /** 마지막으로 잰 왕복 지연(ms) */
  readonly pingMs: number;
  connect(url: string, name: string, fighterId: FighterId): Promise<void>;
  disconnect(): void;
  createRoom(): Promise<RoomState>;
  joinRoom(code: string): Promise<RoomState>;
  leaveRoom(): void;
  setFighter(fighterId: FighterId): void;
  setTeam(team: Team): void;
  setFillBots(fill: boolean): void;
  /** 방장만: 경기 방식(teamfight | crystal) */
  setMode(mode: MatchMode): void;
  setReady(ready: boolean): void;
  /** 방장만 */
  startMatch(): void;
  on<K extends keyof OnlineEvents>(event: K, cb: (v: OnlineEvents[K]) => void): () => void;
}
