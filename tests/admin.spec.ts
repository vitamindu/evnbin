import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 관리자 지급(설정 → 관리자). ?fakeonline 가짜 계정 */
test.describe.configure({ timeout: 120_000 });

async function signup(page: Page, id: string, nick: string, fresh = true) {
  if (fresh) await page.goto('/?fakeonline&qa');
  else await page.reload();
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
const fakeUser = (page: Page, id: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem('fg.fakeaccounts.v2') ?? '{}')[k].profile as { coins: number; crystals: number }, id);

test('admin grants coins/gems to one player and to everyone', async ({ page }, info) => {
  // 받을 사람을 먼저 만든다(같은 브라우저의 가짜 계정 저장소)
  await signup(page, 'friend1', '받는이');
  await page.locator('.icon-btn').last().tap();
  await page.locator('.btn-logout').tap();
  await signup(page, 'mineack991', '관리자', false);
  await page.locator('.lb-top-right .icon-btn').tap();
  await expect(page.locator('.set-panel')).toBeVisible();
  await page.waitForTimeout(400); // 팝업 등장 애니메이션이 끝난 뒤
  await page.locator('.ag-open').tap();
  await expect(page.locator('.ag-panel')).toBeVisible();

  await page.locator('.ag-target').fill('받는이');
  await page.locator('.ag-coins').fill('1,500');
  await page.locator('.ag-gems').fill('30');
  await page.screenshot({ path: info.outputPath('admin.png') });
  await page.locator('.ag-grant').tap();
  await expect(page.locator('.toast').last()).toContainText('받는이님에게 코인 1,500, 보석 30');
  expect(await fakeUser(page, 'friend1')).toMatchObject({ coins: 40 + 1500, crystals: 30 });

  // 잘못된 입력
  await page.locator('.ag-target').fill('없는사람');
  await page.locator('.ag-coins').fill('10');
  await page.locator('.ag-grant').tap();
  await expect(page.locator('.ag-err')).toHaveText('그런 닉네임은 없어요');
  await page.locator('.ag-coins').fill('abc');
  await page.locator('.ag-grant').tap();
  await expect(page.locator('.ag-err')).toHaveText('수량은 숫자만 넣어 주세요');

  // 모두에게(한 번 더 확인)
  await page.locator('.ag-all').tap();
  await page.locator('.ag-coins').fill('');
  await page.locator('.ag-gems').fill('5');
  await page.locator('.ag-grant').tap();
  await page.locator('.ag-confirm-all').tap();
  await expect(page.locator('.toast').last()).toContainText('2명 모두에게 보석 5');
  expect((await fakeUser(page, 'friend1')).crystals).toBe(35);
});

test('non-admin accounts have no admin tools', async ({ page }) => {
  await signup(page, 'plain1', '일반인');
  await page.locator('.lb-top-right .icon-btn').tap();
  await expect(page.locator('.set-panel')).toBeVisible();
  await expect(page.locator('.ag-open')).toHaveCount(0);
});
