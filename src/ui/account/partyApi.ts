import * as real from '../../net/party';
import type { PartyResponse } from '../../net/accountApi';
import { fakeNet, getAccount, isFakeAccounts } from './accountApi';

export type { PartyInvite, PartyMember, PartyResponse } from '../../net/accountApi';

/**
 * 파티 UI 입구. 진짜는 src/net/party.ts. ?fakeonline이면 localStorage 가짜(화면 확인·E2E용):
 * 가짜 친구는 초대를 받으면 바로 수락한다. 받은 초대는 localStorage(fg.fakeparty.v1)의 invites에 넣어 흉내 낸다.
 */
interface PartyModule {
  get(): Promise<PartyResponse>;
  invite(nickname: string): Promise<PartyResponse>;
  accept(from: string): Promise<PartyResponse>;
  decline(from: string): Promise<PartyResponse>;
  leave(): Promise<PartyResponse>;
  kick(nickname: string): Promise<PartyResponse>;
}

const err = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

type FakeState = { leader: string | null; members: string[]; invites: string[]; roomCode: string | null };
const KEY = 'fg.fakeparty.v1';

function fakeModule(): PartyModule {
  const me = () => {
    const a = getAccount();
    if (!a) err('unauthorized');
    return a!.profile.name;
  };
  const read = (): FakeState => {
    try {
      return { leader: null, members: [], invites: [], roomCode: null, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<FakeState>) };
    } catch {
      return { leader: null, members: [], invites: [], roomCode: null };
    }
  };
  const write = (s: FakeState) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* 무시 */
    }
  };
  const view = (s: FakeState): PartyResponse => {
    const nick = me();
    const party =
      s.members.length > 1
        ? {
            leader: s.leader ?? nick,
            roomCode: s.roomCode,
            members: s.members.map((m, i) => ({
              nickname: m,
              fighterId: m === nick ? (getAccount()?.profile.selected ?? 'rivet') : (['volley', 'boulder', 'hinako'] as const)[i % 3]!,
              rankPoints: m === nick ? (getAccount()?.profile.rankPoints ?? 0) : 400 + i * 300,
              leader: m === (s.leader ?? nick),
              ...(m === nick && getAccount()?.profile.avatar ? { avatar: getAccount()!.profile.avatar } : {}),
            })),
          }
        : null;
    return { party, invites: s.invites.map((f) => ({ from: f, at: Date.now() })) };
  };
  return {
    async get() {
      me();
      await fakeNet();
      return view(read());
    },
    async invite(nickname) {
      const nick = me();
      await fakeNet();
      const s = read();
      if (nickname === nick) err('self');
      if (s.members.length === 0) {
        s.members = [nick];
        s.leader = nick;
      }
      if (s.members.includes(nickname)) err('already_in_party');
      if (s.members.length >= 3) err('party_full');
      s.members.push(nickname); // 가짜 친구는 바로 수락
      write(s);
      return view(s);
    },
    async accept(from) {
      const nick = me();
      await fakeNet();
      const s = read();
      if (!s.invites.includes(from)) err('not_found');
      s.invites = s.invites.filter((f) => f !== from);
      s.members = [from, nick];
      s.leader = from;
      write(s);
      return view(s);
    },
    async decline(from) {
      me();
      await fakeNet();
      const s = read();
      s.invites = s.invites.filter((f) => f !== from);
      write(s);
      return view(s);
    },
    async leave() {
      me();
      await fakeNet();
      const s = read();
      if (s.members.length < 2) err('not_in_party');
      const next: FakeState = { leader: null, members: [], invites: s.invites, roomCode: null };
      write(next);
      return view(next);
    },
    async kick(nickname) {
      const nick = me();
      await fakeNet();
      const s = read();
      if ((s.leader ?? nick) !== nick) err('not_allowed');
      s.members = s.members.filter((m) => m !== nickname);
      if (s.members.length < 2) {
        s.members = [];
        s.leader = null;
      }
      write(s);
      return view(s);
    },
  };
}

const api: PartyModule = isFakeAccounts()
  ? fakeModule()
  : {
      get: () => real.getParty(),
      invite: (n) => real.inviteToParty(n),
      accept: (f) => real.acceptParty(f),
      decline: (f) => real.declineParty(f),
      leave: () => real.leaveParty(),
      kick: (n) => real.kickFromParty(n),
    };

export const getParty = () => api.get();
export const inviteToParty = (nickname: string) => api.invite(nickname);
export const acceptParty = (from: string) => api.accept(from);
export const declineParty = (from: string) => api.decline(from);
export const leaveParty = () => api.leave();
export const kickFromParty = (nickname: string) => api.kick(nickname);
