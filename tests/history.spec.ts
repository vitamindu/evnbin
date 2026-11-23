import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 전적(프로필 창 → 전적 보기). ?fakeonline: 기록은 localStorage(fg.fakehistory.v1:<아이디>) */
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

test('empty history, then recent matches with totals and per-match detail', async ({ page }, info) => {
  await signup(page, 'hist1', '기록왕');
  await page.locator('.profile-card').tap();
  await expect(page.locator('.pf-history')).toHaveText('아직 온라인 전적이 없어요');
  await page.locator('.pf-btn-history').tap();
  await expect(page.locator('.hs-list .fr-empty')).toContainText('아직 온라인 경기 기록이 없어요');
  await page.locator('.hs-panel .btn-close').tap();
  await page.locator('.pf-panel .btn-close').tap();

  await page.evaluate(() => {
    const now = Date.now();
    const players = (me: string) => [
      { name: me, fighterId: 'rivet', ally: true, me: true, bot: false, kills: 4, deaths: 1, damage: 9100 },
      { name: '모찌', fighterId: 'hinako', ally: true, me: false, bot: false, kills: 2, deaths: 2, damage: 6100 },
      { name: '봇 1', fighterId: 'boulder', ally: true, me: false, bot: true, kills: 1, deaths: 3, damage: 3000 },
      { name: '픽셀', fighterId: 'volley', ally: false, me: false, bot: false, kills: 3, deaths: 3, damage: 7000 },
      { name: '주노', fighterId: 'fuse', ally: false, me: false, bot: false, kills: 1, deaths: 2, damage: 4200 },
      { name: '봇 2', fighterId: 'shard', ally: false, me: false, bot: true, kills: 0, deaths: 2, damage: 1500 },
    ];
    const recs = [
      { at: now - 5 * 60_000, mode: 'teamfight', mapId: 'blossom-arena', outcome: 'win', score: [10, 6], fighterId: 'rivet', kills: 4, deaths: 1, damage: 9100, ranked: true, rankDelta: 22, mvp: true, players: players('기록왕') },
      { at: now - 3 * 3600_000, mode: 'crystal', mapId: 'blossom-arena', outcome: 'loss', score: [3, 10], fighterId: 'hinako', kills: 1, deaths: 4, damage: 4300, ranked: true, rankDelta: -20, mvp: false, players: players('기록왕') },
      { at: now - 2 * 86400_000, mode: 'teamfight', mapId: 'blossom-arena', outcome: 'draw', score: [5, 5], fighterId: 'prism', kills: 2, deaths: 2, damage: 6000, ranked: false, mvp: false, players: players('기록왕') },
    ];
    localStorage.setItem('fg.fakehistory.v1:hist1', JSON.stringify(recs));
  });
  await page.locator('.profile-card').tap();
  await expect(page.locator('.pf-history')).toHaveText('3판 · 승률 33% · MVP 1');
  await page.locator('.pf-btn-history').tap();
  await expect(page.locator('.hs-row')).toHaveCount(3);
  await expect(page.locator('.hs-stat').nth(0)).toContainText('3');
  await expect(page.locator('.hs-stat.is-rate')).toContainText('33%');
  await expect(page.locator('.hs-row').nth(0)).toHaveClass(/is-win/);
  await expect(page.locator('.hs-row').nth(0)).toContainText('+22 RP');
  await expect(page.locator('.hs-row').nth(0)).toContainText('MVP');
  await expect(page.locator('.hs-row').nth(1)).toContainText('-20 RP');
  await expect(page.locator('.hs-row').nth(2)).toContainText('일반');
  await expect(page.locator('.hs-row').nth(0)).toContainText('BLOSSOM ARENA');
  await page.locator('.hs-row').nth(0).tap();
  await expect(page.locator('.hs-item.is-open .hs-player')).toHaveCount(6);
  await expect(page.locator('.hs-player.is-me')).toContainText('기록왕');
  await expect(page.locator('.hs-player', { hasText: '봇 1' })).toContainText('(봇)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath('history.png') });
});
