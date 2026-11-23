/**
 * 온라인 대전 통신 형식(웹소켓, JSON). Lead 관리 계약 — 바꾸려면 Lead에게.
 * 서버(server/)와 클라이언트(src/net/)가 이 파일을 같이 import한다. DOM·Three.js import 금지.
 *
 * 흐름: 연결 → hello → (create | join) → room 갱신 반복 → start(방장) → 서버가 start 알림
 *       → 클라이언트 input(매 틱) / 서버 snap(일정 간격) → end → 다시 room
 */
import type { FighterId } from '../data/fighters';
import type { Crystal, Zone, Lob, MatchMode, MatchState, Projectile, SimEvent, Team, Unit, Vec2 } from '../game/types';

export const PROTOCOL_VERSION = 2;

/** 조준: [x, y](길이 0~1) 또는 null(자동 조준) */
export type WireAim = [number, number] | null;

// ───────────── 방 ─────────────
export interface RoomPlayer {
  id: string;
  name: string;
  fighterId: FighterId;
  team: Team;
  ready: boolean;
  host: boolean;
  connected: boolean;
  /** 빈자리를 채운 봇이면 true */
  bot: boolean;
}

export interface RoomState {
  /** 친구에게 알려주는 방 코드(대문자 4글자) */
  code: string;
  players: RoomPlayer[];
  phase: 'lobby' | 'playing' | 'results';
  mode: MatchMode;
  mapId: string;
  /** 빈자리를 봇으로 채울지 */
  fillBots: boolean;
}

export interface MatchRosterEntry {
  playerId: string;
  /** 시뮬레이션 안의 파이터 id */
  entityId: number;
  name: string;
  team: Team;
  fighterId: FighterId;
  bot: boolean;
  /** 입힌 스킨 id(src/data/skins.ts). 없으면 기본 외형 */
  skin?: string;
}

export interface MatchStartInfo {
  seed: number;
  mapId: string;
  mode: MatchMode;
  roster: MatchRosterEntry[];
  tickRate: number;
  /** 서버가 몇 틱마다 snap을 보내는지 */
  snapshotEvery: number;
}

export interface Snapshot {
  tick: number;
  /** 이 클라이언트가 보낸 input 중 서버가 처리한 마지막 seq(예측 보정용) */
  ack: number;
  units: Unit[];
  projectiles: Projectile[];
  lobs: Lob[];
  crystals: Crystal[];
  /** 없으면 빈 배열로 본다(옛 서버) */
  zones?: Zone[];
  match: MatchState;
  /** 직전 snap 이후 생긴 사건(효과·피해 숫자·벽 파괴 등) */
  events: SimEvent[];
}

export interface PlayerStats {
  playerId: string;
  name: string;
  fighterId: FighterId;
  team: Team;
  kills: number;
  deaths: number;
  damage: number;
  /** 로그인한 플레이어: 경기 후 랭크 점수와 변화량(게스트·봇은 없음) */
  rankPoints?: number;
  rankDelta?: number;
}

export interface MatchResult {
  /** 랭크 점수가 반영된 경기인가(양 팀 사람 3명 이상·동수) */
  ranked?: boolean;
  winner: Team | -1;
  score: [number, number];
  stats: PlayerStats[];
}

// ───────────── 클라이언트 → 서버 ─────────────
export type ClientMsg =
  /** v2: token(로그인 토큰)이 있으면 계정 이름을 쓰고 경기 결과를 그 계정에 반영. 없으면 게스트 */
  | { t: 'hello'; v: number; name: string; fighterId: FighterId; token?: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'setFighter'; fighterId: FighterId }
  | { t: 'setTeam'; team: Team }
  | { t: 'setBots'; fillBots: boolean }
  /** 방장만: 경기 방식(teamfight | crystal) */
  | { t: 'setMode'; mode: MatchMode }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'input'; seq: number; move: Vec2; attack?: WireAim; super?: WireAim }
  | { t: 'ping'; at: number };

// ───────────── 서버 → 클라이언트 ─────────────
export type ServerMsg =
  | { t: 'welcome'; playerId: string; v: number }
  | { t: 'room'; room: RoomState }
  | { t: 'start'; match: MatchStartInfo }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'end'; result: MatchResult }
  | { t: 'pong'; at: number; serverTick: number }
  | { t: 'error'; code: 'bad_version' | 'room_not_found' | 'room_full' | 'not_host' | 'in_progress' | 'bad_message'; message: string };
