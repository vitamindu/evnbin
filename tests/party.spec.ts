import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * 파티(로비 + 칸·파티 버튼). ?fakeonline 가짜 계정·가짜 친구(모찌·픽셀·주노·탄탄)·가짜 파티:
 * 가짜 친구는 초대를 바로 수락한다. 받은 초대·방 코드는 localStorage(fg.fakeparty.v1)에 넣어 흉내 낸다.
 */
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
const setFakeParty = (page: Page, s: object) =>
  page.evaluate((v) => localStorage.setItem('fg.fakeparty.v1', JSON.stringify(v)), s);

test('invite friends into the + slots, kick, leave', async ({ page }, info) => {
  await signup(page, 'party1', '파티장');
  await expect(page.locator('.party-bar')).toBeHidden();
  await page.locator('.party-slot.slot-left').tap();
  await expect(page.locator('.pi-panel')).toBeVisible();
  await page.locator('.pi-panel .fr-row[data-nickname="모찌"] .pi-invite').tap();
  await expect(page.locator('.party-slot.slot-left')).toHaveClass(/is-filled/);
  await expect(page.locator('.party-slot.slot-left .party-name')).toHaveText('모찌');
  await expect(page.locator('.party-info')).toHaveText('파티 2/3 · 내가 파티장');
  // 파티 버튼으로 한 명 더
  await page.locator('.side-btn[data-btn="party"]').tap();
  await expect(page.locator('.pi-panel .fr-row[data-nickname="모찌"]')).toHaveCount(0);
  await page.locator('.pi-panel .fr-row[data-nickname="픽셀"] .pi-invite').tap();
  await expect(page.locator('.party-slot.slot-right .party-name')).toHaveText('픽셀');
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath('party.png') });
  // 내보내기
  await page.locator('.party-slot.slot-right').tap();
  await page.locator('.party-kick').tap();
  await expect(page.locator('.party-slot.slot-right')).not.toHaveClass(/is-filled/);
  await page.locator('.party-leave').tap();
  await expect(page.locator('.party-bar')).toBeHidden();
  await expect(page.locator('.party-slot.is-filled')).toHaveCount(0);
});

test('accept an invite, then follow the leader into the room', async ({ page }) => {
  await signup(page, 'party2', '파티원');
  await setFakeParty(page, { invites: ['픽셀'] });
  await expect(page.locator('.party-invite[data-from="픽셀"]')).toBeVisible({ timeout: 8000 });
  await page.locator('.party-invite .pv-accept').tap();
  await expect(page.locator('.party-slot.slot-left .party-name')).toHaveText('픽셀');
  await expect(page.locator('.party-slot.slot-left .party-crown')).toBeVisible();
  await expect(page.locator('.party-info')).toHaveText('파티 2/3 · 파티장 픽셀');
  // 파티원은 + 칸으로 초대하지 못한다
  await page.locator('.party-slot.slot-right').tap();
  await expect(page.locator('.toast').last()).toContainText('파티장만');
  // 온라인 모드에서 PLAY → 기다리라는 안내
  await page.locator('.mode-card').tap();
  await page.locator('.mp-card[data-mode="teamfight"]').tap();
  await page.locator('.btn-play').tap();
  await expect(page.locator('.toast').last()).toContainText('파티장이 시작하면');
  await expect(page.locator('.lobby')).toBeVisible();
  // 파티장이 방을 만들면 따라간다
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('fg.fakeparty.v1')!);
    s.roomCode = 'PQRS';
    localStorage.setItem('fg.fakeparty.v1', JSON.stringify(s));
  });
  await expect(page.locator('.online')).toBeVisible({ timeout: 8000 });
});

test('leader: PLAY in an online mode creates the room right away', async ({ page }) => {
  await signup(page, 'party3', '방장');
  await page.locator('.party-slot.slot-left').tap();
  await page.locator('.pi-panel .fr-row[data-nickname="주노"] .pi-invite').tap();
  await expect(page.locator('.party-slot.slot-left .party-name')).toHaveText('주노');
  await page.locator('.mode-card').tap();
  await page.locator('.mp-card[data-mode="teamfight"]').tap();
  await page.locator('.btn-play').tap();
  await expect(page.locator('.room')).toBeVisible({ timeout: 15_000 });
});

test('guests are asked to log in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await page.locator('.auth-offline').tap();
  await page.locator('.party-slot.slot-left').tap();
  await expect(page.locator('.toast').last()).toContainText('로그인');
});
