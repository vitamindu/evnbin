/**
 * 길드 클라이언트. 로그인한 상태에서만 쓴다(아니면 AccountError 'unauthorized').
 * 만들기·가입·탈퇴 뒤에는 프로필(길드 이름)을 다시 읽는다.
 */
import { authed, refresh } from './account';
import type { GuildInfo, GuildResponse, GuildSummary } from './accountApi';

export type { GuildInfo, GuildMember, GuildSummary } from './accountApi';

export async function myGuild(): Promise<GuildInfo | null> {
  return (await authed<GuildResponse>('GET', '/api/guild')).guild;
}

export async function createGuild(name: string, description = ''): Promise<GuildInfo | null> {
  const r = await authed<GuildResponse>('POST', '/api/guild', { name: name.trim(), description });
  await refresh();
  return r.guild;
}

export async function joinGuild(name: string): Promise<GuildInfo | null> {
  const r = await authed<GuildResponse>('POST', '/api/guild/join', { name: name.trim() });
  await refresh();
  return r.guild;
}

export async function leaveGuild(): Promise<void> {
  await authed<GuildResponse>('POST', '/api/guild/leave');
  await refresh();
}

export async function searchGuilds(q = ''): Promise<GuildSummary[]> {
  return (await authed<{ guilds: GuildSummary[] }>('GET', `/api/guilds?q=${encodeURIComponent(q.trim())}`)).guilds;
}
