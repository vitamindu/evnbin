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

test('CHAINER Q·E: 총알이 아니라 사슬(조준 미리보기, 내리치기, 던진 사슬)', async ({ page }, testInfo) => {
  await page.addInitScript(([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer' })), [PROFILE_KEY]);
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  const chainMeshes = () =>
    page.evaluate(() => {
      let n = 0;
      (window as QaWindow).__fgBattle!.view.scene.traverse((o) => {
        if (!(o as { isInstancedMesh?: boolean }).isInstancedMesh || o.renderOrder !== 5 || (o as { count: number }).count === 0) return; // 사슬(chainFx)만
        for (let p: typeof o | null = o; p; p = p.parent) if (!p.visible) return; // 숨겨진 조준 표시는 제외
        n++;
      });
      return n;
    });
  // 조준 미리보기: 원 + 사슬 두 가닥
  await page.evaluate(() => {
    const b = (window as QaWindow).__fgBattle!;
    b.view.setAim({ unitId: b.playerId, which: 'attack', aim: { x: 0, y: -1 } });
  });
  await page.waitForTimeout(300);
  expect(await chainMeshes()).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('chainer-q-aim.png') });
  await page.evaluate(() => (window as QaWindow).__fgBattle!.view.setAim(null));
  // Q: 투사체가 아니라 바닥 내리치기 + 사슬 두 가닥
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => (window as QaWindow).__fgBattle!.sim.lobs.filter((l) => l.slam).length), { timeout: 3000 })
    .toBe(1);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.projectiles.length)).toBe(0);
  expect(await chainMeshes()).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('chainer-q.png') });
  await page.waitForTimeout(330); // 두 사슬이 만난 자리에서 터진다
  await page.screenshot({ path: testInfo.outputPath('chainer-q-burst.png') });
  await page.waitForTimeout(700);
  // E: 던진 사슬(투사체 1개 + 사슬 1줄)
  await page.evaluate(() => (window as QaWindow).__fgBattle!.queueSkill({ x: 0, y: -1 }));
  await page.waitForTimeout(110);
  const e = await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.projectiles.filter((p) => p.chainSkill).length);
  expect(e).toBe(1);
  expect(await chainMeshes()).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('chainer-e.png') });
});
