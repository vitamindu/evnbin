import { el } from '../../core/dom';
import { ADMIN_GRANT_MAX } from '../../net/accountApi';
import { getProfile } from '../../state/profile';
import { accountErrorCode, accountErrorText, adminGrant } from '../account/accountApi';
import type { AppContext } from '../context';
import { toast } from './toast';
import { button, iconEl, txt } from '../widgets';

/**
 * 관리자 도구: 코인·보석(다이아) 지급. 받는 사람은 닉네임 한 명 또는 "모두"(서버의 모든 계정).
 * 관리자 계정(설정 → 관리자)에서만 열린다. 서버도 관리자인지 다시 확인한다.
 */
export function openAdminGrant(ctx: AppContext) {
  if (!getProfile().admin) {
    toast('관리자만 쓸 수 있어요');
    return;
  }
  let all = false;
  let busy = false;
  const input = (placeholder: string, numeric: boolean, cls: string) => {
    const i = el('input', `set-input ${cls}`);
    i.type = 'text';
    i.placeholder = placeholder;
    i.spellcheck = false;
    i.autocomplete = 'off';
    if (numeric) i.inputMode = 'numeric';
    return i;
  };
  const target = input('받는 사람 닉네임', false, 'ag-target');
  target.maxLength = 10;
  const coins = input('0', true, 'ag-coins');
  const gems = input('0', true, 'ag-gems');
  const err = txt('', 'fr-err ag-err');
  const toggleAll = button('btn-toggle ag-all', [txt('모두에게')], () => {
    all = !all;
    toggleAll.classList.toggle('is-on', all);
    target.disabled = all;
    target.value = all ? '' : target.value;
    target.placeholder = all ? '서버의 모든 계정' : '받는 사람 닉네임';
    err.textContent = '';
  });

  const num = (i: HTMLInputElement) => {
    const v = i.value.replace(/[,\s]/g, '');
    if (!v) return 0;
    return /^\d+$/.test(v) ? Number(v) : NaN;
  };

  const close = () => overlay.remove();
  const send = async (who: string, c: number, g: number) => {
    if (busy) return;
    busy = true;
    try {
      const r = await adminGrant(who, c, g);
      const what = [r.coins ? `코인 ${r.coins.toLocaleString('en-US')}` : '', r.gems ? `보석 ${r.gems.toLocaleString('en-US')}` : ''].filter(Boolean).join(', ');
      toast(`${who === '*' ? `${r.count}명 모두` : `${who}님`}에게 ${what}을(를) 지급했어요`);
      coins.value = '';
      gems.value = '';
    } catch (e) {
      const code = accountErrorCode(e);
      err.textContent = code === 'not_found' ? '그런 닉네임은 없어요' : accountErrorText(code);
    } finally {
      busy = false;
    }
  };

  const grantBtn = button('cp-btn is-go ag-grant', [txt('지급')], () => {
    err.textContent = '';
    const c = num(coins);
    const g = num(gems);
    const who = all ? '*' : target.value.trim();
    if (!who) return void (err.textContent = '받는 사람 닉네임을 넣거나 "모두에게"를 눌러 주세요');
    if (Number.isNaN(c) || Number.isNaN(g)) return void (err.textContent = '수량은 숫자만 넣어 주세요');
    if (c > ADMIN_GRANT_MAX || g > ADMIN_GRANT_MAX) return void (err.textContent = `한 번에 ${ADMIN_GRANT_MAX.toLocaleString('en-US')}까지 줄 수 있어요`);
    if (!c && !g) return void (err.textContent = '코인이나 보석 수량을 넣어 주세요');
    for (const i of [target, coins, gems]) i.blur();
    if (who !== '*') return void send(who, c, g);
    // 모두에게는 한 번 더 묻는다
    const ask = el('div', 'overlay', [
      el('div', 'confirm-panel panel', [
        txt('모두에게 지급할까요?', 'cf-title'),
        el('p', 'cf-note', [`서버의 모든 계정에 코인 ${c.toLocaleString('en-US')}, 보석 ${g.toLocaleString('en-US')}을(를) 줘요. 되돌릴 수 없어요.`]),
        el('div', 'cp-buttons', [
          button('cp-btn is-back', [txt('취소')], () => ask.remove(), 'back'),
          button('cp-btn is-danger ag-confirm-all', [txt('모두에게 지급')], () => {
            ask.remove();
            void send('*', c, g);
          }),
        ]),
      ]),
    ]);
    ctx.overlayLayer.append(ask);
  });

  const field = (label: string, ico: HTMLElement | null, control: HTMLElement) => el('label', 'ag-field', [el('span', 'ag-label', [ico ?? '', txt(label)]), control]);
  const overlay = el('div', 'overlay', [
    el('div', 'ag-panel panel', [
      el('div', 'set-head', [txt('관리자 · 코인/보석 지급', 'set-title'), button('btn-close', [iconEl('close')], close, 'back')]),
      field('받는 사람', null, el('div', 'ag-row', [target, toggleAll])),
      field('코인', iconEl('coin'), coins),
      field('보석', iconEl('crystal'), gems),
      err,
      el('div', 'cp-buttons', [button('cp-btn is-back', [txt('닫기')], close, 'back'), grantBtn]),
    ]),
  ]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  ctx.overlayLayer.append(overlay);
}
