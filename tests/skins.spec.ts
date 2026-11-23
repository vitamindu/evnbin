import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 스킨(src/data/skins.ts): 관리자(mineack991)만 SAKURA HINAKO를 입을 수 있다. ?fakeonline 가짜 계정으로 확인 */
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

async function openHinako(page: Page) {
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await page.locator('.fcard[data-fighter="hinako"]').tap();
  await expect(page.locator('.detail-name')).toHaveText('HINAKO');
}

test('admin can wear SAKURA HINAKO', async ({ page }, info) => {
  await signup(page, 'mineack991', '관리자');
  await openHinako(page);
  const chips = page.locator('.skin-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText('착용 중');
  await chips.nth(1).tap();
  await expect(chips.nth(1)).toContainText('착용 중');
  await expect(chips.nth(0)).toContainText('착용');
  await page.waitForTimeout(800);
  await page.screenshot({ path: info.outputPath('skin-admin.png') });
});

test('other accounts see the skin as admin-only and cannot wear it', async ({ page }) => {
  await signup(page, 'normal1', '보통유저');
  await openHinako(page);
  const chips = page.locator('.skin-chip');
  await expect(chips.nth(1)).toContainText('관리자 전용');
  await chips.nth(1).tap();
  await chips.nth(1).tap();
  await expect(chips.nth(0)).toContainText('착용 중');
});

test('fighters without skins show no skin bar', async ({ page }) => {
  await signup(page, 'normal2', '보통둘');
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await page.locator('.fcard[data-fighter="rivet"]').tap();
  await expect(page.locator('.skin-bar')).toBeHidden();
});
