import { loadRankImages } from './ui/rankEmblem';
import '@fontsource/lilita-one/400.css';
import '@fontsource/black-han-sans/400.css';
import './styles/main.css';

import { sfx, unlockAudio } from './audio/sfx';
import { GAME_TITLE } from './config';
import { blockBrowserGestures, enterFullscreen } from './core/device';
import { el } from './core/dom';
import { setupLayout } from './core/layout';
import { ScreenManager } from './core/screens';
import { Stage } from './render/stage';
import { preloadGlbFighters } from './render/glbFighter';
import { renderPortraits } from './render/thumbnails';
import { getSettings, onSettingsChange } from './state/settings';
import type { AppContext } from './ui/context';
import { ICONS } from './ui/icons';
import { initToast } from './ui/overlays/toast';
import { createBattleScreen } from './ui/screens/battle';
import { createFighterDetailScreen } from './ui/screens/fighterDetail';
import { createFightersScreen } from './ui/screens/fighters';
import { initAccountSync } from './ui/account/session';
import { createFriendsScreen } from './ui/screens/friends';
import { createGuildScreen } from './ui/screens/guild';
import { createShopScreen } from './ui/screens/shop';
import { createPassScreen } from './ui/screens/pass';
import { createRankingScreen } from './ui/screens/ranking';
import { createLobbyScreen } from './ui/screens/lobby';
import { createLoginScreen } from './ui/screens/login';
import { createOnlineScreen } from './ui/screens/online';
import { createResultsScreen } from './ui/screens/results';
import { createTitleScreen } from './ui/screens/title';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

async function boot() {
  document.title = GAME_TITLE;
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  blockBrowserGestures();

  // 세로 화면 안내 + FPS 표시(설계 좌표 밖, 실제 화면 기준)
  const rotate = el('div', 'rotate-overlay', [el('div', 'rotate-box', [el('span', 'rotate-ico'), el('p', '', ['화면을 가로로 돌려 주세요'])])]);
  rotate.querySelector('.rotate-ico')!.innerHTML = ICONS.rotate;
  const fpsEl = el('div', 'fps');
  app.append(rotate, fpsEl);

  const stage = new Stage(canvas);
  const applySettings = () => {
    const s = getSettings();
    stage.setQuality(s.quality);
    fpsEl.hidden = !s.showFps;
  };
  setupLayout(ui, (w, h) => stage.resize(w, h));
  applySettings();
  onSettingsChange(applySettings);
  window.setInterval(() => {
    if (!fpsEl.hidden) fpsEl.textContent = `${stage.fps} FPS`;
  }, 500);

  const screens = new ScreenManager(app, ui);
  const overlayLayer = el('div', 'overlay-layer');
  ui.append(overlayLayer);
  initToast(overlayLayer);

  let loginScreen: ReturnType<typeof createLoginScreen> | null = null;
  const title = createTitleScreen(stage, () => {
    unlockAudio();
    sfx('start');
    void enterFullscreen();
    if (loginScreen) screens.show(loginScreen);
  });
  screens.show(title);
  stage.start();
  title.setProgress(0.1);

  // 폰트 로딩(한글은 필요한 글자 묶음만 받는다)
  await withTimeout(
    Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('40px "Black Han Sans"', '가')]),
    4000,
  );
  title.setProgress(0.4);
  // glb 캐릭터 모델(초상화를 그리기 전에 받아 둔다)
  await withTimeout(Promise.all([preloadGlbFighters(), loadRankImages()]), 15000);
  title.setProgress(0.6);
  await nextFrame();

  const { fighters: portraits, skins: skinPortraits } = renderPortraits();
  title.setProgress(0.8);
  await nextFrame();

  const ctx: AppContext = {
    stage,
    screens,
    overlayLayer,
    portraits,
    skinPortraits,
    go: {
      login: () => screens.show(login),
      lobby: () => screens.show(lobby),
      fighters: () => screens.show(fighters),
      friends: () => screens.show(friendsScreen),
      guild: () => screens.show(guildScreen),
      shop: () => screens.show(shopScreen),
      pass: () => screens.show(passScreen),
      ranking: () => screens.show(rankingScreen),
      fighterDetail: (id) => {
        detail.setFighter(id);
        screens.show(detail);
      },
      battle: (match) => {
        battle.configure(match ?? null);
        if (screens.active === battle) battle.restart();
        else screens.show(battle);
      },
      online: (auto) => {
        online.setAuto(auto ?? null);
        screens.show(online);
      },
      results: (result) => {
        results.setResult(result);
        screens.show(results);
      },
    },
  };
  const lobby = createLobbyScreen(ctx);
  const fighters = createFightersScreen(ctx);
  const detail = createFighterDetailScreen(ctx);
  const battle = createBattleScreen(ctx);
  const online = createOnlineScreen(ctx);
  const friendsScreen = createFriendsScreen(ctx);
  const guildScreen = createGuildScreen(ctx);
  const shopScreen = createShopScreen(ctx);
  const passScreen = createPassScreen(ctx);
  const rankingScreen = createRankingScreen(ctx);
  const results = createResultsScreen(ctx);
  const login = createLoginScreen(ctx);
  initAccountSync();
  loginScreen = login;

  title.setProgress(1);
  await nextFrame();
  title.setReady();
}

void boot();
