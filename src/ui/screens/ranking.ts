import '../../styles/online.css';
import { el, icon } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { getFighter } from '../../data/fighters';
import { rankLabel, rankOf } from '../../data/ranks';
import { accountErrorCode, accountErrorText, getAccount } from '../account/accountApi';
import { getRanking, type RankingEntry } from '../account/rankingApi';
import { avatarEl } from '../avatar';
import type { AppContext } from '../context';
import { rankEmblemSvg } from '../rankEmblem';
import { button, header, iconEl, txt } from '../widgets';
import { myPortraitSrc, portraitSrc } from '../portraits';

/**
 * 랭킹 화면(로비 오른쪽 "랭킹"). 서버의 모든 사람을 랭크 점수 순으로(위 100명), 내 순위는 아래에 고정.
 */
export function createRankingScreen(ctx: AppContext): Screen {
  let shown = false;
  const refreshBtn = button('icon-btn fr-refresh', [iconEl('refresh')], () => void load());
  const total = txt('', 'rk-total');
  const list = el('div', 'rkg-list');
  const mine = el('div', 'rkg-mine');
  const guest = el('div', 'fr-guest panel', [
    iconEl('trophy', 'ico fr-guest-ico'),
    txt('로그인하면 랭킹을 볼 수 있어요', 'fr-guest-t'),
    button('cp-btn is-go', [txt('로그인')], () => ctx.go.login(), 'select'),
  ]);
  const body = el('div', 'rkg-body panel', [el('div', 'rkg-head', [txt('랭크 점수 순위', 'fr-title'), total]), list, mine]);
  const root = el('div', 'ranking-screen', [header('랭킹', () => ctx.go.lobby(), refreshBtn), body, guest]);

  const row = (e: RankingEntry, isMe: boolean) => {
    const r = rankOf(e.rankPoints);
    const img = el('img', 'rkg-fighter');
    img.src = e.skin ? portraitSrc(ctx, e.fighterId, e.skin) : isMe ? myPortraitSrc(ctx, e.fighterId) : ctx.portraits[e.fighterId];
    img.alt = getFighter(e.fighterId).name;
    img.draggable = false;
    const medal = e.rank <= 3 ? ` is-top${e.rank}` : '';
    const line = el('div', `rkg-row${isMe ? ' is-me' : ''}${medal}`, [
      txt(String(e.rank), 'rkg-rank'),
      avatarEl(e.nickname, e.avatar, 'fr-avatar'),
      el('span', 'fr-names', [txt(e.nickname, 'fr-name'), txt(e.guild ? `길드 ${e.guild}` : '길드 없음', 'fr-rank')]),
      img,
      icon(rankEmblemSvg(r.tier.id), 'ico rkg-emblem'),
      el('span', 'rkg-tier', [txt(rankLabel(r), 'rkg-tier-name'), txt(`${e.rankPoints} RP`, 'rkg-rp')]),
    ]);
    line.dataset.nickname = e.nickname;
    return line;
  };

  async function load() {
    if (!getAccount()) return;
    refreshBtn.classList.add('is-spinning');
    list.replaceChildren(el('p', 'fr-empty', ['불러오는 중…']));
    try {
      const r = await getRanking();
      if (!shown) return;
      total.textContent = `전체 ${r.total}명`;
      const myName = getAccount()?.profile.name;
      list.replaceChildren(...r.top.map((e) => row(e, e.nickname === myName)));
      mine.replaceChildren(...(r.me ? [txt('내 순위', 'rkg-mine-label'), row(r.me, true)] : []));
    } catch (e) {
      if (shown) list.replaceChildren(el('p', 'fr-empty', [accountErrorText(accountErrorCode(e))]));
    } finally {
      refreshBtn.classList.remove('is-spinning');
    }
  }

  return {
    el: root,
    bg: 'online',
    onShow() {
      shown = true;
      ctx.stage.setView(null);
      const acct = !!getAccount();
      body.hidden = !acct;
      guest.hidden = acct;
      refreshBtn.hidden = !acct;
      void load();
    },
    onHide() {
      shown = false;
    },
  };
}
