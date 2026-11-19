import path from 'node:path';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

export const PROFILE_KEY = 'fg.profile.v1';
export const SETTINGS_KEY = 'fg.settings.v1';

/**
 * Shared fixture:
 * - `errors`: every console.error / uncaught page error seen during the test. The test fails if non-empty.
 * - localStorage profile/settings keys are cleared on the FIRST document load of each test only
 *   (guarded by a sessionStorage flag), so reloads inside a test (T-06) keep what the test saved.
 * - every `.toast` the game inserts is recorded in `window.__qaToasts`, so toast checks don't race
 *   the 1.5s toast animation on a slow (swiftshader) machine. See `expectNewToast`.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({}, use) => {
    await use([]);
  },
  page: async ({ page, errors }, use) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()} @ ${msg.location().url}:${msg.location().lineNumber}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.stack ?? err.message}`));
    await page.addInitScript(
      ([profileKey, settingsKey]) => {
        try {
          if (!sessionStorage.getItem('__qa_storage_cleared')) {
            localStorage.removeItem(profileKey!);
            localStorage.removeItem(settingsKey!);
            sessionStorage.setItem('__qa_storage_cleared', '1');
          }
        } catch {
          /* storage unavailable: nothing to clear */
        }
        const toasts: { text: string; rendered: boolean }[] = [];
        (window as unknown as { __qaToasts: typeof toasts }).__qaToasts = toasts;
        new MutationObserver((records) => {
          for (const r of records) {
            for (const n of r.addedNodes) {
              if (n instanceof HTMLElement && n.classList.contains('toast')) {
                toasts.push({ text: n.textContent ?? '', rendered: n.getClientRects().length > 0 });
              }
            }
          }
        }).observe(document, { childList: true, subtree: true });
      },
      [PROFILE_KEY, SETTINGS_KEY],
    );
    await use(page);
    expect(errors, 'console errors / page errors during the test').toEqual([]);
  },
});

export { expect };

/** Save a full-page screenshot under test-results/screenshots/ (gitignored). */
export async function shot(page: Page, testInfo: TestInfo, name: string) {
  const file = path.join(testInfo.project.outputDir, 'screenshots', `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Load the title screen and wait until it accepts a tap. */
export async function openTitle(page: Page) {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
}

/**
 * Phase 4: after TAP TO START comes the login / sign-up screen. Offline suites skip it with
 * PLAY OFFLINE (training only), which is always offered under the form.
 */
export async function passLogin(page: Page) {
  await expect(page.locator('.login')).toBeVisible();
  await page.locator('.auth-offline').tap();
  await expect(page.locator('.lobby')).toBeVisible();
}

/** Title → tap → login (play offline) → lobby. */
export async function tapToLobby(page: Page) {
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await passLogin(page);
}

export async function gotoLobby(page: Page) {
  await openTitle(page);
  await tapToLobby(page);
}

export async function gotoFighters(page: Page) {
  await gotoLobby(page);
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fighters')).toBeVisible();
}

/** Lobby → FIGHTERS → VOLLEY card → SELECT. Leaves the detail screen open. */
export async function selectVolley(page: Page) {
  await gotoFighters(page);
  await page.locator('.fcard[data-fighter="volley"]').tap();
  await expect(page.locator('.detail')).toBeVisible();
  await expect(page.locator('.detail-name')).toHaveText('VOLLEY');
  await page.locator('.btn-select').tap();
  await expect(page.locator('.btn-select')).toHaveText('선택됨');
}

type ToastRecord = { text: string; rendered: boolean };
const readToasts = (page: Page, from = 0) =>
  page.evaluate((n) => (window as unknown as { __qaToasts: ToastRecord[] }).__qaToasts.slice(n), from);

/** Number of toasts shown so far in this document. Take it before the action under test. */
export async function toastCount(page: Page): Promise<number> {
  return (await readToasts(page)).length;
}

/** Exactly one new `.toast` with `text` was rendered since `since` (from `toastCount`). */
export async function expectNewToast(page: Page, since: number, text: string, message?: string) {
  await expect.poll(() => readToasts(page, since), { message }).toEqual([{ text, rendered: true }]);
}

/** No new toast appears within `ms` after `since`. */
export async function expectNoNewToast(page: Page, since: number, ms = 500) {
  await page.waitForTimeout(ms);
  expect(await readToasts(page, since)).toEqual([]);
}

export async function storedProfile(page: Page): Promise<{ selected?: string } | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { selected?: string }) : null;
  }, PROFILE_KEY);
}

export async function storedSettings(page: Page): Promise<{ quality?: string; showFps?: boolean; playMode?: string } | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { quality?: string; showFps?: boolean; playMode?: string }) : null;
  }, SETTINGS_KEY);
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * T-13 helper: bounding boxes of the key lobby buttons; reports any box that leaves the viewport
 * or overlaps another one (0.5px tolerance).
 */
export async function lobbyLayoutProblems(page: Page, vw: number, vh: number) {
  const selectors = ['.side-btn', '.btn-play', '.pass-card', '.mode-card', '.profile-card', '.currency', '.icon-btn'];
  const items: { name: string; box: Box }[] = [];
  for (const sel of selectors) {
    const all = await page.locator(`.lobby ${sel}`).all();
    expect(all.length, `${sel} present`).toBeGreaterThan(0);
    for (let i = 0; i < all.length; i++) {
      const box = await all[i]!.boundingBox();
      expect(box, `${sel}[${i}] has a box`).not.toBeNull();
      const label = ((await all[i]!.innerText()).replace(/\s+/g, ' ').trim() || '').slice(0, 20);
      items.push({ name: `${sel}[${i}]${label ? ` "${label}"` : ''}`, box: box! });
    }
  }
  const eps = 0.5;
  const problems: string[] = [];
  const fmt = (b: Box) => `(${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}x${b.height.toFixed(1)})`;
  for (const { name, box } of items) {
    if (box.x < -eps || box.y < -eps || box.x + box.width > vw + eps || box.y + box.height > vh + eps) {
      problems.push(`${name} ${fmt(box)} outside viewport ${vw}x${vh}`);
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!.box;
      const b = items[j]!.box;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > eps && oy > eps) problems.push(`${items[i]!.name} ${fmt(a)} overlaps ${items[j]!.name} ${fmt(b)}`);
    }
  }
  return { problems, count: items.length };
}
