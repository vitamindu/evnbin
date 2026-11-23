import * as real from '../../net/friends';
import { fakeNet, getAccount, isFakeAccounts } from './accountApi';

/**
 * 친구 목록 UI 입구. 진짜는 Network 담당의 src/net/friends.ts(listFriends/addFriend/removeFriend).
 * 주소에 ?fakeonline이면 localStorage 가짜(화면 확인·E2E용).
 */
export interface Friend {
  nickname: string;
  online: boolean;
  rankPoints: number;
  /** 지금 게임 방(또는 경기)에 있는가 */
  inRoom: boolean;
  /** 프로필 사진(data URL) */
  avatar?: string;
}

interface FriendsModule {
  list(): Promise<Friend[]>;
  add(nickname: string): Promise<unknown>;
  remove(nickname: string): Promise<unknown>;
}


const KEY = 'fg.fakefriends.v1';
const SEED: Friend[] = [
  { nickname: '모찌', online: true, rankPoints: 850, inRoom: true },
  { nickname: '픽셀', online: true, rankPoints: 1320, inRoom: false },
  { nickname: '주노', online: false, rankPoints: 420, inRoom: false },
  { nickname: '탄탄', online: false, rankPoints: 2140, inRoom: false },
];
const err = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

function fakeModule(): FriendsModule {
  const key = () => `${KEY}:${getAccount()?.username ?? ''}`;
  const read = (): Friend[] => {
    try {
      const raw = localStorage.getItem(key());
      return raw ? (JSON.parse(raw) as Friend[]) : SEED.map((f) => ({ ...f }));
    } catch {
      return SEED.map((f) => ({ ...f }));
    }
  };
  const write = (l: Friend[]) => {
    try {
      localStorage.setItem(key(), JSON.stringify(l));
    } catch {
      /* 무시 */
    }
  };
  return {
    async list() {
      if (!getAccount()) err('unauthorized');
      await fakeNet();
      return read();
    },
    async add(nickname) {
      const me = getAccount();
      if (!me) err('unauthorized');
      await fakeNet();
      const n = nickname.trim();
      if (n.toLowerCase() === me!.profile.name.toLowerCase()) err('self');
      // 가짜 서버: '없는'으로 시작하거나 2자 미만이면 없는 사람
      if (n.length < 2 || n.startsWith('없는')) err('not_found');
      const l = read();
      if (l.some((f) => f.nickname.toLowerCase() === n.toLowerCase())) err('already_friends');
      l.push({ nickname: n, online: Math.random() < 0.5, rankPoints: Math.floor(Math.random() * 1600), inRoom: false });
      write(l);
    },
    async remove(nickname) {
      if (!getAccount()) err('unauthorized');
      await fakeNet();
      write(read().filter((f) => f.nickname !== nickname));
    },
  };
}

const api: FriendsModule = isFakeAccounts()
  ? fakeModule()
  : { list: () => real.listFriends(), add: (n) => real.addFriend(n), remove: (n) => real.removeFriend(n) };

export const listFriends = () => api.list();
export const addFriend = (nickname: string) => api.add(nickname);
export const removeFriend = (nickname: string) => api.remove(nickname);
