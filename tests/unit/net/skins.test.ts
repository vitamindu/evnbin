import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { SKINS, SKIN_SHOP_OPEN } from '../../../src/data/skins';
import { MAX_POWER, upgradeCost } from '../../../src/data/power';

const dirs: string[] = [];
const store = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-skin-'));
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

describe('skins and admin', () => {
  it('mineack991 is admin (any case) and owns every skin', async () => {
    const s = store();
    const r = await s.signup('MineAck991', 'secret1', '관리자');
    expect(r.profile.admin).toBe(true);
    expect(r.profile.skins).toEqual(SKINS.map((k) => k.id));
    const key = 'mineack991';
    const p = s.equipSkin(key, 'hinako', 'hinako_sakura');
    expect(p.skinSel?.hinako).toBe('hinako_sakura');
    expect(s.skinFor(key, 'hinako')).toBe('hinako_sakura');
    expect(s.equipSkin(key, 'hinako', null).skinSel?.hinako).toBeUndefined();
  });

  it('normal accounts cannot wear or (while the shop is closed) buy skins', async () => {
    const s = store();
    const r = await s.signup('normal1', 'secret1', '보통');
    expect(r.profile.admin).toBeUndefined();
    expect(code(() => s.equipSkin('normal1', 'hinako', 'hinako_sakura'))).toBe('not_owned');
    expect(code(() => s.buySkin('normal1', 'hinako_sakura'))).toBe(SKIN_SHOP_OPEN ? 'not_enough_gems' : 'shop_closed');
    expect(s.skinFor('normal1', 'hinako')).toBeUndefined();
  });

  it('rejects a skin on the wrong fighter or an unknown skin', async () => {
    const s = store();
    await s.signup('mineack991', 'secret1', '관리자');
    expect(code(() => s.equipSkin('mineack991', 'rivet', 'hinako_sakura'))).toBe('bad_request');
    expect(code(() => s.equipSkin('mineack991', 'hinako', 'nope'))).toBe('bad_request');
  });
});

describe('buying skins', () => {
  it.runIf(SKIN_SHOP_OPEN)('buys with diamonds once (coins untouched), then can wear it', async () => {
    const s = store();
    await s.signup('buyer1', 'secret1', '구매자');
    (s as unknown as { data: { users: Record<string, { profile: { crystals: number } }> } }).data.users['buyer1']!.profile.crystals = 130;
    const coins = s.profile('buyer1')!.coins;
    const p = s.buySkin('buyer1', 'hinako_sakura');
    expect(p.crystals).toBe(30);
    expect(p.coins).toBe(coins);
    expect(p.skins).toEqual(['hinako_sakura']);
    expect(code(() => s.buySkin('buyer1', 'hinako_sakura'))).toBe('already_owned');
    expect(s.equipSkin('buyer1', 'hinako', 'hinako_sakura').skinSel?.hinako).toBe('hinako_sakura');
  });
});

describe('profile photo', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  it('stores a small image data URL and clears it with null', async () => {
    const s = store();
    await s.signup('photo1', 'secret1', '사진');
    expect(s.setAvatar('photo1', PNG).avatar).toBe(PNG);
    expect(s.profile('photo1')?.avatar).toBe(PNG);
    expect(s.setAvatar('photo1', null).avatar).toBeUndefined();
  });
  it('rejects non-images, other schemes and oversized data', async () => {
    const s = store();
    await s.signup('photo2', 'secret1', '사진둘');
    expect(code(() => s.setAvatar('photo2', 'https://example.com/a.png'))).toBe('bad_request');
    expect(code(() => s.setAvatar('photo2', 'data:image/svg+xml;base64,PHN2Zz4='))).toBe('bad_request');
    expect(code(() => s.setAvatar('photo2', 'data:image/png;base64,' + 'A'.repeat(70_000)))).toBe('bad_request');
    expect(code(() => s.setAvatar('photo2', 42))).toBe('bad_request');
  });
});

describe('upgrades', () => {
  const coinsOf = (s: AccountStore, k: string) => s.profile(k)!.coins;
  const setCoins = (s: AccountStore, k: string, c: number) => {
    (s as unknown as { data: { users: Record<string, { profile: { coins: number } }> } }).data.users[k]!.profile.coins = c;
  };
  it('costs coins, +1 level, stops at max', async () => {
    const s = store();
    await s.signup('lvl1', 'secret1', '레벨');
    setCoins(s, 'lvl1', 100_000);
    let total = 0;
    for (let lv = 1; lv < MAX_POWER; lv++) {
      total += upgradeCost(lv)!;
      expect(s.upgradeFighter('lvl1', 'rivet').fighters.rivet.power).toBe(lv + 1);
    }
    expect(coinsOf(s, 'lvl1')).toBe(100_000 - total);
    expect(code(() => s.upgradeFighter('lvl1', 'rivet'))).toBe('max_level');
  });
  it('not enough coins', async () => {
    const s = store();
    await s.signup('lvl2', 'secret1', '레벨둘');
    setCoins(s, 'lvl2', upgradeCost(1)! - 1);
    expect(code(() => s.upgradeFighter('lvl2', 'rivet'))).toBe('not_enough_coins');
    expect(code(() => s.upgradeFighter('lvl2', 'nobody'))).toBe('bad_request');
  });
  it('admin upgrades for free (unlimited coins)', async () => {
    const s = store();
    await s.signup('mineack991', 'secret1', '관리자');
    const before = coinsOf(s, 'mineack991');
    for (let lv = 1; lv < MAX_POWER; lv++) s.upgradeFighter('mineack991', 'hinako');
    expect(s.profile('mineack991')!.fighters.hinako.power).toBe(MAX_POWER);
    expect(coinsOf(s, 'mineack991')).toBe(before);
  });
});
