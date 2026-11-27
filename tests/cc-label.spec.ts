import { type QaWindow, waitBattleReady } from './battle-helpers';
import { expect, tapToLobby, test } from './fixtures';

test('군중 제어가 걸리면 닉네임 칸이 보라색 아이콘 + CC 이름으로 바뀌고, 풀리면 닉네임으로 돌아온다', async ({ page }, testInfo) => {
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'rivet');
  const name = page.locator('.ub.is-me .ub-name');
  await expect(name).toHaveText('플레이어');
  await expect(name.locator('.ub-cc-ico')).toHaveCount(0);

  // 기절
  await page.evaluate(() => {
    const b = (window as QaWindow).__fgBattle!;
    b.player.stunnedUntilTick = b.sim.tick + 40;
  });
  await expect(name).toHaveText('기절');
  await expect(name).toHaveClass(/is-cc/);
  await expect(name.locator('svg')).toHaveCount(1);
  // 아이콘은 보라색 계열이다
  expect(await name.locator('svg').innerHTML()).toContain('#a65cff');
  await page.screenshot({ path: testInfo.outputPath('cc-stun.png'), clip: { x: 440, y: 200, width: 400, height: 260 } });

  // 풀리면 원래 닉네임
  await expect(name).toHaveText('플레이어', { timeout: 5000 });
  await expect(name).not.toHaveClass(/is-cc/);
});
