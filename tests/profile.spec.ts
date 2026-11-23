import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';

/** 프로필 창(로비 프로필 카드) + 프로필 사진. ?fakeonline 가짜 계정 */
test.describe.configure({ timeout: 120_000 });
const PNG = fileURLToPath(new URL('./fixtures-avatar.png', import.meta.url));

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

test('profile card opens the profile window: most-used fighter, nickname, tier points', async ({ page }, info) => {
  await signup(page, 'profile1', '프로필왕');
  await page.locator('.profile-card').tap();
  const panel = page.locator('.pf-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.pf-name')).toHaveText('프로필왕');
  await expect(panel.locator('.pf-fighter-name')).toHaveText('RIVET');
  await expect(panel.locator('.pf-rank-pts')).toHaveText('0 RP');
  await expect(panel.locator('.pf-avatar')).toHaveText('프');

  // 사진 등록 → 창과 로비 카드에 사진이 보인다
  await panel.locator('input[type=file]').setInputFiles(PNG);
  await expect(panel.locator('.pf-avatar img')).toBeVisible();
  await expect(page.locator('.profile-card .avatar img')).toBeVisible();
  const src = await panel.locator('.pf-avatar img').getAttribute('src');
  expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('profile.png') });

  // 다시 로그인해도 남아 있다(계정에 저장)
  await page.reload();
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('.profile-card .avatar img')).toBeVisible();

  // 지우기
  await page.locator('.profile-card').tap();
  await page.locator('.pf-btn-sub').tap();
  await expect(page.locator('.pf-avatar img')).toHaveCount(0);
  await page.locator('.pf-panel .btn-close').tap();
  await expect(page.locator('.overlay')).toHaveCount(0);
});

test('offline players can open the profile but not upload a photo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await page.locator('.auth-offline').tap();
  await page.locator('.profile-card').tap();
  await expect(page.locator('.pf-panel')).toBeVisible();
  await page.locator('.pf-btn').first().tap();
  await expect(page.locator('.toast').last()).toContainText('로그인');
});
