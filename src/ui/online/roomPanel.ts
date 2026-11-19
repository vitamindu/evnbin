import { RANKED_MIN_PER_TEAM, isRankedMatch } from '../../data/ranks';
import { el } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { getMap } from '../../data/maps';
import type { Team } from '../../game/types';
import type { OnlineClient } from '../../net/api';
import type { RoomPlayer, RoomState } from '../../net/protocol';
import { updateProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { openFighterPicker } from '../overlays/fighterPicker';
import { toast } from '../overlays/toast';
import { button, iconEl, txt } from '../widgets';
import { copyText, portrait, sideClass } from './widgets';

/**
 * 방 화면: 가운데 위 방 코드(복사), 왼쪽 TEAM A / 오른쪽 TEAM B 슬롯 3칸씩, 가운데 맵 미리보기,
 * 아래 팀 바꾸기·봇 채우기·준비(방장은 START).
 * 색은 "내 팀 = 파랑, 상대 = 빨강"(전투 화면과 같은 규칙). 팀 이름 A/B는 모두에게 같다.
 */
const TEAM_SIZE = 3;
const TEAM_NAME: Record<Team, string> = { 0: 'TEAM A', 1: 'TEAM B' };

/** 맵 글자 → 미리보기 색(src/game/world/grid.ts 범례) */
const MINI_COLORS: Record<string, string> = {
  '.': '#d8bb8c',
  ',': '#a3d46e',
  '=': '#cfc8b8',
  '#': '#9a6b45',
  X: '#2b3166',
  B: '#3aa556',
  W: '#4cb4ff',
};

function drawMinimap(canvas: HTMLCanvasElement, mapId: string, myTeam: Team) {
  let rows: string[];
  try {
    rows = getMap(mapId).rows;
  } catch {
    rows = [];
  }
  const g = canvas.getContext('2d');
  if (!g || !rows.length) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const t = Math.floor(Math.min(canvas.width / cols, canvas.height / rows.length));
  const ox = Math.floor((canvas.width - cols * t) / 2);
  const oy = Math.floor((canvas.height - rows.length * t) / 2);
  g.clearRect(0, 0, canvas.width, canvas.height);
  rows.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = row[x] ?? 'X';
      g.fillStyle = MINI_COLORS[ch] ?? MINI_COLORS['.']!;
      g.fillRect(ox + x * t, oy + y * t, t, t);
    }
  });
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== 'A' && ch !== 'Z') continue;
      const team: Team = ch === 'A' ? 0 : 1;
      g.fillStyle = team === myTeam ? '#3e8cff' : '#ff4f5e';
      g.strokeStyle = '#12102a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ox + (x + 0.5) * t, oy + (y + 0.5) * t, t * 0.62, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  });
}

export function createRoomPanel(ctx: AppContext, getClient: () => OnlineClient) {
  // ── 방 코드
  const codeText = txt('----', 'rc-code');
  const copyBtn = button('rc-copy', [iconEl('copy')], async () => {
    const code = getClient().room?.code;
    if (!code) return;
    toast((await copyText(code)) ? 'CODE COPIED' : `CODE: ${code}`);
  });
  const codeCard = el('div', 'room-code panel', [txt('ROOM CODE', 'rc-label'), el('div', 'rc-row', [codeText, copyBtn]), txt('SHARE IT WITH FRIENDS', 'rc-hint')]);

  // ── 팀 열
  const teamHead = (team: Team) => {
    const count = txt('0/3', 'th-count');
    const head = el('div', 'team-head', [txt(TEAM_NAME[team], 'th-name'), count]);
    return { head, count };
  };
  const headA = teamHead(0);
  const headB = teamHead(1);
  const slotsA = el('div', 'team-slots');
  const slotsB = el('div', 'team-slots');
  const colA = el('div', 'team-col team-a', [headA.head, slotsA]);
  const colB = el('div', 'team-col team-b', [headB.head, slotsB]);

  // ── 가운데: VS + 맵 미리보기 + 규칙
  const mini = el('canvas', 'room-minimap');
  mini.width = 264;
  mini.height = 152;
  const mapName = txt('', 'room-map-name');
  const center = el('div', 'room-center', [
    txt('VS', 'room-vs'),
    el('div', 'room-map panel', [mini, mapName]),
    el('div', 'room-facts', [txt('FIRST TO 10 KOs', 'room-fact'), txt('2:30', 'room-fact')]),
  ]);

  // ── 아래 줄
  const switchBtn = button('room-switch', [iconEl('swap'), txt('SWITCH TEAM')], () => {
    const c = getClient();
    const me = myPlayer(c);
    if (!me || !c.room) return;
    const other: Team = me.team === 0 ? 1 : 0;
    if (c.room.players.filter((p) => !p.bot && p.team === other).length >= TEAM_SIZE) {
      toast(`${TEAM_NAME[other]} IS FULL`);
      return;
    }
    c.setTeam(other);
  });
  const botsState = txt('OFF', 'rb-state');
  const botsBtn = button('room-bots', [iconEl('bot'), el('span', 'rb-text', [txt('FILL WITH BOTS', 'rb-label'), el('span', 'rb-switch', [el('i'), botsState])])], () => {
    const c = getClient();
    if (!c.room) return;
    if (!myPlayer(c)?.host) {
      toast('ONLY THE HOST CAN CHANGE THIS');
      return;
    }
    c.setFillBots(!c.room.fillBots);
  });
  const hint = txt('', 'room-hint');
  const readyLabel = txt('READY');
  const readyBtn = button('room-ready', [iconEl('check', 'ico ready-ico'), readyLabel], () => {
    const c = getClient();
    const me = myPlayer(c);
    if (me) c.setReady(!me.ready);
  });
  const startLabel = txt('START');
  let starting = 0;
  const startBtn = button(
    'room-start',
    [startLabel],
    () => {
      const c = getClient();
      const me = myPlayer(c);
      if (!me?.host || !c.room) return;
      if (startBtn.classList.contains('is-disabled')) {
        toast(hint.textContent || 'NOT READY YET');
        return;
      }
      if (!me.ready) c.setReady(true);
      c.startMatch();
      starting = performance.now();
      startLabel.textContent = 'STARTING…';
      startBtn.classList.add('is-disabled');
    },
    'select',
  );
  const actions = el('div', 'room-actions', [hint, el('div', 'room-go', [readyBtn, startBtn])]);
  const rankedTag = txt('', 'room-ranked');
  const root = el('div', 'room', [codeCard, colA, center, colB, el('div', 'room-tools', [switchBtn, botsBtn]), actions, rankedTag]);

  function myPlayer(c: OnlineClient): RoomPlayer | null {
    return c.room?.players.find((p) => p.id === c.playerId) ?? null;
  }

  const slot = (p: RoomPlayer | null, mine: boolean, side: string, fillBots: boolean) => {
    if (!p) {
      return el('div', `slot is-empty ${side}`, [
        el('span', 'slot-pf slot-pf-empty', [fillBots ? iconEl('bot', 'ico slot-bot-ico') : txt('?', 'slot-q')]),
        el('span', 'slot-text', [txt(fillBots ? 'BOT' : 'OPEN SLOT', 'slot-name'), txt(fillBots ? 'JOINS AT START' : 'WAITING FOR A FRIEND', 'slot-sub')]),
      ]);
    }
    const f = getFighter(p.fighterId);
    const tags: HTMLElement[] = [];
    if (mine) tags.push(txt('YOU', 'slot-tag tag-you'));
    if (p.bot) tags.push(el('span', 'slot-tag tag-bot', [iconEl('bot'), txt('BOT')]));
    if (!p.connected) tags.push(txt('OFFLINE', 'slot-tag tag-off'));
    const pf = el('span', 'slot-pf', [
      portrait(ctx, p.fighterId, 'portrait'),
      p.host ? iconEl('crown', 'ico slot-crown') : null,
      mine ? el('span', 'slot-edit', [iconEl('pencil')]) : null,
    ]);
    const sub = txt(f.name, 'slot-sub');
    sub.style.color = `color-mix(in srgb, ${f.palette.primary} 70%, white)`;
    const children: (HTMLElement | null)[] = [
      pf,
      el('span', 'slot-text', [el('span', 'slot-name-row', [txt(p.name, 'slot-name'), ...tags]), sub]),
      // 방장은 준비 대신 START를 누르므로 "NOT READY"는 띄우지 않는다
      p.bot || (p.host && !p.ready)
        ? null
        : el('span', `slot-ready ${p.ready ? 'is-on' : ''}`, [p.ready ? iconEl('check') : null, txt(p.ready ? 'READY' : 'NOT READY')]),
    ];
    const cls = `slot ${side}${mine ? ' is-me' : ''}${p.bot ? ' is-bot' : ''}${p.connected ? '' : ' is-off'}${p.ready ? ' is-ready' : ''}`;
    if (!mine) return el('div', cls, children);
    // 내 칸: 탭하면 캐릭터 고르기
    const b = button(cls, children.filter(Boolean) as Node[], () =>
      openFighterPicker(ctx, p.fighterId, (id) => {
        updateProfile((pr) => {
          pr.selected = id;
        });
        getClient().setFighter(id);
      }),
    );
    return b;
  };

  let lastMap = '';
  function render(room: RoomState) {
    const c = getClient();
    const me = myPlayer(c);
    const myTeam: Team = me?.team ?? 0;
    codeText.textContent = room.code;
    for (const [team, box, head] of [
      [0, slotsA, headA],
      [1, slotsB, headB],
    ] as const) {
      const side = sideClass(team, myTeam);
      const players = room.players.filter((p) => p.team === team).slice(0, TEAM_SIZE);
      const kids: HTMLElement[] = [];
      for (let i = 0; i < TEAM_SIZE; i++) {
        const p = players[i] ?? null;
        kids.push(slot(p, !!p && p.id === me?.id, side, room.fillBots));
      }
      box.replaceChildren(...kids);
      head.count.textContent = `${players.filter((p) => !p.bot).length}/${TEAM_SIZE}`;
      head.head.className = `team-head ${side}`;
    }
    colA.classList.toggle('is-mine', myTeam === 0);
    colB.classList.toggle('is-mine', myTeam === 1);

    const mapKey = `${room.mapId}:${myTeam}`;
    if (mapKey !== lastMap) {
      lastMap = mapKey;
      drawMinimap(mini, room.mapId, myTeam);
      let name = room.mapId.toUpperCase();
      try {
        name = getMap(room.mapId).name;
      } catch {
        /* 모르는 맵: id 그대로 */
      }
      mapName.textContent = name;
    }

    const host = !!me?.host;
    const lobby = room.phase === 'lobby';
    botsState.textContent = room.fillBots ? 'ON' : 'OFF';
    botsBtn.classList.toggle('is-on', room.fillBots);
    botsBtn.classList.toggle('is-locked', !host);
    const otherTeam: Team = myTeam === 0 ? 1 : 0;
    const otherFull = room.players.filter((p) => !p.bot && p.team === otherTeam).length >= TEAM_SIZE;
    switchBtn.classList.toggle('is-disabled', otherFull || !lobby);

    const others = room.players.filter((p) => !p.bot && p.id !== me?.id);
    const waiting = others.filter((p) => !p.ready && p.connected).length;
    const enough = room.fillBots || room.players.length >= 2;
    readyBtn.hidden = host;
    startBtn.hidden = !host;
    readyBtn.classList.toggle('is-on', !!me?.ready);
    readyLabel.textContent = me?.ready ? 'READY!' : 'READY';
    if (performance.now() - starting > 3000) startLabel.textContent = 'START';
    const canStart = host && lobby && waiting === 0 && enough && performance.now() - starting > 3000;
    startBtn.classList.toggle('is-disabled', !canStart);

    const humans: [number, number] = [0, 0];
    for (const pl of room.players) if (!pl.bot) humans[pl.team]++;
    const ranked = isRankedMatch(humans);
    rankedTag.textContent = ranked ? 'RANKED' : `UNRANKED · ${RANKED_MIN_PER_TEAM}+ VS ${RANKED_MIN_PER_TEAM}+ PLAYERS`;
    rankedTag.classList.toggle('is-ranked', ranked);
    let h: string;
    if (room.phase === 'playing') h = 'MATCH STARTING…';
    else if (room.phase === 'results') h = 'MATCH FINISHED';
    else if (host) {
      if (waiting > 0) h = `WAITING FOR ${waiting} PLAYER${waiting > 1 ? 'S' : ''} TO GET READY`;
      else if (!enough) h = 'INVITE A FRIEND OR TURN ON BOTS';
      else h = 'EVERYONE IS READY!';
    } else {
      h = me?.ready ? 'WAITING FOR THE HOST TO START' : 'TAP READY WHEN YOU ARE SET';
    }
    hint.textContent = h;
    hint.classList.toggle('is-go', host && canStart);
  }

  return { el: root, render };
}
