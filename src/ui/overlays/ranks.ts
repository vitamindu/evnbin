import { el, icon } from '../../core/dom';
import { DIVISION_POINTS, RANK_LOSS, RANK_WIN, RANKED_MIN_PER_TEAM, TIERS, rankLabel, rankOf } from '../../data/ranks';
import { getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { rankEmblemSvg } from '../rankEmblem';
import { button, iconEl, txt } from '../widgets';

/** 티어 안내 팝업: 내 랭크 + 전체 티어 문양과 점수 */
export function openRanks(ctx: AppContext) {
  const r = rankOf(getProfile().rankPoints ?? 0);
  const list = el(
    'div',
    'rk-list',
    TIERS.map((t) => {
      const row = el('div', `rk-row${t.id === r.tier.id ? ' is-me' : ''}`, [
        icon(rankEmblemSvg(t.id), 'ico rk-emblem'),
        txt(t.name, 'rk-name'),
        txt(t.divisions ? `${t.min}+ · IV→I` : `${t.min}+`, 'rk-min'),
      ]);
      return row;
    }),
  );
  const overlay = el('div', 'overlay', [
    el('div', 'rk-panel panel', [
      el('div', 'set-head', [txt('RANKS', 'set-title'), button('btn-close', [iconEl('close')], () => overlay.remove(), 'back')]),
      el('div', 'rk-mine', [icon(rankEmblemSvg(r.tier.id), 'ico rk-emblem-big'), el('div', '', [txt(rankLabel(r), 'rk-mine-name'), txt(`${r.points} RP`, 'rk-mine-pts')])]),
      list,
      el('p', 'rk-rule', [
        `Win +${RANK_WIN} · Lose ${RANK_LOSS} · ${DIVISION_POINTS} RP per division. RP only changes in TEAM FIGHT with at least ${RANKED_MIN_PER_TEAM} players on each team and equal team sizes (bots don't count).`,
      ]),
      el('p', 'rk-rule rk-ko', [`티어 점수는 양 팀 모두 사람 ${RANKED_MIN_PER_TEAM}명 이상, 같은 인원일 때만 바뀌어요(봇 제외).`]),
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  ctx.overlayLayer.append(overlay);
}
