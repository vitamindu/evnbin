import type { Locator } from '@playwright/test';
import {
  expect,
  expectNewToast,
  expectNoNewToast,
  gotoFighters,
  gotoLobby,
  lobbyLayoutProblems,
  openTitle,
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
  await expect(tap).toHaveText('TAP TO START');
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
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('.title')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'lobby');
  await expect(page.locator('.nameplate .np-name')).toHaveText('RIVET');
  await expect(page.locator('.nameplate .role-chip')).toContainText('SCATTER');
  // docs/02 §1: the first tap also requests fullscreen (allowed only inside a user gesture).
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await shot(page, testInfo, '02-lobby');
});

test('T-03 FIGHTERS button opens list: 3 cards + MORE SOON, RIVET SELECTED', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.side-btn', { hasText: 'FIGHTERS' }).tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-bg', 'fighters');

  const cards = page.locator('.fighter-grid .fcard');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.fcard[data-fighter]')).toHaveCount(3);
  await expect(page.locator('.fcard[data-fighter] .fcard-name')).toHaveText(['RIVET', 'VOLLEY', 'BOULDER']);
  await expect(page.locator('.fcard-soon')).toContainText('MORE SOON');
  await expect(cards.last()).toHaveClass(/fcard-soon/);

  const rivet = page.locator('.fcard[data-fighter="rivet"]');
  await expect(rivet).toHaveClass(/is-selected/);
  await expect(rivet.locator('.fcard-selected')).toHaveText('SELECTED');
  await expect(page.locator('.fcard-selected')).toHaveCount(1);
  await expect(page.locator('.fcard.is-selected')).toHaveCount(1);

  // Portraits were rendered (data URLs from the offscreen WebGL pass) and actually decoded.
  for (const id of ['rivet', 'volley', 'boulder']) {
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
  await expect(selectBtn).toHaveText('SELECT');
  await expect(selectBtn).not.toHaveClass(/is-selected/);

  let toasts = await toastCount(page);
  await selectBtn.tap();
  await expect(selectBtn).toHaveText('SELECTED');
  await expect(selectBtn).toHaveClass(/is-selected/);
  await expectNewToast(page, toasts, 'VOLLEY SELECTED');
  expect((await storedProfile(page))?.selected).toBe('volley');
  await shot(page, testInfo, '04-detail-volley-selected');

  // Tapping SELECT again on the already-selected fighter is a no-op (no new toast).
  toasts = await toastCount(page);
  await selectBtn.tap();
  await expectNoNewToast(page, toasts);
  await expect(selectBtn).toHaveText('SELECTED');
});

test('T-05 back twice: lobby nameplate shows VOLLEY', async ({ page }) => {
  await selectVolley(page);

  await page.locator('.detail .btn-back').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('.fcard[data-fighter="volley"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fcard[data-fighter="volley"] .fcard-selected')).toHaveText('SELECTED');
  await expect(page.locator('.fcard[data-fighter="rivet"]')).not.toHaveClass(/is-selected/);
  await expect(page.locator('.fcard-selected')).toHaveCount(1);

  await page.locator('.fighters .btn-back').tap();
  await expect(page.locator('.lobby')).toBeVisible();
  await expect(page.locator('.nameplate .np-name')).toHaveText('VOLLEY');
  await expect(page.locator('.nameplate .role-chip')).toContainText('MARKSMAN');
});

test('T-06 selection persists across reload (VOLLEY)', async ({ page }) => {
  await selectVolley(page);
  expect((await storedProfile(page))?.selected).toBe('volley');

  await page.reload();
  await tapToLobby(page);
  await expect(page.locator('.nameplate .np-name')).toHaveText('VOLLEY');

  await page.locator('.side-btn', { hasText: 'FIGHTERS' }).tap();
  await expect(page.locator('.fcard[data-fighter="volley"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.fcard-selected')).toHaveCount(1);
});

test('T-07 detail arrows cycle RIVET → VOLLEY → BOULDER → RIVET', async ({ page }) => {
  await gotoFighters(page);
  await page.locator('.fcard[data-fighter="rivet"]').tap();
  const name = page.locator('.detail-name');
  const selectBtn = page.locator('.btn-select');
  await expect(name).toHaveText('RIVET');
  await expect(selectBtn).toHaveText('SELECTED');

  const next = page.locator('.arrow-next');
  const prev = page.locator('.arrow-prev');
  for (const expected of ['VOLLEY', 'BOULDER', 'RIVET']) {
    await next.tap();
    await expect(name).toHaveText(expected);
    // SELECT label tracks whether the shown fighter is the selected one (RIVET by default).
    await expect(selectBtn).toHaveText(expected === 'RIVET' ? 'SELECTED' : 'SELECT');
  }
  for (const expected of ['BOULDER', 'VOLLEY', 'RIVET']) {
    await prev.tap();
    await expect(name).toHaveText(expected);
  }
});

test('T-08 not-yet-available buttons show COMING SOON and stay on the lobby', async ({ page }) => {
  await gotoLobby(page);
  const targets: [string, Locator][] = [
    ['SHOP', page.locator('.side-btn', { hasText: 'SHOP' })],
    ['NEWS', page.locator('.side-btn', { hasText: 'NEWS' })],
    ['FRIENDS', page.locator('.side-btn', { hasText: 'FRIENDS' })],
    ['PARTY', page.locator('.side-btn', { hasText: 'PARTY' })],
    ['CREW', page.locator('.side-btn', { hasText: 'CREW' })],
    ['SEASON PASS', page.locator('.pass-card')],
    ['MODE', page.locator('.mode-card')],
    ['+ left', page.locator('.party-slot.slot-left')],
    ['+ right', page.locator('.party-slot.slot-right')],
    // Also "준비 중" per docs/02 §2 lobby table:
    ['profile card', page.locator('.profile-card')],
    ['trophy card', page.locator('.trophy-card')],
    ['coins', page.locator('.lb-top-right .currency').nth(0)],
    ['crystals', page.locator('.lb-top-right .currency').nth(1)],
  ];
  for (const [label, loc] of targets) {
    await test.step(label, async () => {
      const toasts = await toastCount(page);
      await loc.tap();
      await expectNewToast(page, toasts, 'COMING SOON', `${label} → COMING SOON toast`);
      await expect(page.locator('.lobby'), `${label} → still lobby`).toBeVisible();
      await expect(page.locator('#app')).toHaveAttribute('data-bg', 'lobby');
      await expect(page.locator('.overlay'), `${label} → no popup`).toHaveCount(0);
    });
  }
});

test('T-09 PLAY opens matchmaking, timer runs, CANCEL closes it', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.btn-play').tap();
  const panel = page.locator('.mm-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.mm-title')).toHaveText('SEARCHING');
  await expect(panel.locator('.mm-slot')).toHaveCount(6);
  await expect(panel.locator('.mm-me img')).toHaveAttribute('alt', 'RIVET');

  const time = panel.locator('.mm-time');
  const seconds = async () => {
    const [m, s] = (await time.innerText()).split(':').map(Number);
    return m! * 60 + s!;
  };
  await expect(time).toHaveText(/^\d+:\d{2}$/);
  const start = await seconds();
  await expect.poll(seconds, { message: 'elapsed time increases', timeout: 6_000 }).toBeGreaterThanOrEqual(start + 2);
  await shot(page, testInfo, '09-matchmaking');

  await panel.locator('.btn-cancel').tap();
  await expect(page.locator('.mm-panel')).toHaveCount(0);
  await expect(page.locator('.overlay')).toHaveCount(0);
  await expect(page.locator('.lobby')).toBeVisible();
});

test('T-10 settings: GRAPHICS toggles HIGH/LOW, SHOW FPS shows the FPS meter', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.lb-top-right .icon-btn').tap();
  const panel = page.locator('.set-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.set-title')).toHaveText('SETTINGS');

  const graphics = panel.locator('.set-row', { hasText: 'GRAPHICS' }).locator('.btn-toggle');
  const fpsToggle = panel.locator('.set-row', { hasText: 'SHOW FPS' }).locator('.btn-toggle');
  const fpsMeter = page.locator('.fps');

  await expect(graphics).toHaveText('HIGH');
  await graphics.tap();
  await expect(graphics).toHaveText('LOW');
  expect((await storedSettings(page))?.quality).toBe('low');
  await graphics.tap();
  await expect(graphics).toHaveText('HIGH');
  expect((await storedSettings(page))?.quality).toBe('high');

  await expect(fpsToggle).toHaveText('OFF');
  await expect(fpsMeter).toBeHidden();
  await fpsToggle.tap();
  await expect(fpsToggle).toHaveText('ON');
  await expect(fpsMeter).toBeVisible();
  await expect(fpsMeter).toHaveText(/^\d+ FPS$/);
  expect((await storedSettings(page))?.showFps).toBe(true);
  await shot(page, testInfo, '10-settings');

  await fpsToggle.tap();
  await expect(fpsToggle).toHaveText('OFF');
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
    const graphics = page.locator('.set-row', { hasText: 'GRAPHICS' }).locator('.btn-toggle');
    await graphics.tap();
    await expect(graphics).toHaveText('LOW');
    await expect.poll(canvasWidth).toBe(1280);
    await graphics.tap();
    await expect(graphics).toHaveText('HIGH');
    await expect.poll(canvasWidth).toBe(2560);
  });
});

test('T-11 tapping the lobby fighter opens the fighter list', async ({ page }) => {
  await gotoLobby(page);
  await page.locator('.stage-hit').tap();
  await expect(page.locator('.fighters')).toBeVisible();
  await expect(page.locator('.lobby')).toHaveCount(0);
});

test.describe('portrait 800x1280', () => {
  test.use({ viewport: { width: 800, height: 1280 } });
  test('T-12 portrait shows ROTATE YOUR DEVICE over the whole screen', async ({ page }, testInfo) => {
    await page.goto('/');
    const overlay = page.locator('.rotate-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveText('ROTATE YOUR DEVICE');
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
      expect(count).toBe(6 + 1 + 1 + 1 + 1 + 2 + 1);
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
