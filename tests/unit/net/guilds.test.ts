import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { GUILD_MAX_MEMBERS } from '../../../src/net/accountApi';

const dirs: string[] = [];
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-guild-'));
  dirs.push(d);
  return { dir: d, s: new AccountStore(d, Date.now, () => {}) };
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'ok';
};
const users = async (s: AccountStore, n: number) => {
  for (let i = 1; i <= n; i++) await s.signup(`user${i}`, 'secret1', `유저${i}`);
};

describe('guilds', () => {
  it('create → leader; name unique (case-insensitive); profile shows the guild', async () => {
    const { s } = mk();
    await users(s, 2);
    s.createGuild('user1', '불꽃길드', '같이 해요');
    const g = s.guildOf('user1')!;
    expect(g.name).toBe('불꽃길드');
    expect(g.leader).toBe('user1');
    expect(g.description).toBe('같이 해요');
    expect(s.profile('user1')!.guild).toBe('불꽃길드');
    expect(code(() => s.createGuild('user1', '다른길드'))).toBe('already_in_guild');
    expect(code(() => s.createGuild('user2', '불꽃길드'))).toBe('guild_taken');
    expect(code(() => s.createGuild('user2', 'a'))).toBe('invalid_guild_name');
    expect(code(() => s.createGuild('user2', '이름이너무너무너무길어요요'))).toBe('invalid_guild_name');
  });

  it('join by name (any case), not twice, full at the limit', async () => {
    const { s } = mk();
    await users(s, 3);
    s.createGuild('user1', 'Blaze');
    s.joinGuild('user2', 'blaze');
    expect(s.guildOf('user2')!.members).toEqual(['user1', 'user2']);
    expect(code(() => s.joinGuild('user2', 'Blaze'))).toBe('already_in_guild');
    expect(code(() => s.joinGuild('user3', '없는길드'))).toBe('not_found');
    const stored = (s as unknown as { data: { guilds: Record<string, { members: string[] }> } }).data.guilds['blaze']!;
    while (stored.members.length < GUILD_MAX_MEMBERS) stored.members.push(`ghost${stored.members.length}`);
    expect(code(() => s.joinGuild('user3', 'Blaze'))).toBe('guild_full');
  });

  it('leader leaves → oldest member leads; last one leaves → guild gone', async () => {
    const { s } = mk();
    await users(s, 3);
    s.createGuild('user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.joinGuild('user3', 'Blaze');
    s.leaveGuild('user1');
    expect(s.guildOf('user1')).toBeNull();
    expect(s.guildOf('user2')!.leader).toBe('user2');
    expect(s.profile('user1')!.guild).toBeUndefined();
    s.leaveGuild('user2');
    s.leaveGuild('user3');
    expect(s.searchGuilds('')).toEqual([]);
    expect(code(() => s.leaveGuild('user3'))).toBe('not_in_guild');
    s.createGuild('user3', 'Blaze');
    expect(s.guildOf('user3')!.leader).toBe('user3');
  });

  it('search by part of the name, biggest first', async () => {
    const { s } = mk();
    await users(s, 4);
    s.createGuild('user1', '불꽃길드');
    s.createGuild('user2', '얼음길드');
    s.joinGuild('user3', '얼음길드');
    s.createGuild('user4', 'Rush');
    expect(s.searchGuilds('').map((g) => g.name)).toEqual(['얼음길드', 'Rush', '불꽃길드']);
    expect(s.searchGuilds('길드').map((g) => [g.name, g.members, g.leader])).toEqual([
      ['얼음길드', 2, '유저2'],
      ['불꽃길드', 1, '유저1'],
    ]);
    expect(s.searchGuilds('rUs').map((g) => g.name)).toEqual(['Rush']);
  });

  it('survives a restart (saved to the file)', async () => {
    const { s, dir } = mk();
    await users(s, 2);
    s.createGuild('user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    const again = new AccountStore(dir, Date.now, () => {});
    expect(again.guildOf('user2')!.members).toEqual(['user1', 'user2']);
    expect(again.profile('user1')!.guild).toBe('Blaze');
  });
});
