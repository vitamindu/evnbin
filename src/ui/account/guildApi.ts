import * as real from '../../net/guild';
import type { GuildChatMessage, GuildInfo, GuildJoinMode, GuildRole, GuildSummary } from '../../net/accountApi';
import { GUILD_CHAT_KEEP, GUILD_CHAT_MAX, GUILD_DESC_MAX, GUILD_MAX_MEMBERS, isValidGuildName } from '../../net/accountApi';
import { fakeNet, getAccount, isFakeAccounts, patchFakeProfile } from './accountApi';

export type { GuildChatMessage, GuildInfo, GuildJoinMode, GuildMember, GuildRequest, GuildRole, GuildSummary } from '../../net/accountApi';

/**
 * 길드 UI 입구. 진짜는 src/net/guild.ts. ?fakeonline이면 localStorage 가짜(화면 확인·E2E용).
 * 직급: 마스터 / 부마스터 / 멤버. 가입: 자유 / 승인 필요.
 */
interface GuildModule {
  mine(): Promise<GuildInfo | null>;
  create(name: string, description: string): Promise<unknown>;
  join(name: string): Promise<'joined' | 'requested'>;
  leave(): Promise<unknown>;
  answer(nickname: string, accept: boolean): Promise<unknown>;
  kick(nickname: string): Promise<unknown>;
  vice(nickname: string, on: boolean): Promise<unknown>;
  settings(opts: { joinMode?: GuildJoinMode; description?: string }): Promise<unknown>;
  chat(after: number): Promise<GuildChatMessage[]>;
  send(text: string, after: number): Promise<GuildChatMessage[]>;
  search(q: string): Promise<GuildSummary[]>;
}

const err = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

// ───────────── 가짜 ─────────────
type FakeGuild = {
  name: string;
  description: string;
  leader: string;
  vices: string[];
  members: string[];
  joinMode: GuildJoinMode;
  requests: string[];
  chat: GuildChatMessage[];
  next: number;
};
const KEY = 'fg.fakeguilds.v2';
const seed = (): FakeGuild[] => [
  {
    name: '벚꽃연합',
    description: '즐겜 길드, 누구나 환영',
    leader: '모찌',
    vices: ['픽셀'],
    members: ['모찌', '픽셀', '주노'],
    joinMode: 'open',
    requests: [],
    chat: [
      { id: 1, from: null, text: '모찌님이 길드를 만들었어요', at: Date.now() - 3_600_000 },
      { id: 2, from: '모찌', text: '오늘 저녁 9시에 크리스탈 러시 하실 분!', at: Date.now() - 600_000 },
    ],
    next: 3,
  },
  { name: 'NightOwls', description: '밤에 모여요', leader: '탄탄', vices: [], members: ['탄탄'], joinMode: 'approval', requests: [], chat: [], next: 1 },
];

function fakeModule(): GuildModule {
  const read = (): FakeGuild[] => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as FakeGuild[]) : seed();
    } catch {
      return seed();
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
  const roleOf = (g: FakeGuild, n: string): GuildRole => (g.leader === n ? 'master' : g.vices.includes(n) ? 'vice' : 'member');
  const sys = (g: FakeGuild, text: string, from: string | null = null) => {
    g.chat.push({ id: g.next++, from, text, at: Date.now() });
    if (g.chat.length > GUILD_CHAT_KEEP) g.chat.splice(0, g.chat.length - GUILD_CHAT_KEEP);
  };
  const rp = (n: string, i: number) => (n === getAccount()?.profile.name ? (getAccount()?.profile.rankPoints ?? 0) : 300 + i * 270);
  const info = (g: FakeGuild, nick: string): GuildInfo => {
    const myRole = roleOf(g, nick);
    return {
      name: g.name,
      description: g.description,
      leader: g.leader,
      maxMembers: GUILD_MAX_MEMBERS,
      joinMode: g.joinMode,
      myRole,
      members: g.members.map((m, i) => ({
        nickname: m,
        rankPoints: rp(m, i),
        role: roleOf(g, m),
        online: m === nick || i % 2 === 0,
        inRoom: false,
        ...(m === nick && getAccount()?.profile.avatar ? { avatar: getAccount()!.profile.avatar } : {}),
      })),
      requests: myRole === 'member' ? [] : g.requests.map((n, i) => ({ nickname: n, rankPoints: 200 + i * 150, at: Date.now() })),
    };
  };
  const setProfileGuild = (name: string | undefined) =>
    patchFakeProfile((p) => {
      if (name) p.guild = name;
      else delete p.guild;
    });
  const staff = (l: FakeGuild[]) => {
    const nick = me();
    const g = mineOf(l, nick);
    if (!g) err('not_in_guild');
    return { g: g!, nick, role: roleOf(g!, nick) };
  };
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
      const g: FakeGuild = { name: name.trim(), description: description.trim().slice(0, GUILD_DESC_MAX), leader: nick, vices: [], members: [nick], joinMode: 'approval', requests: [], chat: [], next: 1 };
      sys(g, `${nick}님이 길드를 만들었어요`);
      for (const o of l) o.requests = o.requests.filter((r) => r !== nick);
      l.push(g);
      write(l);
      setProfileGuild(g.name);
    },
    async join(name) {
      const nick = me();
      await fakeNet();
      const l = read();
      if (mineOf(l, nick)) err('already_in_guild');
      const g = l.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
      if (!g) err('not_found');
      if (g!.members.length >= GUILD_MAX_MEMBERS) err('guild_full');
      if (g!.joinMode === 'approval') {
        if (g!.requests.includes(nick)) err('already_requested');
        g!.requests.push(nick);
        write(l);
        return 'requested';
      }
      g!.members.push(nick);
      sys(g!, `${nick}님이 들어왔어요`);
      for (const o of l) o.requests = o.requests.filter((r) => r !== nick);
      write(l);
      setProfileGuild(g!.name);
      return 'joined';
    },
    async leave() {
      await fakeNet();
      let l = read();
      const { g, nick } = staff(l);
      g.members = g.members.filter((m) => m !== nick);
      g.vices = g.vices.filter((m) => m !== nick);
      if (!g.members.length) l = l.filter((x) => x !== g);
      else {
        sys(g, `${nick}님이 나갔어요`);
        if (g.leader === nick) {
          g.leader = g.vices[0] ?? g.members[0]!;
          g.vices = g.vices.filter((m) => m !== g.leader);
          sys(g, `${g.leader}님이 새 마스터가 됐어요`);
        }
      }
      write(l);
      setProfileGuild(undefined);
    },
    async answer(nickname, accept) {
      await fakeNet();
      const l = read();
      const { g, role } = staff(l);
      if (role === 'member') err('not_allowed');
      if (!g.requests.includes(nickname)) err('not_found');
      g.requests = g.requests.filter((r) => r !== nickname);
      if (accept) {
        if (g.members.length >= GUILD_MAX_MEMBERS) err('guild_full');
        g.members.push(nickname);
        sys(g, `${nickname}님이 들어왔어요`);
      }
      write(l);
    },
    async kick(nickname) {
      await fakeNet();
      const l = read();
      const { g, role, nick } = staff(l);
      if (role === 'member') err('not_allowed');
      if (!g.members.includes(nickname)) err('not_found');
      if (nickname === nick) err('self');
      if (nickname === g.leader) err('not_allowed');
      g.members = g.members.filter((m) => m !== nickname);
      g.vices = g.vices.filter((m) => m !== nickname);
      sys(g, `${nickname}님이 추방됐어요`);
      write(l);
    },
    async vice(nickname, on) {
      await fakeNet();
      const l = read();
      const { g, role, nick } = staff(l);
      if (role !== 'master') err('not_allowed');
      if (!g.members.includes(nickname) || nickname === nick) err('not_found');
      const was = g.vices.includes(nickname);
      if (on && !was) g.vices.push(nickname);
      if (!on && was) g.vices = g.vices.filter((m) => m !== nickname);
      if (on !== was) sys(g, on ? `${nickname}님이 부마스터가 됐어요` : `${nickname}님이 부마스터에서 내려왔어요`);
      write(l);
    },
    async settings(opts) {
      await fakeNet();
      const l = read();
      const { g, role } = staff(l);
      if (role !== 'master') err('not_allowed');
      if (opts.joinMode) g.joinMode = opts.joinMode;
      if (opts.description !== undefined) g.description = opts.description.trim().slice(0, GUILD_DESC_MAX);
      write(l);
    },
    async chat(after) {
      const l = read();
      const { g } = staff(l);
      await fakeNet();
      return g.chat.filter((c) => c.id > after);
    },
    async send(text, after) {
      await fakeNet();
      const l = read();
      const { g, nick } = staff(l);
      const t = Array.from(text.trim()).slice(0, GUILD_CHAT_MAX).join('');
      if (!t) err('bad_request');
      sys(g, t, nick);
      write(l);
      return g.chat.filter((c) => c.id > after);
    },
    async search(q) {
      const nick = me();
      await fakeNet();
      const n = q.trim().toLowerCase();
      return read()
        .filter((g) => !n || g.name.toLowerCase().includes(n))
        .map((g) => ({ name: g.name, description: g.description, members: g.members.length, leader: g.leader, joinMode: g.joinMode, ...(g.requests.includes(nick) ? { requested: true } : {}) }))
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
      answer: (n, a) => real.answerRequest(n, a),
      kick: (n) => real.kickMember(n),
      vice: (n, on) => real.setVice(n, on),
      settings: (o) => real.guildSettings(o),
      chat: (after) => real.guildChat(after),
      send: (t, after) => real.sendGuildChat(t, after),
      search: (q) => real.searchGuilds(q),
    };

export const myGuild = () => api.mine();
export const createGuild = (name: string, description = '') => api.create(name, description);
export const joinGuild = (name: string) => api.join(name);
export const leaveGuild = () => api.leave();
export const answerRequest = (nickname: string, accept: boolean) => api.answer(nickname, accept);
export const kickMember = (nickname: string) => api.kick(nickname);
export const setVice = (nickname: string, on: boolean) => api.vice(nickname, on);
export const guildSettings = (opts: { joinMode?: GuildJoinMode; description?: string }) => api.settings(opts);
export const guildChat = (after = 0) => api.chat(after);
export const sendGuildChat = (text: string, after = 0) => api.send(text, after);
export const searchGuilds = (q = '') => api.search(q);
