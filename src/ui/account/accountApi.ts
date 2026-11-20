import type { FighterId } from '../../data/fighters';
import * as realAccount from '../../net/account';
import { getServerUrl } from '../../net/config';
import type { Profile } from '../../state/profile';

/**
 * 계정 기능의 UI 쪽 입구(어댑터). 진짜는 Network 담당의 src/net/account.ts.
 * - 진짜 모듈의 getAccount()는 { profile, username }(로그아웃이면 profile=null)을 돌려준다.
 *   UI는 "로그인 = Account, 아니면 null"로 쓰므로 여기서 바꿔 준다.
 * - 5단계: username = 로그인 아이디, profile.name = 닉네임(화면에 보이는 이름).
 *   signup(아이디, 비밀번호, 닉네임), changeNickname(닉네임)은 진짜 모듈에 있으면 그것을 쓴다.
 * - 주소에 ?fakeonline이 있으면 localStorage 가짜(화면 확인·E2E용). 서버 주소에 "fail"이 들어 있으면 'network' 오류.
 */
export interface Account {
  /** 로그인 아이디(설정 화면에만 보인다) */
  username: string;
  /** profile.name = 닉네임 */
  profile: Profile;
}

export type AccountErrorCode =
  | 'bad_credentials'
  | 'username_taken'
  | 'invalid_username'
  | 'weak_password'
  | 'nickname_taken'
  | 'invalid_nickname'
  | 'unauthorized'
  | 'rate_limited'
  | 'not_found'
  | 'already_friends'
  | 'self'
  | 'server_error'
  | 'network';

interface AccountModule {
  signup(username: string, password: string, nickname: string): Promise<unknown>;
  login(username: string, password: string): Promise<unknown>;
  logout(): Promise<unknown> | void;
  restore(): Promise<unknown>;
  updateSelected(fighterId: FighterId): Promise<unknown>;
  changeNickname(nickname: string): Promise<unknown>;
  getAccount(): Account | null;
  onAccountChange(cb: (a: Account | null) => void): () => void;
}

const fail = (code: AccountErrorCode): never => {
  throw Object.assign(new Error(code), { code });
};

// ───────────── 진짜 모듈 어댑터 ─────────────
type RealState = { profile: Profile | null; username: string | null } | null;
type RealModule = {
  signup(u: string, p: string, n?: string): Promise<unknown>;
  login(u: string, p: string): Promise<unknown>;
  logout(): Promise<unknown>;
  restore(): Promise<unknown>;
  updateSelected(f: FighterId): Promise<unknown>;
  changeNickname?: (n: string) => Promise<unknown>;
  getAccount(): RealState;
  onAccountChange(cb: (s: RealState) => void): () => void;
};

function realAdapter(m: RealModule): AccountModule {
  const norm = (s: RealState): Account | null => (s?.profile ? { username: s.username ?? s.profile.name, profile: s.profile } : null);
  return {
    signup: (u, p, n) => m.signup(u, p, n),
    login: (u, p) => m.login(u, p),
    logout: () => m.logout(),
    restore: () => m.restore(),
    updateSelected: (f) => m.updateSelected(f),
    changeNickname: (n) => (m.changeNickname ? m.changeNickname(n) : Promise.reject(Object.assign(new Error('server_error'), { code: 'server_error' }))),
    getAccount: () => norm(m.getAccount()),
    onAccountChange: (cb) => m.onAccountChange((s) => cb(norm(s))),
  };
}

// ───────────── 가짜(localStorage) ─────────────
const USERS_KEY = 'fg.fakeaccounts.v2';
const TOKEN_KEY = 'fg.fakeaccount.token';
const ID_RE = /^[A-Za-z0-9_가-힣]{3,12}$/;
const NICK_RE = /^[A-Za-z0-9_가-힣]{2,10}$/;

type Row = { username: string; password: string; profile: Profile };
const readUsers = (): Record<string, Row> => {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}') as Record<string, Row>;
  } catch {
    return {};
  }
};
const writeUsers = (all: Record<string, Row>) => {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(all));
  } catch {
    /* 무시 */
  }
};
/** 가짜 서버 지연 + 'fail' 주소면 network 오류 */
export const fakeNet = async () => {
  await new Promise((r) => setTimeout(r, 300));
  if (/fail/i.test(getServerUrl())) fail('network');
};

function fakeModule(): AccountModule {
  let account: Account | null = null;
  const listeners = new Set<(a: Account | null) => void>();
  const emit = () => {
    for (const l of [...listeners]) l(account);
  };
  const newProfile = (nickname: string): Profile => {
    const tag = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('');
    return {
      name: nickname,
      tag,
      level: 1,
      coins: 40,
      crystals: 0,
      selected: 'rivet',
      rankPoints: 0,
      fighters: {
        rivet: { trophies: 16, power: 1 },
        volley: { trophies: 8, power: 1 },
        boulder: { trophies: 0, power: 1 },
        hinako: { trophies: 4, power: 1 },
      },
    };
  };
  const signIn = (key: string, row: Row) => {
    account = { username: row.username, profile: { ...row.profile } };
    try {
      localStorage.setItem(TOKEN_KEY, key);
    } catch {
      /* 무시 */
    }
    emit();
    return account;
  };
  const nickTaken = (all: Record<string, Row>, nick: string, exceptKey?: string) =>
    Object.entries(all).some(([k, r]) => k !== exceptKey && r.profile.name.toLowerCase() === nick.toLowerCase());
  return {
    async signup(username, password, nickname) {
      await fakeNet();
      if (!ID_RE.test(username)) fail('invalid_username');
      if (!NICK_RE.test(nickname)) fail('invalid_nickname');
      if (password.length < 6) fail('weak_password');
      const all = readUsers();
      const key = username.toLowerCase();
      if (all[key]) fail('username_taken');
      if (nickTaken(all, nickname)) fail('nickname_taken');
      all[key] = { username, password, profile: newProfile(nickname) };
      writeUsers(all);
      return signIn(key, all[key]!);
    },
    async login(username, password) {
      await fakeNet();
      const key = username.toLowerCase();
      const row = readUsers()[key];
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
      await fakeNet();
      const row = readUsers()[key];
      if (!row) return null;
      return signIn(key, row);
    },
    async updateSelected(fighterId) {
      if (!account) fail('unauthorized');
      const all = readUsers();
      const key = account!.username.toLowerCase();
      if (all[key]) {
        all[key]!.profile.selected = fighterId;
        writeUsers(all);
      }
      account = { ...account!, profile: { ...account!.profile, selected: fighterId } };
      emit();
    },
    async changeNickname(nickname) {
      if (!account) fail('unauthorized');
      await fakeNet();
      if (!NICK_RE.test(nickname)) fail('invalid_nickname');
      const all = readUsers();
      const key = account!.username.toLowerCase();
      if (nickTaken(all, nickname, key)) fail('nickname_taken');
      if (all[key]) {
        all[key]!.profile.name = nickname;
        writeUsers(all);
      }
      account = { ...account!, profile: { ...account!.profile, name: nickname } };
      emit();
    },
    getAccount: () => account,
    onAccountChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export const isFakeAccounts = () => new URLSearchParams(location.search).has('fakeonline');
const api: AccountModule = isFakeAccounts() ? fakeModule() : realAdapter(realAccount as unknown as RealModule);

export const signup = (username: string, password: string, nickname: string) => api.signup(username, password, nickname);
export const login = (username: string, password: string) => api.login(username, password);
export const logout = () => api.logout();
export const restore = () => api.restore();
export const updateSelected = (fighterId: FighterId) => api.updateSelected(fighterId);
export const changeNickname = (nickname: string) => api.changeNickname(nickname);
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
    case 'nickname_taken':
      return '이미 쓰는 닉네임이에요';
    case 'invalid_nickname':
      return '닉네임은 2~10자 영문·숫자·한글·_';
    case 'unauthorized':
      return '다시 로그인해 주세요';
    case 'rate_limited':
      return '잠시 뒤 다시 시도해 주세요';
    case 'not_found':
      return '그런 닉네임은 없어요';
    case 'already_friends':
      return '이미 친구예요';
    case 'self':
      return '나 자신은 추가할 수 없어요';
    case 'server_error':
      return '서버에 문제가 생겼어요';
    default:
      return '서버에 연결할 수 없어요';
  }
}
