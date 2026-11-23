import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 길드 화면(로비 "길드"). ?fakeonline 가짜 계정 + 가짜 길드(벚꽃연합, NightOwls) */
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

test('lobby: 길드 button on the right, 상자 moved to the left', async ({ page }) => {
  await signup(page, 'guild0', '길드영');
  await expect(page.locator('.lb-side-right .side-btn[data-btn="crew"]')).toContainText('길드');
  await expect(page.locator('.lb-side-left .side-btn[data-btn="box"]')).toBeVisible();
  await expect(page.locator('.lb-side-right .side-btn[data-btn="box"]')).toHaveCount(0);
});

test('create a guild, see myself as leader, leave it', async ({ page }, info) => {
  await signup(page, 'guild1', '길드장');
  await page.locator('.side-btn[data-btn="crew"]').tap();
  await expect(page.locator('.guild-screen .gd-none')).toBeVisible();
  await expect(page.locator('.gd-row')).toHaveCount(2);
  const inputs = page.locator('.gd-none .fr-addpanel .fr-input');
  await inputs.nth(0).fill('번개팀');
  await inputs.nth(1).fill('매일 저녁 모여요');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-in')).toBeVisible();
  await expect(page.locator('.gd-name')).toHaveText('번개팀');
  await expect(page.locator('.gd-desc')).toHaveText('매일 저녁 모여요');
  const me = page.locator('.gd-in .fr-row[data-nickname="길드장"]');
  await expect(me.locator('.gd-role')).toContainText('길드장');
  await page.screenshot({ path: info.outputPath('guild.png') });

  // 프로필 창에도 길드 이름
  await page.locator('.hdr .btn-back').tap();
  await page.locator('.profile-card').tap();
  await expect(page.locator('.pf-guild')).toHaveText('번개팀');
  await page.locator('.pf-panel .btn-close').tap();

  await page.locator('.side-btn[data-btn="crew"]').tap();
  await page.locator('.gd-leave').tap();
  await page.locator('.gd-confirm-leave').tap();
  await expect(page.locator('.gd-none')).toBeVisible();
  await expect(page.locator('.gd-row[data-guild="번개팀"]')).toHaveCount(0);
});

test('search and join an existing guild; duplicate names are refused', async ({ page }) => {
  await signup(page, 'guild2', '가입자');
  await page.locator('.side-btn[data-btn="crew"]').tap();
  const inputs = page.locator('.gd-none .fr-addpanel .fr-input');
  await inputs.nth(0).fill('벚꽃연합');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-none .fr-err')).toHaveText('이미 있는 길드 이름이에요');

  await page.locator('.gd-none .fr-listpanel .fr-input').fill('벚꽃');
  await page.locator('.gd-search').tap();
  await expect(page.locator('.gd-row')).toHaveCount(1);
  await page.locator('.gd-row[data-guild="벚꽃연합"] .gd-join').tap();
  await expect(page.locator('.gd-name')).toHaveText('벚꽃연합');
  await expect(page.locator('.gd-in .fr-row')).toHaveCount(4);
  await expect(page.locator('.gd-in .fr-row[data-nickname="모찌"] .gd-role')).toBeVisible();
});

test('guests are asked to log in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await page.locator('.auth-offline').tap();
  await page.locator('.side-btn[data-btn="crew"]').tap();
  await expect(page.locator('.guild-screen .fr-guest')).toBeVisible();
});
