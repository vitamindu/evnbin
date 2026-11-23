import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 상점(src/data/shop.ts). ?fakeonline 가짜 계정 */
test.describe.configure({ timeout: 120_000 });

async function signup(page: Page, id: string, nick: string) {
  await page.goto('/?fakeonline&qa');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.login')).not.toHaveClass(/is-checking/);
  await page.locator('.auth-tab').nth(1).tap();
  const inputs = page.locator('.auth-field:not([hidden]) .auth-input');
  await inputs.nth(0).fill(id);
  await inputs.nth(1).fill(nick);
  await inputs.nth(2).fill('secret1');
  await inputs.nth(3).fill('secret1');
  await inputs.nth(3).press('Enter');
  await expect(page.locator('.lobby')).toBeVisible();
}
async function giveGems(page: Page, id: string, crystals: number) {
  await page.evaluate(
    ([key, g]) => {
      const all = JSON.parse(localStorage.getItem('fg.fakeaccounts.v2') ?? '{}');
      all[key as string].profile.crystals = g;
      localStorage.setItem('fg.fakeaccounts.v2', JSON.stringify(all));
    },
    [id, crystals] as const,
  );
  await page.reload();
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.lobby')).toBeVisible();
}
const coinsText = (page: Page) => page.locator('.shop-screen .currency').nth(0);
const gemsText = (page: Page) => page.locator('.shop-screen .currency').nth(1);

test('lobby: no 소식 button; 상점 opens the shop', async ({ page }) => {
  await signup(page, 'shop0', '상점영');
  await expect(page.locator('.side-btn[data-btn="news"]')).toHaveCount(0);
  await page.locator('.side-btn[data-btn="shop"]').tap();
  await expect(page.locator('.shop-screen')).toBeVisible();
  await expect(page.locator('.shop-card')).toHaveCount(6);
});

test('daily gift once, buy boxes and coins with diamonds', async ({ page }, info) => {
  await signup(page, 'shop1', '상점왕');
  await giveGems(page, 'shop1', 100);
  await page.locator('.side-btn[data-btn="shop"]').tap();
  await expect(coinsText(page)).toHaveText('40');
  await page.locator('.shop-card[data-item="daily"] .shop-buy').tap();
  await expect(coinsText(page)).toHaveText('140');
  await expect(page.locator('.shop-card[data-item="daily"] .shop-buy')).toHaveText('내일 다시');
  await page.screenshot({ path: info.outputPath('shop.png') });

  await page.locator('.shop-card[data-item="box1"] .shop-buy').tap();
  await page.locator('.shop-confirm-buy').tap();
  await expect(gemsText(page)).toHaveText('70');
  await page.locator('.shop-card[data-item="coins1500"] .shop-buy').tap();
  await page.locator('.shop-confirm-buy').tap();
  await expect(gemsText(page)).toHaveText('20');
  await expect(coinsText(page)).toHaveText('1,640');
  // 모자라면 묻지 않고 알림
  await page.locator('.shop-card[data-item="box10"] .shop-buy').tap();
  await expect(page.locator('.toast').last()).toContainText('다이아가 부족해요');
  await expect(page.locator('.shop-confirm-buy')).toHaveCount(0);
  // 산 상자는 로비 상자 버튼에
  await page.locator('.hdr .btn-back').tap();
  await expect(page.locator('.side-btn[data-btn="box"] .badge')).toHaveText('1');
});

test('skin from the shop, then it shows as owned', async ({ page }) => {
  await signup(page, 'shop2', '스킨왕');
  await giveGems(page, 'shop2', 150);
  await page.locator('.side-btn[data-btn="shop"]').tap();
  const skin = page.locator('.shop-card[data-item="skin:hinako_sakura"]');
  await skin.locator('.shop-buy').tap();
  await page.locator('.shop-confirm-buy').tap();
  await expect(skin.locator('.shop-buy')).toHaveText('보유 중');
  await expect(gemsText(page)).toHaveText('50');
});
