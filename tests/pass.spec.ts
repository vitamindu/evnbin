import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 시즌 패스(src/data/pass.ts). ?fakeonline 가짜 계정 */
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
async function patch(page: Page, id: string, fn: string) {
  await page.evaluate(
    ([key, body]) => {
      const all = JSON.parse(localStorage.getItem('fg.fakeaccounts.v2') ?? '{}');
      new Function('p', body as string)(all[key as string].profile);
      localStorage.setItem('fg.fakeaccounts.v2', JSON.stringify(all));
    },
    [id, fn] as const,
  );
  await page.reload();
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.lobby')).toBeVisible();
}

test('season pass: claim reached free tiers, premium for diamonds, badge on the lobby card', async ({ page }, info) => {
  await signup(page, 'pass1', '패스왕');
  await patch(page, 'pass1', "p.pass = { season: 1, xp: 350, premium: false, claimedFree: [], claimedPremium: [] }; p.crystals = 200;");
  // 3단계까지 열림 → 무료 3개 받을 수 있음
  await expect(page.locator('.pass-card .pass-sub')).toHaveText('시즌 1 · 3단계');
  await expect(page.locator('.pass-badge')).toHaveText('3');
  await page.locator('.pass-card').tap();
  await expect(page.locator('.pass-screen')).toBeVisible();
  await expect(page.locator('.ps-tier-num')).toHaveText('3');
  await expect(page.locator('.ps-xp-text')).toHaveText('50 / 100 XP');
  await expect(page.locator('.ps-cell.is-free.is-ready')).toHaveCount(3);
  await expect(page.locator('.ps-cell.is-premium.is-locked')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('pass.png') });

  const coins = page.locator('.pass-screen .currency').nth(0);
  await expect(coins).toHaveText('40');
  await page.locator('.ps-cell.is-free[data-tier="1"]').tap();
  await expect(coins).toHaveText('150');
  await expect(page.locator('.ps-cell.is-free[data-tier="1"]')).toHaveClass(/is-claimed/);
  // 아직 안 열린 단계
  await page.locator('.ps-cell.is-free[data-tier="4"]').tap();
  await expect(page.locator('.toast').last()).toContainText('4단계까지');

  // 프리미엄: 잠긴 칸을 누르면 사기 창
  await page.locator('.ps-cell.is-premium[data-tier="2"]').tap();
  await page.locator('.ps-confirm').tap();
  await expect(page.locator('.ps-premium')).toContainText('프리미엄 적용 중');
  await expect(page.locator('.pass-screen .currency').nth(1)).toHaveText('50');
  await expect(page.locator('.ps-cell.is-premium.is-ready')).toHaveCount(3);
  await page.locator('.ps-cell.is-premium[data-tier="2"]').tap();
  await expect(page.locator('.pass-screen .currency').nth(1)).toHaveText('70');

  await page.locator('.hdr .btn-back').tap();
  await expect(page.locator('.pass-badge')).toHaveText('4');
});
