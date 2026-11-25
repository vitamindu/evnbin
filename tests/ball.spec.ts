import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { QaWindow } from './battle-helpers';

/** 파이터 볼(가짜 온라인, 봇으로 채운 방) */
test.describe.configure({ timeout: 180_000 });

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

type BallWin = QaWindow & { __fgBattle?: { state: { ball: { pos: { x: number; y: number }; carrierId: number | null } | null; match: { mode: string; score: [number, number] } }; playerId: number } };

test('fighter ball: mode card, room on MEADOW PITCH, ball on the field, goal toast', async ({ page }, info) => {
  await signup(page, 'ball1', '공잡이');
  await page.locator('.mode-card').tap();
  await expect(page.locator('.mp-card')).toHaveCount(4);
  await page.locator('.mp-card[data-mode="ball"]').tap();
  await expect(page.locator('.mode-card .mode-name')).toHaveText('파이터 볼');
  await page.locator('.btn-play').tap();
  await page.locator('.hc-create-btn').tap();
  await expect(page.locator('.room')).toBeVisible();
  await expect(page.locator('.room-mode-btn[data-mode="ball"]')).toHaveClass(/is-on/);
  await expect(page.locator('.room-map-name')).toHaveText('MEADOW PITCH');
  await expect(page.locator('.room-fact').first()).toHaveText('2골 선승');
  await page.locator('.room-bots').tap();
  await expect(page.locator('.room-start:not(.is-disabled)')).toBeVisible({ timeout: 15_000 });
  await page.locator('.room-start').tap();
  await page.waitForFunction(() => !!(window as BallWin).__fgBattle?.state.ball, null, { timeout: 60_000 });
  await expect(page.locator('.battle .sb-target').first()).toHaveText('2골 선승');
  const ball = await page.evaluate(() => (window as BallWin).__fgBattle!.state.ball!);
  expect(ball.pos.x).toBeCloseTo(10.5, 1);
  expect(ball.pos.y).toBeCloseTo(14.5, 1);
  // 3D 공이 장면에 있다
  expect(await page.evaluate(() => !!(window as BallWin & { __fgBattle: { view: { scene: { getObjectByName(n: string): unknown } } } }).__fgBattle!.view.scene.getObjectByName('ball'))).toBe(true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('ball.png') });
  // 공을 위쪽(상대 팀) 골대 칸에 놓으면 우리 팀 골 → 알림, 1:0, 잠시 뒤 공이 가운데로
  await page.evaluate(() => {
    const sim = (window as unknown as { __fgBattle: { sim: { ball: { pos: { x: number; y: number }; vel: { x: number; y: number }; carrierId: number | null } } } }).__fgBattle.sim;
    sim.ball.carrierId = null;
    sim.ball.vel = { x: 0, y: 0 };
    sim.ball.pos = { x: 10.5, y: 1.5 };
  });
  await expect(page.locator('.toast', { hasText: '우리 팀 골!' }).last()).toBeAttached({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as BallWin).__fgBattle!.state.match.score)).toEqual([1, 0]);
  await page.waitForFunction(() => {
    const b = (window as BallWin).__fgBattle!.state.ball!;
    return Math.abs(b.pos.y - 14.5) < 0.6 && b.carrierId === null;
  }, null, { timeout: 15_000 });
});
