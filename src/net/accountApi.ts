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
  | 'bad_request';

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

export function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
}
