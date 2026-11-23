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
 *   POST   /api/guild   (Bearer) {name, description?} → { guild }  (만들기, 만든 사람 = 길드장)
 *   POST   /api/guild/join (Bearer) {name}           → { guild }
 *   POST   /api/guild/leave (Bearer)                 → { guild: null }
 *   GET    /api/guilds?q=이름 (Bearer)               → { guilds: GuildSummary[] }  (멤버 많은 순 20개)
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
  | 'guild_full';

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

export function isValidGuildName(n: unknown): n is string {
  return typeof n === 'string' && GUILD_NAME_PATTERN.test(n.trim());
}

export interface GuildMember {
  nickname: string;
  rankPoints: number;
  avatar?: string;
  leader: boolean;
  online: boolean;
  inRoom: boolean;
}

export interface GuildInfo {
  name: string;
  description: string;
  /** 길드장 닉네임 */
  leader: string;
  members: GuildMember[];
  maxMembers: number;
}

export interface GuildSummary {
  name: string;
  description: string;
  members: number;
  leader: string;
}

/** GET /api/guild 등 길드 응답 */
export interface GuildResponse {
  guild: GuildInfo | null;
}

export function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
}
