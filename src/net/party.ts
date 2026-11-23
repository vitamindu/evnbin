/** 파티 클라이언트(로그인 필요). 서버는 메모리에 파티를 둔다(server/party.ts). */
import { authed } from './account';
import type { PartyResponse } from './accountApi';

export type { PartyInvite, PartyMember, PartyResponse } from './accountApi';

export const getParty = () => authed<PartyResponse>('GET', '/api/party');
export const inviteToParty = (nickname: string) => authed<PartyResponse>('POST', '/api/party/invite', { nickname });
export const acceptParty = (from: string) => authed<PartyResponse>('POST', '/api/party/accept', { from });
export const declineParty = (from: string) => authed<PartyResponse>('POST', '/api/party/decline', { from });
export const leaveParty = () => authed<PartyResponse>('POST', '/api/party/leave');
export const kickFromParty = (nickname: string) => authed<PartyResponse>('POST', '/api/party/kick', { nickname });
