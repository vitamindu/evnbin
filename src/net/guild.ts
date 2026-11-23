/**
 * 길드 클라이언트. 로그인한 상태에서만 쓴다(아니면 AccountError 'unauthorized').
 * 만들기·가입·탈퇴·추방 뒤에는 프로필(길드 이름)을 다시 읽는다.
 */
import { authed, refresh } from './account';
import type { GuildChatMessage, GuildChatResponse, GuildInfo, GuildJoinMode, GuildResponse, GuildSummary } from './accountApi';

export type { GuildChatMessage, GuildInfo, GuildJoinMode, GuildMember, GuildRequest, GuildRole, GuildSummary } from './accountApi';

export async function myGuild(): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('GET', '/api/guild')).guild;
}

export async function createGuild(name: string, description = ''): Promise<GuildInfo | null> {
  const r = await authed<GuildResponse>('POST', '/api/guild', { name: name.trim(), description });
  await refresh();
  return r.guild;
}

/** 'joined' = 바로 들어감, 'requested' = 가입 요청만 남김(승인 필요 길드) */
export async function joinGuild(name: string): Promise<'joined' | 'requested'> {
  const r = await authed<GuildResponse>('POST', '/api/guild/join', { name: name.trim() });
  if (r.guild) await refresh();
  return r.guild ? 'joined' : 'requested';
}

export async function leaveGuild(): Promise<void> {
  await authed<GuildResponse>('POST', '/api/guild/leave');
  await refresh();
}

export async function answerRequest(nickname: string, accept: boolean): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('POST', '/api/guild/answer', { nickname, accept })).guild;
}

export async function kickMember(nickname: string): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('POST', '/api/guild/kick', { nickname })).guild;
}

export async function setVice(nickname: string, on: boolean): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('POST', '/api/guild/vice', { nickname, on })).guild;
}

export async function guildSettings(opts: { joinMode?: GuildJoinMode; description?: string }): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('PUT', '/api/guild/settings', opts)).guild;
}

export async function guildChat(after = 0): Promise<GuildChatMessage[]> {
  return (await authed<GuildChatResponse>('GET', `/api/guild/chat?after=${after}`)).messages;
}

export async function sendGuildChat(text: string, after = 0): Promise<GuildChatMessage[]> {
  return (await authed<GuildChatResponse>('POST', `/api/guild/chat?after=${after}`, { text })).messages;
}

export async function searchGuilds(q = ''): Promise<GuildSummary[]> {
  return (await authed<{ guilds: GuildSummary[] }>('GET', `/api/guilds?q=${encodeURIComponent(q.trim())}`)).guilds;
}
