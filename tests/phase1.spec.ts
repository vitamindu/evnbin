import type { Locator } from '@playwright/test';
import {
  expect,
  expectNewToast,
  expectNoNewToast,
  gotoFighters,
  gotoLobby,
  lobbyLayoutProblems,
  openTitle,
  passLogin,
  selectVolley,
  shot,
  storedProfile,
  storedSettings,
  tapToLobby,
  test,
  toastCount,
} from './fixtures';

/** Phase 1: title → lobby → fighter select. IDs from docs/06-test-cases.md. */

type TitleState = { bar: string; loader: boolean; tap: boolean };

test('T-01 first launch: loading bar then TAP TO START, no console errors', async ({ page }, testInfo) => {
  // Record every distinct title-screen state from the first DOM mutation on, so the
  // "loading bar first" check does not depend on how fast this machine loads.
  await page.addInitScript(() => {
    const states: TitleState[] = [];
    (window as unknown as { __qaTitle: TitleState[] }).__qaTitle = states;
    const visible = (e: HTMLElement) => !e.closest('[hidden]') && e.getClientRects().length > 0;
    new MutationObserver(() => {
      const loader = document.querySelector<HTMLElement>('.title-loader');
      const tap = document.querySelector<HTMLElement>('.title-tap');
      const fill = document.querySelector<HTMLElement>('.title-loader .bar i');
      if (!loader || !tap || !fill) return;
      const s = { bar: fill.style.width, loader: visible(loader), tap: visible(tap) };
      const last = states[states.length - 1];
      if (!last || last.bar !== s.bar || last.loader !== s.loader || last.tap !== s.tap) states.push(s);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden'] });
  });
  await page.goto('/');
  const loader = page.locator('.title-loader');
  const tap = page.locator('.title-tap');
  await expect(tap).toBeVisible({ timeout: 30_000 });

  const states = await page.evaluate(() => (window as unknown as { __qaTitle: TitleState[] }).__qaTitle);
  const loading = states.filter((s) => s.loader && !s.tap);
  expect(loading.length, `loading states seen: ${JSON.stringify(states)}`).toBeGreaterThan(0);
  const pct = loading.map((s) => parseFloat(s.bar) || 0);
  expect(pct[0], 'bar starts below 100%').toBeLessThan(100);
  expect(pct, 'bar only moves forward').toEqual([...pct].sort((a, b) => a - b));
  expect(states.some((s) => s.loader && s.tap), 'loader and TAP TO START never shown together').toBe(false);
  expect(states.at(-1)).toEqual({ bar: '100%', loader: false, tap: true });

  // Final screen: the bar is replaced by TAP TO START.
  await expect(tap).toHaveText('터치해서 시작');
  await expect(tap).not.toHaveAttribute('hidden', /.*/);
  await expect(loader).toBeHidden();
  await expect(loader.locator('.bar i')).toHaveAttribute('style', /width:\s*100%/);
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'title');
  await expect(page).toHaveTitle('FIGHT GUYS');
  await shot(page, testInfo, '01-title');
  // console/page errors are asserted by the fixture after the test body.
});

test('T-02 tap title goes to lobby with default fighter RIVET', async ({ page }, testInfo) => {
  await openTitle(page);
  await page.locator('.title').tap();
  await passLogin(page);
  await expect(page.locator('.title')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'lobby');
  await expect(page.locator('.nameplate .np-name')).toHaveText('RIVET');
  await expect(page.locator('.nameplate .role-chip')).toContainText('산탄형');
  // docs/02 §1: the first tap also requests fullscreen (allowed only inside a user gesture).
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await shot(page, testInfo, '02-lobby');
});

test('T-03 FIGHTERS button opens list: 4 cards + MORE SOON, RIVET SELECTED', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'fighters');

  const cards = page.locator('.fighter-grid .fcard');
  await expect(cards).toHaveCount(8);
  await expect(page.locator('.fcard[data-fighter]')).toHaveCount(8);
  await expect(page.locator('.fcard[data-fighter] .fcard-name')).toHaveText(['RIVET', 'VOLLEY', 'BOULDER', 'HINAKO', 'FUSE', 'SHARD', 'GRIZZLE', 'PRISM']);
  await expect(page.locator('.fcard-soon')).toHaveCount(0);
  await expect(page.locator('.fighters-count')).toHaveText('8 / 8 보유');

  const rivet = page.locator('.fcard[data-fighter="rivet"]');
  await expect(rivet).toHaveClass(/is-selected/);
  await expect(rivet.locator('.fcard-selected')).toHaveText('선택됨');
  await expect(page.locator('.fcard-selected')).toHaveCount(1);
  await expect(page.locator('.fcard.is-selected')).toHaveCount(1);

  // Portraits were rendered (data URLs from the offscreen WebGL pass) and actually decoded.
  for (const id of ['rivet', 'volley', 'boulder', 'hinako']) {
    const img = page.locator(`.fcard[data-fighter="${id}"] img`);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  await shot(page, testInfo, '03-fighters');
});

test('T-04 select VOLLEY: button becomes SELECTED and a toast appears', async ({ page }, testInfo) => {
  await gotoFighters(page);
  await page.locator('.fcard[data-fighter="volley"]').tap();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.locator('.detail-name')).toHaveText('VOLLEY');

  const selectBtn = page.locator('.btn-select');
  await expect(selectBtn).toHaveText('선택');
  await expect(selectBtn).not.toHaveClass(/is-selected/);

  let toasts = await toastCount(page);
  await selectBtn.tap();
  await expect(selectBtn).toHaveText('선택됨');
  await expect(selectBtn).toHaveClass(/is-selected/);
  await expectNewToast(page, toasts, 'VOLLEY 선택!');
  expect((await storedProfile(page))?.selected).toBe('volley');
  await shot(page, testInfo, '04-detail-volley-selected');

  // Tapping SELECT again on the already-selected fighter is a no-op (no new toast).
  toasts = await toastCount(page);
  await selectBtn.tap();
  await expectNoNewToast(page, toasts);
  await expect(selectBtn).toHaveText('선택됨');
});

test('T-05 back twice: lobby nameplate shows VOLLEY', async ({ page }) => {
  await selectVolley(page);

  await page.locator('.detail .btn-back').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('.fcard[data-fighter="volley"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fcard[data-fighter="volley"] .fcard-selected')).toHaveText('선택됨');
  await expect(page.locator('.fcard[data-fighter="rivet"]')).not.toHaveClass(/is-selected/);
  await expect(page.locator('.fcard-selected')).toHaveCount(1);

  await page.locator('.fighters .btn-back').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('.nameplate .np-name')).toHaveText('VOLLEY');
  await expect(page.locator('.nameplate .role-chip')).toContainText('연사형');
});

test('T-06 selection persists across reload (VOLLEY)', async ({ page }) => {
  await selectVolley(page);
  expect((await storedProfile(page))?.selected).toBe('volley');

  await page.reload();
  await tapToLobby(page);
  await expect(page.locator('.nameplate .np-name')).toHaveText('VOLLEY');

  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fcard[data-fighter="volley"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fcard-selected')).toHaveCount(1);
});

test('T-07 detail arrows cycle through every fighter and wrap to RIVET', async ({ page }) => {
  await gotoFighters(page);
  await page.locator('.fcard[data-fighter="rivet"]').tap();
  const name = page.locator('.detail-name');
  const selectBtn = page.locator('.btn-select');
  await expect(name).toHaveText('RIVET');
  await expect(selectBtn).toHaveText('선택됨');

  const next = page.locator('.arrow-next');
  const prev = page.locator('.arrow-prev');
  for (const expected of ['VOLLEY', 'BOULDER', 'HINAKO', 'FUSE', 'SHARD', 'GRIZZLE', 'PRISM', 'RIVET']) {
    await next.tap();
    await expect(name).toHaveText(expected);
    // SELECT label tracks whether the shown fighter is the selected one (RIVET by default).
    await expect(selectBtn).toHaveText(expected === 'RIVET' ? '선택됨' : '선택');
  }
  for (const expected of ['PRISM', 'GRIZZLE', 'SHARD', 'FUSE', 'HINAKO', 'BOULDER', 'VOLLEY', 'RIVET']) {
    await prev.tap();
    await expect(name).toHaveText(expected);
  }
});

test('T-08b mode card opens the mode picker; TEAM FIGHT is remembered, TRAINING switches back', async ({ page }) => {
  await gotoLobby(page);
  await expect(page.locator('.mode-card .mode-name')).toHaveText('연습장');
  await page.locator('.mode-card').tap();
  const picker = page.locator('.mp-panel');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.mp-card')).toHaveCount(3);
  await expect(picker.locator('.mp-card[data-mode="training"]')).toHaveClass(/is-selected/);
  await picker.locator('.mp-card[data-mode="teamfight"]').tap();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.mode-card .mode-name')).toHaveText('팀 대결');
  expect((await storedSettings(page))?.playMode).toBe('teamfight');
  await page.locator('.mode-card').tap();
  await page.locator('.mp-card[data-mode="training"]').tap();
  await expect(page.locator('.mode-card .mode-name')).toHaveText('연습장');
  expect((await storedSettings(page))?.playMode).toBe('training');
});

test('T-09 PLAY opens the Training Yard battle and the back button returns to the lobby', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.btn-play').tap();
  await expect(page.locator('.battle')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'battle');
  await expect(page.locator('.battle-label')).toHaveText('TRAINING YARD');
  await expect(page.locator('.btn-battle-exit')).toBeVisible();
  await expect(page.locator('.lobby')).toHaveCount(0);
  // Phase 2: PLAY no longer opens the matchmaking popup.
  await expect(page.locator('.mm-panel')).toHaveCount(0);
  await expect(page.locator('.overlay')).toHaveCount(0);
  // The player's own HP bar is drawn once the battle loop runs.
  await expect(page.locator('.ub.is-me .ub-bar')).toBeVisible();
  await shot(page, testInfo, '09-battle');

  await page.locator('.btn-battle-exit').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'lobby');
  await expect(page.locator('.battle')).toHaveCount(0);
  await expect(page.locator('.nameplate .np-name')).toHaveText('RIVET');
});

test('T-10 settings: GRAPHICS toggles HIGH/LOW, SHOW FPS shows the FPS meter', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.lb-top-right .icon-btn').tap();
  const panel = page.locator('.set-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.set-title')).toHaveText('설정');

  const graphics = panel.locator('.set-row[data-row="graphics"]').locator('.btn-toggle');
  const fpsToggle = panel.locator('.set-row[data-row="fps"]').locator('.btn-toggle');
  const fpsMeter = page.locator('.fps');

  await expect(graphics).toHaveText('높음');
  await graphics.tap();
  await expect(graphics).toHaveText('낮음');
  expect((await storedSettings(page))?.quality).toBe('low');
  await graphics.tap();
  await expect(graphics).toHaveText('높음');
  expect((await storedSettings(page))?.quality).toBe('high');

  await expect(fpsToggle).toHaveText('끔');
  await expect(fpsMeter).toBeHidden();
  await fpsToggle.tap();
  await expect(fpsToggle).toHaveText('켬');
  await expect(fpsMeter).toBeVisible();
  await expect(fpsMeter).toHaveText(/^\d+ FPS$/);
  expect((await storedSettings(page))?.showFps).toBe(true);
  await shot(page, testInfo, '10-settings');

  await fpsToggle.tap();
  await expect(fpsToggle).toHaveText('끔');
  await expect(fpsMeter).toBeHidden();

  await panel.locator('.btn-close').tap();
  await expect(page.locator('.set-panel')).toHaveCount(0);
  await expect(page.locator('.lobby')).toBeVisible();
});

test.describe('on a 2x display', () => {
  test.use({ deviceScaleFactor: 2 });
  test('T-10 GRAPHICS LOW drops the canvas to 1x pixel ratio', async ({ page }) => {
    await gotoLobby(page);
    const canvasWidth = () => page.locator('#scene').evaluate((c: HTMLCanvasElement) => c.width);
    await expect.poll(canvasWidth).toBe(2560);
    await page.locator('.lb-top-right .icon-btn').tap();
    const graphics = page.locator('.set-row[data-row="graphics"]').locator('.btn-toggle');
    await graphics.tap();
    await expect(graphics).toHaveText('낮음');
    await expect.poll(canvasWidth).toBe(1280);
    await graphics.tap();
    await expect(graphics).toHaveText('높음');
    await expect.poll(canvasWidth).toBe(2560);
  });
});

test('T-11 tapping the lobby fighter opens the fighter list', async ({ page }) => {
  await gotoLobby(page);
  await page.locator('.stage-hit').tap();
  // Let the browser deliver the click that follows the tap, so a ghost click that falls through
  // to the newly shown screen (e.g. onto a fighter card) is caught instead of racing it.
  await page.waitForTimeout(800);
  await expect(page.locator('#app'), 'ends on the fighter list (not a fighter detail screen)').toHaveAttribute('data-bg', 'fighters');
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('.detail')).toHaveCount(0);
  await expect(page.locator('.lobby')).toHaveCount(0);
});

test.describe('portrait 800x1280', () => {
  test.use({ viewport: { width: 800, height: 1280 } });
  test('T-12 portrait shows ROTATE YOUR DEVICE over the whole screen', async ({ page }, testInfo) => {
    await page.goto('/');
    const overlay = page.locator('.rotate-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText('화면을 가로로 돌려 주세요');
    await expect(page.locator('html')).toHaveClass(/is-portrait/);

    const box = await overlay.boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: 800, height: 1280 });
    // It is the topmost element everywhere (covers title UI, canvas, etc.).
    const covered = await page.evaluate(() =>
      [
        [5, 5],
        [400, 640],
        [795, 1275],
        [400, 1200],
      ].every(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.rotate-overlay')),
    );
    expect(covered).toBe(true);
    await shot(page, testInfo, '12-portrait');

    // Rotating back to landscape removes the cover.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(overlay).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/is-portrait/);
  });
});

for (const vp of [
  { width: 1280, height: 712 },
  { width: 1280, height: 800 },
]) {
  test.describe(`lobby layout ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    const tag = vp.height === 712 ? 'short screen (address bar visible)' : 'baseline';
    test(`T-13 lobby buttons inside viewport and not overlapping — ${vp.width}x${vp.height} ${tag}`, async ({ page }, testInfo) => {
      await gotoLobby(page);
      const { problems, count } = await lobbyLayoutProblems(page, vp.width, vp.height);
      await shot(page, testInfo, `13-lobby-${vp.width}x${vp.height}`);
      expect(count).toBe(7 + 1 + 1 + 1 + 1 + 2 + 1); // 옆 버튼 7개(상점·캐릭터·상자 / 친구·파티·길드·랭킹)
      expect(problems).toEqual([]);
    });
  });
}

test('T-14 PWA: manifest (fullscreen, landscape, 192/512 icons) and service worker', async ({ page }) => {
  await openTitle(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toMatch(/manifest\.webmanifest$/);
  const manifestUrl = new URL(href!, page.url()).toString();
  const res = await page.request.get(manifestUrl);
  expect(res.status()).toBe(200);
  const m = (await res.json()) as {
    display: string;
    orientation: string;
    icons: { src: string; sizes: string; type?: string; purpose?: string }[];
  };
  expect(m.display).toBe('fullscreen');
  expect(m.orientation).toBe('landscape');

  for (const size of ['192x192', '512x512']) {
    const icon = m.icons.find(
      (i) => i.sizes.split(/\s+/).includes(size) && (!i.purpose || i.purpose.split(/\s+/).includes('any')),
    );
    expect(icon, `manifest has a ${size} "any" icon`).toBeTruthy();
    const r = await page.request.get(new URL(icon!.src, manifestUrl).toString());
    expect(r.status(), `${icon!.src} fetchable`).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    const png = await r.body();
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, `${icon!.src} real pixel size`).toBe(size);
  }

  // Service worker registers and becomes active.
  await expect
    .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 15_000 })
    .toBe(true);
  const active = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, state: r.active?.state ?? null })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]),
  );
  expect(active, 'navigator.serviceWorker.ready resolved').not.toBeNull();
  expect(active!.scope).toBe(new URL('/', page.url()).toString());
  expect(['activating', 'activated']).toContain(active!.state);
});
