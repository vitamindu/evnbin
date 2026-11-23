import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStore } from '../../../server/accounts';
import { DAILY_GIFT, SHOP_ITEMS, getShopItem, shopDay } from '../../../src/data/shop';

const dirs: string[] = [];
let now = Date.UTC(2026, 10, 23, 3, 0, 0); // 한국 시간 12:00
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'fg-shop-'));
  dirs.push(d);
  return new AccountStore(d, () => now, () => {});
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
const gems = (s: AccountStore, k: string, n: number) => {
  (s as unknown as { data: { users: Record<string, { profile: { crystals: number } }> } }).data.users[k]!.profile.crystals = n;
};

describe('shop', () => {
  it('catalog: unique ids, every paid item has a positive diamond price', () => {
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
    for (const i of SHOP_ITEMS) if (i.kind !== 'daily') expect(i.price).toBeGreaterThan(0);
  });

  it('daily gift once per Korean day', async () => {
    const s = mk();
    await s.signup('shop1', 'secret1', '상점');
    const c0 = s.profile('shop1')!.coins;
    const r = s.buyShopItem('shop1', 'daily');
    expect(r.got.coins).toBe(DAILY_GIFT.kind === 'daily' ? DAILY_GIFT.coins : 0);
    expect(r.profile.coins).toBe(c0 + r.got.coins);
    expect(code(() => s.buyShopItem('shop1', 'daily'))).toBe('already_claimed');
    now += 11 * 3600_000; // 한국 시간 23:00 — 아직 같은 날
    expect(code(() => s.buyShopItem('shop1', 'daily'))).toBe('already_claimed');
    now += 2 * 3600_000; // 한국 시간 다음 날 01:00
    expect(s.buyShopItem('shop1', 'daily').got.coins).toBeGreaterThan(0);
  });

  it('boxes and coins cost diamonds; not enough → nothing changes', async () => {
    const s = mk();
    await s.signup('shop2', 'secret1', '상점둘');
    const box10 = getShopItem('box10')!;
    const coins = getShopItem('coins1500')!;
    if (box10.kind !== 'box' || coins.kind !== 'coins') throw new Error('catalog');
    gems(s, 'shop2', box10.price - 1);
    expect(code(() => s.buyShopItem('shop2', 'box10'))).toBe('not_enough_gems');
    expect(s.profile('shop2')!.boxes ?? 0).toBe(0);
    gems(s, 'shop2', box10.price + coins.price);
    const c0 = s.profile('shop2')!.coins;
    expect(s.buyShopItem('shop2', 'box10').profile.boxes).toBe(10);
    const p = s.buyShopItem('shop2', 'coins1500').profile;
    expect(p.crystals).toBe(0);
    expect(p.coins).toBe(c0 + coins.coins);
    expect(code(() => s.buyShopItem('shop2', 'nope'))).toBe('bad_request');
  });

  it('skins: once, then owned', async () => {
    const s = mk();
    await s.signup('shop3', 'secret1', '상점셋');
    gems(s, 'shop3', 1000);
    expect(s.buyShopItem('shop3', 'skin:hinako_sakura').profile.skins).toEqual(['hinako_sakura']);
    expect(code(() => s.buyShopItem('shop3', 'skin:hinako_sakura'))).toBe('already_owned');
  });

  it('admin pays nothing', async () => {
    const s = mk();
    await s.signup('mineack991', 'secret1', '관리자');
    gems(s, 'mineack991', 0);
    expect(s.buyShopItem('mineack991', 'box10').profile.boxes).toBe(10);
    expect(s.profile('mineack991')!.crystals).toBe(0);
  });

  it('shopDay uses Korean time', () => {
    expect(shopDay(Date.UTC(2026, 0, 1, 14, 59))).toBe('2026-01-01');
    expect(shopDay(Date.UTC(2026, 0, 1, 15, 0))).toBe('2026-01-02');
  });
});
