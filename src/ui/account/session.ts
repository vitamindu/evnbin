import { onProfileChange, useServerProfile } from '../../state/profile';
import { toast } from '../overlays/toast';
import { accountErrorCode, accountErrorText, getAccount, onAccountChange, updateSelected } from './accountApi';

/**
 * 계정 ↔ 프로필 연결(앱 수명 동안 한 번 initAccountSync).
 * - 로그인/로그아웃하면 state/profile.ts가 서버 프로필 / 기기 프로필로 바뀐다.
 * - 로그인 중 선택 캐릭터가 바뀌면 updateSelected로 서버에 저장한다.
 * - "오프라인으로 계속"(게스트)은 연습장만 쓸 수 있다.
 */
let offline = false;
let started = false;

export function initAccountSync() {
  if (started) return;
  started = true;
  onAccountChange((a) => {
    if (a) offline = false;
    useServerProfile(a?.profile ?? null);
  });
  onProfileChange((p) => {
    const a = getAccount();
    if (!a || p.selected === a.profile.selected) return;
    updateSelected(p.selected).catch((e) => toast(accountErrorText(accountErrorCode(e))));
  });
  const a = getAccount();
  if (a) useServerProfile(a.profile);
}

export function setOfflineGuest(v: boolean) {
  offline = v;
}

/** 로그인하지 않고 오프라인으로 들어왔는가 */
export function isOfflineGuest(): boolean {
  return offline && !getAccount();
}

/** 화면에 보일 계정 이름(로그인 안 했으면 null) */
export function accountName(): string | null {
  return getAccount()?.username ?? null;
}
