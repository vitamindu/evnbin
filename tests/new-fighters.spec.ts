import { type QaWindow, waitBattleReady } from './battle-helpers';
import { PROFILE_KEY, expect, gotoLobby, tapToLobby, test } from './fixtures';

test('T-37 REAPER·FISTER·CHAINER: 6열 목록과 상세 화면', async ({ page }, testInfo) => {
  await gotoLobby(page);
  await page.locator('.side-btn[data-btn="fighters"]').tap();
  await expect(page.locator('.fcard[data-fighter="reaper"] .fcard-name')).toHaveText('REAPER');
  await expect(page.locator('.fcard[data-fighter="fister"] .fcard-name')).toHaveText('FISTER');
  await expect(page.locator('.fcard[data-fighter="chainer"] .fcard-name')).toHaveText('CHAINER');
  // 11명과 곧 추가 카드를 포함해 모두 화면 안(1280×800)에 들어간다
  for (const card of await page.locator('.fcard').all()) {
    const b = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1280);
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  }
  await page.screenshot({ path: testInfo.outputPath('fighters-grid.png') });
  await page.locator('.fcard[data-fighter="chainer"]').tap();
  await expect(page.locator('.detail-name')).toHaveText('CHAINER');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('chainer.png') });
  await page.locator('.arrow-prev').tap();
  await page.locator('.arrow-prev').tap();
  await expect(page.locator('.detail-name')).toHaveText('REAPER');
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('reaper.png') });
});

test('TRUE FORM REAPER: 전설 스킨 모델·이펙트가 연습장에서 보인다', async ({ page }, testInfo) => {
  await page.addInitScript(
    ([key]) => {
      localStorage.setItem(key!, JSON.stringify({ selected: 'reaper', skins: ['reaper_trueform'], skinSel: { reaper: 'reaper_trueform' } }));
    },
    [PROFILE_KEY],
  );
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'reaper');
  const fxOk: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('effects/reaper/') && r.ok()) fxOk.push(r.url().split('/').pop()!);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('trueform-idle.png') });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('trueform-dash.png') });
  await page.evaluate(() => ((window as QaWindow).__fgBattle!.player.superCharge = 1));
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('trueform-super.png') });
  await expect.poll(() => fxOk.sort()).toEqual(['super.png', 'trail.png']);
});

test('CHAINER Q·E: 총알이 아니라 사슬(조준 미리보기, 내리치기, 던진 사슬)', async ({ page }, testInfo) => {
  await page.addInitScript(([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer' })), [PROFILE_KEY]);
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  const chainMeshes = () =>
    page.evaluate(() => {
      let n = 0;
      (window as QaWindow).__fgBattle!.view.scene.traverse((o) => {
        if (!(o as { isInstancedMesh?: boolean }).isInstancedMesh || o.renderOrder !== 5 || (o as { count: number }).count === 0) return; // 사슬(chainFx)만
        for (let p: typeof o | null = o; p; p = p.parent) if (!p.visible) return; // 숨겨진 조준 표시는 제외
        n++;
      });
      return n;
    });
  // 조준 미리보기: 원 + 사슬 두 가닥(화면이 조준을 지울 수 있어 걸어 가며 기다린다)
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const b = (window as QaWindow).__fgBattle!;
          b.view.setAim({ unitId: b.playerId, which: 'attack', aim: { x: 0, y: -1 } });
        });
        await page.waitForTimeout(150);
        return chainMeshes();
      },
      { timeout: 5000 },
    )
    .toBe(2);
  await page.screenshot({ path: testInfo.outputPath('chainer-q-aim.png') });
  await page.evaluate(() => (window as QaWindow).__fgBattle!.view.setAim(null));
  // Q: 투사체가 아니라 바닥 내리치기 + 사슬 두 가닥
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => (window as QaWindow).__fgBattle!.sim.lobs.filter((l) => l.slam).length), { timeout: 3000 })
    .toBe(1);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.projectiles.length)).toBe(0);
  expect(await chainMeshes()).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('chainer-q.png') });
  // 한 번 더 내리친다(탄 3개): 두 사슬이 만난 자리에서 터져 번쩍이는 그 순간을 바로 찍는다
  await page.waitForTimeout(1500);
  const burstCount = () => {
    let n = 0;
    (window as QaWindow).__fgBattle!.view.scene.traverse((o) => {
      const m = (o as unknown as { material?: { map?: unknown } }).material;
      if (o.renderOrder === 6 && m?.map) n++; // 번쩍임(이미지가 입혀진 이펙트)
    });
    return n;
  };
  await page.keyboard.press('Space');
  await page.waitForFunction(burstCount, null, { polling: 'raf', timeout: 5000 });
  await page.screenshot({ path: testInfo.outputPath('chainer-q-burst.png') });
  expect(await page.evaluate(burstCount)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(900);
  // E2: 던진 사슬(투사체 1개 + 사슬 1줄). 던진 직후 같은 화면에서 사슬을 센다
  await page.evaluate(() => (window as QaWindow).__fgBattle!.queueSkill({ x: -1, y: 0 })); // E1(짧은 돌진)
  await page.waitForFunction(() => (window as QaWindow).__fgBattle!.player.chainSkillPhase === 'chain' && !(window as QaWindow).__fgBattle!.player.action, null, { polling: 'raf' });
  await page.evaluate(() => (window as QaWindow).__fgBattle!.queueSkill({ x: -1, y: 0 })); // E2(사슬 던지기)
  await page.waitForFunction(() => (window as QaWindow).__fgBattle!.sim.projectiles.some((p) => p.chainSkill), null, { polling: 'raf' });
  await page.waitForTimeout(40);
  expect(await chainMeshes()).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('chainer-e.png') });
});

test('CHAINER 패시브: 중첩이 있으면 Q 내리치기 없이 궤도를 도는 빛줄기만 나간다', async ({ page }, testInfo) => {
  await page.addInitScript(([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer' })), [PROFILE_KEY]);
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  const whirls = () =>
    page.evaluate(() => {
      let n = 0;
      (window as QaWindow).__fgBattle!.view.scene.traverse((o) => {
        if (o.name === 'chain-whirl') n++;
      });
      return n;
    });
  // 패시브 중첩이 있어야 기본 공격이 회오리로 나간다
  await page.evaluate(() => ((window as QaWindow).__fgBattle!.player.passiveStacks = 1));
  await page.keyboard.press('Space');
  await expect.poll(whirls, { timeout: 3000 }).toBe(1);
  expect(await page.evaluate(() => (window as QaWindow).__fgBattle!.sim.lobs.length)).toBe(0); // Q는 안 나갔다
  await expect.poll(() => page.evaluate(() => (window as QaWindow).__fgBattle!.player.passiveStacks)).toBe(0);
  // 중첩이 없으면 다시 Q 내리치기
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => (window as QaWindow).__fgBattle!.sim.lobs.filter((l) => l.slam).length), { timeout: 3000 })
    .toBe(1);
});

test('CHAINER R: 총알이 아니라 사슬 한 줄(단사슬)이 날아간다', async ({ page }, testInfo) => {
  await page.addInitScript(([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer' })), [PROFILE_KEY]);
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  await page.evaluate(() => ((window as QaWindow).__fgBattle!.player.superCharge = 1));
  await page.keyboard.press('e'); // 자동 조준 궁극기
  // 복사 사슬 투사체가 떠 있는 동안: 사슬 메시 정확히 1개(한 줄), 총알 모양 탄 없음
  const seen = await page.waitForFunction(
    () => {
      const b = (window as QaWindow).__fgBattle!;
      if (!b.sim.projectiles.some((p) => p.stealsSuper)) return false;
      let chains = 0;
      b.view.scene.traverse((o) => {
        if ((o as { isInstancedMesh?: boolean }).isInstancedMesh && o.renderOrder === 5 && (o as { count: number }).count > 0) {
          for (let p: typeof o | null = o; p; p = p.parent) if (!p.visible) return;
          chains++;
        }
      });
      return chains;
    },
    null,
    { polling: 'raf', timeout: 5000 },
  );
  expect(await seen.jsonValue()).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('chainer-r.png') });
});

test('CRIMSON WARLORD(Chainer 전설 스킨): 사슬·회오리가 스킨 이미지로 그려진다', async ({ page }, testInfo) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key!, JSON.stringify({ selected: 'chainer', skins: ['chainer_crimson'], skinSel: { chainer: 'chainer_crimson' } })),
    [PROFILE_KEY],
  );
  await page.goto('/?qa');
  await tapToLobby(page);
  await page.locator('.btn-play').tap();
  await waitBattleReady(page, 'chainer');
  const count = (pred: string) =>
    page.evaluate((p) => {
      let n = 0;
      (window as QaWindow).__fgBattle!.view.scene.traverse((o) => {
        for (let q: typeof o | null = o; q; q = q.parent) if (!q.visible) return;
        if (p === 'sprite' && o.userData.chainSprite) n++;
        if (p === 'ring' && o.type === 'Group' && o.name === 'chain-whirl-image') n++;
        if (p === 'links' && (o as { isInstancedMesh?: boolean }).isInstancedMesh && o.renderOrder === 5 && (o as { count: number }).count > 0) n++;
      });
      return n;
    }, pred);
  // Q: 3D 고리 사슬이 아니라 스킨 이미지 사슬 두 가닥
  await page.keyboard.press('Space');
  await expect.poll(() => count('sprite'), { timeout: 3000 }).toBe(2);
  expect(await count('links')).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('crimson-q.png') });
  await page.waitForTimeout(1500);
  // 패시브: 소용돌이 고리 이미지
  await page.evaluate(() => ((window as QaWindow).__fgBattle!.player.passiveStacks = 1));
  await page.keyboard.press('Space');
  await expect.poll(() => count('ring'), { timeout: 3000 }).toBe(1);
});
