import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** 길드 화면(로비 "길드"). ?fakeonline 가짜 계정 + 가짜 길드(벚꽃연합, NightOwls) */
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

test('lobby: 길드 button on the right, 상자 moved to the left', async ({ page }) => {
  await signup(page, 'guild0', '길드영');
  await expect(page.locator('.lb-side-right .side-btn[data-btn="crew"]')).toContainText('길드');
  await expect(page.locator('.lb-side-left .side-btn[data-btn="box"]')).toBeVisible();
  await expect(page.locator('.lb-side-right .side-btn[data-btn="box"]')).toHaveCount(0);
});

/** 가짜 계정에 코인·다이아를 넣고 다시 로그인(토큰으로 자동) */
async function giveMoney(page: Page, id: string, coins: number, crystals: number) {
  await page.evaluate(
    ([key, c, g]) => {
      const all = JSON.parse(localStorage.getItem('fg.fakeaccounts.v2') ?? '{}');
      all[key as string].profile.coins = c;
      all[key as string].profile.crystals = g;
      localStorage.setItem('fg.fakeaccounts.v2', JSON.stringify(all));
    },
    [id, coins, crystals] as const,
  );
  await page.reload();
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await expect(page.locator('.lobby')).toBeVisible();
}

const openGuildScreen = async (page: Page) => {
  await page.locator('.side-btn[data-btn="crew"]').tap();
  await expect(page.locator('.guild-screen')).toBeVisible();
};

test('create a guild: master, settings, profile shows it, leave', async ({ page }, info) => {
  await signup(page, 'guild1', '번개짱');
  // 돈이 모자라면 못 만든다
  await openGuildScreen(page);
  await expect(page.locator('.gd-cost')).toContainText('2,000');
  await expect(page.locator('.gd-cost')).toContainText('100');
  await page.locator('.gd-none .fr-addpanel .fr-input').nth(0).fill('번개팀');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-none .fr-err')).toHaveText('코인이 부족해요');
  await page.locator('.hdr .btn-back').tap();
  await giveMoney(page, 'guild1', 2500, 120);
  await openGuildScreen(page);
  await expect(page.locator('.gd-none')).toBeVisible();
  await expect(page.locator('.gd-row')).toHaveCount(2);
  const inputs = page.locator('.gd-none .fr-addpanel .fr-input');
  await inputs.nth(0).fill('번개팀');
  await inputs.nth(1).fill('매일 저녁 모여요');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-in')).toBeVisible();
  await expect(page.locator('.gd-name')).toHaveText('번개팀');
  await expect(page.locator('.gd-myrole')).toHaveText('내 직급 · 마스터');
  await expect(page.locator('.gd-in .fr-row[data-nickname="번개짱"] .gd-role')).toContainText('마스터');
  // 마스터만: 가입 방식(처음엔 승인 필요) + 가입 요청 탭
  await expect(page.locator('.gd-seg.is-on')).toHaveText('승인 필요');
  await page.locator('.gd-seg', { hasText: '자유 가입' }).tap();
  await expect(page.locator('.gd-seg.is-on')).toHaveText('자유 가입');
  await expect(page.locator('.gd-tab-requests')).toBeVisible();
  // 채팅: 만들었다는 알림
  await page.locator('.gd-tab-chat').tap();
  await expect(page.locator('.gd-msg.is-system').first()).toContainText('길드를 만들었어요');
  await page.screenshot({ path: info.outputPath('guild-master.png') });

  await page.locator('.hdr .btn-back').tap();
  // 비용이 빠졌다: 2500 - 2000, 120 - 100
  await expect(page.locator('.lb-top-right .currency').nth(0)).toHaveText('500');
  await expect(page.locator('.lb-top-right .currency').nth(1)).toHaveText('20');
  await page.locator('.profile-card').tap();
  await expect(page.locator('.pf-guild')).toHaveText('번개팀');
  await page.locator('.pf-panel .btn-close').tap();

  await openGuildScreen(page);
  await page.locator('.gd-leave').tap();
  await page.locator('.gd-confirm-leave').tap();
  await expect(page.locator('.gd-none')).toBeVisible();
  await expect(page.locator('.gd-row[data-guild="번개팀"]')).toHaveCount(0);
});

test('member: join an open guild directly, chat, no management; approval guilds take a request', async ({ page }, info) => {
  await signup(page, 'guild2', '가입자');
  await openGuildScreen(page);
  // 이름 겹침
  await page.locator('.gd-none .fr-addpanel .fr-input').nth(0).fill('벚꽃연합');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-none .fr-err')).toHaveText('이미 있는 길드 이름이에요');
  // 승인 필요 길드 → 요청만
  await page.locator('.gd-row[data-guild="NightOwls"] .gd-join').tap();
  await expect(page.locator('.gd-row[data-guild="NightOwls"] .gd-join')).toHaveText('요청함');
  await expect(page.locator('.gd-none')).toBeVisible();
  // 자유 가입 길드 → 바로
  await page.locator('.gd-none .fr-listpanel .fr-input').fill('벚꽃');
  await page.locator('.gd-search').tap();
  await expect(page.locator('.gd-row')).toHaveCount(1);
  await page.locator('.gd-row[data-guild="벚꽃연합"] .gd-join').tap();
  await expect(page.locator('.gd-name')).toHaveText('벚꽃연합');
  await expect(page.locator('.gd-myrole')).toHaveText('내 직급 · 멤버');
  await expect(page.locator('.gd-members .fr-row')).toHaveCount(4);
  await expect(page.locator('.gd-in .fr-row[data-nickname="모찌"] .gd-role')).toContainText('마스터');
  await expect(page.locator('.gd-in .fr-row[data-nickname="픽셀"] .gd-role')).toContainText('부마스터');
  await expect(page.locator('.gd-manage')).toHaveCount(0);
  await expect(page.locator('.gd-tab-requests')).toBeHidden();
  await expect(page.locator('.gd-settings')).toBeHidden();
  // 채팅
  await page.locator('.gd-tab-chat').tap();
  await expect(page.locator('.gd-msg', { hasText: '크리스탈 러시' })).toBeVisible();
  await page.locator('.gd-chat-input').fill('안녕하세요! 잘 부탁해요');
  await page.locator('.gd-send').tap();
  await expect(page.locator('.gd-msg.is-mine')).toContainText('안녕하세요! 잘 부탁해요');
  await page.screenshot({ path: info.outputPath('guild-chat.png') });
});

test('master manages: accept a request, appoint a vice, kick a member', async ({ page }, info) => {
  await signup(page, 'guild3', '마스터짱');
  await giveMoney(page, 'guild3', 2000, 100);
  await openGuildScreen(page);
  await page.locator('.gd-none .fr-addpanel .fr-input').nth(0).fill('천둥');
  await page.locator('.gd-create').tap();
  await expect(page.locator('.gd-name')).toHaveText('천둥');
  // 가짜 저장소에 멤버 2명과 가입 요청 1개를 넣는다
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('fg.fakeguilds.v2')!);
    const g = l.find((x: { name: string }) => x.name === '천둥');
    g.members.push('하나', '두리');
    g.requests.push('세찌');
    localStorage.setItem('fg.fakeguilds.v2', JSON.stringify(l));
  });
  await page.locator('.fr-refresh').tap();
  await expect(page.locator('.gd-members .fr-row')).toHaveCount(3);
  await expect(page.locator('.gd-req-badge')).toHaveText('1');

  await page.locator('.gd-tab-requests').tap();
  await page.locator('.gd-requests .fr-row[data-nickname="세찌"] .gd-accept').tap();
  await expect(page.locator('.gd-requests .fr-empty')).toHaveText('가입 요청이 없어요');
  await page.locator('.gd-tab-members').tap();
  await expect(page.locator('.gd-members .fr-row')).toHaveCount(4);

  await page.locator('.gd-members .fr-row[data-nickname="하나"] .gd-manage').tap();
  await page.locator('.gd-vice-btn').tap();
  await expect(page.locator('.gd-members .fr-row[data-nickname="하나"] .gd-role')).toContainText('부마스터');

  await page.locator('.gd-members .fr-row[data-nickname="두리"] .gd-manage').tap();
  await page.locator('.gd-kick-btn').tap();
  await page.locator('.gd-confirm-kick').tap();
  await expect(page.locator('.gd-members .fr-row[data-nickname="두리"]')).toHaveCount(0);
  await expect(page.locator('.gd-members .fr-row')).toHaveCount(3);
  // 자기 자신에게는 관리 버튼이 없다
  await expect(page.locator('.gd-members .fr-row[data-nickname="마스터짱"] .gd-manage')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('guild-manage.png') });
});

test('vice can kick members but not the master, and cannot appoint', async ({ page }) => {
  await signup(page, 'guild4', '부마짱');
  await openGuildScreen(page);
  await page.locator('.gd-row[data-guild="벚꽃연합"] .gd-join').tap();
  await expect(page.locator('.gd-name')).toHaveText('벚꽃연합');
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('fg.fakeguilds.v2')!);
    const g = l.find((x: { name: string }) => x.name === '벚꽃연합');
    g.vices.push('부마짱');
    localStorage.setItem('fg.fakeguilds.v2', JSON.stringify(l));
  });
  await page.locator('.fr-refresh').tap();
  await expect(page.locator('.gd-myrole')).toHaveText('내 직급 · 부마스터');
  await expect(page.locator('.gd-members .fr-row[data-nickname="모찌"] .gd-manage')).toHaveCount(0);
  await page.locator('.gd-members .fr-row[data-nickname="픽셀"] .gd-manage').tap();
  await expect(page.locator('.gd-vice-btn')).toHaveCount(0);
  await expect(page.locator('.gd-kick-btn')).toBeVisible();
  await page.locator('.gd-kick-btn').tap();
  await page.locator('.gd-confirm-kick').tap();
  await expect(page.locator('.gd-members .fr-row[data-nickname="픽셀"]')).toHaveCount(0);
  await expect(page.locator('.gd-settings')).toBeHidden();
  await expect(page.locator('.gd-tab-requests')).toBeVisible();
});

test('guests are asked to log in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title-tap')).toBeVisible({ timeout: 30_000 });
  await page.locator('.title').tap();
  await page.locator('.auth-offline').tap();
  await page.locator('.side-btn[data-btn="crew"]').tap();
  await expect(page.locator('.guild-screen .fr-guest')).toBeVisible();
});
