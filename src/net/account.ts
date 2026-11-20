/**
 * 계정(로그인) 클라이언트. Network 담당. UI는 이 모듈만 쓴다.
 *
 * - API 주소는 게임 서버 주소(getServerUrl)에서 만든다: wss://x → https://x/api, ws://x → http://x/api.
 * - 토큰은 localStorage 'fg.auth.v1'에 저장(못 쓰면 이번 실행 동안만 기억).
 * - 실패하면 AccountError(code)로 reject. code는 서버 오류 코드(bad_credentials 등) 또는
 *   'network'(서버에 닿지 않음·시간 초과), 'server_error'.
 * - restore(): 저장된 토큰으로 /api/me. 토큰이 틀리거나 만료면 지우고 null. 서버에 닿지 않으면 'network'로 reject
 *   (토큰은 남겨 두어 다음에 다시 시도할 수 있다).
 * - 로그인한 상태면 온라인 클라이언트(client.ts)가 hello에 토큰을 실어 보낸다.
 * - profile.name = 닉네임(화면·방 이름). 로그인 아이디는 AccountState.username으로 따로 준다.
 */
import type { FighterId } from '../data/fighters';
import type { Profile } from '../state/profile';
import type { AccountApiError, AccountProfile, AuthResponse, ProfileResponse } from './accountApi';
import { getServerUrl } from './config';

const KEY = 'fg.auth.v1';
const TIMEOUT_MS = 10_000;

export type AccountErrorCode = AccountApiError | 'network' | 'server_error';

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export interface AccountState {
  /** 로그인했으면 계정 프로필, 아니면 null(게스트·오프라인). profile.name = 닉네임 */
  profile: Profile | null;
  /** 로그인 아이디(닉네임과 다를 수 있다) */
  username: string | null;
}

// 서버 프로필과 UI 프로필이 같은 모양인지 컴파일 때 확인(계약)
const _sameShapeA: Profile = {} as AccountProfile;
const _sameShapeB: AccountProfile = {} as Profile;
void _sameShapeA;
void _sameShapeB;

type Listener = (s: AccountState) => void;
const listeners = new Set<Listener>();
let memoryToken: string | null = null;
let state: AccountState = { profile: null, username: null };

/** 게임 서버 주소 → API 기본 주소(끝에 / 없음) */
export function apiBase(serverUrl: string = getServerUrl()): string {
  return serverUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/+$/, '');
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: unknown };
    return typeof v.token === 'string' ? v.token : null;
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(KEY, JSON.stringify({ token }));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장 불가: 이번 실행 동안만 기억 */
  }
}

export function getAccount(): Readonly<AccountState> {
  return state;
}

export function isLoggedIn(): boolean {
  return state.profile !== null;
}

/** 계정 상태가 바뀔 때마다(로그인·로그아웃·프로필 갱신). 지금 상태로 한 번 바로 부른다. 해제 함수를 돌려준다 */
export function onAccountChange(cb: Listener): () => void {
  listeners.add(cb);
  try {
    cb(state);
  } catch (err) {
    console.error('[account] listener failed', err);
  }
  return () => {
    listeners.delete(cb);
  };
}

function setProfile(profile: Profile | null, username: string | null = profile ? state.username : null) {
  state = { profile, username: profile ? (username ?? state.username) : null };
  for (const l of [...listeners]) {
    try {
      l(state);
    } catch (err) {
      console.error('[account] listener failed', err);
    }
  }
}

/** 계정 API 호출(friends.ts도 쓴다). 실패하면 AccountError */
export async function call<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl?.signal,
    });
  } catch (err) {
    throw new AccountError('network', `Cannot reach the server: ${(err as Error)?.message ?? String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) {
    const code = (data as { error?: string } | null)?.error;
    throw new AccountError((code as AccountErrorCode | undefined) ?? (res.status >= 500 ? 'server_error' : 'bad_request'));
  }
  return data as T;
}

/** 가입(아이디·비밀번호·닉네임). 성공하면 바로 로그인 상태 */
export async function signup(username: string, password: string, nickname?: string): Promise<Profile> {
  // 닉네임 칸이 없는 화면에서 부르면 아이디를 닉네임으로 쓴다
  const nick = (nickname ?? username).trim();
  const r = await call<AuthResponse>('POST', '/api/signup', { username: username.trim(), password, nickname: nick });
  setToken(r.token);
  setProfile(r.profile, r.username);
  return r.profile;
}

export async function login(username: string, password: string): Promise<Profile> {
  const r = await call<AuthResponse>('POST', '/api/login', { username: username.trim(), password });
  setToken(r.token);
  setProfile(r.profile, r.username);
  return r.profile;
}

/** 닉네임 바꾸기(2~10자, 겹치면 nickname_taken). 이미 들어가 있는 방의 이름은 다음에 들어갈 때 바뀐다 */
export async function changeNickname(nickname: string): Promise<Profile> {
  const r = await authed<ProfileResponse>('PUT', '/api/nickname', { nickname: nickname.trim() });
  setProfile(r.profile, r.username);
  return r.profile;
}

/** 토큰이 필요한 호출. 토큰이 틀리면 로그아웃 상태로 */
export async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  if (!token) throw new AccountError('unauthorized');
  try {
    return await call<T>(method, path, body, token);
  } catch (err) {
    if (err instanceof AccountError && err.code === 'unauthorized') {
      setToken(null);
      setProfile(null);
    }
    throw err;
  }
}

/** 로그아웃. 서버에 닿지 않아도 기기에서는 로그아웃한다 */
export async function logout(): Promise<void> {
  const token = getToken();
  setToken(null);
  setProfile(null);
  if (!token) return;
  try {
    await call('POST', '/api/logout', undefined, token);
  } catch {
    /* 토큰은 서버에서 30일 뒤 만료 */
  }
}

/** 저장된 토큰으로 자동 로그인. 토큰이 없거나 틀리면 null */
export async function restore(): Promise<Profile | null> {
  const token = getToken();
  if (!token) {
    setProfile(null);
    return null;
  }
  try {
    const r = await call<ProfileResponse>('GET', '/api/me', undefined, token);
    setProfile(r.profile, r.username);
    return r.profile;
  } catch (err) {
    if (err instanceof AccountError && err.code === 'unauthorized') {
      setToken(null);
      setProfile(null);
      return null;
    }
    throw err;
  }
}

/** 경기가 끝난 뒤 등: 서버 프로필(트로피·코인)을 다시 읽는다. 로그인하지 않았으면 null */
export async function refresh(): Promise<Profile | null> {
  if (!getToken()) return null;
  return restore();
}

/** 선택 캐릭터 저장(클라이언트가 바꿀 수 있는 유일한 값) */
export async function updateSelected(selected: FighterId): Promise<Profile> {
  const r = await authed<ProfileResponse>('PUT', '/api/profile', { selected });
  setProfile(r.profile, r.username);
  return r.profile;
}
