import { el } from '../../core/dom';
import { getFighter } from '../../data/fighters';
import { getServerUrl } from '../../net/config';
import { getProfile, updateProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { getAccount } from '../account/accountApi';
import { openFighterPicker } from '../overlays/fighterPicker';
import { openSettings } from '../overlays/settings';
import { button, iconEl, roleChip, txt } from '../widgets';
import { cleanCode, cleanName, portrait } from './widgets';

/**
 * 온라인 첫 화면(연결된 뒤, 방 밖): 내 이름·캐릭터, 방 만들기, 코드로 들어가기.
 * 입력란은 진짜 <input>이라 태블릿 키보드가 뜬다. 키보드가 화면 아래쪽 절반을 덮어도 보이도록 입력란은 위쪽에 둔다.
 */
export interface HubActions {
  create(): Promise<void>;
  join(code: string): Promise<void>;
}

export function createHubPanel(ctx: AppContext, actions: HubActions) {
  // ── 내 이름·캐릭터
  const nameInput = el('input', 'name-input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.spellcheck = false;
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('autocapitalize', 'characters');
  nameInput.enterKeyHint = 'done';
  nameInput.setAttribute('aria-label', 'Your name');
  const commitName = () => {
    const acct = getAccount();
    if (acct) return acct.username;
    const v = cleanName(nameInput.value) || 'PLAYER';
    nameInput.value = v;
    if (v !== getProfile().name) {
      updateProfile((p) => {
        p.name = v;
      });
    }
    return v;
  };
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  const pfBox = el('span', 'hub-pf');
  const fighterName = txt('', 'hub-fname');
  const fighterRole = el('span', 'hub-frole');
  const fighterBtn = button('hub-fighter', [pfBox, el('span', 'hub-fcol', [txt('FIGHTER', 'hub-label'), fighterName, fighterRole]), txt('CHANGE', 'hub-change')], () =>
    openFighterPicker(ctx, getProfile().selected, (id) => {
      updateProfile((p) => {
        p.selected = id;
      });
      refresh();
    }),
  );
  // 로그인 중이면 이름은 계정 이름(고칠 수 없음)이라 입력칸 대신 이름표만
  const nameBox = el('label', 'hub-namebox', [txt('YOUR NAME', 'hub-label'), el('span', 'name-field', [nameInput, iconEl('pencil', 'ico name-pencil')])]);
  const acctName = txt('', 'hub-acct-name');
  const acctBox = el('div', 'hub-namebox hub-acct', [txt('PLAYING AS', 'hub-label'), el('span', 'hub-acct-row', [acctName, txt('ACCOUNT', 'slot-tag tag-you')])]);
  const playerCard = el('div', 'hub-player panel', [nameBox, acctBox, fighterBtn]);

  // ── 방 만들기
  const createLabel = txt('CREATE');
  const createBtn = button('hc-btn hc-create-btn', [createLabel], () => void actions.create(), 'select');
  const createCard = el('div', 'hub-card hub-create panel', [
    el('span', 'hc-art', [el('span', 'hc-glow'), iconEl('crown', 'ico hc-ico')]),
    txt('CREATE ROOM', 'hc-title'),
    el('p', 'hc-desc', ['GET A ROOM CODE AND SHARE IT WITH YOUR FRIENDS']),
    createBtn,
  ]);

  // ── 코드로 들어가기: 투명한 input 하나가 네 칸 위를 덮는다
  const codeInput = el('input', 'code-input');
  codeInput.type = 'text';
  codeInput.maxLength = 4;
  codeInput.spellcheck = false;
  codeInput.autocomplete = 'off';
  codeInput.setAttribute('autocapitalize', 'characters');
  codeInput.setAttribute('autocorrect', 'off');
  codeInput.enterKeyHint = 'go';
  codeInput.setAttribute('aria-label', 'Room code');
  const boxes = [0, 1, 2, 3].map(() => el('span', 'code-box t-outline'));
  const codeField = el('label', 'code-field', [...boxes, codeInput]);
  const joinError = txt('', 'join-error');
  const joinLabel = txt('JOIN');
  const joinBtn = button('hc-btn hc-join-btn', [joinLabel], () => void submitJoin(), 'select');
  const joinCard = el('div', 'hub-card hub-join panel', [
    txt('JOIN ROOM', 'hc-title'),
    el('p', 'hc-desc', ["ENTER YOUR FRIEND'S 4-LETTER CODE"]),
    codeField,
    joinError,
    joinBtn,
  ]);

  const renderCode = () => {
    const v = cleanCode(codeInput.value);
    if (codeInput.value !== v) codeInput.value = v;
    boxes.forEach((b, i) => {
      b.textContent = v[i] ?? '';
      b.classList.toggle('is-filled', i < v.length);
      b.classList.toggle('is-next', i === Math.min(v.length, 3));
    });
    joinBtn.classList.toggle('is-ready', v.length === 4);
  };
  codeInput.addEventListener('input', () => {
    renderCode();
    setJoinError('');
  });
  codeInput.addEventListener('focus', () => codeField.classList.add('is-focus'));
  codeInput.addEventListener('blur', () => codeField.classList.remove('is-focus'));
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitJoin();
  });

  let errFlip = false;
  function setJoinError(text: string) {
    joinError.textContent = text;
    codeField.classList.toggle('is-error', !!text);
    if (text) {
      errFlip = !errFlip;
      codeField.classList.toggle('shake-a', errFlip);
      codeField.classList.toggle('shake-b', !errFlip);
    }
  }

  async function submitJoin() {
    const code = cleanCode(codeInput.value);
    if (code.length !== 4) {
      setJoinError('ENTER ALL 4 LETTERS');
      codeInput.focus();
      return;
    }
    codeInput.blur();
    await actions.join(code);
  }

  // ── 서버 주소(바꾸려면 설정)
  const serverText = el('span', 'hub-server-url');
  const serverRow = el('div', 'hub-server', [txt('SERVER', 'hub-label'), serverText, button('hub-server-btn', [iconEl('gear')], () => openSettings(ctx))]);

  const root = el('div', 'hub', [playerCard, el('div', 'hub-cards', [createCard, joinCard]), serverRow]);

  function refresh() {
    const p = getProfile();
    const acct = getAccount();
    nameBox.hidden = !!acct;
    acctBox.hidden = !acct;
    acctName.textContent = acct?.username ?? '';
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    const f = getFighter(p.selected);
    pfBox.replaceChildren(portrait(ctx, f.id, 'portrait hub-portrait'));
    fighterName.textContent = f.name;
    fighterRole.replaceChildren(roleChip(f.id));
    serverText.textContent = getServerUrl();
    renderCode();
  }

  return {
    el: root,
    refresh,
    commitName,
    setJoinError,
    /** 진행 중인 요청 표시(버튼 글자·눌림 막기) */
    setBusy(kind: 'create' | 'join' | null) {
      root.classList.toggle('is-busy', kind !== null);
      createLabel.textContent = kind === 'create' ? 'CREATING…' : 'CREATE';
      joinLabel.textContent = kind === 'join' ? 'JOINING…' : 'JOIN';
    },
    blurInputs() {
      nameInput.blur();
      codeInput.blur();
    },
  };
}
