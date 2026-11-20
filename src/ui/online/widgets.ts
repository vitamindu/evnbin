import { el } from '../../core/dom';
import { getFighter, type FighterId } from '../../data/fighters';
import type { Team } from '../../game/types';
import type { MatchMode } from '../../game/types';
import type { OnlineClient, OnlineStatus } from '../../net/api';
import type { AppContext } from '../context';
import { txt } from '../widgets';

/** 핑 품질: 좋음(초록 3칸) / 보통(노랑 2칸) / 나쁨(빨강 1칸) */
export function pingLevel(ms: number): 'good' | 'ok' | 'bad' {
  return ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

/** 신호 막대 3칸 + 숫자. 값이 바뀔 때만 DOM을 건드린다 */
export function pingMeter(className = '') {
  const num = txt('--', 'pm-num');
  const root = el('span', `ping-meter ${className}`.trim(), [el('span', 'pm-bars', [el('i'), el('i'), el('i')]), num]);
  let last = -2;
  return {
    el: root,
    set(ms: number) {
      const v = Math.round(ms);
      if (v === last) return;
      last = v;
      num.textContent = v > 0 ? `${v}ms` : '--ms';
      root.dataset.level = v > 0 ? pingLevel(v) : 'none';
    },
  };
}

/** 화면 오른쪽 위 연결 상태: 점 + ONLINE/CONNECTING/OFFLINE + 핑 */
export function netChip() {
  const dot = el('i', 'nc-dot');
  const label = txt('오프라인', 'nc-label');
  const ping = pingMeter('nc-ping');
  const root = el('div', 'net-chip', [dot, label, ping.el]);
  return {
    el: root,
    setStatus(s: OnlineStatus) {
      root.dataset.status = s;
      label.textContent = s === 'connected' ? '온라인' : s === 'connecting' ? '연결 중' : '오프라인';
      ping.el.hidden = s !== 'connected';
    },
    setPing: ping.set,
  };
}

/** 내 팀은 언제나 파랑, 상대 팀은 빨강(전투 화면의 발밑 원과 같은 규칙) */
export function sideClass(team: Team, myTeam: Team): 'is-blue' | 'is-red' {
  return team === myTeam ? 'is-blue' : 'is-red';
}

/** 캐릭터 초상화 칸(캐릭터 색 배경 + 렌더한 초상화) */
export function portrait(ctx: AppContext, id: FighterId, className = 'portrait') {
  const f = getFighter(id);
  const img = el('img');
  img.src = ctx.portraits[id];
  img.alt = f.name;
  img.draggable = false;
  const box = el('span', className, [img]);
  box.style.setProperty('--c', f.palette.primary);
  return box;
}

/** 클립보드에 글자 복사. https가 아닌 주소(LAN)에서는 예전 방식으로 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방식으로 */
  }
  try {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 이름 다듬기: 앞뒤 공백 제거, 연속 공백 하나로, 12자, 대문자 */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 12).toUpperCase();
}

/** 방 코드: 영문·숫자만, 대문자, 4자 */
export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

/** 방장: 방의 경기 방식 바꾸기 */
export function setRoomMode(client: OnlineClient, mode: MatchMode) {
  client.setMode(mode);
}
