import '../../styles/online.css';
import { el, icon } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { rankLabel, rankOf } from '../../data/ranks';
import { GUILD_DESC_MAX, GUILD_NAME_MAX } from '../../net/accountApi';
import type { AppContext } from '../context';
import { accountErrorCode, accountErrorText, getAccount } from '../account/accountApi';
import { createGuild, joinGuild, leaveGuild, myGuild, searchGuilds, type GuildInfo, type GuildMember, type GuildSummary } from '../account/guildApi';
import { avatarEl } from '../avatar';
import { toast } from '../overlays/toast';
import { rankEmblemSvg } from '../rankEmblem';
import { button, header, iconEl, txt } from '../widgets';

/**
 * 길드 화면(로비 길드 버튼).
 * - 길드 없음: 왼쪽 길드 만들기(이름·소개), 오른쪽 길드 찾기(이름 검색 → 가입).
 * - 길드 있음: 왼쪽 길드 정보(이름·소개·길드장·인원, 나가기), 오른쪽 멤버 목록.
 * - 게스트: 로그인 안내.
 * 채팅·길드 전용 보상 등은 이후 추가.
 */
export function createGuildScreen(ctx: AppContext): Screen {
  let shown = false;
  let busy = false;
  let confirmEl: HTMLElement | null = null;

  const refreshBtn = button('icon-btn fr-refresh', [iconEl('refresh')], () => void load());
  const hdr = header('길드', () => ctx.go.lobby(), refreshBtn);

  const input = (placeholder: string, max: number, cls = 'fr-input') => {
    const i = el('input', cls);
    i.type = 'text';
    i.maxLength = max;
    i.spellcheck = false;
    i.autocomplete = 'off';
    i.placeholder = placeholder;
    return i;
  };
  const errText = (e: unknown, ctxt: 'join' | 'other' = 'other') => {
    const c = accountErrorCode(e);
    return c === 'not_found' && ctxt === 'join' ? '그런 길드는 없어요' : accountErrorText(c);
  };

  // ── 길드 없음: 만들기
  const nameIn = input('길드 이름(2~12자)', GUILD_NAME_MAX);
  const descIn = input('소개(선택, 40자까지)', GUILD_DESC_MAX);
  nameIn.setAttribute('aria-label', 'Guild name');
  const createErr = txt('', 'fr-err');
  const createBtn = button('fr-add gd-create', [iconEl('plus'), txt('만들기')], () => void create(), 'select');
  const createPanel = el('div', 'fr-addpanel panel', [
    txt('길드 만들기', 'fr-title'),
    el('p', 'fr-desc', ['만든 사람이 길드장이 돼요']),
    el('span', 'auth-box fr-box', [nameIn]),
    el('span', 'auth-box fr-box', [descIn]),
    el('div', 'fr-addrow', [createBtn]),
    createErr,
  ]);
  nameIn.addEventListener('input', () => (createErr.textContent = ''));

  // ── 길드 없음: 찾기
  const searchIn = input('길드 이름 검색', GUILD_NAME_MAX);
  searchIn.enterKeyHint = 'search';
  searchIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void search();
  });
  const searchBtn = button('fr-add gd-search', [txt('찾기')], () => void search());
  const findList = el('div', 'fr-list');
  const findPanel = el('div', 'fr-listpanel panel', [
    el('div', 'fr-listhead', [txt('길드 찾기', 'fr-title')]),
    el('div', 'fr-addrow', [el('span', 'auth-box fr-box', [searchIn]), searchBtn]),
    findList,
  ]);
  const noGuild = el('div', 'fr-body gd-none', [createPanel, findPanel]);

  // ── 길드 있음
  const gName = txt('', 'gd-name');
  const gDesc = el('p', 'fr-desc gd-desc');
  const gLeader = txt('', 'gd-meta');
  const gCount = txt('', 'gd-meta');
  const leaveBtn = button('cp-btn is-danger gd-leave', [txt('길드 나가기')], () => confirmLeave(), 'back');
  const infoPanel = el('div', 'fr-addpanel panel gd-info', [iconEl('crew', 'ico gd-ico'), gName, gDesc, gLeader, gCount, leaveBtn]);
  const memberCount = txt('', 'fr-count');
  const memberList = el('div', 'fr-list');
  const memberPanel = el('div', 'fr-listpanel panel', [el('div', 'fr-listhead', [txt('멤버', 'fr-title'), memberCount]), memberList]);
  const inGuild = el('div', 'fr-body gd-in', [infoPanel, memberPanel]);

  const guest = el('div', 'fr-guest panel', [
    iconEl('crew', 'ico fr-guest-ico'),
    txt('로그인하면 길드에 들어갈 수 있어요', 'fr-guest-t'),
    button('cp-btn is-go', [txt('로그인')], () => ctx.go.login(), 'select'),
  ]);
  const root = el('div', 'friends-screen guild-screen', [hdr, noGuild, inGuild, guest]);

  const message = (list: HTMLElement, text: string) => list.replaceChildren(el('p', 'fr-empty', [text]));

  function memberRow(m: GuildMember) {
    const r = rankOf(m.rankPoints);
    const status = !m.online ? 'off' : m.inRoom ? 'room' : 'on';
    const row = el('div', `fr-row is-${status}`, [
      el('i', 'fr-dot'),
      avatarEl(m.nickname, m.avatar, 'fr-avatar'),
      icon(rankEmblemSvg(r.tier.id), 'ico fr-emblem'),
      el('span', 'fr-names', [txt(m.nickname, 'fr-name'), txt(`${rankLabel(r)} · ${m.rankPoints} RP`, 'fr-rank')]),
      m.leader ? el('span', 'gd-role', [iconEl('crown'), txt('길드장')]) : null,
      txt(status === 'off' ? '오프라인' : status === 'room' ? '방에 있음' : '온라인', 'fr-status'),
    ].filter(Boolean) as Node[]);
    row.dataset.nickname = m.nickname;
    return row;
  }

  function guildRow(g: GuildSummary) {
    const join = button('fr-add gd-join', [txt('가입')], () => void doJoin(g.name), 'select');
    const row = el('div', 'fr-row is-on gd-row', [
      iconEl('crew', 'ico gd-row-ico'),
      el('span', 'fr-names', [txt(g.name, 'fr-name'), txt(g.description || `길드장 ${g.leader}`, 'fr-rank')]),
      txt(`${g.members}명`, 'fr-status'),
      join,
    ]);
    row.dataset.guild = g.name;
    return row;
  }

  function showGuild(g: GuildInfo | null) {
    noGuild.hidden = !!g;
    inGuild.hidden = !g;
    if (!g) {
      void search();
      return;
    }
    gName.textContent = g.name;
    gDesc.textContent = g.description || '소개가 없어요';
    gLeader.textContent = `길드장 ${g.leader}`;
    gCount.textContent = `멤버 ${g.members.length} / ${g.maxMembers}`;
    const online = g.members.filter((m) => m.online).length;
    memberCount.textContent = `${g.members.length}명 · 온라인 ${online}명`;
    const sorted = [...g.members].sort((a, b) => Number(b.leader) - Number(a.leader) || Number(b.online) - Number(a.online) || b.rankPoints - a.rankPoints);
    memberList.replaceChildren(...sorted.map(memberRow));
  }

  async function load() {
    if (!getAccount()) return;
    refreshBtn.classList.add('is-spinning');
    try {
      const g = await myGuild();
      if (shown) showGuild(g);
    } catch (e) {
      if (shown) toast(errText(e));
    } finally {
      refreshBtn.classList.remove('is-spinning');
    }
  }

  async function search() {
    message(findList, '찾는 중…');
    try {
      const l = await searchGuilds(searchIn.value);
      if (!shown) return;
      if (!l.length) message(findList, searchIn.value.trim() ? '그런 이름의 길드가 없어요' : '아직 길드가 없어요. 직접 만들어 보세요!');
      else findList.replaceChildren(...l.map(guildRow));
    } catch (e) {
      if (shown) message(findList, errText(e));
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string, kind: 'join' | 'other' = 'other', errEl?: HTMLElement) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      if (errEl) errEl.textContent = errText(e, kind);
      else toast(errText(e, kind));
    } finally {
      busy = false;
    }
  }

  async function create() {
    const n = nameIn.value.trim();
    if (!n) {
      createErr.textContent = '길드 이름을 넣어 주세요';
      return;
    }
    nameIn.blur();
    descIn.blur();
    await run(() => createGuild(n, descIn.value), `${n} 길드를 만들었어요`, 'other', createErr);
    if (getAccount()?.profile.guild) {
      nameIn.value = '';
      descIn.value = '';
    }
  }

  const doJoin = (name: string) => run(() => joinGuild(name), `${name} 길드에 들어갔어요`, 'join');

  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }
  function confirmLeave() {
    closeConfirm();
    const ov = el('div', 'overlay', [
      el('div', 'confirm-panel panel', [
        txt('길드를 나갈까요?', 'cf-title'),
        el('p', 'cf-note', ['길드장이 나가면 가장 먼저 들어온 멤버가 길드장이 돼요. 마지막 멤버가 나가면 길드가 없어져요.']),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
          button('cp-btn is-danger gd-confirm-leave', [txt('나가기')], () => {
            closeConfirm();
            void run(() => leaveGuild(), '길드에서 나왔어요');
          }),
        ]),
      ]),
    ]);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeConfirm();
    });
    confirmEl = ov;
    ctx.overlayLayer.append(ov);
  }

  return {
    el: root,
    bg: 'online',
    onShow() {
      shown = true;
      ctx.stage.setView(null);
      const acct = getAccount();
      guest.hidden = !!acct;
      refreshBtn.hidden = !acct;
      noGuild.hidden = true;
      inGuild.hidden = true;
      createErr.textContent = '';
      if (acct) void load();
    },
    onHide() {
      shown = false;
      closeConfirm();
      for (const i of [nameIn, descIn, searchIn]) i.blur();
    },
  };
}
