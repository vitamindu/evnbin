import { defineConfig } from 'vitest/config';

// 단위 테스트(게임 로직). 브라우저 E2E(Playwright)는 tests/*.spec.ts.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
