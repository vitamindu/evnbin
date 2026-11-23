import { rankLabel, rankOf } from '../../data/ranks';
import '../../styles/online.css';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { getFighter } from '../../data/fighters';
import type { Team } from '../../game/types';
import type { MatchResult, PlayerStats } from '../../net/protocol';
import { ShowcaseView } from '../../render/views/showcaseView';
import { equippedSkin, getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { getOnlineClient } from '../online/clientFactory';
import { portrait } from '../online/widgets';
import { button, iconEl, txt } from '../widgets';

/**
 * 온라인 경기 결과. UI 담당.
 * 왼쪽: 내 캐릭터(이기면 세리머니), 위: VICTORY!/DEFEAT/DRAW + 점수,
 * 오른쪽: 팀별 표(KO·DEATHS·DAMAGE, 가장 잘한 사람에게 별), 아래: 로비 / 방으로 돌아가기.
 * 색은 "내 팀 = 파랑"(전투 화면과 같은 규칙).
 */
export function createResultsScreen(ctx: AppContext) {
  const view = new ShowcaseView({
    fov: 26,
    camPos: [0, 1.35, 8.4],
    lookAtY: 0.95,
    ndcX: -0.6,
    baseYaw: 0.35,
    returnToBase: true,
  });

  const title = txt('', 'rs-title');
  const rankLine = txt('', 'rs-rank');
  const scoreMine = txt('0', 'rs-num');
  const scoreTheirs = txt('0', 'rs-num');
  const scoreLine = el('div', 'rs-score', [el('span', 'rs-box is-blue', [txt('우리 팀', 'rs-cap'), scoreMine]), txt('-', 'rs-dash'), el('span', 'rs-box is-red', [txt('상대 팀', 'rs-cap'), scoreTheirs])]);
  const tables = el('div', 'rs-tables');
  const roomBtn = button('rs-room', [txt('방으로 돌아가기')], () => ctx.go.online(), 'select');
  const lobbyBtn = button('rs-lobby', [iconEl('door'), txt('로비')], () => {
    const c = getOnlineClient();
    if (c.room) c.leaveRoom();
    c.disconnect();
    ctx.go.lobby();
  }, 'back');
  const root = el('div', 'results', [el('div', 'rs-head', [title, scoreLine, rankLine]), tables, el('div', 'rs-buttons', [lobbyBtn, roomBtn])]);

  let result: MatchResult | null = null;
  let celebrate = false;

  const table = (rows: PlayerStats[], side: 'is-blue' | 'is-red', heading: string, myId: string | null, mvp: string | null) => {
    const head = el('div', `rs-row rs-th ${side}`, [txt(heading, 'rs-team'), txt('KO', 'rs-c'), txt('쓰러짐', 'rs-c'), txt('피해량', 'rs-c rs-dmg')]);
    const body = rows.map((p) => {
      const f = getFighter(p.fighterId);
      return el('div', `rs-row ${side}${p.playerId === myId ? ' is-me' : ''}`, [
        el('span', 'rs-who', [
          portrait(ctx, p.fighterId, 'portrait rs-pf'),
          el('span', 'rs-names', [
            el('span', 'rs-name-row', [txt(p.name, 'rs-name'), p.playerId === myId ? txt('나', 'slot-tag tag-you') : null, p.playerId === mvp ? iconEl('star', 'ico rs-star') : null]),
            txt(f.name, 'rs-fighter'),
          ]),
        ]),
        txt(String(p.kills), 'rs-c rs-k'),
        txt(String(p.deaths), 'rs-c'),
        txt(p.damage.toLocaleString('en-US'), 'rs-c rs-dmg'),
      ]);
    });
    return el('div', `rs-table panel ${side}`, [head, ...body]);
  };

  function render() {
    const r = result;
    if (!r) return;
    const c = getOnlineClient();
    const myId = c.playerId;
    const me = r.stats.find((p) => p.playerId === myId);
    const myTeam: Team = me?.team ?? 0;
    const other: Team = myTeam === 0 ? 1 : 0;
    const outcome = r.winner === -1 ? 'draw' : r.winner === myTeam ? 'win' : 'lose';
    root.dataset.outcome = outcome;
    screen.bg = `results-${outcome}`;
    title.textContent = outcome === 'win' ? '승리!' : outcome === 'lose' ? '패배' : '무승부';
    if (!r.ranked) rankLine.textContent = '일반전 · 양 팀 인원이 달라요';
    else if (me?.rankPoints !== undefined) {
      const d = me.rankDelta ?? 0;
      rankLine.textContent = `${rankLabel(rankOf(me.rankPoints))}  ${d >= 0 ? '+' : ''}${d} RP`;
    } else rankLine.textContent = '랭크전 · 로그인하면 RP를 받아요';
    scoreMine.textContent = String(r.score[myTeam]);
    scoreTheirs.textContent = String(r.score[other]);
    // 최고 활약: KO가 가장 많은 사람(같으면 피해량) — 아무도 KO가 없으면 없음
    const best = [...r.stats].sort((a, b) => b.kills - a.kills || b.damage - a.damage)[0];
    const mvp = best && best.kills > 0 ? best.playerId : null;
    const sort = (t: Team) => r.stats.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    tables.replaceChildren(table(sort(myTeam), 'is-blue', '우리 팀', myId, mvp), table(sort(other), 'is-red', '상대 팀', myId, mvp));
    const fid = me?.fighterId ?? getProfile().selected;
    view.setFighter(fid, equippedSkin(getProfile(), fid));
    celebrate = outcome === 'win';
    roomBtn.hidden = !c.room;
  }

  const screen: Screen & { setResult(r: MatchResult): void } = {
    el: root,
    bg: 'results-win',
    setResult(r) {
      result = r;
      render();
    },
    onShow() {
      render();
      ctx.stage.setView(view);
      if (celebrate) window.setTimeout(() => view.celebrate(), 350);
    },
  };
  return screen;
}
