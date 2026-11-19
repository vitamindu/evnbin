import type { FighterId } from '../../data/fighters';
import { getServerUrl } from '../../net/config';
import type { Profile } from '../../state/profile';

/**
 * 계정 기능의 UI 쪽 입구. Network 담당의 src/net/account.ts와 같은 이름·모양.
 * - src/net/account.ts가 있으면 그것을 쓴다(이 파일을 만든 작업 공간에는 아직 없어서 import.meta.glob으로 "있으면" 불러온다).
 *   Lead: 병합 뒤에는 `export * from '../../net/account'` 한 줄로 바꿔도 된다(?fakeonline 가짜는 남기려면 아래 분기 유지).
 * - 주소에 ?fakeonline 이 있거나 진짜 모듈이 없으면 localStorage 가짜(화면 확인·E2E용).
 *   가짜도 서버 주소에 "fail"이 들어 있으면 'network' 오류를 낸다.
 */
export interface Account {
  username: string;
  profile: Profile;
}

export type AccountErrorCode =
  | 'bad_credentials'
  | 'username_taken'
  | 'invalid_username'
  | 'weak_password'
  | 'unauthorized'
  | 'rate_limited'
  | 'network';

interface AccountModule {
  signup(username: string, password: string): Promise<unknown>;
  login(username: string, password: string): Promise<unknown>;
  logout(): Promise<unknown> | void;
  restore(): Promise<unknown>;
  updateSelected(fighterId: FighterId): Promise<unknown>;
  getAccount(): Account | null;
  onAccountChange(cb: (a: Account | null) => void): () => void;
}

const realModules = import.meta.glob<AccountModule>('../../net/account.ts', { eager: true });

// ───────────── 가짜(localStorage) ─────────────
const USERS_KEY = 'fg.fakeaccounts.v1';
const TOKEN_KEY = 'fg.fakeaccount.token';

function fakeModule(): AccountModule {
  let account: Account | null = null;
  const listeners = new Set<(a: Account | null) => void>();
  const emit = () => {
    for (const l of [...listeners]) l(account);
  };
  type Row = { password: string; profile: Profile };
  const read = (): Record<string, Row> => {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}') as Record<string, Row>;
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, Row>) => {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(all));
    } catch {
      /* 무시 */
    }
  };
  const fail = (code: AccountErrorCode): never => {
    throw Object.assign(new Error(code), { code });
  };
  const net = async () => {
    await new Promise((r) => setTimeout(r, 350));
    if (/fail/i.test(getServerUrl())) fail('network');
  };
  const newProfile = (username: string): Profile => {
    const tag = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('');
    return {
      name: username,
      tag,
      level: 1,
      coins: 40,
      crystals: 0,
      rankPoints: 0,
      selected: 'rivet',
      fighters: {
        rivet: { trophies: 16, power: 1 },
        volley: { trophies: 8, power: 1 },
        boulder: { trophies: 0, power: 1 },
        hinako: { trophies: 4, power: 1 },
      },
    };
  };
  const signIn = (key: string, row: Row) => {
    account = { username: row.profile.name, profile: row.profile };
    try {
      localStorage.setItem(TOKEN_KEY, key);
    } catch {
      /* 무시 */
    }
    emit();
    return account;
  };
  return {
    async signup(username, password) {
      await net();
      if (!/^[A-Za-z0-9_가-힣]{3,12}$/.test(username)) fail('invalid_username');
      if (password.length < 6) fail('weak_password');
      const all = read();
      const key = username.toLowerCase();
      if (all[key]) fail('username_taken');
      all[key] = { password, profile: newProfile(username) };
      write(all);
      return signIn(key, all[key]!);
    },
    async login(username, password) {
      await net();
      const key = username.toLowerCase();
      const row = read()[key];
      if (!row || row.password !== password) fail('bad_credentials');
      return signIn(key, row!);
    },
    logout() {
      account = null;
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* 무시 */
      }
      emit();
    },
    async restore() {
      let key: string | null = null;
      try {
        key = localStorage.getItem(TOKEN_KEY);
      } catch {
        key = null;
      }
      if (!key) return null;
      await net();
      const row = read()[key];
      if (!row) return null;
      return signIn(key, row);
    },
    async updateSelected(fighterId) {
      if (!account) fail('unauthorized');
      const all = read();
      const key = account!.username.toLowerCase();
      if (all[key]) {
        all[key]!.profile.selected = fighterId;
        write(all);
      }
      account = { ...account!, profile: { ...account!.profile, selected: fighterId } };
      emit();
    },
    getAccount: () => account,
    onAccountChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const fake = new URLSearchParams(location.search).has('fakeonline');
const real = Object.values(realModules)[0];
/** 진짜 모듈은 로그아웃 상태도 { profile: null, username: null } 객체로 준다 → UI 계약(null)에 맞춘다 */
function adapt(m: AccountModule): AccountModule {
  type Raw = { profile: Profile | null; username: string | null } | null;
  const norm = (a: unknown): Account | null => {
    const r = a as Raw;
    return r && r.profile && r.username ? { username: r.username, profile: r.profile } : null;
  };
  return {
    ...m,
    getAccount: () => norm(m.getAccount()),
    onAccountChange: (cb) => m.onAccountChange((a) => cb(norm(a))),
  };
}
const api: AccountModule = !fake && real ? adapt(real) : fakeModule();

export const signup = (username: string, password: string) => api.signup(username, password);
export const login = (username: string, password: string) => api.login(username, password);
export const logout = () => api.logout();
export const restore = () => api.restore();
export const updateSelected = (fighterId: FighterId) => api.updateSelected(fighterId);
export const getAccount = () => api.getAccount();
export const onAccountChange = (cb: (a: Account | null) => void) => api.onAccountChange(cb);

/** 던져진 값에서 오류 코드(없으면 'network') */
export function accountErrorCode(e: unknown): AccountErrorCode {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? (code as AccountErrorCode) : 'network';
}

/** 오류 문구(한국어, 짧게) */
export function accountErrorText(code: AccountErrorCode): string {
  switch (code) {
    case 'bad_credentials':
      return '아이디 또는 비밀번호가 틀렸어요';
    case 'username_taken':
      return '이미 있는 아이디예요';
    case 'invalid_username':
      return '아이디는 3~12자 영문·숫자·한글·_';
    case 'weak_password':
      return '비밀번호는 6자 이상';
    case 'unauthorized':
      return '다시 로그인해 주세요';
    case 'rate_limited':
      return '잠시 뒤 다시 시도해 주세요';
    default:
      return '서버에 연결할 수 없어요';
  }
}
