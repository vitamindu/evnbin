import { el } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { getMap } from '../../data/maps';
import type { MatchRecord } from '../account/historyApi';
import { getHistory } from '../account/historyApi';
import { accountErrorCode, accountErrorText, getAccount } from '../account/accountApi';
import type { AppContext } from '../context';
import { MODES } from './modePicker';
import { toast } from './toast';
import { summarize, timeAgo } from './historyMath';

export { summarize, timeAgo } from './historyMath';
import { button, iconEl, txt } from '../widgets';
import { myPortraitSrc } from '../portraits';

const OUTCOME: Record<MatchRecord['outcome'], string> = { win: '승리', draw: '무승부', loss: '패배' };

/**
 * 전적 창(프로필 창의 "전적 보기"). 위: 전체 합계. 아래: 최근 경기(누르면 그 판의 모든 플레이어).
 */
export function openHistory(ctx: AppContext) {
  if (!getAccount()) {
    toast('로그인하면 전적을 볼 수 있어요');
    return;
  }
  const summary = el('div', 'hs-summary');
  const list = el('div', 'hs-list', [el('p', 'fr-empty', ['불러오는 중…'])]);
  const close = () => overlay.remove();
  const overlay = el('div', 'overlay', [
    el('div', 'hs-panel panel', [el('div', 'set-head', [txt('전적', 'set-title'), button('btn-close', [iconEl('close')], close, 'back')]), summary, list]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  ctx.overlayLayer.append(overlay);

  const portrait = (id: MatchRecord['fighterId'], cls: string) => {
    const img = el('img', cls);
    img.src = myPortraitSrc(ctx, id);
    img.alt = '';
    img.draggable = false;
    return img;
  };
  const stat = (label: string, value: string, cls = '') => el('div', `hs-stat ${cls}`.trim(), [txt(value, 'hs-stat-v'), txt(label, 'hs-stat-l')]);

  const detail = (r: MatchRecord) => {
    const team = (ally: boolean) =>
      el(
        'div',
        `hs-team ${ally ? 'is-ally' : 'is-enemy'}`,
        r.players
          .filter((p) => p.ally === ally)
          .sort((a, b) => b.kills - a.kills || b.damage - a.damage)
          .map((p) =>
            el('div', `hs-player${p.me ? ' is-me' : ''}`, [
              portrait(p.fighterId, 'hs-p-img'),
              txt(p.bot ? `${p.name} (봇)` : p.name, 'hs-p-name'),
              txt(`${p.kills} / ${p.deaths}`, 'hs-p-kd'),
              txt(p.damage.toLocaleString('en-US'), 'hs-p-dmg'),
            ]),
          ),
      );
    return el('div', 'hs-detail', [team(true), team(false)]);
  };

  const row = (r: MatchRecord, i: number) => {
    const f = getFighter(r.fighterId);
    const mode = MODES[r.mode];
    let mapName = r.mapId;
    try {
      mapName = getMap(r.mapId).name;
    } catch {
      /* 없어진 맵 */
    }
    const img = el('img', 'hs-fighter');
    img.src = myPortraitSrc(ctx, r.fighterId);
    img.alt = f.name;
    img.draggable = false;
    const head = button(`hs-row is-${r.outcome}`, [
      el('span', 'hs-outcome', [txt(OUTCOME[r.outcome], 'hs-outcome-t'), txt(`${r.score[0]} : ${r.score[1]}`, 'hs-score')]),
      img,
      el('span', 'hs-mode', [txt(mode?.name ?? r.mode, 'hs-mode-name'), txt(mapName, 'hs-map')]),
      el('span', 'hs-kda', [txt(`${r.kills} / ${r.deaths}`, 'hs-kd'), txt('KO / 쓰러짐', 'hs-small')]),
      el('span', 'hs-dmg', [txt(r.damage.toLocaleString('en-US'), 'hs-dmg-v'), txt('피해량', 'hs-small')]),
      r.mvp ? el('span', 'hs-mvp', [iconEl('star'), txt('MVP')]) : el('span', 'hs-mvp is-empty'),
      txt(r.ranked && typeof r.rankDelta === 'number' ? `${r.rankDelta >= 0 ? '+' : ''}${r.rankDelta} RP` : '일반', `hs-rp${r.ranked ? (r.rankDelta! >= 0 ? ' is-up' : ' is-down') : ''}`),
      txt(timeAgo(r.at), 'hs-time'),
    ], () => {
      const open = wrap.classList.toggle('is-open');
      if (open && !wrap.querySelector('.hs-detail')) wrap.append(detail(r));
    }, false);
    const wrap = el('div', 'hs-item', [head]);
    wrap.dataset.index = String(i);
    return wrap;
  };

  getHistory()
    .then(({ records, totals }) => {
      const s = summarize(totals);
      summary.replaceChildren(
        stat('판', String(totals.games)),
        stat('승률', `${s.winRate}%`, 'is-rate'),
        stat('승 / 무 / 패', `${totals.wins} / ${totals.draws} / ${totals.losses}`),
        stat('KO / 쓰러짐', `${s.kd}`),
        stat('평균 피해', s.avgDamage.toLocaleString('en-US')),
        stat('MVP', String(totals.mvps)),
      );
      list.replaceChildren(...(records.length ? records.map(row) : [el('p', 'fr-empty', ['아직 온라인 경기 기록이 없어요. 온라인 대전을 해 보세요!'])]));
    })
    .catch((e) => list.replaceChildren(el('p', 'fr-empty', [accountErrorText(accountErrorCode(e))])));
}
