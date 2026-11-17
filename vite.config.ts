import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { GAME_TITLE, THEME_COLOR } from './src/config';

/** index.html 안의 %GAME_TITLE% 를 설정값으로 바꾼다. */
function injectTitle(): Plugin {
  return {
    name: 'inject-game-title',
    transformIndexHtml: (html) => html.replaceAll('%GAME_TITLE%', GAME_TITLE),
  };
}

export default defineConfig({
  // GitHub Pages(프로젝트 페이지)에서는 /저장소이름/ 아래에서 서비스되므로 빌드 시 BASE_PATH로 지정한다.
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    injectTitle(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: GAME_TITLE,
        short_name: GAME_TITLE,
        description: `${GAME_TITLE} — 3v3 arena shooter prototype`,
        lang: 'ko',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
