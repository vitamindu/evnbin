import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { RANKING_SIZE } from '../../../src/net/accountApi';

const dirs: string[] = [];
let now = 1_000_000;
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-rank-'));
  dirs.push(d);
  return new AccountStore(d, () => now++, () => {});
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const setRp = (s: AccountStore, k: string, rp: number) => {
  (s as unknown as { data: { users: Record<string, { profile: { rankPoints: number } }> } }).data.users[k]!.profile.rankPoints = rp;
};

describe('ranking', () => {
  it('everyone on the server by rank points; ties share a rank; earlier signup first; guild shown', async () => {
    const s = mk();
    for (const [id, rp] of [['aaa1', 300], ['bbb2', 520], ['ccc3', 300], ['ddd4', 0], ['eee5', 701]] as const) {
      await s.signup(id, 'secret1', `닉${id}`);
      setRp(s, id, rp);
    }
    (s as unknown as { data: { users: Record<string, { profile: { coins: number; crystals: number } }> } }).data.users['bbb2']!.profile.coins = 5000;
    (s as unknown as { data: { users: Record<string, { profile: { coins: number; crystals: number } }> } }).data.users['bbb2']!.profile.crystals = 500;
    s.createGuild('bbb2', 'Blaze');
    const r = s.ranking('ccc3');
    expect(r.total).toBe(5);
    expect(r.top.map((e) => [e.rank, e.nickname, e.rankPoints])).toEqual([
      [1, '닉eee5', 701],
      [2, '닉bbb2', 520],
      [3, '닉aaa1', 300],
      [3, '닉ccc3', 300],
      [5, '닉ddd4', 0],
    ]);
    expect(r.top[1]!.guild).toBe('Blaze');
    expect(r.me).toMatchObject({ rank: 3, nickname: '닉ccc3' });
  });

  it(`shows the top ${RANKING_SIZE} and still returns my own row below that`, async () => {
    const s = mk();
    for (let i = 0; i < RANKING_SIZE + 3; i++) {
      await s.signup(`ppp${i}`, 'secret1', `pp${i}`);
      setRp(s, `ppp${i}`, 1000 - i);
    }
    const r = s.ranking(`ppp${RANKING_SIZE + 2}`);
    expect(r.top).toHaveLength(RANKING_SIZE);
    expect(r.me).toMatchObject({ rank: RANKING_SIZE + 3 });
    expect(s.ranking(null).me).toBeNull();
  });
});
