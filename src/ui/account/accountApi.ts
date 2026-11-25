import type { FighterId } from '../../data/fighters';
import * as realAccount from '../../net/account';
import { getServerUrl } from '../../net/config';
import type { Profile } from '../../state/profile';
import { SKINS, SKIN_SHOP_OPEN, getSkin } from '../../data/skins';
import { upgradeCost } from '../../data/power';
import { boxTotals, rollFighterBox, type BoxItem } from '../../data/boxes';
import { getShopItem, shopDay } from '../../data/shop';
import { ADMIN_GRANT_MAX } from '../../net/accountApi';
import { PASS_SKIN_REFUND, PREMIUM_PRICE, normalizePass, rewardOf, tierOf, type PassTrack } from '../../data/pass';
import type { ShopGot } from '../../net/account';

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
  | 'not_owned'
  | 'already_owned'
  | 'shop_closed'
  | 'not_enough_coins'
  | 'not_enough_gems'
  | 'max_level'
  | 'no_boxes'
  | 'already_in_guild'
  | 'not_in_guild'
  | 'invalid_guild_name'
  | 'guild_taken'
  | 'guild_full'
  | 'not_allowed'
  | 'already_requested'
  | 'rate_limited_chat'
  | 'already_claimed'
  | 'tier_locked'
  | 'premium_required'
  | 'already_premium'
  | 'not_friends'
  | 'party_full'
  | 'not_in_party'
  | 'already_in_party'
  | 'server_error'
  | 'network';

interface AccountModule {
  signup(username: string, password: string, nickname: string): Promise<unknown>;
  login(username: string, password: string): Promise<unknown>;
  logout(): Promise<unknown> | void;
  restore(): Promise<unknown>;
  updateSelected(fighterId: FighterId): Promise<unknown>;
  changeNickname(nickname: string): Promise<unknown>;
  equipSkin(fighterId: FighterId, skinId: string | null): Promise<unknown>;
  buySkin(skinId: string): Promise<unknown>;
  setAvatar(avatar: string | null): Promise<unknown>;
  upgradeFighter(fighterId: FighterId): Promise<unknown>;
  openBox(): Promise<{ items: BoxItem[] }>;
  buyShopItem(itemId: string): Promise<{ got: ShopGot }>;
  claimPass(tier: number, track: PassTrack): Promise<{ got: ShopGot }>;
  buyPremiumPass(): Promise<unknown>;
  adminGrant(target: string, coins: number, gems: number): Promise<{ count: number; coins: number; gems: number }>;
  /** 가짜 모듈만 */
  patch?(fn: (p: Profile) => void): void;
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
  equipSkin(f: FighterId, s: string | null): Promise<unknown>;
  buySkin(s: string): Promise<unknown>;
  setAvatar(a: string | null): Promise<unknown>;
  upgradeFighter(f: FighterId): Promise<unknown>;
  openBox(): Promise<{ items: BoxItem[] }>;
  buyShopItem(itemId: string): Promise<{ got: ShopGot }>;
  claimPass(tier: number, track: PassTrack): Promise<{ got: ShopGot }>;
  buyPremiumPass(): Promise<unknown>;
  adminGrant(target: string, coins: number, gems: number): Promise<{ count: number; coins: number; gems: number }>;
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
    equipSkin: (f, id) => m.equipSkin(f, id),
    buySkin: (id) => m.buySkin(id),
    setAvatar: (a) => m.setAvatar(a),
    upgradeFighter: (f) => m.upgradeFighter(f),
    openBox: () => m.openBox(),
    buyShopItem: (id) => m.buyShopItem(id),
    claimPass: (t, k) => m.claimPass(t, k),
    buyPremiumPass: () => m.buyPremiumPass(),
    adminGrant: (t, c, g) => m.adminGrant(t, c, g),
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
        fuse: { trophies: 0, power: 1 },
        shard: { trophies: 0, power: 1 },
        grizzle: { trophies: 0, power: 1 },
        prism: { trophies: 0, power: 1 },
        reaper: { trophies: 0, power: 1 },
        fister: { trophies: 0, power: 1 },
      },
    };
  };
  const present = (row: Row): Profile =>
    row.username.toLowerCase() === 'mineack991' ? { ...row.profile, admin: true, skins: SKINS.map((k) => k.id) } : { ...row.profile };
  const save = (fn: (row: Row) => void) => {
    const all = readUsers();
    const row = all[account!.username.toLowerCase()];
    if (!row) return;
    fn(row);
    writeUsers(all);
    account = { ...account!, profile: present(row) };
    emit();
  };
  const signIn = (key: string, row: Row) => {
    account = { username: row.username, profile: present(row) };
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
    async equipSkin(fighterId, skinId) {
      if (!account) fail('unauthorized');
      await fakeNet();
      if (skinId && !account!.profile.admin && !account!.profile.skins?.includes(skinId)) fail('not_owned');
      save((row) => {
        const sel = { ...(row.profile.skinSel ?? {}) };
        if (skinId) sel[fighterId] = skinId;
        else delete sel[fighterId];
        row.profile.skinSel = sel;
      });
    },
    async buySkin(skinId) {
      if (!account) fail('unauthorized');
      await fakeNet();
      const skin = getSkin(skinId);
      if (!skin) fail('server_error');
      if (account!.profile.admin || account!.profile.skins?.includes(skinId)) fail('already_owned');
      if (!SKIN_SHOP_OPEN) fail('shop_closed');
      if (account!.profile.crystals < skin!.price) fail('not_enough_gems');
      save((row) => {
        row.profile.crystals -= skin!.price;
        row.profile.skins = [...(row.profile.skins ?? []), skinId];
      });
    },
    async setAvatar(avatar) {
      if (!account) fail('unauthorized');
      await fakeNet();
      save((row) => {
        if (avatar) row.profile.avatar = avatar;
        else delete row.profile.avatar;
      });
    },
    async upgradeFighter(fighterId) {
      if (!account) fail('unauthorized');
      await fakeNet();
      const lv = account!.profile.fighters[fighterId]?.power ?? 1;
      const cost = upgradeCost(lv);
      if (cost === null) fail('max_level');
      const admin = !!account!.profile.admin;
      if (!admin && account!.profile.coins < cost!) fail('not_enough_coins');
      save((row) => {
        const fp = (row.profile.fighters[fighterId] ??= { trophies: 0, power: 1 });
        fp.power = lv + 1;
        if (!admin) row.profile.coins -= cost!;
      });
    },
    async openBox() {
      if (!account) fail('unauthorized');
      await fakeNet();
      if ((account!.profile.boxes ?? 0) < 1) fail('no_boxes');
      const items = rollFighterBox(Math.random);
      const t = boxTotals(items);
      save((row) => {
        row.profile.boxes = (row.profile.boxes ?? 0) - 1;
        row.profile.coins += t.coins;
        row.profile.crystals += t.gems;
      });
      return { items };
    },
    async buyShopItem(itemId) {
      if (!account) fail('unauthorized');
      await fakeNet();
      const item = getShopItem(itemId);
      if (!item) fail('server_error');
      const p = account!.profile;
      const got: ShopGot = { coins: 0, gems: 0, boxes: 0 };
      if (item!.kind === 'daily') {
        if (p.dailyClaimed === shopDay(Date.now())) fail('already_claimed');
        got.coins = item!.coins;
        got.gems = item!.gems;
        got.boxes = item!.boxes;
      } else {
        if (item!.kind === 'skin') {
          if (p.admin || p.skins?.includes(item!.skinId)) fail('already_owned');
          got.skin = item!.skinId;
        }
        if (!p.admin && p.crystals < item!.price) fail('not_enough_gems');
        if (item!.kind === 'box') got.boxes = item!.boxes;
        if (item!.kind === 'coins') got.coins = item!.coins;
      }
      save((row) => {
        const q = row.profile;
        if (item!.kind === 'daily') q.dailyClaimed = shopDay(Date.now());
        else if (!p.admin) q.crystals -= item!.price;
        q.coins += got.coins;
        q.crystals += got.gems;
        q.boxes = (q.boxes ?? 0) + got.boxes;
        if (got.skin) q.skins = [...(q.skins ?? []), got.skin];
      });
      return { got };
    },
    async claimPass(tier, track) {
      if (!account) fail('unauthorized');
      await fakeNet();
      const pass = normalizePass(account!.profile.pass);
      if (tier > tierOf(pass.xp)) fail('tier_locked');
      if (track === 'premium' && !pass.premium) fail('premium_required');
      const claimed = track === 'free' ? pass.claimedFree : pass.claimedPremium;
      if (claimed.includes(tier)) fail('already_claimed');
      claimed.push(tier);
      const rw = rewardOf(track, tier);
      const got: ShopGot = { coins: rw.coins ?? 0, gems: rw.gems ?? 0, boxes: rw.boxes ?? 0 };
      const p = account!.profile;
      if (rw.skin) {
        if (p.admin || p.skins?.includes(rw.skin)) got.gems += PASS_SKIN_REFUND;
        else got.skin = rw.skin;
      }
      save((row) => {
        const q = row.profile;
        q.pass = pass;
        q.coins += got.coins;
        q.crystals += got.gems;
        q.boxes = (q.boxes ?? 0) + got.boxes;
        if (got.skin) q.skins = [...(q.skins ?? []), got.skin];
      });
      return { got };
    },
    async buyPremiumPass() {
      if (!account) fail('unauthorized');
      await fakeNet();
      const p = account!.profile;
      const pass = normalizePass(p.pass);
      if (pass.premium) fail('already_premium');
      if (!p.admin && p.crystals < PREMIUM_PRICE) fail('not_enough_gems');
      pass.premium = true;
      save((row) => {
        row.profile.pass = pass;
        if (!p.admin) row.profile.crystals -= PREMIUM_PRICE;
      });
    },
    async adminGrant(target, coins, gems) {
      if (!account) fail('unauthorized');
      await fakeNet();
      if (!account!.profile.admin) fail('not_allowed');
      const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= ADMIN_GRANT_MAX;
      if (!ok(coins) || !ok(gems) || (!coins && !gems)) fail('server_error');
      const all = readUsers();
      const keys = target === '*' ? Object.keys(all) : Object.keys(all).filter((k) => all[k]!.profile.name.toLowerCase() === target.toLowerCase());
      if (!keys.length) fail('not_found');
      for (const k of keys) {
        all[k]!.profile.coins += coins;
        all[k]!.profile.crystals += gems;
      }
      writeUsers(all);
      const mine = all[account!.username.toLowerCase()];
      if (mine) {
        account = { ...account!, profile: present(mine) };
        emit();
      }
      return { count: keys.length, coins, gems };
    },
    patch(fn: (p: Profile) => void) {
      if (account) save((row) => fn(row.profile));
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
export const equipSkin = (fighterId: FighterId, skinId: string | null) => api.equipSkin(fighterId, skinId);
export const buySkin = (skinId: string) => api.buySkin(skinId);
export const setAvatar = (avatar: string | null) => api.setAvatar(avatar);
export const upgradeFighter = (fighterId: FighterId) => api.upgradeFighter(fighterId);
export const openBox = () => api.openBox();
export const buyShopItem = (itemId: string) => api.buyShopItem(itemId);
export const claimPass = (tier: number, track: PassTrack) => api.claimPass(tier, track);
export const buyPremiumPass = () => api.buyPremiumPass();
export const adminGrant = (target: string, coins: number, gems: number) => api.adminGrant(target, coins, gems);
/** 가짜 계정(?fakeonline)일 때만: 저장된 프로필을 고친다(가짜 길드 등) */
export const patchFakeProfile = (fn: (p: Profile) => void) => api.patch?.(fn);
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
    case 'not_owned':
      return '아직 없는 스킨이에요';
    case 'already_owned':
      return '이미 가진 스킨이에요';
    case 'shop_closed':
      return '스킨 상점은 아직 준비 중이에요';
    case 'not_enough_coins':
      return '코인이 부족해요';
    case 'not_enough_gems':
      return '다이아가 부족해요';
    case 'max_level':
      return '이미 최대 레벨이에요';
    case 'no_boxes':
      return '열 수 있는 상자가 없어요';
    case 'already_in_guild':
      return '이미 길드에 들어가 있어요';
    case 'not_in_guild':
      return '길드에 들어가 있지 않아요';
    case 'invalid_guild_name':
      return '길드 이름은 2~12자 영문·숫자·한글·_';
    case 'guild_taken':
      return '이미 있는 길드 이름이에요';
    case 'guild_full':
      return '길드 인원이 꽉 찼어요';
    case 'not_allowed':
      return '권한이 없어요';
    case 'already_requested':
      return '이미 가입 요청을 보냈어요';
    case 'rate_limited_chat':
      return '조금 천천히 보내 주세요';
    case 'already_claimed':
      return '이미 받았어요';
    case 'tier_locked':
      return '아직 열리지 않은 단계예요';
    case 'premium_required':
      return '프리미엄 패스가 필요해요';
    case 'already_premium':
      return '이미 프리미엄이에요';
    case 'not_friends':
      return '친구만 초대할 수 있어요';
    case 'party_full':
      return '파티가 꽉 찼어요(3명)';
    case 'not_in_party':
      return '파티에 들어가 있지 않아요';
    case 'already_in_party':
      return '이미 같은 파티예요';
    case 'server_error':
      return '서버에 문제가 생겼어요';
    default:
      return '서버에 연결할 수 없어요';
  }
}
