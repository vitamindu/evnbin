import * as real from '../../net/guild';
import type { GuildInfo, GuildSummary } from '../../net/accountApi';
import { GUILD_MAX_MEMBERS, isValidGuildName } from '../../net/accountApi';
import { fakeNet, getAccount, isFakeAccounts, patchFakeProfile } from './accountApi';

export type { GuildInfo, GuildMember, GuildSummary } from '../../net/accountApi';

/**
 * 길드 UI 입구. 진짜는 src/net/guild.ts. ?fakeonline이면 localStorage 가짜(화면 확인·E2E용).
 */
interface GuildModule {
  mine(): Promise<GuildInfo | null>;
  create(name: string, description: string): Promise<unknown>;
  join(name: string): Promise<unknown>;
  leave(): Promise<unknown>;
  search(q: string): Promise<GuildSummary[]>;
}

const err = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

// ───────────── 가짜 ─────────────
type FakeGuild = { name: string; description: string; leader: string; members: string[] };
const KEY = 'fg.fakeguilds.v1';
const SEED: FakeGuild[] = [
  { name: '벚꽃연합', description: '즐겜 길드, 누구나 환영', leader: '모찌', members: ['모찌', '픽셀', '주노'] },
  { name: 'NightOwls', description: '밤에 모여요', leader: '탄탄', members: ['탄탄'] },
];

function fakeModule(): GuildModule {
  const read = (): FakeGuild[] => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as FakeGuild[]) : SEED.map((g) => ({ ...g, members: [...g.members] }));
    } catch {
      return SEED.map((g) => ({ ...g, members: [...g.members] }));
    }
  };
  const write = (l: FakeGuild[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {
      /* 무시 */
    }
  };
  const me = () => {
    const a = getAccount();
    if (!a) err('unauthorized');
    return a!.profile.name;
  };
  const mineOf = (l: FakeGuild[], nick: string) => l.find((g) => g.members.includes(nick));
  const info = (g: FakeGuild, nick: string): GuildInfo => ({
    name: g.name,
    description: g.description,
    leader: g.leader,
    maxMembers: GUILD_MAX_MEMBERS,
    members: g.members.map((m, i) => ({
      nickname: m,
      rankPoints: m === nick ? (getAccount()?.profile.rankPoints ?? 0) : 300 + i * 270,
      leader: m === g.leader,
      online: m === nick || i % 2 === 0,
      inRoom: false,
      ...(m === nick && getAccount()?.profile.avatar ? { avatar: getAccount()!.profile.avatar } : {}),
    })),
  });
  const setProfileGuild = (name: string | undefined) =>
    patchFakeProfile((p) => {
      if (name) p.guild = name;
      else delete p.guild;
    });
  return {
    async mine() {
      const nick = me();
      await fakeNet();
      const g = mineOf(read(), nick);
      return g ? info(g, nick) : null;
    },
    async create(name, description) {
      const nick = me();
      await fakeNet();
      const l = read();
      if (mineOf(l, nick)) err('already_in_guild');
      if (!isValidGuildName(name)) err('invalid_guild_name');
      if (l.some((g) => g.name.toLowerCase() === name.trim().toLowerCase())) err('guild_taken');
      l.push({ name: name.trim(), description: description.trim(), leader: nick, members: [nick] });
      write(l);
      setProfileGuild(name.trim());
    },
    async join(name) {
      const nick = me();
      await fakeNet();
      const l = read();
      if (mineOf(l, nick)) err('already_in_guild');
      const g = l.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
      if (!g) err('not_found');
      if (g!.members.length >= GUILD_MAX_MEMBERS) err('guild_full');
      g!.members.push(nick);
      write(l);
      setProfileGuild(g!.name);
    },
    async leave() {
      const nick = me();
      await fakeNet();
      let l = read();
      const g = mineOf(l, nick);
      if (!g) err('not_in_guild');
      g!.members = g!.members.filter((m) => m !== nick);
      if (!g!.members.length) l = l.filter((x) => x !== g);
      else if (g!.leader === nick) g!.leader = g!.members[0]!;
      write(l);
      setProfileGuild(undefined);
    },
    async search(q) {
      me();
      await fakeNet();
      const n = q.trim().toLowerCase();
      return read()
        .filter((g) => !n || g.name.toLowerCase().includes(n))
        .map((g) => ({ name: g.name, description: g.description, members: g.members.length, leader: g.leader }))
        .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
    },
  };
}

const api: GuildModule = isFakeAccounts()
  ? fakeModule()
  : {
      mine: () => real.myGuild(),
      create: (n, d) => real.createGuild(n, d),
      join: (n) => real.joinGuild(n),
      leave: () => real.leaveGuild(),
      search: (q) => real.searchGuilds(q),
    };

export const myGuild = () => api.mine();
export const createGuild = (name: string, description = '') => api.create(name, description);
export const joinGuild = (name: string) => api.join(name);
export const leaveGuild = () => api.leave();
export const searchGuilds = (q = '') => api.search(q);
