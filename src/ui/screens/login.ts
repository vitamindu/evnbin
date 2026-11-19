import '../../styles/online.css';
import { GAME_TITLE } from '../../config';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import { getServerUrl } from '../../net/config';
import type { AppContext } from '../context';
import { accountErrorCode, accountErrorText, getAccount, login, restore, signup, type AccountErrorCode } from '../account/accountApi';
import { setOfflineGuest } from '../account/session';
import { openSettings } from '../overlays/settings';
import { button, iconEl, txt } from '../widgets';

/**
 * 로그인 / 회원가입 화면(TAP TO START 다음). UI 담당.
 * - 들어오면 저장된 토큰으로 자동 로그인(restore) → 되면 바로 로비.
 * - 입력 칸은 화면 위쪽(태블릿 키보드가 아래 절반을 덮어도 보이게), Enter로 다음 칸 / 제출.
 * - 서버에 닿지 않으면 "오프라인으로 계속"을 크게 보여 준다(연습장만). 평소에도 아래에 작게 있다.
 * 오류 문구는 영어 + 한국어 짧게.
 */
type Mode = 'login' | 'signup';

export function createLoginScreen(ctx: AppContext): Screen {
  let mode: Mode = 'login';
  let busy = false;
  let shown = false;

  const input = (type: string, autocomplete: string, label: string) => {
    const i = el('input', 'auth-input');
    i.type = type;
    i.autocomplete = autocomplete as AutoFill;
    i.spellcheck = false;
    i.setAttribute('autocapitalize', 'off');
    i.setAttribute('autocorrect', 'off');
    i.setAttribute('aria-label', label);
    return i;
  };
  const idInput = input('text', 'username', 'ID');
  idInput.maxLength = 12;
  const pwInput = input('password', 'current-password', 'Password');
  const pw2Input = input('password', 'new-password', 'Confirm password');
  const field = (en: string, ko: string, i: HTMLInputElement) =>
    el('label', 'auth-field', [el('span', 'auth-label', [txt(en), el('span', 'auth-ko', [ko])]), el('span', 'auth-box', [i])]);
  const confirmField = field('CONFIRM', '비밀번호 확인', pw2Input);

  const tabLogin = button('auth-tab', [txt('LOG IN')], () => setMode('login'));
  const tabSignup = button('auth-tab', [txt('SIGN UP')], () => setMode('signup'));
  const errEn = txt('', 'auth-err-en');
  const errKo = el('span', 'auth-err-ko');
  const err = el('div', 'auth-err', [errEn, errKo]);
  const submitLabel = txt('LOG IN');
  const submit = button('auth-submit', [submitLabel], () => void send(), 'select');
  const checking = el('div', 'auth-checking', [txt('SIGNING IN', 'auth-checking-t'), el('div', 'mm-dots', [el('i'), el('i'), el('i')])]);
  const panel = el('div', 'auth-panel panel', [
    el('div', 'auth-tabs', [tabLogin, tabSignup]),
    field('ID', '아이디', idInput),
    field('PASSWORD', '비밀번호', pwInput),
    confirmField,
    err,
    submit,
    checking,
  ]);

  const offlineNote = el('span', 'auth-off-note', ['NO SERVER? TRAINING WORKS OFFLINE · 서버 없이 연습장만']);
  const offlineBtn = button('auth-offline', [iconEl('modeTraining'), txt('PLAY OFFLINE')], () => {
    setOfflineGuest(true);
    ctx.go.lobby();
  });
  const serverBtn = button('auth-server', [iconEl('gear')], () => openSettings(ctx));
  const offlineRow = el('div', 'auth-off', [offlineNote, el('div', 'auth-off-btns', [offlineBtn, serverBtn])]);

  const logoWords = GAME_TITLE.split(' ').map((w, i) => {
    const word = el('div', `logo-word logo-word-${i}`, [el('span', '', [w])]);
    word.dataset.text = w;
    return word;
  });
  const logo = el('div', 'auth-logo', logoWords);
  const root = el('div', 'login', [logo, panel, offlineRow]);

  function setMode(m: Mode) {
    mode = m;
    root.dataset.mode = m;
    tabLogin.classList.toggle('is-on', m === 'login');
    tabSignup.classList.toggle('is-on', m === 'signup');
    confirmField.hidden = m !== 'signup';
    pwInput.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    pwInput.enterKeyHint = m === 'signup' ? 'next' : 'go';
    submitLabel.textContent = m === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
    showError(null);
  }

  function showError(code: AccountErrorCode | 'mismatch' | 'empty' | null) {
    root.classList.toggle('is-unreachable', code === 'network');
    if (!code) {
      errEn.textContent = '';
      errKo.textContent = '';
      return;
    }
    const [en, ko] =
      code === 'mismatch'
        ? ["PASSWORDS DON'T MATCH", '비밀번호가 서로 달라요']
        : code === 'empty'
          ? ['ENTER ID AND PASSWORD', '아이디와 비밀번호를 넣어 주세요']
          : accountErrorText(code);
    errEn.textContent = en;
    errKo.textContent = ko;
    panel.classList.remove('shake-a', 'shake-b');
    void panel.offsetWidth;
    panel.classList.add('shake-a');
  }

  function setBusy(b: boolean, label?: string) {
    busy = b;
    root.classList.toggle('is-busy', b);
    if (label) submitLabel.textContent = label;
    else submitLabel.textContent = mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
  }

  async function send() {
    if (busy) return;
    const id = idInput.value.trim();
    const pw = pwInput.value;
    if (!id || !pw) return showError('empty');
    if (mode === 'signup' && pw !== pw2Input.value) return showError('mismatch');
    for (const i of [idInput, pwInput, pw2Input]) i.blur();
    showError(null);
    setBusy(true, mode === 'login' ? 'LOGGING IN…' : 'CREATING…');
    try {
      if (mode === 'login') await login(id, pw);
      else await signup(id, pw);
      setOfflineGuest(false);
      pwInput.value = '';
      pw2Input.value = '';
      ctx.go.lobby();
    } catch (e) {
      showError(accountErrorCode(e));
    } finally {
      setBusy(false);
    }
  }

  idInput.enterKeyHint = 'next';
  pw2Input.enterKeyHint = 'go';
  idInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pwInput.focus();
  });
  pwInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (mode === 'signup') pw2Input.focus();
    else void send();
  });
  pw2Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void send();
  });
  setMode('login');

  return {
    el: root,
    bg: 'title',
    async onShow() {
      shown = true;
      ctx.stage.setView(null);
      offlineNote.title = getServerUrl();
      if (getAccount()) {
        ctx.go.lobby();
        return;
      }
      // 저장된 토큰으로 자동 로그인
      root.classList.add('is-checking');
      try {
        await restore();
        if (shown && getAccount()) {
          ctx.go.lobby();
          return;
        }
      } catch (e) {
        // 토큰 만료는 그냥 로그인 화면, 그 밖(서버 없음 등)은 알려 준다
        const code = accountErrorCode(e);
        if (code !== 'unauthorized') showError(code);
      } finally {
        root.classList.remove('is-checking');
      }
    },
    onHide() {
      shown = false;
      for (const i of [idInput, pwInput, pw2Input]) i.blur();
    },
  };
}
