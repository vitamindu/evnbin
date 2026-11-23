import { rankDelta } from '../src/data/ranks';
/**
 * 계정 저장소(아이디+비밀번호). Network 담당.
 *
 * - 저장: dataDir/accounts.json 하나(원자적 쓰기: 임시 파일 → rename). Fly에서는 볼륨 /data, 로컬은 ./.data.
 * - 비밀번호: scrypt(N=16384, r=8, p=1, 64바이트) + 사용자별 16바이트 salt, 비교는 timingSafeEqual.
 * - 토큰: 무작위 32바이트(base64url). 파일에는 SHA-256 해시만 저장, 30일 만료, 계정당 최대 10개.
 * - 아이디(로그인): 3~12자(영문·숫자·한글·밑줄), 대소문자 구분 없이 하나만. 비밀번호 6자 이상.
 * - 닉네임(profile.name, 화면·방 이름): 2~10자, 대소문자 구분 없이 하나만. 바꿀 수 있다.
 *   닉네임이 없던 예전 계정은 읽을 때 닉네임 = 아이디(10자로 자르고, 겹치면 뒤에 숫자)로 옮긴다.
 * - 친구: 계정마다 친구 계정 키 목록. 추가·삭제는 항상 양쪽에.
 * - 트로피·코인은 서버만 바꾼다(경기 결과). 클라이언트는 선택 캐릭터만.
 */
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIGHTERS, type FighterId } from '../src/data/fighters';
import { SKINS, SKIN_SHOP_OPEN, getSkin } from '../src/data/skins';
import { MAX_POWER, upgradeCost } from '../src/data/power';
import { boxTotals, rollFighterBox, type BoxItem } from '../src/data/boxes';

/** 관리자 로그인 아이디(대소문자 무시). FG_ADMINS 환경 변수(쉼표 구분)로 바꿀 수 있다 */
export const ADMIN_USERNAMES = new Set(
  (process.env.FG_ADMINS ?? 'mineack991')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
import {
  GUILD_DESC_MAX,
  GUILD_MAX_MEMBERS,
  NICKNAME_MAX,
  isValidGuildName,
  isValidNickname,
  isValidPassword,
  isValidUsername,
  type AccountApiError,
  type AccountProfile as Profile,
} from '../src/net/accountApi';

export type AccountErrorCode = Exclude<AccountApiError, 'rate_limited'>;

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
  /** 닉네임(= profile.name). 예전 파일에는 없을 수 있다(읽을 때 채움) */
  nickname: string;
  /** 친구 계정 키 */
  friends: string[];
  salt: string;
  hash: string;
  createdAt: number;
  profile: Profile;
  tokens: StoredToken[];
  /** 들어가 있는 길드 id(= 소문자 길드 이름) */
  guild?: string;
}

interface StoredGuild {
  name: string;
  description: string;
  /** 길드장 계정 키 */
  leader: string;
  /** 멤버 계정 키(들어온 순서, 길드장 포함) */
  members: string[];
  createdAt: number;
}

interface StoreFile {
  version: 1;
  /** 키 = 소문자 아이디 */
  users: Record<string, StoredUser>;
  /** 키 = 소문자 길드 이름 */
  guilds?: Record<string, StoredGuild>;
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

export function defaultProfile(nickname: string): Profile {
  const fighters = {} as Profile['fighters'];
  for (const f of FIGHTERS) fighters[f.id] = { trophies: 0, power: 1 };
  const tag = Array.from({ length: 8 }, () => TAG_ALPHABET[randomInt(TAG_ALPHABET.length)]).join('');
  return { name: nickname, tag, level: 1, coins: 0, crystals: 0, selected: 'rivet', fighters, rankPoints: 0 };
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
  /** 같은 아이디·닉네임으로 동시에 가입하는 경우를 막는다 */
  private readonly signingUp = new Set<string>();
  private readonly reservedNicks = new Set<string>();
  /** 소문자 닉네임 → 계정 키 */
  private readonly byNick = new Map<string, string>();

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
      this.data = { version: 1, users: parsed.users, guilds: parsed.guilds ?? {} };
    } catch (err) {
      // 깨진 파일은 지우지 않고 옆에 남긴다
      const backup = `${this.file}.corrupt-${this.now()}`;
      renameSync(this.file, backup);
      this.log(`[accounts] could not read ${this.file} (${(err as Error).message}); moved to ${backup}`);
      this.data = { version: 1, users: {} };
    }
    const t = this.now();
    let migrated = 0;
    // 닉네임이 있는 계정을 먼저 등록하고, 없는 계정(예전 파일)은 아이디로 만든다
    const entries = Object.entries(this.data.users);
    for (const [key, u] of entries) {
      if (u.nickname && isValidNickname(u.nickname) && !this.byNick.has(u.nickname.toLowerCase())) this.byNick.set(u.nickname.toLowerCase(), key);
      else u.nickname = '';
    }
    for (const [key, u] of entries) {
      u.tokens = (u.tokens ?? []).filter((tok) => tok.expiresAt > t);
      for (const tok of u.tokens) this.byToken.set(tok.hash, key);
      u.friends = Array.isArray(u.friends) ? u.friends.filter((f) => typeof f === 'string') : [];
      if (!u.nickname) {
        u.nickname = this.freeNickname(u.username);
        this.byNick.set(u.nickname.toLowerCase(), key);
        migrated++;
      }
      u.profile = normalizeProfile(u.profile, u.nickname);
    }
    // 없어진 계정을 가리키는 친구 정리
    for (const u of Object.values(this.data.users)) u.friends = u.friends.filter((f) => this.data.users[f]);
    if (migrated) {
      this.log(`[accounts] gave nicknames to ${migrated} older account(s)`);
      this.save();
    }
  }

  /** 아이디에서 쓸 수 있는 닉네임: 10자로 자르고, 겹치면 뒤에 숫자 */
  private freeNickname(username: string): string {
    let base = Array.from(username.replace(/[^A-Za-z0-9_가-힣]/gu, '')).join('');
    if (Array.from(base).length < 2) base = (base + '__').slice(0, 2);
    const fit = (b: string, suffix: string) => Array.from(b).slice(0, NICKNAME_MAX - suffix.length).join('') + suffix;
    const first = fit(base, '');
    if (!this.nickTaken(first)) return first;
    for (let i = 2; ; i++) {
      const n = fit(base, String(i));
      if (!this.nickTaken(n)) return n;
    }
  }

  private nickTaken(nickname: string, exceptKey?: string): boolean {
    const k = nickname.toLowerCase();
    const owner = this.byNick.get(k);
    return (owner !== undefined && owner !== exceptKey) || this.reservedNicks.has(k);
  }

  /** 원자적 저장: 임시 파일에 쓰고 rename */
  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  async signup(username: unknown, password: unknown, nickname: unknown): Promise<{ token: string; profile: Profile; username: string }> {
    if (!validUsername(username)) throw new AccountError('invalid_username');
    if (!isValidNickname(nickname)) throw new AccountError('invalid_nickname');
    if (!validPassword(password)) throw new AccountError('weak_password');
    const key = accountKey(username);
    const nick = nickname.toLowerCase();
    if (this.data.users[key] || this.signingUp.has(key)) throw new AccountError('username_taken');
    if (this.nickTaken(nickname)) throw new AccountError('nickname_taken');
    this.signingUp.add(key);
    this.reservedNicks.add(nick);
    try {
      const salt = randomBytes(16);
      const hash = await scrypt(password, salt);
      if (this.data.users[key]) throw new AccountError('username_taken');
      const user: StoredUser = {
        username,
        nickname,
        friends: [],
        salt: salt.toString('base64'),
        hash: hash.toString('base64'),
        createdAt: this.now(),
        profile: defaultProfile(nickname),
        tokens: [],
      };
      this.data.users[key] = user;
      this.byNick.set(nick, key);
      const token = this.issueToken(key, user);
      this.save();
      return { token, profile: present(user, this.data.guilds), username };
    } finally {
      this.signingUp.delete(key);
      this.reservedNicks.delete(nick);
    }
  }

  async login(username: unknown, password: unknown): Promise<{ token: string; profile: Profile; username: string }> {
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
    return { token, profile: present(user, this.data.guilds), username: user.username };
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
    return u ? present(u, this.data.guilds) : null;
  }

  /** 로그인 아이디(가입할 때 쓴 대소문자 그대로) */
  username(key: string): string | null {
    return this.data.users[key]?.username ?? null;
  }

  /** 닉네임(화면·방에서 쓰는 이름) */
  nickname(key: string): string | null {
    return this.data.users[key]?.nickname ?? null;
  }

  /** 닉네임 → 계정 키(대소문자 무시) */
  findByNickname(nickname: unknown): string | null {
    if (typeof nickname !== 'string') return null;
    return this.byNick.get(nickname.trim().toLowerCase()) ?? null;
  }

  /** 닉네임 바꾸기. 같은 닉네임의 대소문자만 바꾸는 것은 된다 */
  changeNickname(key: string, nickname: unknown): Profile {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (!isValidNickname(nickname)) throw new AccountError('invalid_nickname');
    if (this.nickTaken(nickname, key)) throw new AccountError('nickname_taken');
    this.byNick.delete(u.nickname.toLowerCase());
    this.byNick.set(nickname.toLowerCase(), key);
    u.nickname = nickname;
    u.profile.name = nickname;
    this.save();
    return present(u, this.data.guilds);
  }

  /** 친구 계정 키 목록 */
  friends(key: string): string[] {
    return [...(this.data.users[key]?.friends ?? [])];
  }

  /** 닉네임으로 친구 추가(바로 서로 친구) */
  addFriend(key: string, nickname: unknown) {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    const other = this.findByNickname(nickname);
    if (!other) throw new AccountError('not_found');
    if (other === key) throw new AccountError('self');
    if (u.friends.includes(other)) throw new AccountError('already_friends');
    const o = this.data.users[other]!;
    u.friends.push(other);
    if (!o.friends.includes(key)) o.friends.push(key);
    this.save();
  }

  /** 닉네임으로 친구 삭제(서로). 그런 계정이 없거나 친구가 아니면 not_found */
  removeFriend(key: string, nickname: unknown) {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    const other = this.findByNickname(nickname);
    if (!other || !u.friends.includes(other)) throw new AccountError('not_found');
    const o = this.data.users[other]!;
    u.friends = u.friends.filter((f) => f !== other);
    o.friends = o.friends.filter((f) => f !== key);
    this.save();
  }

  /** 클라이언트가 바꿀 수 있는 것은 선택 캐릭터뿐 */
  updateSelected(key: string, selected: unknown): Profile | null {
    const u = this.data.users[key];
    if (!u) return null;
    if (typeof selected !== 'string' || !FIGHTERS.some((f) => f.id === selected)) return null;
    u.profile.selected = selected as FighterId;
    this.save();
    return present(u, this.data.guilds);
  }

  /** 프로필 사진: 작은 이미지 data URL(jpeg/webp/png, 6만 자 이하). null이면 지운다 */
  setAvatar(key: string, avatar: unknown): Profile {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (avatar === null) delete u.profile.avatar;
    else {
      if (typeof avatar !== 'string' || avatar.length > 60_000 || !/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/.test(avatar)) {
        throw new AccountError('bad_request');
      }
      u.profile.avatar = avatar;
    }
    this.save();
    return present(u, this.data.guilds);
  }

  /** 캐릭터에 스킨 입히기(skinId=null이면 기본). 가진 스킨만 */
  equipSkin(key: string, fighterId: unknown, skinId: unknown): Profile {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (typeof fighterId !== 'string' || !FIGHTERS.some((f) => f.id === fighterId)) throw new AccountError('bad_request');
    const sel = { ...(u.profile.skinSel ?? {}) };
    if (skinId === null) delete sel[fighterId as FighterId];
    else {
      const skin = typeof skinId === 'string' ? getSkin(skinId) : undefined;
      if (!skin || skin.fighterId !== fighterId) throw new AccountError('bad_request');
      if (!owns(u, skin.id)) throw new AccountError('not_owned');
      sel[fighterId as FighterId] = skin.id;
    }
    u.profile.skinSel = sel;
    this.save();
    return present(u, this.data.guilds);
  }

  /** 다이아로 스킨 사기(상점이 열려 있을 때만) */
  buySkin(key: string, skinId: unknown): Profile {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    const skin = typeof skinId === 'string' ? getSkin(skinId) : undefined;
    if (!skin) throw new AccountError('bad_request');
    if (owns(u, skin.id)) throw new AccountError('already_owned');
    if (!SKIN_SHOP_OPEN) throw new AccountError('shop_closed');
    if (!isAdmin(u)) {
      if (u.profile.crystals < skin.price) throw new AccountError('not_enough_gems');
      u.profile.crystals -= skin.price;
    }
    u.profile.skins = [...(u.profile.skins ?? []), skin.id];
    this.save();
    return present(u, this.data.guilds);
  }

  /** 캐릭터 레벨 업(최대 MAX_POWER). 코인이 든다. 관리자는 무료(무한 코인) */
  upgradeFighter(key: string, fighterId: unknown): Profile {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (typeof fighterId !== 'string' || !FIGHTERS.some((f) => f.id === fighterId)) throw new AccountError('bad_request');
    const fp = (u.profile.fighters[fighterId as FighterId] ??= { trophies: 0, power: 1 });
    const cost = upgradeCost(fp.power);
    if (cost === null || fp.power >= MAX_POWER) throw new AccountError('max_level');
    if (!isAdmin(u)) {
      if (u.profile.coins < cost) throw new AccountError('not_enough_coins');
      u.profile.coins -= cost;
    }
    fp.power += 1;
    this.save();
    return present(u, this.data.guilds);
  }

  /** 파이터 상자 하나 열기(관리자도 상자는 있어야 연다). rand는 테스트용 */
  openBox(key: string, rand: () => number = () => randomInt(0, 2 ** 32) / 2 ** 32): { profile: Profile; items: BoxItem[] } {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if ((u.profile.boxes ?? 0) < 1) throw new AccountError('no_boxes');
    u.profile.boxes = (u.profile.boxes ?? 0) - 1;
    const items = rollFighterBox(rand);
    const t = boxTotals(items);
    u.profile.coins += t.coins;
    u.profile.crystals += t.gems;
    this.save();
    return { profile: present(u, this.data.guilds), items };
  }

  // ───────────── 길드 ─────────────
  private get guilds(): Record<string, StoredGuild> {
    return (this.data.guilds ??= {});
  }

  /** 들어가 있는 길드(없으면 null). 사라진 길드를 가리키면 정리한다 */
  guildOf(key: string): (StoredGuild & { id: string }) | null {
    const u = this.data.users[key];
    const id = u?.guild;
    if (!u || !id) return null;
    const g = this.guilds[id];
    if (!g || !g.members.includes(key)) {
      delete u.guild;
      return null;
    }
    return { ...g, members: [...g.members], id };
  }

  /** 길드 만들기(만든 사람 = 길드장) */
  createGuild(key: string, name: unknown, description: unknown = ''): void {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (this.guildOf(key)) throw new AccountError('already_in_guild');
    if (!isValidGuildName(name)) throw new AccountError('invalid_guild_name');
    const id = name.trim().toLowerCase();
    if (this.guilds[id]) throw new AccountError('guild_taken');
    const desc = typeof description === 'string' ? description.trim().slice(0, GUILD_DESC_MAX) : '';
    this.guilds[id] = { name: name.trim(), description: desc, leader: key, members: [key], createdAt: this.now() };
    u.guild = id;
    this.save();
  }

  /** 이름으로 길드 가입(바로 들어간다) */
  joinGuild(key: string, name: unknown): void {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    if (this.guildOf(key)) throw new AccountError('already_in_guild');
    const id = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const g = this.guilds[id];
    if (!g) throw new AccountError('not_found');
    if (g.members.length >= GUILD_MAX_MEMBERS) throw new AccountError('guild_full');
    g.members.push(key);
    u.guild = id;
    this.save();
  }

  /** 길드 나가기. 길드장이 나가면 가장 먼저 들어온 멤버가 길드장, 마지막 사람이 나가면 길드가 없어진다 */
  leaveGuild(key: string): void {
    const u = this.data.users[key];
    if (!u) throw new AccountError('unauthorized');
    const g = this.guildOf(key);
    if (!g) throw new AccountError('not_in_guild');
    const stored = this.guilds[g.id]!;
    stored.members = stored.members.filter((m) => m !== key);
    delete u.guild;
    if (!stored.members.length) delete this.guilds[g.id];
    else if (stored.leader === key) stored.leader = stored.members[0]!;
    this.save();
  }

  /** 길드 찾기: 이름에 q가 들어간 길드(없으면 전부), 멤버 많은 순 최대 20개 */
  searchGuilds(q: unknown): { name: string; description: string; members: number; leader: string }[] {
    const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
    return Object.entries(this.guilds)
      .filter(([id]) => !needle || id.includes(needle))
      .map(([, g]) => ({ name: g.name, description: g.description, members: g.members.length, leader: this.nickname(g.leader) ?? '' }))
      .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))
      .slice(0, 20);
  }

  /** 경기에 쓸 스킨(가진 것만) */
  skinFor(key: string, fighterId: FighterId): string | undefined {
    const u = this.data.users[key];
    const id = u?.profile.skinSel?.[fighterId];
    return u && id && owns(u, id) ? id : undefined;
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
      fp.games = (fp.games ?? 0) + 1;
      u.profile.coins += r.outcome === 'win' ? COINS_WIN : COINS_OTHER;
      // 파이터 상자: 승리 +1
      if (r.outcome === 'win') u.profile.boxes = (u.profile.boxes ?? 0) + 1;
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

/** 클라이언트에 보내는 프로필: 관리자 표시 + 관리자는 모든 스킨 */
function present(u: StoredUser, guilds?: Record<string, StoredGuild>): Profile {
  const p = clone(u.profile);
  const g = u.guild ? guilds?.[u.guild] : undefined;
  if (g) p.guild = g.name;
  else delete p.guild;
  if (ADMIN_USERNAMES.has(u.username.toLowerCase())) {
    p.admin = true;
    p.skins = SKINS.map((s) => s.id);
  } else {
    delete p.admin;
  }
  return p;
}

function isAdmin(u: StoredUser): boolean {
  return ADMIN_USERNAMES.has(u.username.toLowerCase());
}

function owns(u: StoredUser, skinId: string): boolean {
  return isAdmin(u) || !!u.profile.skins?.includes(skinId);
}

function clone(p: Profile): Profile {
  return JSON.parse(JSON.stringify(p)) as Profile;
}

/** 새 캐릭터가 추가되거나 필드가 빠진 저장본을 지금 모양으로 */
function normalizeProfile(p: Partial<Profile> | undefined, nickname: string): Profile {
  const def = defaultProfile(nickname);
  const merged: Profile = { ...def, ...(p ?? {}), name: nickname, fighters: { ...def.fighters, ...(p?.fighters ?? {}) } };
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
