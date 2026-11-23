import { el } from '../core/dom';
import { getFighter } from '../data/fighters';
import { getProfile } from '../state/profile';
import { accountErrorCode, accountErrorText, getAccount } from './account/accountApi';
import { listFriends } from './account/friendsApi';
import { acceptParty, declineParty, getParty, inviteToParty, kickFromParty, leaveParty, type PartyMember, type PartyResponse } from './account/partyApi';
import { avatarEl } from './avatar';
import type { AppContext } from './context';
import { toast } from './overlays/toast';
import { button, iconEl, txt } from './widgets';

/**
 * 로비의 파티: 캐릭터 양옆 + 칸 2개(파티원), 받은 초대 알림, 파티 나가기.
 * 로비를 보는 동안 3초마다 서버에서 파티 상태를 읽는다.
 * 파티장이 온라인 방을 만들면 파티원은 그 방으로 따라 들어간다.
 */
export function createLobbyParty(ctx: AppContext, slots: [HTMLElement, HTMLElement]) {
  let state: PartyResponse = { party: null, invites: [] };
  let timer = 0;
  let shown = false;
  let followed: string | null = null;
  let dialog: HTMLElement | null = null;
  let busy = false;

  const myName = () => getProfile().name;
  const isLeader = () => !state.party || state.party.leader === myName();
  const mates = () => (state.party?.members ?? []).filter((m) => m.nickname !== myName());

  // 받은 초대 알림(위 가운데)
  const inviteBox = el('div', 'party-invites');
  // 파티 줄(나가기)
  const leaveBtn = button('party-leave', [txt('파티 나가기')], () => void run(() => leaveParty(), '파티에서 나왔어요'), 'back');
  const partyInfo = txt('', 'party-info');
  const partyBar = el('div', 'party-bar', [iconEl('party'), partyInfo, leaveBtn]);

  const closeDialog = () => {
    dialog?.remove();
    dialog = null;
  };
  const showDialog = (panel: HTMLElement) => {
    closeDialog();
    const ov = el('div', 'overlay', [panel]);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeDialog();
    });
    dialog = ov;
    ctx.overlayLayer.append(ov);
  };

  async function run(fn: () => Promise<PartyResponse>, ok?: string) {
    if (busy) return;
    busy = true;
    try {
      apply(await fn());
      if (ok) toast(ok);
    } catch (e) {
      toast(accountErrorText(accountErrorCode(e)));
    } finally {
      busy = false;
    }
  }

  /** + 칸: 친구 목록에서 초대 */
  async function openInvite() {
    if (!getAccount()) {
      toast('로그인하면 친구를 파티에 초대할 수 있어요');
      return;
    }
    if (!isLeader()) {
      toast('파티장만 초대할 수 있어요');
      return;
    }
    const list = el('div', 'pi-list', [el('p', 'fr-empty', ['불러오는 중…'])]);
    showDialog(el('div', 'pi-panel panel', [el('div', 'set-head', [txt('파티 초대', 'set-title'), button('btn-close', [iconEl('close')], closeDialog, 'back')]), list]));
    try {
      const friends = await listFriends();
      const inParty = new Set((state.party?.members ?? []).map((m) => m.nickname));
      const rows = friends
        .filter((f) => !inParty.has(f.nickname))
        .sort((a, b) => Number(b.online) - Number(a.online))
        .map((f) => {
          const row = el('div', `fr-row is-${f.online ? 'on' : 'off'}`, [
            el('i', 'fr-dot'),
            avatarEl(f.nickname, f.avatar, 'fr-avatar'),
            el('span', 'fr-names', [txt(f.nickname, 'fr-name'), txt(f.online ? '온라인' : '오프라인', 'fr-rank')]),
            button('fr-add pi-invite', [txt('초대')], () => {
              closeDialog();
              void run(() => inviteToParty(f.nickname), `${f.nickname}님에게 파티 초대를 보냈어요`);
            }, 'select'),
          ]);
          row.dataset.nickname = f.nickname;
          return row;
        });
      list.replaceChildren(...(rows.length ? rows : [el('p', 'fr-empty', ['초대할 친구가 없어요. 친구 화면에서 먼저 친구를 추가해 주세요'])]));
    } catch (e) {
      list.replaceChildren(el('p', 'fr-empty', [accountErrorText(accountErrorCode(e))]));
    }
  }

  /** 파티원 칸: 파티장은 내보내기 */
  function openMember(m: PartyMember) {
    if (!isLeader()) {
      toast(`${m.nickname}님${m.leader ? '(파티장)' : ''}`);
      return;
    }
    showDialog(
      el('div', 'confirm-panel panel', [
        txt(m.nickname, 'cf-title'),
        el('p', 'cf-note', [`${getFighter(m.fighterId).name} · ${m.rankPoints} RP`]),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('닫기')], closeDialog, 'back'),
          button('cp-btn is-danger party-kick', [txt('내보내기')], () => {
            closeDialog();
            void run(() => kickFromParty(m.nickname), `${m.nickname}님을 파티에서 내보냈어요`);
          }),
        ]),
      ]),
    );
  }

  function renderSlots() {
    const ms = mates();
    slots.forEach((slot, i) => {
      const m = ms[i];
      slot.classList.toggle('is-filled', !!m);
      slot.dataset.nickname = m?.nickname ?? '';
      if (m) {
        const av = avatarEl(m.nickname, m.avatar, 'party-avatar');
        av.style.setProperty('--c', getFighter(m.fighterId).palette.primary);
        slot.replaceChildren(av, txt(m.nickname, 'party-name'), m.leader ? el('span', 'party-crown', [iconEl('crown')]) : '');
      } else {
        slot.replaceChildren(iconEl('plus'));
      }
    });
  }

  function renderInvites() {
    inviteBox.replaceChildren(
      ...state.invites.slice(0, 2).map((inv) => {
        const box = el('div', 'party-invite panel', [
          avatarEl(inv.from, inv.avatar, 'fr-avatar'),
          el('span', 'pv-text', [txt(inv.from, 'pv-from'), txt('님의 파티 초대', 'pv-sub')]),
          button('fr-add pv-accept', [txt('수락')], () => void run(() => acceptParty(inv.from), `${inv.from}님의 파티에 들어갔어요`), 'select'),
          button('cp-btn is-back pv-decline', [txt('거절')], () => void run(() => declineParty(inv.from)), 'back'),
        ]);
        box.dataset.from = inv.from;
        return box;
      }),
    );
  }

  function apply(r: PartyResponse) {
    state = r;
    renderSlots();
    renderInvites();
    const p = r.party;
    partyBar.hidden = !p;
    if (p) partyInfo.textContent = `파티 ${p.members.length}/3 · ${p.leader === myName() ? '내가 파티장' : `파티장 ${p.leader}`}`;
    // 파티장이 방을 만들었으면 따라간다(같은 방 코드는 한 번만)
    if (shown && p && p.leader !== myName() && p.roomCode && p.roomCode !== followed) {
      followed = p.roomCode;
      toast(`${p.leader}님의 방으로 들어가요`);
      ctx.go.online({ join: p.roomCode });
    }
    if (!p?.roomCode) followed = null;
  }

  async function poll() {
    if (!shown || !getAccount()) return;
    try {
      apply(await getParty());
    } catch {
      /* 다음 차례 */
    }
  }

  return {
    el: [inviteBox, partyBar] as const,
    /** 파티 버튼: 친구 초대 창 */
    invite() {
      void openInvite();
    },
    openSlot(i: number) {
      const m = mates()[i];
      if (m) openMember(m);
      else void openInvite();
    },
    /** PLAY(온라인 모드)를 눌렀을 때: 파티장은 방을 만들고 파티원이 따라오게, 파티원은 기다리게 */
    playOnline(): boolean {
      const p = state.party;
      if (!p) return false;
      if (p.leader === myName()) {
        ctx.go.online({ create: true });
        return true;
      }
      toast('파티장이 시작하면 자동으로 같은 방에 들어가요');
      return true;
    },
    show() {
      shown = true;
      if (!getAccount()) {
        apply({ party: null, invites: [] });
        return;
      }
      void poll();
      window.clearInterval(timer);
      timer = window.setInterval(() => void poll(), 3000);
    },
    hide() {
      shown = false;
      window.clearInterval(timer);
      closeDialog();
    },
  };
}
