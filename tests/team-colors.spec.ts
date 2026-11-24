import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * 보는 사람 기준 팀 색: 위쪽 팀(팀 1)으로 들어가도 우리 팀 발밑 원은 파랑, 상대는 빨강.
 * ?fakeonline 가짜 온라인(봇으로 채운 방).
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

for (const top of [false, true]) {
  test(`team rings are relative to the viewer — ${top ? 'top (team 1)' : 'bottom (team 0)'}`, async ({ page }, info) => {
    await signup(page, top ? 'topteam' : 'botteam', top ? '위팀' : '아래팀');
    await page.locator('.mode-card').tap();
    await page.locator('.mp-card[data-mode="teamfight"]').tap();
    await page.locator('.btn-play').tap();
    await page.locator('.hc-create-btn').tap();
    await expect(page.locator('.room')).toBeVisible();
    if (top) await page.locator('.room-switch').tap();
    await page.locator('.room-bots').tap();
    await expect(page.locator('.room-start:not(.is-disabled)')).toBeVisible({ timeout: 15_000 });
    await page.locator('.room-start').tap();
    await page.waitForFunction(() => !!(window as unknown as { __fgBattle?: unknown }).__fgBattle, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const rings = await page.evaluate(() => {
      type U = { id: number; team: number; type: string };
      const b = (window as unknown as { __fgBattle: { playerId: number; state: { units: U[] }; view: { scene: { getObjectByName(n: string): unknown; traverse(f: (o: unknown) => void): void } } } }).__fgBattle;
      const me = b.state.units.find((u) => u.id === b.playerId)!;
      const out: { team: number; me: boolean; color: string }[] = [];
      // 발밑 원: 파이터 모델 안의 RingGeometry
      b.view.scene.traverse((o) => {
        const m = o as { name?: string; children?: unknown[] };
        if (!m.name?.startsWith('fighter:')) return;
        const unitId = (o as { userData?: { unitId?: number } }).userData?.unitId;
        for (const c of (m.children ?? []) as { geometry?: { type: string }; material?: { color: { getHexString(): string } } }[]) {
          if (c.geometry?.type === 'RingGeometry') {
            const u = b.state.units.find((x) => x.id === unitId);
            if (u) out.push({ team: u.team, me: u.id === me.id, color: c.material!.color.getHexString() });
          }
        }
      });
      return { myTeam: me.team, out };
    });
    expect(rings.myTeam).toBe(top ? 1 : 0);
    expect(rings.out.length).toBe(6);
    for (const r of rings.out) {
      const want = r.me ? '3ec8ff' : r.team === rings.myTeam ? '4f8bff' : 'ff4f5e';
      expect(r.color, `team ${r.team}${r.me ? ' (me)' : ''}`).toBe(want);
    }
    await page.screenshot({ path: info.outputPath(`rings-${top ? 'top' : 'bottom'}.png`) });
  });
}
