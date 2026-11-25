import type { Page } from '@playwright/test';
import { expect, expectNewToast, passLogin, shot, test, toastCount } from './fixtures';
import type { QaWindow } from './battle-helpers';

/**
 * Phase 5 UI (docs/phase5-plan.md): sign-up with a nickname, friends screen, room mode switch, crystal HUD.
 * Uses `?fakeonline` (in-memory fake server + localStorage fake accounts/friends, src/ui/online, src/ui/account).
 */
test.describe.configure({ timeout: 120_000 });

type FakeWindow = QaWindow & { __fgFakeOnline?: { finishMatch(demo?: boolean): void } };

/** Title → sign up (아이디 / 닉네임 / 비밀번호 ×2) → lobby */
async function signupToLobby(page: Page, id = 'tester1', nick = '테스터') {
  await page.goto('/?fakeonline&qa');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.login')).toBeVisible();
  await expect(page.locator('.login')).not.toHaveClass(/is-checking/);
  await page.locator('.auth-tab').nth(1).tap();
  const inputs = page.locator('.auth-field:not([hidden]) .auth-input');
  await expect(inputs).toHaveCount(4);
  await inputs.nth(0).fill(id);
  await inputs.nth(1).fill(nick);
  await inputs.nth(2).fill('secret1');
  await inputs.nth(3).fill('secret1');
  await inputs.nth(3).press('Enter');
  await expect(page.locator('.lobby')).toBeVisible();
}

test('T-50 sign-up asks for a nickname; the nickname is the shown name and the ID only appears in settings', async ({ page }) => {
  await signupToLobby(page, 'loginid9', '하늘별');
  await expect(page.locator('.pc-name')).toHaveText('하늘별');
  await page.locator('.lb-top-right .icon-btn').tap();
  const acct = page.locator('.set-row[data-row="account"]');
  await expect(acct).toContainText('loginid9');
  const nick = page.locator('.set-row[data-row="nickname"] .set-nick');
  await expect(nick).toHaveValue('하늘별');
  await nick.fill('새별');
  const toasts = await toastCount(page);
  await page.locator('.btn-nick-save').tap();
  await expectNewToast(page, toasts, '닉네임을 바꿨어요');
  await page.locator('.set-panel .btn-close').tap();
  await expect(page.locator('.pc-name')).toHaveText('새별');
});

test('T-51 friends screen: list with status + tier, add by nickname (errors), remove with confirm', async ({ page }, testInfo) => {
  await signupToLobby(page);
  await page.locator('.side-btn[data-btn="friends"]').tap();
  await expect(page.locator('.friends-screen')).toBeVisible();
  const rows = page.locator('.fr-row');
  await expect(rows).toHaveCount(4);
  // online first, the friend in a room shows 방에 있음, offline ones last
  await expect(rows.first()).toHaveClass(/is-room/);
  await expect(rows.first().locator('.fr-status')).toHaveText('방에 있음');
  await expect(rows.last()).toHaveClass(/is-off/);
  await expect(rows.first().locator('.fr-emblem > *')).toHaveCount(1);
  await expect(page.locator('.fr-mynick')).toHaveText('테스터');
  await shot(page, testInfo, '51-friends');

  const input = page.locator('.fr-input');
  await input.fill('없는사람');
  await input.press('Enter');
  await expect(page.locator('.fr-err')).toHaveText('그런 닉네임은 없어요');
  await input.fill('테스터');
  await page.locator('.fr-add').tap();
  await expect(page.locator('.fr-err')).toHaveText('나 자신은 추가할 수 없어요');
  await input.fill('모찌');
  await page.locator('.fr-add').tap();
  await expect(page.locator('.fr-err')).toHaveText('이미 친구예요');
  await input.fill('새친구');
  await page.locator('.fr-add').tap();
  await expect(rows).toHaveCount(5);
  await expect(page.locator('.fr-row[data-nickname="새친구"]')).toHaveCount(1);

  await page.locator('.fr-row[data-nickname="주노"] .fr-del').tap();
  await expect(page.locator('.confirm-panel')).toBeVisible();
  await page.locator('.fr-confirm-del').tap();
  await expect(rows).toHaveCount(4);
  await expect(page.locator('.fr-row[data-nickname="주노"]')).toHaveCount(0);

  await page.locator('.hdr .btn-back').tap();
  await expect(page.locator('.lobby')).toBeVisible();
});

test('T-52 offline guests see a login hint on the friends screen', async ({ page }) => {
  await page.goto('/?fakeonline');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await passLogin(page);
  await page.locator('.side-btn[data-btn="friends"]').tap();
  await expect(page.locator('.fr-guest')).toBeVisible();
  await expect(page.locator('.fr-guest-t')).toHaveText('로그인하면 친구를 추가할 수 있어요');
  await expect(page.locator('.fr-body')).toBeHidden();
});

test('T-53 crystal rush: host room shows the mode, battle shows team crystal totals, countdown and carried count', async ({ page }, testInfo) => {
  await signupToLobby(page);
  await page.locator('.mode-card').tap();
  await expect(page.locator('.mp-card')).toHaveCount(4);
  await page.locator('.mp-card[data-mode="crystal"]').tap();
  await expect(page.locator('.mode-card .mode-name')).toHaveText('크리스탈 러시');
  await page.locator('.btn-play').tap();
  await expect(page.locator('.hub')).toBeVisible();
  await page.locator('.hc-create-btn').tap();
  await expect(page.locator('.room')).toBeVisible();
  await expect(page.locator('.room-mode-btn[data-mode="crystal"]')).toHaveClass(/is-on/);
  // host can switch back and forth
  await page.locator('.room-mode-btn[data-mode="teamfight"]').tap();
  await expect(page.locator('.room-mode-btn[data-mode="teamfight"]')).toHaveClass(/is-on/);
  await page.locator('.room-mode-btn[data-mode="crystal"]').tap();
  await expect(page.locator('.room-mode-btn[data-mode="crystal"]')).toHaveClass(/is-on/);
  await page.locator('.room-bots').tap();
  await expect(page.locator('.room-start:not(.is-disabled)')).toBeVisible({ timeout: 15_000 });
  await page.locator('.room-start').tap();

  await expect(page.locator('.battle')).toBeVisible();
  await expect(page.locator('.ub.is-me .ub-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.crystal-board')).toBeVisible();
  await expect(page.locator('.scoreboard:not(.crystal-board)')).toBeHidden();
  await expect(page.locator('.crystal-countdown')).toBeHidden();

  // give the player 11 crystals: the sim's crystal rules sum them and start our countdown
  const toasts = await toastCount(page);
  await page.evaluate(() => {
    const p = (window as FakeWindow).__fgBattle!.player as { crystals?: number; hp: number; maxHp: number };
    p.crystals = 11;
  });
  await expect(page.locator('.crystal-board .sb-blue .sb-num')).toHaveText(/^1[1-9]$/);
  await expect(page.locator('.crystal-countdown')).toBeVisible();
  await expect(page.locator('.crystal-countdown')).toHaveClass(/is-blue/);
  await expect(page.locator('.cd-cap')).toHaveText('우리 팀 승리까지');
  await expect(page.locator('.cd-num')).toHaveText(/^\d+$/);
  await expect(page.locator('.ub.is-me .ub-gems')).toBeVisible();
  await expect(page.locator('.ub.is-me .ub-gem-num')).toHaveText(/^1[1-9]$/);
  await expectNewToast(page, toasts, '우리 팀 카운트다운 시작! 크리스탈을 지켜요');
  await shot(page, testInfo, '53-crystal-hud');

  // drop below 10 → countdown cancels
  const toasts2 = await toastCount(page);
  await page.evaluate(() => {
    ((window as FakeWindow).__fgBattle!.player as { crystals?: number }).crystals = 0;
  });
  await expect(page.locator('.crystal-countdown')).toBeHidden();
  await expectNewToast(page, toasts2, '카운트다운이 멈췄어요!');
  await expect(page.locator('.ub.is-me .ub-gems')).toBeHidden();
});
