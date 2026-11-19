import { rankDelta } from '../src/data/ranks';
/**
 * 계정 저장소(아이디+비밀번호). Network 담당.
 *
 * - 저장: dataDir/accounts.json 하나(원자적 쓰기: 임시 파일 → rename). Fly에서는 볼륨 /data, 로컬은 ./.data.
 * - 비밀번호: scrypt(N=16384, r=8, p=1, 64바이트) + 사용자별 16바이트 salt, 비교는 timingSafeEqual.
 * - 토큰: 무작위 32바이트(base64url). 파일에는 SHA-256 해시만 저장, 30일 만료, 계정당 최대 10개.
 * - 아이디: 3~12자(영문·숫자·한글·밑줄), 대소문자 구분 없이 하나만. 비밀번호 6자 이상.
 * - 트로피·코인은 서버만 바꾼다(경기 결과). 클라이언트는 선택 캐릭터만.
 */
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIGHTERS, type FighterId } from '../src/data/fighters';
import { isValidPassword, isValidUsername, type AccountProfile as Profile } from '../src/net/accountApi';

export type AccountErrorCode = 'bad_credentials' | 'username_taken' | 'invalid_username' | 'weak_password' | 'unauthorized';

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOKENS = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const TAG_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const TROPHY_WIN = 8;
export const TROPHY_LOSS = -4;
export const COINS_WIN = 20;
export const COINS_OTHER = 10;

interface StoredToken {
  /** SHA-256(토큰) hex */
  hash: string;
  expiresAt: number;
}

interface StoredUser {
  username: string;
  salt: string;
  hash: string;
  createdAt: number;
  profile: Profile;
  tokens: StoredToken[];
}

interface StoreFile {
  version: 1;
  /** 키 = 소문자 아이디 */
  users: Record<string, StoredUser>;
}

export type MatchOutcome = 'win' | 'draw' | 'loss';

export interface AccountResult {
  /** 계정 키(소문자 아이디) */
  account: string;
  fighterId: FighterId;
  outcome: MatchOutcome;
  /** 팀 안 피해량 순위(0 = 1등)와 팀 인원(봇 포함) */
  place?: number;
  teamSize?: number;
}

export const validUsername = isValidUsername;
export const validPassword = isValidPassword;

export const accountKey = (username: string) => username.toLowerCase();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFC'), salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function defaultProfile(username: string): Profile {
  const fighters = {} as Profile['fighters'];
  for (const f of FIGHTERS) fighters[f.id] = { trophies: 0, power: 1 };
  const tag = Array.from({ length: 8 }, () => TAG_ALPHABET[randomInt(TAG_ALPHABET.length)]).join('');
  return { name: username, tag, level: 1, coins: 0, crystals: 0, selected: 'rivet', fighters, rankPoints: 0 };
}

/** 데이터 폴더: DATA_DIR → /data(있으면) → ./.data */
export function defaultDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (existsSync('/data')) return '/data';
  return join(process.cwd(), '.data');
}

export class AccountStore {
  private data: StoreFile = { version: 1, users: {} };
  /** 토큰 해시 → 계정 키 */
  private readonly byToken = new Map<string, string>();
  private readonly file: string;
  /** 같은 아이디로 동시에 가입하는 경우를 막는다 */
  private readonly signingUp = new Set<string>();

  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
    private readonly log: (m: string) => void = (m) => console.log(m),
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'accounts.json');
    this.load();
  }

  get size(): number {
    return Object.keys(this.data.users).length;
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      if (!parsed || typeof parsed.users !== 'object') throw new Error('bad format');
      this.data = { version: 1, users: parsed.users };
    } catch (err) {
      // 깨진 파일은 지우지 않고 옆에 남긴다
      const backup = `${this.file}.corrupt-${this.now()}`;
      renameSync(this.file, backup);
      this.log(`[accounts] could not read ${this.file} (${(err as Error).message}); moved to ${backup}`);
      this.data = { version: 1, users: {} };
    }
    const t = this.now();
    for (const [key, u] of Object.entries(this.data.users)) {
      u.tokens = (u.tokens ?? []).filter((tok) => tok.expiresAt > t);
      for (const tok of u.tokens) this.byToken.set(tok.hash, key);
      u.profile = normalizeProfile(u.profile, u.username);
    }
  }

  /** 원자적 저장: 임시 파일에 쓰고 rename */
  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  async signup(username: unknown, password: unknown): Promise<{ token: string; profile: Profile }> {
    if (!validUsername(username)) throw new AccountError('invalid_username');
    if (!validPassword(password)) throw new AccountError('weak_password');
    const key = accountKey(username);
    if (this.data.users[key] || this.signingUp.has(key)) throw new AccountError('username_taken');
    this.signingUp.add(key);
    try {
      const salt = randomBytes(16);
      const hash = await scrypt(password, salt);
      if (this.data.users[key]) throw new AccountError('username_taken');
      const user: StoredUser = {
        username,
        salt: salt.toString('base64'),
        hash: hash.toString('base64'),
        createdAt: this.now(),
        profile: defaultProfile(username),
        tokens: [],
      };
      this.data.users[key] = user;
      const token = this.issueToken(key, user);
      this.save();
      return { token, profile: clone(user.profile) };
    } finally {
      this.signingUp.delete(key);
    }
  }

  async login(username: unknown, password: unknown): Promise<{ token: string; profile: Profile }> {
    const key = typeof username === 'string' ? accountKey(username) : '';
    const user = key ? this.data.users[key] : undefined;
    const pw = typeof password === 'string' ? password : '';
    // 없는 아이디도 같은 시간이 걸리게 한 번 계산한다
    const salt = user ? Buffer.from(user.salt, 'base64') : randomBytes(16);
    const got = await scrypt(pw, salt);
    if (!user) throw new AccountError('bad_credentials');
    const want = Buffer.from(user.hash, 'base64');
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new AccountError('bad_credentials');
    const token = this.issueToken(key, user);
    this.save();
    return { token, profile: clone(user.profile) };
  }

  /** 토큰 → 계정 키(없거나 만료면 null) */
  verify(token: unknown): string | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const h = sha256(token);
    const key = this.byToken.get(h);
    if (!key) return null;
    const user = this.data.users[key];
    const tok = user?.tokens.find((t) => t.hash === h);
    if (!user || !tok) {
      this.byToken.delete(h);
      return null;
    }
    if (tok.expiresAt <= this.now()) {
      user.tokens = user.tokens.filter((t) => t !== tok);
      this.byToken.delete(h);
      this.save();
      return null;
    }
    return key;
  }

  logout(token: unknown): boolean {
    const key = this.verify(token);
    if (!key) return false;
    const h = sha256(token as string);
    const user = this.data.users[key]!;
    user.tokens = user.tokens.filter((t) => t.hash !== h);
    this.byToken.delete(h);
    this.save();
    return true;
  }

  profile(key: string): Profile | null {
    const u = this.data.users[key];
    return u ? clone(u.profile) : null;
  }

  /** 계정 이름(가입할 때 쓴 대소문자 그대로) */
  username(key: string): string | null {
    return this.data.users[key]?.username ?? null;
  }

  /** 클라이언트가 바꿀 수 있는 것은 선택 캐릭터뿐 */
  updateSelected(key: string, selected: unknown): Profile | null {
    const u = this.data.users[key];
    if (!u) return null;
    if (typeof selected !== 'string' || !FIGHTERS.some((f) => f.id === selected)) return null;
    u.profile.selected = selected as FighterId;
    this.save();
    return clone(u.profile);
  }

  /** 경기 결과: 캐릭터별 트로피(승 +8, 무 0, 패 −4, 0 아래로 안 내려감), 코인(승 +20, 그 외 +10) */
  /** ranked=false면 랭크 점수는 그대로(트로피·코인만) */
  applyMatchResults(results: readonly AccountResult[], ranked = false): Map<string, { rankPoints: number; rankDelta: number }> {
    const out = new Map<string, { rankPoints: number; rankDelta: number }>();
    let changed = false;
    for (const r of results) {
      const u = this.data.users[r.account];
      if (!u) continue;
      const fp = (u.profile.fighters[r.fighterId] ??= { trophies: 0, power: 1 });
      const delta = r.outcome === 'win' ? TROPHY_WIN : r.outcome === 'loss' ? TROPHY_LOSS : 0;
      fp.trophies = Math.max(0, fp.trophies + delta);
      u.profile.coins += r.outcome === 'win' ? COINS_WIN : COINS_OTHER;
      const before = u.profile.rankPoints ?? 0;
      u.profile.rankPoints = Math.max(0, before + (ranked ? rankDelta(r.outcome, r.place ?? 0, r.teamSize ?? 1) : 0));
      out.set(r.account, { rankPoints: u.profile.rankPoints, rankDelta: u.profile.rankPoints - before });
      changed = true;
    }
    if (changed) this.save();
    return out;
  }

  private issueToken(key: string, user: StoredUser): string {
    const token = randomBytes(32).toString('base64url');
    const h = sha256(token);
    const t = this.now();
    user.tokens = user.tokens.filter((tok) => tok.expiresAt > t);
    user.tokens.push({ hash: h, expiresAt: t + TOKEN_TTL_MS });
    while (user.tokens.length > MAX_TOKENS) this.byToken.delete(user.tokens.shift()!.hash);
    this.byToken.set(h, key);
    return token;
  }
}

function clone(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

/** 새 캐릭터가 추가되거나 필드가 빠진 저장본을 지금 모양으로 */
function normalizeProfile(p: Partial<Profile> | undefined, username: string): Profile {
  const def = defaultProfile(username);
  const merged: Profile = { ...def, ...(p ?? {}), name: username, fighters: { ...def.fighters, ...(p?.fighters ?? {}) } };
  if (!FIGHTERS.some((f) => f.id === merged.selected)) merged.selected = def.selected;
  return merged;
}

/**
 * 같은 IP의 로그인 실패 제한: windowMs 안에 maxFailures번 틀리면 window가 끝날 때까지 rate_limited.
 * 성공하면 그 IP의 실패 기록을 지운다. 가입은 IP당 windowMs에 maxSignups번까지.
 */
export class RateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly signups = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly maxSignups = 10,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(map: Map<string, number[]>, ip: string): number[] {
    const t = this.now();
    const list = (map.get(ip) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length) map.set(ip, list);
    else map.delete(ip);
    return list;
  }

  loginBlocked(ip: string): boolean {
    return this.recent(this.failures, ip).length >= this.maxFailures;
  }
  loginFailed(ip: string) {
    this.recent(this.failures, ip);
    this.failures.set(ip, [...(this.failures.get(ip) ?? []), this.now()]);
  }
  loginOk(ip: string) {
    this.failures.delete(ip);
  }
  signupBlocked(ip: string): boolean {
    return this.recent(this.signups, ip).length >= this.maxSignups;
  }
  signedUp(ip: string) {
    this.signups.set(ip, [...this.recent(this.signups, ip), this.now()]);
  }
  /** 오래된 기록 정리(주기적으로) */
  sweep() {
    for (const ip of [...this.failures.keys()]) this.recent(this.failures, ip);
    for (const ip of [...this.signups.keys()]) this.recent(this.signups, ip);
  }
}
