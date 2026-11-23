import '../../styles/online.css';
import { el, icon } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { rankLabel, rankOf } from '../../data/ranks';
import type { AppContext } from '../context';
import { accountErrorCode, accountErrorText, getAccount } from '../account/accountApi';
import { avatarEl } from '../avatar';
import { addFriend, listFriends, removeFriend, type Friend } from '../account/friendsApi';
import { toast } from '../overlays/toast';
import { rankEmblemSvg } from '../rankEmblem';
import { button, header, iconEl, txt } from '../widgets';

/**
 * 친구 화면(로비 친구 버튼). UI 담당.
 * 왼쪽: 닉네임으로 친구 추가(입력칸은 화면 위쪽, Enter로 추가) + 내 닉네임.
 * 오른쪽: 친구 목록(온라인 점, 티어 문양·이름, 온라인/방에 있음/오프라인, 삭제는 확인 후).
 * 로그인하지 않은 게스트에게는 안내와 로그인 버튼만.
 */
export function createFriendsScreen(ctx: AppContext): Screen {
  let shown = false;
  let loading = false;
  let busyAdd = false;
  let confirmEl: HTMLElement | null = null;

  const refreshBtn = button('icon-btn fr-refresh', [iconEl('refresh')], () => void load());
  const hdr = header('친구', () => ctx.go.lobby(), refreshBtn);

  // ── 추가
  const input = el('input', 'fr-input');
  input.type = 'text';
  input.maxLength = 10;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  input.placeholder = '친구 닉네임';
  input.setAttribute('aria-label', 'Friend nickname');
  const addLabel = txt('추가');
  const addBtn = button('fr-add', [iconEl('plus'), addLabel], () => void add(), 'select');
  const addErr = txt('', 'fr-err');
  const myNick = txt('', 'fr-mynick');
  const addPanel = el('div', 'fr-addpanel panel', [
    txt('친구 추가', 'fr-title'),
    el('p', 'fr-desc', ['친구의 닉네임을 넣으면 바로 서로 친구가 돼요']),
    el('div', 'fr-addrow', [el('span', 'auth-box fr-box', [input]), addBtn]),
    addErr,
    el('div', 'fr-me', [txt('내 닉네임', 'fr-me-cap'), myNick]),
  ]);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  input.addEventListener('input', () => {
    addErr.textContent = '';
  });

  // ── 목록
  const count = txt('', 'fr-count');
  const list = el('div', 'fr-list');
  const listPanel = el('div', 'fr-listpanel panel', [el('div', 'fr-listhead', [txt('친구 목록', 'fr-title'), count]), list]);

  // ── 게스트
  const guest = el('div', 'fr-guest panel', [
    iconEl('friends', 'ico fr-guest-ico'),
    txt('로그인하면 친구를 추가할 수 있어요', 'fr-guest-t'),
    button('cp-btn is-go', [txt('로그인')], () => ctx.go.login(), 'select'),
  ]);

  const body = el('div', 'fr-body', [addPanel, listPanel]);
  const root = el('div', 'friends-screen', [hdr, body, guest]);

  const sortFriends = (l: Friend[]) =>
    [...l].sort((a, b) => Number(b.online) - Number(a.online) || Number(b.inRoom) - Number(a.inRoom) || b.rankPoints - a.rankPoints);

  function row(f: Friend) {
    const r = rankOf(f.rankPoints);
    const status = !f.online ? 'off' : f.inRoom ? 'room' : 'on';
    const statusText = status === 'off' ? '오프라인' : status === 'room' ? '방에 있음' : '온라인';
    const del = button('fr-del', [iconEl('close')], () => confirmRemove(f.nickname), 'back');
    const rowEl = el('div', `fr-row is-${status}`, [
      el('i', 'fr-dot'),
      avatarEl(f.nickname, f.avatar, 'fr-avatar'),
      icon(rankEmblemSvg(r.tier.id), 'ico fr-emblem'),
      el('span', 'fr-names', [txt(f.nickname, 'fr-name'), txt(`${rankLabel(r)} · ${f.rankPoints} RP`, 'fr-rank')]),
      txt(statusText, 'fr-status'),
      del,
    ]);
    rowEl.dataset.nickname = f.nickname;
    return rowEl;
  }

  function showMessage(text: string, retry = false) {
    list.replaceChildren(el('div', 'fr-empty', [txt(text), retry ? button('cp-btn is-go fr-retry', [txt('다시 시도')], () => void load()) : null]));
  }

  async function load() {
    if (!getAccount() || loading) return;
    loading = true;
    refreshBtn.classList.add('is-spinning');
    if (!list.querySelector('.fr-row')) showMessage('불러오는 중…');
    try {
      const l = await listFriends();
      if (!shown) return;
      count.textContent = `${l.length}명 · 온라인 ${l.filter((f) => f.online).length}명`;
      if (!l.length) showMessage('아직 친구가 없어요. 닉네임으로 추가해 보세요!');
      else list.replaceChildren(...sortFriends(l).map(row));
    } catch (e) {
      if (shown) showMessage(accountErrorText(accountErrorCode(e)), true);
    } finally {
      loading = false;
      refreshBtn.classList.remove('is-spinning');
    }
  }

  async function add() {
    const n = input.value.trim();
    if (busyAdd) return;
    if (!n) {
      addErr.textContent = '닉네임을 넣어 주세요';
      input.focus();
      return;
    }
    busyAdd = true;
    addLabel.textContent = '추가 중…';
    input.blur();
    try {
      await addFriend(n);
      input.value = '';
      toast(`${n}님과 친구가 됐어요`);
      await load();
    } catch (e) {
      addErr.textContent = accountErrorText(accountErrorCode(e));
    } finally {
      busyAdd = false;
      addLabel.textContent = '추가';
    }
  }

  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }

  function confirmRemove(nickname: string) {
    closeConfirm();
    const ov = el('div', 'overlay', [
      el('div', 'confirm-panel panel', [
        txt('친구를 삭제할까요?', 'cf-title'),
        el('p', 'cf-note', [`${nickname}님과 서로 친구 목록에서 지워져요.`]),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('취소')], () => closeConfirm(), 'back'),
          button('cp-btn is-danger fr-confirm-del', [txt('삭제')], async () => {
            closeConfirm();
            try {
              await removeFriend(nickname);
              toast(`${nickname}님을 친구에서 지웠어요`);
              await load();
            } catch (e) {
              toast(accountErrorText(accountErrorCode(e)));
            }
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
      body.hidden = !acct;
      refreshBtn.hidden = !acct;
      guest.hidden = !!acct;
      addErr.textContent = '';
      myNick.textContent = acct?.profile.name ?? '';
      list.replaceChildren();
      count.textContent = '';
      if (acct) void load();
    },
    onHide() {
      shown = false;
      closeConfirm();
      input.blur();
    },
  };
}
