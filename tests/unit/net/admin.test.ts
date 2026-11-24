import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { ADMIN_GRANT_MAX } from '../../../src/net/accountApi';

const dirs: string[] = [];
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-admin-'));
  dirs.push(d);
  return new AccountStore(d, Date.now, () => {});
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

describe('admin grant', () => {
  it('admin gives coins/gems to one player by nickname (any case) or to everyone', async () => {
    const s = mk();
    await s.signup('mineack991', 'secret1', '관리자');
    await s.signup('user1', 'secret1', 'Alpha');
    await s.signup('user2', 'secret1', '베타');
    const c1 = s.profile('user1')!.coins;
    const g1 = s.profile('user1')!.crystals;
    expect(s.adminGrant('mineack991', 'alpha', 1500, 30)).toEqual({ count: 1, coins: 1500, gems: 30 });
    expect(s.profile('user1')!.coins).toBe(c1 + 1500);
    expect(s.profile('user1')!.crystals).toBe(g1 + 30);
    expect(s.profile('user2')!.crystals).toBe(0);
    expect(s.adminGrant('mineack991', '*', 0, 5).count).toBe(3);
    expect(s.profile('user2')!.crystals).toBe(5);
    expect(s.profile('user1')!.crystals).toBe(g1 + 35);
  });

  it('only the admin; amounts must be whole numbers 0..max, not both zero; unknown nickname', async () => {
    const s = mk();
    await s.signup('mineack991', 'secret1', '관리자');
    await s.signup('user1', 'secret1', 'Alpha');
    expect(code(() => s.adminGrant('user1', 'Alpha', 100, 0))).toBe('not_allowed');
    expect(code(() => s.adminGrant('mineack991', 'Alpha', -1, 0))).toBe('bad_request');
    expect(code(() => s.adminGrant('mineack991', 'Alpha', 1.5, 0))).toBe('bad_request');
    expect(code(() => s.adminGrant('mineack991', 'Alpha', ADMIN_GRANT_MAX + 1, 0))).toBe('bad_request');
    expect(code(() => s.adminGrant('mineack991', 'Alpha', 0, 0))).toBe('bad_request');
    expect(code(() => s.adminGrant('mineack991', '없는사람', 10, 0))).toBe('not_found');
    expect(s.adminGrant('mineack991', 'Alpha', '250', undefined).coins).toBe(250);
  });
});
