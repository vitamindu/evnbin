import '../../styles/online.css';
import { el, icon } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { rankLabel, rankOf } from '../../data/ranks';
import { GUILD_CHAT_MAX, GUILD_DESC_MAX, GUILD_NAME_MAX } from '../../net/accountApi';
import type { AppContext } from '../context';
import { accountErrorCode, accountErrorText, getAccount } from '../account/accountApi';
import {
  answerRequest,
  createGuild,
  guildChat,
  guildSettings,
  joinGuild,
  kickMember,
  leaveGuild,
  myGuild,
  searchGuilds,
  sendGuildChat,
  setVice,
  type GuildChatMessage,
  type GuildInfo,
  type GuildMember,
  type GuildRequest,
  type GuildRole,
  type GuildSummary,
} from '../account/guildApi';
import { avatarEl } from '../avatar';
import { toast } from '../overlays/toast';
import { rankEmblemSvg } from '../rankEmblem';
import { button, header, iconEl, txt } from '../widgets';

/**
 * 길드 화면(로비 길드 버튼).
 * - 길드 없음: 왼쪽 길드 만들기(이름·소개), 오른쪽 길드 찾기(이름 검색 → 가입).
 * - 길드 있음: 왼쪽 길드 정보(이름·소개·마스터·인원·가입 방식, 마스터는 설정, 나가기),
 *   오른쪽 탭: 멤버(마스터·부마스터는 관리) / 채팅(3초마다 새 글) / 가입 요청(마스터·부마스터).
 * - 직급: 마스터(부마스터 임명·해제, 누구나 추방, 설정) / 부마스터(마스터 빼고 추방, 요청 승인) / 멤버.
 * - 게스트: 로그인 안내. 길드 보상은 이후 추가.
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

  // ── 길드 있음: 왼쪽 정보
  const gName = txt('', 'gd-name');
  const gDesc = el('p', 'fr-desc gd-desc');
  const gLeader = txt('', 'gd-meta');
  const gCount = txt('', 'gd-meta');
  const gMode = txt('', 'gd-meta gd-mode');
  const myRoleChip = el('span', 'gd-myrole');
  const modeOpen = button('gd-seg', [txt('자유 가입')], () => void changeMode('open'));
  const modeApproval = button('gd-seg', [txt('승인 필요')], () => void changeMode('approval'));
  const settingsRow = el('div', 'gd-settings', [txt('가입 방식', 'gd-set-label'), el('div', 'gd-segs', [modeOpen, modeApproval])]);
  const leaveBtn = button('cp-btn is-danger gd-leave', [txt('길드 나가기')], () => confirmLeave(), 'back');
  const infoPanel = el('div', 'fr-addpanel panel gd-info', [iconEl('crew', 'ico gd-ico'), gName, myRoleChip, gDesc, gLeader, gCount, gMode, settingsRow, leaveBtn]);

  // ── 길드 있음: 오른쪽 탭
  type Tab = 'members' | 'chat' | 'requests';
  let tab: Tab = 'members';
  const memberCount = txt('', 'fr-count');
  const reqBadge = el('span', 'badge t-outline gd-req-badge');
  const tabBtn = (t: Tab, label: string, extra?: HTMLElement) => {
    const b = button(`gd-tab gd-tab-${t}`, [txt(label), extra ?? null].filter(Boolean) as Node[], () => setTab(t));
    return b;
  };
  const tabMembers = tabBtn('members', '멤버');
  const tabChat = tabBtn('chat', '채팅');
  const tabReq = tabBtn('requests', '가입 요청', reqBadge);
  const memberList = el('div', 'fr-list gd-members');
  const reqList = el('div', 'fr-list gd-requests');
  const chatList = el('div', 'gd-chat-list');
  const chatIn = input('메시지(100자까지)', GUILD_CHAT_MAX, 'fr-input gd-chat-input');
  chatIn.enterKeyHint = 'send';
  chatIn.setAttribute('aria-label', 'Guild chat');
  chatIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void sendChat();
  });
  const sendBtn = button('fr-add gd-send', [txt('보내기')], () => void sendChat(), 'select');
  const chatBox = el('div', 'gd-chat', [chatList, el('div', 'fr-addrow gd-chat-row', [el('span', 'auth-box fr-box', [chatIn]), sendBtn])]);
  const memberPanel = el('div', 'fr-listpanel panel gd-right', [
    el('div', 'fr-listhead gd-tabs', [tabMembers, tabChat, tabReq, memberCount]),
    memberList,
    chatBox,
    reqList,
  ]);
  const inGuild = el('div', 'fr-body gd-in', [infoPanel, memberPanel]);

  const guest = el('div', 'fr-guest panel', [
    iconEl('crew', 'ico fr-guest-ico'),
    txt('로그인하면 길드에 들어갈 수 있어요', 'fr-guest-t'),
    button('cp-btn is-go', [txt('로그인')], () => ctx.go.login(), 'select'),
  ]);
  const root = el('div', 'friends-screen guild-screen', [hdr, noGuild, inGuild, guest]);

  const message = (list: HTMLElement, text: string) => list.replaceChildren(el('p', 'fr-empty', [text]));

  let guild: GuildInfo | null = null;
  const ROLE_TEXT: Record<GuildRole, string> = { master: '마스터', vice: '부마스터', member: '멤버' };
  const ROLE_ORDER: Record<GuildRole, number> = { master: 0, vice: 1, member: 2 };

  /** 내가 이 멤버에게 할 수 있는 일 */
  const actionsFor = (m: GuildMember) => {
    const me = guild?.myRole ?? 'member';
    const self = m.nickname === getAccount()?.profile.name;
    return {
      vice: me === 'master' && !self,
      kick: !self && m.role !== 'master' && (me === 'master' || me === 'vice'),
    };
  };

  function memberRow(m: GuildMember) {
    const r = rankOf(m.rankPoints);
    const status = !m.online ? 'off' : m.inRoom ? 'room' : 'on';
    const act = actionsFor(m);
    const manage = act.vice || act.kick ? button('gd-manage', [iconEl('gear')], () => openManage(m)) : null;
    const row = el('div', `fr-row is-${status}`, [
      el('i', 'fr-dot'),
      avatarEl(m.nickname, m.avatar, 'fr-avatar'),
      icon(rankEmblemSvg(r.tier.id), 'ico fr-emblem'),
      el('span', 'fr-names', [txt(m.nickname, 'fr-name'), txt(`${rankLabel(r)} · ${m.rankPoints} RP`, 'fr-rank')]),
      m.role !== 'member' ? el('span', `gd-role is-${m.role}`, [iconEl(m.role === 'master' ? 'crown' : 'star'), txt(ROLE_TEXT[m.role])]) : null,
      txt(status === 'off' ? '오프라인' : status === 'room' ? '방에 있음' : '온라인', 'fr-status'),
      manage,
    ].filter(Boolean) as Node[]);
    row.dataset.nickname = m.nickname;
    return row;
  }

  function requestRow(q: GuildRequest) {
    const r = rankOf(q.rankPoints);
    const row = el('div', 'fr-row is-on', [
      avatarEl(q.nickname, q.avatar, 'fr-avatar'),
      icon(rankEmblemSvg(r.tier.id), 'ico fr-emblem'),
      el('span', 'fr-names', [txt(q.nickname, 'fr-name'), txt(`${rankLabel(r)} · ${q.rankPoints} RP`, 'fr-rank')]),
      button('fr-add gd-accept', [txt('승인')], () => void run(() => answerRequest(q.nickname, true), `${q.nickname}님을 받았어요`), 'select'),
      button('cp-btn is-back gd-reject', [txt('거절')], () => void run(() => answerRequest(q.nickname, false), `${q.nickname}님의 요청을 거절했어요`), 'back'),
    ]);
    row.dataset.nickname = q.nickname;
    return row;
  }

  function guildRow(g: GuildSummary) {
    const label = g.requested ? '요청함' : g.joinMode === 'approval' ? '가입 요청' : '가입';
    const join = button(`fr-add gd-join${g.requested ? ' is-done' : ''}`, [txt(label)], () => {
      if (!g.requested) void doJoin(g.name);
    }, 'select');
    const row = el('div', 'fr-row is-on gd-row', [
      iconEl('crew', 'ico gd-row-ico'),
      el('span', 'fr-names', [txt(g.name, 'fr-name'), txt(g.description || `마스터 ${g.leader}`, 'fr-rank')]),
      txt(`${g.members}명 · ${g.joinMode === 'approval' ? '승인' : '자유'}`, 'fr-status'),
      join,
    ]);
    row.dataset.guild = g.name;
    return row;
  }

  function setTab(t: Tab) {
    if (t === 'requests' && guild?.myRole === 'member') t = 'members';
    tab = t;
    for (const [b, k] of [[tabMembers, 'members'], [tabChat, 'chat'], [tabReq, 'requests']] as const) b.classList.toggle('is-on', k === tab);
    memberList.hidden = tab !== 'members';
    chatBox.hidden = tab !== 'chat';
    reqList.hidden = tab !== 'requests';
    memberCount.hidden = tab !== 'members';
    if (tab === 'chat') {
      void pollChat();
      chatList.scrollTop = chatList.scrollHeight;
    }
  }

  function showGuild(g: GuildInfo | null) {
    guild = g;
    noGuild.hidden = !!g;
    inGuild.hidden = !g;
    if (!g) {
      stopChat();
      void search();
      return;
    }
    gName.textContent = g.name;
    gDesc.textContent = g.description || '소개가 없어요';
    gLeader.textContent = `마스터 ${g.leader}`;
    gCount.textContent = `멤버 ${g.members.length} / ${g.maxMembers}`;
    gMode.textContent = g.joinMode === 'approval' ? '가입: 승인 필요' : '가입: 자유';
    myRoleChip.textContent = `내 직급 · ${ROLE_TEXT[g.myRole]}`;
    myRoleChip.className = `gd-myrole is-${g.myRole}`;
    settingsRow.hidden = g.myRole !== 'master';
    gMode.hidden = g.myRole === 'master';
    modeOpen.classList.toggle('is-on', g.joinMode === 'open');
    modeApproval.classList.toggle('is-on', g.joinMode === 'approval');
    const online = g.members.filter((m) => m.online).length;
    memberCount.textContent = `${g.members.length}명 · 온라인 ${online}명`;
    const sorted = [...g.members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Number(b.online) - Number(a.online) || b.rankPoints - a.rankPoints);
    memberList.replaceChildren(...sorted.map(memberRow));
    tabReq.hidden = g.myRole === 'member';
    reqBadge.textContent = String(g.requests.length);
    reqBadge.hidden = !g.requests.length;
    if (!g.requests.length) message(reqList, '가입 요청이 없어요');
    else reqList.replaceChildren(...g.requests.map(requestRow));
    setTab(tab);
    startChat();
  }

  // ── 채팅: 화면을 보는 동안 3초마다 새 글
  let lastChatId = 0;
  let chatTimer = 0;
  const chatLine = (c: GuildChatMessage) => {
    const mine = c.from !== null && c.from === getAccount()?.profile.name;
    const time = new Date(c.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const line =
      c.from === null
        ? el('div', 'gd-msg is-system', [txt(c.text, 'gd-msg-text')])
        : el('div', `gd-msg${mine ? ' is-mine' : ''}`, [txt(c.from, 'gd-msg-from'), el('span', 'gd-msg-text', [c.text]), txt(time, 'gd-msg-time')]);
    line.dataset.id = String(c.id);
    return line;
  };
  const addChat = (msgs: GuildChatMessage[]) => {
    const fresh = msgs.filter((m) => m.id > lastChatId);
    if (!fresh.length) return;
    const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    if (!lastChatId) chatList.replaceChildren();
    chatList.append(...fresh.map(chatLine));
    lastChatId = fresh[fresh.length - 1]!.id;
    while (chatList.childElementCount > 100) chatList.firstElementChild!.remove();
    if (atBottom || fresh.some((m) => m.from === getAccount()?.profile.name)) chatList.scrollTop = chatList.scrollHeight;
  };
  async function pollChat() {
    if (!guild || !shown) return;
    try {
      addChat(await guildChat(lastChatId));
      if (!lastChatId && !chatList.childElementCount) message(chatList, '아직 채팅이 없어요. 첫 인사를 남겨 보세요!');
    } catch {
      /* 다음 차례에 다시 */
    }
  }
  function startChat() {
    if (chatTimer) return;
    void pollChat();
    chatTimer = window.setInterval(() => void pollChat(), 3000);
  }
  function stopChat() {
    window.clearInterval(chatTimer);
    chatTimer = 0;
  }
  let sending = false;
  async function sendChat() {
    const t = chatIn.value.trim();
    if (!t || sending) return;
    sending = true;
    try {
      addChat(await sendGuildChat(t, lastChatId));
      chatIn.value = '';
    } catch (e) {
      toast(errText(e));
    } finally {
      sending = false;
    }
  }

  async function changeMode(mode: 'open' | 'approval') {
    if (guild?.joinMode === mode) return;
    await run(() => guildSettings({ joinMode: mode }), mode === 'open' ? '이제 누구나 바로 들어올 수 있어요' : '이제 가입하려면 승인이 필요해요');
  }

  // ── 멤버 관리 창(부마스터 임명·해제, 추방)
  function openManage(m: GuildMember) {
    closeConfirm();
    const act = actionsFor(m);
    const buttons: HTMLElement[] = [];
    if (act.vice) {
      const on = m.role !== 'vice';
      buttons.push(
        button(`cp-btn is-go gd-vice-btn`, [txt(on ? '부마스터로 임명' : '부마스터 해제')], () => {
          closeConfirm();
          void run(() => setVice(m.nickname, on), on ? `${m.nickname}님을 부마스터로 임명했어요` : `${m.nickname}님을 부마스터에서 해제했어요`);
        }),
      );
    }
    if (act.kick) {
      buttons.push(
        button('cp-btn is-danger gd-kick-btn', [txt('추방')], () => {
          closeConfirm();
          confirmKick(m.nickname);
        }),
      );
    }
    buttons.push(button('cp-btn is-back', [txt('닫기')], () => closeConfirm(), 'back'));
    showDialog(`${m.nickname}`, `${ROLE_TEXT[m.role]} · ${m.rankPoints} RP`, buttons, 'gd-manage-panel');
  }
  function confirmKick(nickname: string) {
    showDialog('정말 추방할까요?', `${nickname}님이 길드에서 나가게 돼요.`, [
      button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
      button('cp-btn is-danger gd-confirm-kick', [txt('추방')], () => {
        closeConfirm();
        void run(() => kickMember(nickname), `${nickname}님을 추방했어요`);
      }),
    ]);
  }
  function showDialog(title: string, note: string, buttons: HTMLElement[], cls = '') {
    closeConfirm();
    const ov = el('div', 'overlay', [el('div', `confirm-panel panel ${cls}`.trim(), [txt(title, 'cf-title'), el('p', 'cf-note', [note]), el('div', 'cp-buttons', buttons)])]);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeConfirm();
    });
    confirmEl = ov;
    ctx.overlayLayer.append(ov);
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

  async function doJoin(name: string) {
    if (busy) return;
    busy = true;
    try {
      const r = await joinGuild(name);
      toast(r === 'joined' ? `${name} 길드에 들어갔어요` : `${name} 길드에 가입 요청을 보냈어요. 승인을 기다려 주세요`);
      await load();
      if (r === 'requested') await search();
    } catch (e) {
      toast(errText(e, 'join'));
    } finally {
      busy = false;
    }
  }

  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }
  function confirmLeave() {
    const master = guild?.myRole === 'master';
    showDialog(
      '길드를 나갈까요?',
      master ? '마스터가 나가면 가장 먼저 임명된 부마스터(없으면 가장 먼저 들어온 멤버)가 마스터가 돼요. 마지막 멤버가 나가면 길드가 없어져요.' : '언제든 다시 가입할 수 있어요.',
      [
        button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
        button('cp-btn is-danger gd-confirm-leave', [txt('나가기')], () => {
          closeConfirm();
          lastChatId = 0;
          chatList.replaceChildren();
          void run(() => leaveGuild(), '길드에서 나왔어요');
        }),
      ],
    );
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
      lastChatId = 0;
      chatList.replaceChildren();
      tab = 'members';
      if (acct) void load();
    },
    onHide() {
      shown = false;
      stopChat();
      closeConfirm();
      for (const i of [nameIn, descIn, searchIn, chatIn]) i.blur();
    },
  };
}
