/**
 * 계정 HTTP API 형식(docs/phase4-plan.md "계약"). 서버(server/api.ts)와 클라이언트(src/net/account.ts)가 같이 쓴다.
 * DOM·Three.js import 금지. AccountProfile은 src/state/profile.ts의 Profile과 같은 모양이다
 * (같은지 src/net/account.ts에서 컴파일 때 확인한다).
 *
 *   POST /api/signup  {username, password}  → { token, profile }
 *   POST /api/login   {username, password}  → { token, profile }
 *   GET  /api/me      (Authorization: Bearer) → { profile }
 *   PUT  /api/profile (Bearer) {selected}    → { profile }
 *   POST /api/logout  (Bearer)               → { ok: true }
 *   오류: { error: AccountApiError } (HTTP 400/401/409/429)
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
  /** 형식이 틀린 요청(JSON 아님, 필드 없음, 모르는 캐릭터 등) */
  | 'bad_request';

export interface AuthResponse {
  token: string;
  profile: AccountProfile;
}

export interface ProfileResponse {
  profile: AccountProfile;
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

export function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
}
