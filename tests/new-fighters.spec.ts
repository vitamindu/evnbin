import { type QaWindow, waitBattleReady } from './battle-helpers';
import { PROFILE_KEY, expect, gotoLobby, tapToLobby, test } from './fixtures';

test('T-37 REAPER·FISTER·CHAINER: 6열 목록과 상세 화면', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fcard[data-fighter="reaper"] .fcard-name')).toHaveText('REAPER');
  await expect(page.locator('.fcard[data-fighter="fister"] .fcard-name')).toHaveText('FISTER');
  await expect(page.locator('.fcard[data-fighter="chainer"] .fcard-name')).toHaveText('CHAINER');
  // 11명과 곧 추가 카드를 포함해 모두 화면 안(1280×800)에 들어간다
  for (const card of await page.locator('.fcard').all()) {
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  }
  await page.screenshot({ path: testInfo.outputPath('fighters-grid.png') });
  await page.locator('.fcard[data-fighter="chainer"]').tap();
  await expect(page.locator('.detail-name')).toHaveText('CHAINER');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('chainer.png') });
  await page.locator('.arrow-prev').tap();
  await page.locator('.arrow-prev').tap();
  await expect(page.locator('.detail-name')).toHaveText('REAPER');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('reaper.png') });
});

test('TRUE FORM REAPER: 전설 스킨 모델·이펙트가 연습장에서 보인다', async ({ page }, testInfo) => {
  await page.addInitScript(
    ([key]) => {
      localStorage.setItem(key!, JSON.stringify({ selected: 'reaper', skins: ['reaper_trueform'], skinSel: { reaper: 'reaper_trueform' } }));
    },
    [PROFILE_KEY],
  );
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'reaper');
  const fxOk: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('effects/reaper/') && r.ok()) fxOk.push(r.url().split('/').pop()!);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('trueform-idle.png') });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('trueform-dash.png') });
  await page.evaluate(() => ((window as QaWindow).__fgBattle!.player.superCharge = 1));
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('trueform-super.png') });
  await expect.poll(() => fxOk.sort()).toEqual(['super.png', 'trail.png']);
});

test('CHAINER Q: 투사체가 아니라 바닥을 내리치는 사슬(원 표시 + 떨어지는 사슬)', async ({ page }, testInfo) => {
  await page.addInitScript(([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer' })), [PROFILE_KEY]);
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  const q = await page.evaluate(() => {
    const s = (window as QaWindow).__fgBattle!.sim;
    return { shots: s.projectiles.length, slams: s.lobs.filter((l) => l.slam).length };
  });
  expect(q).toEqual({ shots: 0, slams: 1 });
  await page.screenshot({ path: testInfo.outputPath('chainer-q.png') });
});
