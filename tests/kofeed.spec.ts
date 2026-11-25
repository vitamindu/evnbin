import { expect, test } from './fixtures';
import { ATTACK_STICK, idleDummyWithSpot, openBattle, teleport, type QaWindow } from './battle-helpers';

/** KO 알림은 모든 모드: 연습장에서 허수아비를 쓰러뜨려도 뜬다 */
test('kill feed shows in training too', async ({ page }) => {
  await openBattle(page, 'rivet');
  const { spot } = idleDummyWithSpot();
  await teleport(page, spot.x, spot.y);
  await page.evaluate(() => {
    const s = (window as QaWindow).__fgBattle!;
    for (const u of s.sim.units) if (u.type === 'dummy') u.hp = u.maxHp = 1; // 허수아비는 금방 회복하므로 최대 체력도
  });
  await page.touchscreen.tap(ATTACK_STICK.x, ATTACK_STICK.y);
  const row = page.locator('.ko-feed .kf-row').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('허수아비');
  await expect(row).toHaveClass(/is-me/);
});
