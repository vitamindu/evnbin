import { defineConfig } from '@playwright/test';

/**
 * E2E: phase 1 (title → lobby → fighter select, tests/phase1.spec.ts) and phase 2
 * (offline battle, tests/phase2.spec.ts; battle tests open `/?qa` to read `window.__fgBattle`).
 * Runs against the production build served by `vite preview` on :4173. Build first
 * (`npm run test:e2e` does it). Test IDs follow docs/06-test-cases.md.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'tests',
  // 단위 테스트(tests/unit, vitest)는 제외하고 브라우저 시나리오만 실행
  testMatch: '*.spec.ts',
  testIgnore: 'unit/**',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // swiftshader WebGL is CPU-bound; keep parallelism modest so timing-sensitive checks stay stable.
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    deviceScaleFactor: 1,
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
