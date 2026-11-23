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

/** 가짜 계정 저장소(localStorage)에 상자를 넣고 다시 로그인(토큰으로 자동) */
async function giveBoxes(page: Page, id: string, n: number) {
  await page.evaluate(
    ([key, count]) => {
      const all = JSON.parse(localStorage.getItem('fg.fakeaccounts.v2') ?? '{}');
      all[key as string].profile.boxes = count;
      localStorage.setItem('fg.fakeaccounts.v2', JSON.stringify(all));
    },
    [id, n] as const,
  );
  await page.reload();
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.lobby')).toBeVisible();
}

test('admin: unlimited coins/diamonds but not boxes', async ({ page }) => {
  await signup(page, 'mineack991', '관리자');
  await expect(page.locator('.lb-top-right .currency').nth(0)).toHaveText('∞');
  await expect(page.locator('.lb-top-right .currency').nth(1)).toHaveText('∞');
  const btn = page.locator('.side-btn[data-btn="box"]');
  await expect(btn.locator('.badge')).toBeHidden();
  await btn.tap();
  await expect(page.locator('.bx-count')).toHaveText('보유 0개');
  await page.locator('.bx-open').tap();
  await expect(page.locator('.toast').last()).toContainText('열 수 있는 상자가 없어요');
});

test('opening a fighter box: 3-10 items, one box used, coins/diamonds go up', async ({ page }, info) => {
  await signup(page, 'boxer1', '상자왕');
  await giveBoxes(page, 'boxer1', 2);
  const btn = page.locator('.side-btn[data-btn="box"]');
  await expect(btn.locator('.badge')).toHaveText('2');
  const coins0 = Number((await page.locator('.lb-top-right .currency').nth(0).innerText()).replace(/,/g, ''));
  const gems0 = Number((await page.locator('.lb-top-right .currency').nth(1).innerText()).replace(/,/g, ''));
  await btn.tap();
  const panel = page.locator('.bx-panel');
  await panel.locator('.bx-open').tap();
  await expect(panel).toHaveClass(/is-open/);
  await expect(page.locator('.bx-count')).toHaveText('보유 1개');
  const n = await panel.locator('.bx-item').count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(10);
  await expect(panel.locator('.bx-n')).toHaveText(`${n}개 획득`);
  const sum = async (sel: string) => (await panel.locator(sel).allInnerTexts()).reduce((s, t) => s + Number(t.replace('+', '')), 0);
  const coins = await sum('.bx-item.is-coins .bx-amt');
  const gems = await sum('.bx-item.is-gems .bx-amt');
  await expect(page.locator('.lb-top-right .currency').nth(0)).toHaveText((coins0 + coins).toLocaleString('en-US'));
  await expect(page.locator('.lb-top-right .currency').nth(1)).toHaveText((gems0 + gems).toLocaleString('en-US'));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: info.outputPath('box.png') });
  await panel.locator('.bx-open').tap();
  await expect(page.locator('.bx-count')).toHaveText('보유 0개');
  await page.locator('.bx-panel .btn-close').tap();
  await expect(btn.locator('.badge')).toBeHidden();
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
