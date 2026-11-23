import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { PASS_SKIN_REFUND, PASS_TIERS, PASS_XP, PREMIUM_PRICE, XP_PER_TIER, freeReward, normalizePass, premiumReward, tierOf } from '../../../src/data/pass';

const dirs: string[] = [];
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-pass-'));
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
const raw = (s: AccountStore, k: string) => (s as unknown as { data: { users: Record<string, { profile: { crystals: number; pass?: unknown } }> } }).data.users[k]!.profile;

describe('season pass', () => {
  it('table: 30 tiers, every tier has a reward on both tracks, premium ends with a skin', () => {
    for (let t = 1; t <= PASS_TIERS; t++) {
      expect(Object.keys(freeReward(t)).length).toBeGreaterThan(0);
      expect(Object.keys(premiumReward(t)).length).toBeGreaterThan(0);
    }
    expect(premiumReward(PASS_TIERS).skin).toBe('hinako_sakura');
    expect(tierOf(0)).toBe(0);
    expect(tierOf(XP_PER_TIER * 3 + 50)).toBe(3);
    expect(tierOf(XP_PER_TIER * 99)).toBe(PASS_TIERS);
  });

  it('online matches give pass XP (win/draw/loss)', async () => {
    const s = mk();
    await s.signup('pass1', 'secret1', '패스');
    s.applyMatchResults([{ account: 'pass1', fighterId: 'rivet', outcome: 'win' }]);
    s.applyMatchResults([{ account: 'pass1', fighterId: 'rivet', outcome: 'draw' }]);
    s.applyMatchResults([{ account: 'pass1', fighterId: 'rivet', outcome: 'loss' }]);
    expect(normalizePass(s.profile('pass1')!.pass).xp).toBe(PASS_XP.win + PASS_XP.draw + PASS_XP.loss);
  });

  it('claim only reached tiers, once; premium track needs premium', async () => {
    const s = mk();
    await s.signup('pass2', 'secret1', '패스둘');
    raw(s, 'pass2').pass = { ...normalizePass(undefined), xp: XP_PER_TIER * 5 };
    expect(code(() => s.claimPass('pass2', 6, 'free'))).toBe('tier_locked');
    const c0 = s.profile('pass2')!.coins;
    const r = s.claimPass('pass2', 1, 'free');
    expect(r.got.coins).toBe(freeReward(1).coins);
    expect(r.profile.coins).toBe(c0 + r.got.coins);
    expect(code(() => s.claimPass('pass2', 1, 'free'))).toBe('already_claimed');
    expect(s.claimPass('pass2', 5, 'free').profile.boxes).toBe(1);
    expect(code(() => s.claimPass('pass2', 1, 'premium'))).toBe('premium_required');
    expect(code(() => s.claimPass('pass2', 0, 'free'))).toBe('bad_request');
    expect(code(() => s.claimPass('pass2', 1, 'gold'))).toBe('bad_request');
  });

  it('premium costs diamonds once; then premium rewards (also past tiers)', async () => {
    const s = mk();
    await s.signup('pass3', 'secret1', '패스셋');
    raw(s, 'pass3').pass = { ...normalizePass(undefined), xp: XP_PER_TIER * 2 };
    raw(s, 'pass3').crystals = PREMIUM_PRICE - 1;
    expect(code(() => s.buyPremiumPass('pass3'))).toBe('not_enough_gems');
    raw(s, 'pass3').crystals = PREMIUM_PRICE;
    expect(normalizePass(s.buyPremiumPass('pass3').pass).premium).toBe(true);
    expect(s.profile('pass3')!.crystals).toBe(0);
    expect(code(() => s.buyPremiumPass('pass3'))).toBe('already_premium');
    expect(s.claimPass('pass3', 2, 'premium').got.gems).toBe(premiumReward(2).gems);
  });

  it('last premium tier gives the skin, or diamonds if already owned', async () => {
    const s = mk();
    await s.signup('pass4', 'secret1', '패스넷');
    raw(s, 'pass4').pass = { ...normalizePass(undefined), xp: XP_PER_TIER * PASS_TIERS, premium: true };
    expect(s.claimPass('pass4', PASS_TIERS, 'premium').profile.skins).toEqual(['hinako_sakura']);
    await s.signup('mineack991', 'secret1', '관리자');
    raw(s, 'mineack991').pass = { ...normalizePass(undefined), xp: XP_PER_TIER * PASS_TIERS, premium: true };
    expect(s.claimPass('mineack991', PASS_TIERS, 'premium').got.gems).toBe(PASS_SKIN_REFUND);
  });
});
