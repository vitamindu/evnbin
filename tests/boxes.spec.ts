import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 파이터 상자(src/data/boxes.ts). ?fakeonline 가짜 계정 */
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

test('admin opens fighter boxes: 3-10 items, coins/diamonds go up', async ({ page }, info) => {
  await signup(page, 'mineack991', '관리자');
  const btn = page.locator('.side-btn[data-btn="box"]');
  await expect(btn.locator('.badge')).toHaveText('∞');
  const gems0 = Number(await page.locator('.lb-top-right .currency').nth(1).innerText());
  await btn.tap();
  const panel = page.locator('.bx-panel');
  await expect(panel).toBeVisible();
  await panel.locator('.bx-open').tap();
  await expect(panel).toHaveClass(/is-open/);
  const n = await panel.locator('.bx-item').count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(10);
  await expect(panel.locator('.bx-n')).toHaveText(`${n}개 획득`);
  const gemSum = await panel.locator('.bx-item.is-gems .bx-amt').allInnerTexts();
  const added = gemSum.reduce((s, t) => s + Number(t.replace('+', '')), 0);
  await expect(page.locator('.lb-top-right .currency').nth(1)).toHaveText(String(gems0 + added));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: info.outputPath('box.png') });
  await panel.locator('.bx-open').tap();
  await expect(panel).toHaveClass(/is-open/);
});

test('a normal account with no boxes is told how to get one', async ({ page }) => {
  await signup(page, 'nobox1', '상자없음');
  const btn = page.locator('.side-btn[data-btn="box"]');
  await expect(btn.locator('.badge')).toBeHidden();
  await btn.tap();
  await page.locator('.bx-open').tap();
  await expect(page.locator('.toast').last()).toContainText('열 수 있는 상자가 없어요');
  await expect(page.locator('.bx-panel')).not.toHaveClass(/is-open/);
});
