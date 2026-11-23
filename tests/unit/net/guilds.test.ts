import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { GUILD_COST_COINS, GUILD_COST_GEMS, GUILD_MAX_MEMBERS } from '../../../src/net/accountApi';

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
/** 가입 + 길드 만들 돈(코인·다이아 넉넉히) */
const users = async (s: AccountStore, n: number) => {
  for (let i = 1; i <= n; i++) {
    await s.signup(`user${i}`, 'secret1', `유저${i}`);
    setMoney(s, `user${i}`, 100_000, 10_000);
  }
};
const setMoney = (s: AccountStore, key: string, coins: number, crystals: number) => {
  const p = (s as unknown as { data: { users: Record<string, { profile: { coins: number; crystals: number } }> } }).data.users[key]!.profile;
  p.coins = coins;
  p.crystals = crystals;
};

const openGuild = (s: AccountStore, master: string, name: string) => {
  s.createGuild(master, name);
  s.guildSettings(master, { joinMode: 'open' });
};

describe('guild creation cost', () => {
  it(`costs ${GUILD_COST_COINS} coins + ${GUILD_COST_GEMS} diamonds; checks both before charging`, async () => {
    const { s } = mk();
    await s.signup('poor1', 'secret1', '가난');
    setMoney(s, 'poor1', GUILD_COST_COINS - 1, 1000);
    expect(code(() => s.createGuild('poor1', 'Blaze'))).toBe('not_enough_coins');
    setMoney(s, 'poor1', 5000, GUILD_COST_GEMS - 1);
    expect(code(() => s.createGuild('poor1', 'Blaze'))).toBe('not_enough_gems');
    expect(s.profile('poor1')!.coins).toBe(5000);
    setMoney(s, 'poor1', 5000, 150);
    s.createGuild('poor1', 'Blaze');
    expect(s.profile('poor1')!.coins).toBe(5000 - GUILD_COST_COINS);
    expect(s.profile('poor1')!.crystals).toBe(150 - GUILD_COST_GEMS);
  });
  it('a taken name costs nothing', async () => {
    const { s } = mk();
    await users(s, 2);
    s.createGuild('user1', 'Blaze');
    expect(code(() => s.createGuild('user2', 'blaze'))).toBe('guild_taken');
    expect(s.profile('user2')!.coins).toBe(100_000);
  });
  it('admin creates for free', async () => {
    const { s } = mk();
    await s.signup('mineack991', 'secret1', '관리자');
    setMoney(s, 'mineack991', 0, 0);
    s.createGuild('mineack991', 'Admins');
    expect(s.profile('mineack991')!.coins).toBe(0);
  });
});

describe('guilds', () => {
  it('create → master; name unique (case-insensitive); profile shows the guild; starts as approval-only', async () => {
    const { s } = mk();
    await users(s, 2);
    s.createGuild('user1', '불꽃길드', '같이 해요');
    const g = s.guildOf('user1')!;
    expect(g.name).toBe('불꽃길드');
    expect(g.leader).toBe('user1');
    expect(g.joinMode).toBe('approval');
    expect(s.guildRole('user1')).toBe('master');
    expect(s.profile('user1')!.guild).toBe('불꽃길드');
    expect(code(() => s.createGuild('user1', '다른길드'))).toBe('already_in_guild');
    expect(code(() => s.createGuild('user2', '불꽃길드'))).toBe('guild_taken');
    expect(code(() => s.createGuild('user2', 'a'))).toBe('invalid_guild_name');
    expect(code(() => s.createGuild('user2', '이름이너무너무너무길어요요'))).toBe('invalid_guild_name');
  });

  it('open guild: join by name at once; full at the limit', async () => {
    const { s } = mk();
    await users(s, 3);
    openGuild(s, 'user1', 'Blaze');
    expect(s.joinGuild('user2', 'blaze')).toBe('joined');
    expect(s.guildOf('user2')!.members).toEqual(['user1', 'user2']);
    expect(code(() => s.joinGuild('user2', 'Blaze'))).toBe('already_in_guild');
    expect(code(() => s.joinGuild('user3', '없는길드'))).toBe('not_found');
    const stored = (s as unknown as { data: { guilds: Record<string, { members: string[] }> } }).data.guilds['blaze']!;
    while (stored.members.length < GUILD_MAX_MEMBERS) stored.members.push(`ghost${stored.members.length}`);
    expect(code(() => s.joinGuild('user3', 'Blaze'))).toBe('guild_full');
  });

  it('approval guild: request → master/vice accept or reject; members cannot answer', async () => {
    const { s } = mk();
    await users(s, 5);
    s.createGuild('user1', 'Blaze');
    expect(s.joinGuild('user2', 'Blaze')).toBe('requested');
    expect(s.guildOf('user2')).toBeNull();
    expect(s.requestedGuilds('user2')).toEqual(['Blaze']);
    expect(code(() => s.joinGuild('user2', 'Blaze'))).toBe('already_requested');
    s.answerRequest('user1', '유저2', true);
    expect(s.guildRole('user2')).toBe('member');
    expect(s.requestedGuilds('user2')).toEqual([]);
    // 멤버는 승인 못 함, 부마스터는 가능
    s.joinGuild('user3', 'Blaze');
    expect(code(() => s.answerRequest('user2', '유저3', true))).toBe('not_allowed');
    s.setVice('user1', '유저2', true);
    s.answerRequest('user2', '유저3', false);
    expect(s.guildOf('user3')).toBeNull();
    expect(s.guildOf('user1')!.requests).toEqual([]);
    expect(code(() => s.answerRequest('user1', '유저3', true))).toBe('not_found');
    // 요청한 사람이 다른 길드에 먼저 들어가면 요청이 사라진다
    s.joinGuild('user4', 'Blaze');
    s.createGuild('user4', 'Other');
    expect(s.guildOf('user1')!.requests).toEqual([]);
  });

  it('master appoints/dismisses vice; only master can', async () => {
    const { s } = mk();
    await users(s, 3);
    openGuild(s, 'user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.joinGuild('user3', 'Blaze');
    s.setVice('user1', '유저2', true);
    expect(s.guildRole('user2')).toBe('vice');
    expect(code(() => s.setVice('user2', '유저3', true))).toBe('not_allowed');
    expect(code(() => s.setVice('user3', '유저2', false))).toBe('not_allowed');
    s.setVice('user1', '유저2', false);
    expect(s.guildRole('user2')).toBe('member');
    expect(code(() => s.setVice('user1', '유저1', true))).toBe('not_found');
  });

  it('kick: master kicks anyone; vice kicks anyone but the master; members cannot', async () => {
    const { s } = mk();
    await users(s, 5);
    openGuild(s, 'user1', 'Blaze');
    for (const u of ['user2', 'user3', 'user4', 'user5']) s.joinGuild(u, 'Blaze');
    s.setVice('user1', '유저2', true);
    s.setVice('user1', '유저3', true);
    expect(code(() => s.kickMember('user4', '유저5'))).toBe('not_allowed');
    expect(code(() => s.kickMember('user2', '유저1'))).toBe('not_allowed');
    expect(code(() => s.kickMember('user2', '유저2'))).toBe('self');
    s.kickMember('user2', '유저3'); // 부마스터가 다른 부마스터도
    expect(s.guildOf('user3')).toBeNull();
    expect(s.profile('user3')!.guild).toBeUndefined();
    s.kickMember('user2', '유저4');
    s.kickMember('user1', '유저2'); // 마스터는 부마스터도
    expect(s.guildOf('user1')!.members).toEqual(['user1', 'user5']);
    expect(s.guildOf('user1')!.vices).toEqual([]);
  });

  it('master leaves → first vice becomes master (else oldest member); last one leaves → guild gone', async () => {
    const { s } = mk();
    await users(s, 3);
    openGuild(s, 'user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.joinGuild('user3', 'Blaze');
    s.setVice('user1', '유저3', true);
    s.leaveGuild('user1');
    expect(s.guildRole('user3')).toBe('master');
    expect(s.guildOf('user3')!.vices).toEqual([]);
    s.leaveGuild('user3');
    expect(s.guildRole('user2')).toBe('master');
    s.leaveGuild('user2');
    expect(s.searchGuilds('')).toEqual([]);
    expect(code(() => s.leaveGuild('user2'))).toBe('not_in_guild');
  });

  it('settings are master-only', async () => {
    const { s } = mk();
    await users(s, 2);
    openGuild(s, 'user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.setVice('user1', '유저2', true);
    expect(code(() => s.guildSettings('user2', { joinMode: 'approval' }))).toBe('not_allowed');
    s.guildSettings('user1', { joinMode: 'approval', description: '  새 소개  ' });
    expect(s.guildOf('user1')!.joinMode).toBe('approval');
    expect(s.guildOf('user1')!.description).toBe('새 소개');
    expect(code(() => s.guildSettings('user1', { joinMode: 'whatever' }))).toBe('bad_request');
  });

  it('chat: members only, trimmed, 100 chars, 1 per second, system notices', async () => {
    let now = 1_000_000;
    const d = mkdtempSync(join(tmpdir(), 'fg-guild-'));
    dirs.push(d);
    const s = new AccountStore(d, () => now, () => {});
    await users(s, 3);
    openGuild(s, 'user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.guildChat('user1', '  안녕하세요  ');
    expect(code(() => s.guildChat('user1', '또'))).toBe('rate_limited_chat');
    now += 1000;
    s.guildChat('user1', 'x'.repeat(150));
    expect(code(() => s.guildChat('user1', '   '))).toBe('bad_request');
    expect(code(() => s.guildChat('user3', '밖에서'))).toBe('not_in_guild');
    const chat = s.guildOf('user2')!.chat;
    const mine = chat.filter((c) => c.from === 'user1').map((c) => c.text);
    expect(mine).toEqual(['안녕하세요', 'x'.repeat(100)]);
    expect(chat.filter((c) => c.from === null).map((c) => c.text)).toEqual(['유저1님이 길드를 만들었어요', '유저2님이 들어왔어요']);
    expect(chat.map((c) => c.id)).toEqual([...chat.map((c) => c.id)].sort((a, b) => a - b));
  });

  it('search by part of the name, biggest first', async () => {
    const { s } = mk();
    await users(s, 4);
    s.createGuild('user1', '불꽃길드');
    openGuild(s, 'user2', '얼음길드');
    s.joinGuild('user3', '얼음길드');
    s.createGuild('user4', 'Rush');
    expect(s.searchGuilds('').map((g) => g.name)).toEqual(['얼음길드', 'Rush', '불꽃길드']);
    expect(s.searchGuilds('길드').map((g) => [g.name, g.members, g.leader, g.joinMode])).toEqual([
      ['얼음길드', 2, '유저2', 'open'],
      ['불꽃길드', 1, '유저1', 'approval'],
    ]);
  });

  it('survives a restart (saved to the file)', async () => {
    const { s, dir } = mk();
    await users(s, 2);
    openGuild(s, 'user1', 'Blaze');
    s.joinGuild('user2', 'Blaze');
    s.setVice('user1', '유저2', true);
    const again = new AccountStore(dir, Date.now, () => {});
    expect(again.guildOf('user2')!.members).toEqual(['user1', 'user2']);
    expect(again.guildRole('user2')).toBe('vice');
    expect(again.profile('user1')!.guild).toBe('Blaze');
  });
});
