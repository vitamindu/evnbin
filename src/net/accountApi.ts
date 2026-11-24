/**
 * 계정 HTTP API 형식(docs/phase4-plan.md "계약"). 서버(server/api.ts)와 클라이언트(src/net/account.ts)가 같이 쓴다.
 * DOM·Three.js import 금지. AccountProfile은 src/state/profile.ts의 Profile과 같은 모양이다
 * (같은지 src/net/account.ts에서 컴파일 때 확인한다).
 *
 *   POST   /api/signup  {username, password, nickname} → { token, profile, username }
 *   POST   /api/login   {username, password}           → { token, profile, username }
 *   GET    /api/me      (Authorization: Bearer)         → { profile, username }
 *   PUT    /api/profile (Bearer) {selected}             → { profile, username }
 *   PUT    /api/nickname (Bearer) {nickname}            → { profile, username }
 *   PUT    /api/avatar  (Bearer) {avatar: dataURL|null}  → { profile, username }  (jpeg/webp/png, 6만 자 이하)
 *   POST   /api/upgrade (Bearer) {fighterId}          → { profile, username }  (레벨 +1, 코인 차감. 관리자는 무료)
 *   POST   /api/boxes/open (Bearer)                   → { profile, username, items: BoxItem[] }  (파이터 상자 1개, src/data/boxes.ts)
 *   GET    /api/guild   (Bearer)                     → { guild: GuildInfo | null }
 *   POST   /api/guild   (Bearer) {name, description?} → { guild }  (만들기, 만든 사람 = 마스터. 코인 2000 + 다이아 100)
 *   POST   /api/guild/join (Bearer) {name}           → { guild }
 *   POST   /api/guild/leave (Bearer)                 → { guild: null }
 *   GET    /api/guilds?q=이름 (Bearer)               → { guilds: GuildSummary[] }  (멤버 많은 순 20개)
 *   POST   /api/guild/answer (Bearer) {nickname, accept} → { guild }  (가입 요청 승인·거절, 마스터·부마스터)
 *   POST   /api/guild/kick (Bearer) {nickname}       → { guild }  (마스터: 누구나, 부마스터: 마스터 빼고)
 *   POST   /api/guild/vice (Bearer) {nickname, on}   → { guild }  (부마스터 임명·해제, 마스터만)
 *   PUT    /api/guild/settings (Bearer) {joinMode?, description?} → { guild }  (마스터만)
 *   GET    /api/guild/chat?after=id (Bearer)         → { messages }  (after보다 새 것, 최대 100)
 *   POST   /api/guild/chat (Bearer) {text}           → { messages }  (1초에 1번, 100자)
 *   POST   /api/shop/buy (Bearer) {itemId}           → { profile, username, got }  (src/data/shop.ts, 다이아 차감)
 *   POST   /api/pass/claim (Bearer) {tier, track}     → { profile, username, got }  (시즌 패스 보상)
 *   POST   /api/pass/premium (Bearer)               → { profile, username }  (프리미엄, 다이아)
 *   GET    /api/party (Bearer)                       → PartyResponse  (내 파티 + 받은 초대)
 *   POST   /api/party/invite (Bearer) {nickname}     → PartyResponse  (친구만, 최대 3명)
 *   POST   /api/party/accept (Bearer) {from}         → PartyResponse
 *   POST   /api/party/decline (Bearer) {from}        → PartyResponse
 *   POST   /api/party/leave (Bearer)                 → PartyResponse
 *   POST   /api/party/kick (Bearer) {nickname}       → PartyResponse  (파티장만)
 *   GET    /api/history (Bearer)                      → HistoryResponse  (최근 30판 + 전체 합계)
 *   GET    /api/ranking (Bearer)                      → RankingResponse  (서버 전체, 랭크 점수 순 100명 + 내 순위)
 *   POST   /api/admin/grant (Bearer, 관리자) {target: 닉네임 | '*', coins, gems} → AdminGrantResponse  ('*' = 서버의 모든 계정)
 *   PUT    /api/skin    (Bearer) {fighterId, skinId|null} → { profile, username }  (가진 스킨만, null = 기본)
 *   POST   /api/skins/buy (Bearer) {skinId}             → { profile, username }  (코인 차감, SKIN_SHOP_OPEN일 때만)
 *   POST   /api/logout  (Bearer)                        → { ok: true }
 *   GET    /api/friends (Bearer)                        → { friends: FriendInfo[] }
 *   POST   /api/friends (Bearer) {nickname}             → { friends: FriendInfo[] }  (바로 서로 친구)
 *   DELETE /api/friends/<닉네임, URL 인코딩> (Bearer)    → { friends: FriendInfo[] }  (서로 삭제)
 *   오류: { error: AccountApiError } (HTTP 400/401/404/409/429)
 *
 * profile.name = 닉네임(화면·방 이름). username = 로그인 아이디(응답에 따로 담는다).
 */
import type { FighterId } from '../data/fighters';
import type { PassState } from '../data/pass';
import type { MatchMode } from '../game/types';

export interface AccountFighterProgress {
  trophies: number;
  power: number;
  games?: number;
}

export interface AccountProfile {
  name: string;
  tag: string;
  level: number;
  coins: number;
  crystals: number;
  selected: FighterId;
  fighters: Record<FighterId, AccountFighterProgress>;
  rankPoints: number;
  avatar?: string;
  /** 오늘의 선물을 받은 날(한국 시간 YYYY-MM-DD) */
  dailyClaimed?: string;
  /** 시즌 패스(src/data/pass.ts) */
  pass?: PassState;
  /** 들어가 있는 길드 이름 */
  guild?: string;
  boxes?: number;
  admin?: boolean;
  skins?: string[];
  skinSel?: Partial<Record<FighterId, string>>;
}

export type AccountApiError =
  | 'bad_credentials'
  | 'username_taken'
  | 'invalid_username'
  | 'weak_password'
  | 'unauthorized'
  | 'rate_limited'
  | 'nickname_taken'
  | 'invalid_nickname'
  /** 친구: 그 닉네임의 계정이 없음(또는 삭제할 때 친구가 아님) */
  | 'not_found'
  | 'already_friends'
  /** 친구: 자기 자신 */
  | 'self'
  /** 형식이 틀린 요청(JSON 아님, 필드 없음, 모르는 캐릭터 등) */
  | 'bad_request'
  /** 스킨: 가지지 않은 스킨 */
  | 'not_owned'
  | 'already_owned'
  /** 스킨 상점이 아직 닫혀 있음 */
  | 'shop_closed'
  | 'not_enough_coins'
  /** 스킨: 다이아 부족 */
  | 'not_enough_gems'
  /** 이미 최대 레벨 */
  | 'max_level'
  /** 열 상자가 없음 */
  | 'no_boxes'
  /** 길드: 이미 다른 길드에 있음 / 길드 없음 / 이름 형식 / 이름 겹침 / 꽉 참 */
  | 'already_in_guild'
  | 'not_in_guild'
  | 'invalid_guild_name'
  | 'guild_taken'
  | 'guild_full'
  /** 길드: 권한 없음(마스터·부마스터만) / 이미 가입 요청함 / 채팅을 너무 빨리 보냄 */
  | 'not_allowed'
  | 'already_requested'
  | 'rate_limited_chat'
  /** 상점: 오늘의 선물을 이미 받음 */
  | 'already_claimed'
  /** 시즌 패스: 아직 안 열린 단계 / 프리미엄이 필요 / 이미 프리미엄 */
  | 'tier_locked'
  | 'premium_required'
  | 'already_premium'
  /** 파티: 친구가 아님 / 꽉 참(3명) / 파티에 없음 / 이미 같은 파티 */
  | 'not_friends'
  | 'party_full'
  | 'not_in_party'
  | 'already_in_party';

export interface AuthResponse {
  token: string;
  profile: AccountProfile;
  /** 로그인 아이디(profile.name은 닉네임) */
  username: string;
}

export interface ProfileResponse {
  profile: AccountProfile;
  username: string;
}

export interface FriendInfo {
  nickname: string;
  /** 지금 서버에 웹소켓으로 연결돼 있는가 */
  online: boolean;
  rankPoints: number;
  /** 지금 방(로비 또는 경기)에 있는가 */
  inRoom: boolean;
  /** 프로필 사진(data URL) */
  avatar?: string;
}

export interface FriendsResponse {
  friends: FriendInfo[];
}

export interface ErrorResponse {
  error: AccountApiError;
}

/** 아이디 규칙: 3~12자, 영문·숫자·한글(완성형)·밑줄 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_가-힣]{3,12}$/u;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function isValidUsername(u: unknown): u is string {
  return typeof u === 'string' && USERNAME_PATTERN.test(u);
}

/** 닉네임 규칙: 2~10자, 영문·숫자·한글(완성형)·밑줄. 대소문자 구분 없이 하나만 */
export const NICKNAME_PATTERN = /^[A-Za-z0-9_가-힣]{2,10}$/u;
export const NICKNAME_MAX = 10;

export function isValidNickname(n: unknown): n is string {
  return typeof n === 'string' && NICKNAME_PATTERN.test(n);
}

/** 길드 이름: 2~12자, 영문·숫자·한글(완성형)·밑줄. 대소문자 구분 없이 하나만 */
export const GUILD_NAME_PATTERN = /^[A-Za-z0-9_가-힣]{2,12}$/u;
export const GUILD_NAME_MAX = 12;
export const GUILD_DESC_MAX = 40;
export const GUILD_MAX_MEMBERS = 30;
/** 길드 만드는 비용(관리자는 무료) */
export const GUILD_COST_COINS = 2000;
export const GUILD_COST_GEMS = 100;
/** 한 길드에 쌓이는 가입 요청 최대 수(넘으면 오래된 것부터 지운다) */
export const GUILD_MAX_REQUESTS = 50;
export const GUILD_CHAT_MAX = 100;
/** 서버에 남겨 두는 채팅 수 */
export const GUILD_CHAT_KEEP = 100;

/** 직급: 마스터 / 부마스터 / 멤버 */
export type GuildRole = 'master' | 'vice' | 'member';
/** 가입 방식: 바로 가입 / 마스터·부마스터 승인 */
export type GuildJoinMode = 'open' | 'approval';

export function isValidGuildName(n: unknown): n is string {
  return typeof n === 'string' && GUILD_NAME_PATTERN.test(n.trim());
}

export interface GuildMember {
  nickname: string;
  rankPoints: number;
  avatar?: string;
  role: GuildRole;
  online: boolean;
  inRoom: boolean;
}

export interface GuildRequest {
  nickname: string;
  rankPoints: number;
  avatar?: string;
  at: number;
}

export interface GuildChatMessage {
  id: number;
  /** 보낸 사람 닉네임. null이면 알림(가입·추방 등) */
  from: string | null;
  text: string;
  at: number;
}

export interface GuildInfo {
  name: string;
  description: string;
  /** 마스터 닉네임 */
  leader: string;
  members: GuildMember[];
  maxMembers: number;
  joinMode: GuildJoinMode;
  /** 내 직급 */
  myRole: GuildRole;
  /** 가입 요청(마스터·부마스터에게만, 그 외에는 빈 배열) */
  requests: GuildRequest[];
}

export interface GuildSummary {
  name: string;
  description: string;
  members: number;
  leader: string;
  joinMode: GuildJoinMode;
  /** 내가 가입 요청을 남겼는가 */
  requested?: boolean;
}

/** GET /api/guild 등 길드 응답 */
export interface GuildResponse {
  guild: GuildInfo | null;
  /** 가입 요청만 남겼을 때(승인 필요 길드) */
  requested?: boolean;
}

export interface PartyMember {
  nickname: string;
  avatar?: string;
  fighterId: FighterId;
  rankPoints: number;
  leader: boolean;
}

export interface PartyInvite {
  /** 보낸 사람 닉네임 */
  from: string;
  avatar?: string;
  at: number;
}

/** GET /api/party 등 */
export interface PartyResponse {
  party: { members: PartyMember[]; leader: string; roomCode: string | null } | null;
  invites: PartyInvite[];
}

/** 전적 한 판(내 계정 기준). 최근 HISTORY_KEEP판만 서버에 남는다 */
export interface MatchRecord {
  at: number;
  mode: MatchMode;
  mapId: string;
  outcome: 'win' | 'draw' | 'loss';
  /** [우리 팀, 상대 팀] 점수 */
  score: [number, number];
  fighterId: FighterId;
  kills: number;
  deaths: number;
  damage: number;
  ranked: boolean;
  /** 랭크 점수 변화(랭크 경기만) */
  rankDelta?: number;
  /** 이 판 최고 활약(KO 최다, 같으면 피해량) */
  mvp: boolean;
  players: { name: string; fighterId: FighterId; ally: boolean; me: boolean; bot: boolean; kills: number; deaths: number; damage: number }[];
}

/** 지금까지 전체 합계(기록 개수와 상관없이 쌓인다) */
export interface HistoryTotals {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  kills: number;
  deaths: number;
  damage: number;
  mvps: number;
}

export interface HistoryResponse {
  records: MatchRecord[];
  totals: HistoryTotals;
}

export const HISTORY_KEEP = 30;

/** 랭킹 한 줄(서버 전체, 랭크 점수 순) */
export interface RankingEntry {
  /** 순위(같은 점수면 같은 순위: 1, 2, 2, 4 …) */
  rank: number;
  nickname: string;
  rankPoints: number;
  avatar?: string;
  guild?: string;
  /** 가장 많이 쓴 캐릭터 */
  fighterId: FighterId;
}

export interface RankingResponse {
  /** 위에서부터 최대 RANKING_SIZE명 */
  top: RankingEntry[];
  /** 내 자리(로그인했을 때) */
  me: RankingEntry | null;
  /** 전체 사람 수 */
  total: number;
}

export const RANKING_SIZE = 100;

/** 관리자 지급: 한 번에 줄 수 있는 최대 수량(코인·보석 각각) */
export const ADMIN_GRANT_MAX = 1_000_000;

/** POST /api/admin/grant 응답 */
export interface AdminGrantResponse {
  /** 받은 계정 수 */
  count: number;
  coins: number;
  gems: number;
}

export interface GuildChatResponse {
  messages: GuildChatMessage[];
}

export function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
}
