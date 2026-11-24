import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 랭킹(로비 오른쪽 "랭킹"). ?fakeonline: 가짜 12명 + 나 */
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

test('ranking: whole server by RP, ties share a rank, my row pinned, new tier names', async ({ page }, info) => {
  await signup(page, 'rank1', '랭커');
  await expect(page.locator('.lb-side-right .side-btn[data-btn="trophy"]')).toContainText('랭킹');
  await page.locator('.side-btn[data-btn="trophy"]').tap();
  await expect(page.locator('.ranking-screen')).toBeVisible();
  await expect(page.locator('.rkg-list .rkg-row')).toHaveCount(13);
  await expect(page.locator('.rk-total')).toHaveText('전체 13명');
  const first = page.locator('.rkg-list .rkg-row').nth(0);
  await expect(first).toContainText('탄탄');
  await expect(first.locator('.rkg-tier-name')).toHaveText('챌린저 III'); // 742 → 725~749
  await expect(page.locator('.rkg-list .rkg-row[data-nickname="픽셀"] .rkg-rank')).toHaveText('2');
  await expect(page.locator('.rkg-list .rkg-row[data-nickname="모찌"] .rkg-rank')).toHaveText('2');
  await expect(page.locator('.rkg-list .rkg-row[data-nickname="모찌"]')).toContainText('그랜드마스터 II');
  await expect(page.locator('.rkg-list .rkg-row[data-nickname="별빛"]')).toContainText('플래티넘 I');
  // 나(0점)는 맨 아래와 같은 순위, 아래에 고정
  await expect(page.locator('.rkg-mine .rkg-row.is-me')).toContainText('랭커');
  await expect(page.locator('.rkg-mine .rkg-row.is-me')).toContainText('브론즈 IV');
  await expect(page.locator('.rkg-mine .rkg-rank')).toHaveText('12');
  await page.screenshot({ path: info.outputPath('ranking.png') });
});

test('ranking asks guests to log in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await page.locator('.auth-offline').tap();
  await page.locator('.side-btn[data-btn="trophy"]').tap();
  await expect(page.locator('.ranking-screen .fr-guest')).toBeVisible();
});

test('tier popup shows the new 100-point tiers', async ({ page }) => {
  await signup(page, 'rank2', '티어');
  await page.locator('.trophy-card').tap();
  await expect(page.locator('.rk-row')).toHaveCount(8);
  await expect(page.locator('.rk-row').nth(0)).toContainText('0~100 · IV→I');
  await expect(page.locator('.rk-row').nth(7)).toContainText('700+ · IV→I');
  await expect(page.locator('.rk-rule')).toContainText('단계마다 25 RP');
});
