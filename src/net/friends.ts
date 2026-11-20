/**
 * 친구 목록 클라이언트. Network 담당. 로그인한 상태에서만 쓴다(아니면 AccountError 'unauthorized').
 *
 * - listFriends(): 친구들(닉네임, 지금 접속 중인지, 랭크 점수, 방에 있는지). 접속 중인 친구가 먼저.
 * - addFriend(닉네임): 바로 서로 친구. 오류 not_found(그 닉네임 없음), already_friends, self.
 * - removeFriend(닉네임): 서로 삭제. 친구가 아니면 not_found.
 * 추가·삭제도 바뀐 목록을 돌려준다.
 */
import { authed } from './account';
import type { FriendInfo, FriendsResponse } from './accountApi';

export type { FriendInfo } from './accountApi';

export async function listFriends(): Promise<FriendInfo[]> {
  return (await authed<FriendsResponse>('GET', '/api/friends')).friends;
}

export async function addFriend(nickname: string): Promise<FriendInfo[]> {
  return (await authed<FriendsResponse>('POST', '/api/friends', { nickname: nickname.trim() })).friends;
}

export async function removeFriend(nickname: string): Promise<FriendInfo[]> {
  return (await authed<FriendsResponse>('DELETE', `/api/friends/${encodeURIComponent(nickname)}`)).friends;
}
