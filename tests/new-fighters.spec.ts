import { expect, gotoLobby, test } from './fixtures';

test('REAPER·FISTER: 캐릭터 목록 5열, 상세 화면', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fcard[data-fighter="reaper"] .fcard-name')).toHaveText('REAPER');
  await expect(page.locator('.fcard[data-fighter="fister"] .fcard-name')).toHaveText('FISTER');
  // 10장 모두 화면 안(1280×800)에 들어간다
  for (const card of await page.locator('.fcard').all()) {
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  }
  await page.screenshot({ path: testInfo.outputPath('fighters-grid.png') });
  await page.locator('.fcard[data-fighter="reaper"]').tap();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('reaper.png') });
});
