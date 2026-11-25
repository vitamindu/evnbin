import { el, icon } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { rankLabel, rankOf } from '../../data/ranks';
import { getProfile, mostPlayedFighter, onProfileChange } from '../../state/profile';
import { accountErrorCode, accountErrorText, getAccount, setAvatar } from '../account/accountApi';
import { avatarEl, fillAvatar, imageFileToAvatar } from '../avatar';
import type { AppContext } from '../context';
import { rankEmblemSvg } from '../rankEmblem';
import { toast } from './toast';
import { openHistory, summarize } from './history';
import { getHistory } from '../account/historyApi';
import { button, iconEl, roleChip, txt } from '../widgets';
import { myPortraitSrc } from '../portraits';

/**
 * 프로필 창(로비의 프로필 카드를 누르면 열린다).
 * 왼쪽: 가장 많이 쓴 파이터. 오른쪽: 프로필 사진, 닉네임, 티어 점수. 나머지 항목은 이후에 추가.
 */
export function openProfile(ctx: AppContext) {
  const p0 = getProfile();
  const photo = avatarEl(p0.name, p0.avatar, 'pf-avatar');
  const name = txt('', 'pf-name');
  const tag = el('span', 'pf-tag');
  const guildLine = el('span', 'pf-guild');
  const rankIco = el('span', 'pf-rank-ico');
  const rankName = txt('', 'pf-rank-name');
  const rankPts = txt('', 'pf-rank-pts');
  const fImg = el('img', 'pf-fighter-img');
  fImg.draggable = false;
  const fName = txt('', 'pf-fighter-name');
  const fRole = el('span', 'pf-fighter-role');
  const fGames = el('span', 'pf-fighter-games');
  const left = el('div', 'pf-left', [txt('가장 많이 사용한 파이터', 'pf-label'), fImg, fName, fRole, fGames]);

  // 사진 고르기: 숨긴 파일 입력(갤러리·카메라)
  const file = el('input') as HTMLInputElement;
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  let busy = false;
  const save = async (value: string | null, ok: string) => {
    if (busy) return;
    busy = true;
    try {
      await setAvatar(value);
      toast(ok);
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      busy = false;
    }
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    let url: string;
    try {
      url = await imageFileToAvatar(f);
    } catch {
      toast('이 이미지는 쓸 수 없어요');
      return;
    }
    await save(url, '프로필 사진을 바꿨어요');
  });
  const pick = () => {
    if (!getAccount()) {
      toast('로그인하면 프로필 사진을 등록할 수 있어요');
      return;
    }
    file.click();
  };
  const changeBtn = button('pf-btn', [txt('사진 바꾸기')], pick);
  const clearBtn = button('pf-btn pf-btn-sub', [txt('사진 지우기')], () => void save(null, '프로필 사진을 지웠어요'));
  const photoBtn = button('pf-photo', [photo, el('span', 'pf-photo-edit', [iconEl('gear')])], pick);

  const historyLine = txt('', 'pf-history');
  const historyBtn = button('pf-btn pf-btn-history', [iconEl('trophy'), txt('전적 보기')], () => openHistory(ctx));
  const right = el('div', 'pf-right', [
    el('div', 'pf-id', [photoBtn, el('div', 'pf-id-text', [name, tag, guildLine])]),
    el('div', 'pf-btns', [changeBtn, clearBtn]),
    el('div', 'pf-rank panel', [rankIco, el('div', 'pf-rank-text', [txt('티어 점수', 'pf-label'), rankName, rankPts])]),
    el('div', 'pf-history-row', [historyLine, historyBtn]),
    file,
  ]);

  const render = () => {
    const p = getProfile();
    const best = getFighter(mostPlayedFighter(p));
    left.style.setProperty('--c', best.palette.primary);
    photo.style.setProperty('--c', getFighter(p.selected).palette.primary);
    fillAvatar(photo, p.name, p.avatar);
    name.textContent = p.name;
    tag.textContent = `#${p.tag}`;
    guildLine.replaceChildren(iconEl('crew'), txt(p.guild ?? '길드 없음'));
    guildLine.classList.toggle('is-none', !p.guild);
    const r = rankOf(p.rankPoints ?? 0);
    rankIco.replaceChildren(icon(rankEmblemSvg(r.tier.id), 'ico pf-emblem'));
    rankName.textContent = rankLabel(r);
    rankPts.textContent = `${r.points} RP`;
    fImg.src = myPortraitSrc(ctx, best.id);
    fImg.alt = best.name;
    fName.textContent = best.name;
    fRole.replaceChildren(roleChip(best.id));
    const games = p.fighters[best.id]?.games ?? 0;
    fGames.replaceChildren(iconEl('trophy'), txt(String(p.fighters[best.id]?.trophies ?? 0)), txt(games ? `· ${games}판` : '', 'pf-games'));
    clearBtn.hidden = !p.avatar;
  };
  render();
  const off = onProfileChange(render);
  // 전적 요약 한 줄(로그인했을 때)
  if (getAccount()) {
    historyLine.textContent = '전적 불러오는 중…';
    getHistory()
      .then(({ totals }) => {
        const s = summarize(totals);
        historyLine.textContent = totals.games ? `${totals.games}판 · 승률 ${s.winRate}% · MVP ${totals.mvps}` : '아직 온라인 전적이 없어요';
      })
      .catch(() => (historyLine.textContent = ''));
  } else historyLine.textContent = '로그인하면 전적이 남아요';

  const close = () => {
    off();
    overlay.remove();
  };
  const overlay = el('div', 'overlay', [
    el('div', 'pf-panel panel', [
      el('div', 'set-head', [txt('프로필', 'set-title'), button('btn-close', [iconEl('close')], close, 'back')]),
      el('div', 'pf-body', [left, right]),
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  ctx.overlayLayer.append(overlay);
}
