import '../../styles/online.css';
import { el } from '../../core/dom';
import type { Screen } from '../../core/screens';
import type { OnlineClient } from '../../net/api';
import { getServerUrl } from '../../net/config';
import { getProfile } from '../../state/profile';
import type { AppContext } from '../context';
import { getOnlineClient } from '../online/clientFactory';
import { errorFrom, errorText } from '../online/errors';
import { createHubPanel } from '../online/hubPanel';
import { createRoomPanel } from '../online/roomPanel';
import { netChip, setRoomMode } from '../online/widgets';
import { getSettings } from '../../state/settings';
import { openSettings } from '../overlays/settings';
import { toast } from '../overlays/toast';
import { button, header, txt } from '../widgets';

/**
 * 온라인 TEAM FIGHT 화면. UI 담당. 한 화면 안에서 상태에 따라 패널을 바꾼다.
 *  connecting(연결 중) → hub(이름·방 만들기·코드로 들어가기) → room(방)
 *  failed(서버에 닿지 않음) / lost(방에 있다가 끊김): 다시 시도·설정·로비
 * 경기 시작(OnlineEvents.matchStart)은 어느 화면에 있든 전투 화면으로 넘어간다(wire()).
 */
type View = 'connecting' | 'failed' | 'hub' | 'room' | 'lost';

export function createOnlineScreen(ctx: AppContext): Screen {
  let client: OnlineClient | null = null;
  let view: View = 'connecting';
  let shown = false;
  /** 지금 연결에 쓴 이름(이름을 바꾸면 다시 연결해서 서버에 알린다) */
  let connectedAs = '';
  /** 사용자가 직접 끊는 중(끊김 화면을 띄우지 않는다) */
  let quiet = false;
  let busy: 'create' | 'join' | null = null;
  const unsubs: (() => void)[] = [];

  const getClient = () => {
    if (!client) {
      client = getOnlineClient();
      const c = client;
      // 경기 시작은 방 화면·결과 화면 어디서든 받는다(앱 수명 동안 한 번만 연결)
      c.on('matchStart', ({ info, session }) => ctx.go.battle({ session, info, client: c }));
    }
    return client;
  };

  // ── 머리줄
  const chip = netChip();
  const hdr = header('팀 대결', () => back(), chip.el);

  // ── 연결 상태 패널
  const cpTitle = txt('', 'cp-title');
  const cpDots = el('div', 'mm-dots', [el('i'), el('i'), el('i')]);
  const cpNote = el('p', 'cp-note');
  const cpUrl = el('span', 'cp-url');
  const cpButtons = el('div', 'cp-buttons');
  const connectPanel = el('div', 'cp-panel panel', [cpTitle, cpDots, cpNote, cpUrl, cpButtons]);

  const hub = createHubPanel(ctx, { create, join });
  const room = createRoomPanel(ctx, getClient);
  const root = el('div', 'online', [hdr, connectPanel, hub.el, room.el]);

  function setView(v: View) {
    view = v;
    root.dataset.view = v;
    connectPanel.hidden = !(v === 'connecting' || v === 'failed' || v === 'lost');
    hub.el.hidden = v !== 'hub';
    room.el.hidden = v !== 'room';
    if (v !== 'hub') hub.blurInputs();
    if (v === 'hub') hub.refresh();
    if (v === 'room' && getClient().room) room.render(getClient().room!);
    if (!connectPanel.hidden) renderConnect(v);
  }

  function renderConnect(v: View) {
    cpUrl.textContent = getServerUrl();
    cpDots.hidden = v !== 'connecting';
    const btn = (label: string, cls: string, fn: () => void) => button(`cp-btn ${cls}`, [txt(label)], fn, cls === 'is-back' ? 'back' : 'tap');
    if (v === 'connecting') {
      cpTitle.textContent = '연결 중';
      cpNote.textContent = '게임 서버를 찾고 있어요';
      cpButtons.replaceChildren(btn('취소', 'is-back', () => leaveToLobby()));
    } else if (v === 'failed') {
      cpTitle.textContent = '서버에 연결할 수 없어요';
      cpNote.textContent = '서버가 켜져 있는지, 설정의 서버 주소가 맞는지 확인해 주세요.';
      cpButtons.replaceChildren(
        btn('로비', 'is-back', () => leaveToLobby()),
        btn('설정', 'is-blue', () => openSettings(ctx)),
        btn('다시 시도', 'is-go', () => void connect()),
      );
    } else {
      cpTitle.textContent = '연결이 끊겼어요';
      cpNote.textContent = '다시 연결하면 방으로 돌아가요.';
      cpButtons.replaceChildren(btn('로비', 'is-back', () => leaveToLobby()), btn('다시 연결', 'is-go', () => void connect()));
    }
  }

  // ── 연결

  async function connect(): Promise<boolean> {
    const c = getClient();
    const wasLost = view === 'lost';
    quiet = false;
    setView('connecting');
    const name = getProfile().name;
    try {
      await c.connect(getServerUrl(), name, getProfile().selected);
      connectedAs = name;
      if (shown) setView(c.room ? 'room' : 'hub');
      return true;
    } catch {
      if (shown && !quiet) setView(wasLost ? 'lost' : 'failed');
      return false;
    }
  }

  /** 방을 만들거나 들어가기 전에: 연결돼 있고, 서버가 아는 이름이 지금 이름인지 */
  async function ready(): Promise<boolean> {
    const c = getClient();
    const name = hub.commitName();
    if (c.status === 'connected' && name === connectedAs) return true;
    // 이름을 바꿨으면 다시 연결해서 hello에 새 이름을 보낸다(그동안 끊김 화면은 띄우지 않는다)
    quiet = true;
    if (c.status === 'connected') c.disconnect();
    try {
      await c.connect(getServerUrl(), name, getProfile().selected);
      connectedAs = name;
      return true;
    } catch {
      if (shown) setView('failed');
      return false;
    } finally {
      quiet = false;
    }
  }

  async function create() {
    if (busy) return;
    busy = 'create';
    hub.setBusy(busy);
    try {
      if (!(await ready())) return;
      await getClient().createRoom();
      // 로비에서 크리스탈 러시를 골랐으면 방도 그 모드로
      const mode = getSettings().playMode;
      if (mode === 'crystal') setRoomMode(getClient(), mode);
      if (shown) setView('room');
    } catch (e) {
      toast(errorFrom(e, '방을 만들지 못했어요'));
    } finally {
      busy = null;
      hub.setBusy(null);
    }
  }

  async function join(code: string) {
    if (busy) return;
    busy = 'join';
    hub.setBusy(busy);
    try {
      if (!(await ready())) return;
      await getClient().joinRoom(code);
      if (shown) setView('room');
    } catch (e) {
      hub.setJoinError(errorFrom(e, '방을 찾을 수 없어요'));
    } finally {
      busy = null;
      hub.setBusy(null);
    }
  }

  // ── 나가기

  function back() {
    const c = getClient();
    if (view === 'room') {
      c.leaveRoom();
      setView(c.status === 'connected' ? 'hub' : 'failed');
      return;
    }
    leaveToLobby();
  }

  function leaveToLobby() {
    const c = getClient();
    quiet = true;
    if (c.room) c.leaveRoom();
    c.disconnect();
    ctx.go.lobby();
  }

  return {
    el: root,
    bg: 'online',
    onShow() {
      shown = true;
      const c = getClient();
      ctx.stage.setView(null);
      chip.setStatus(c.status);
      chip.setPing(c.pingMs);
      hub.refresh();
      unsubs.push(
        c.on('status', (s) => {
          chip.setStatus(s);
          if (s === 'disconnected' && !quiet && !busy && (view === 'room' || view === 'hub')) setView(view === 'room' ? 'lost' : 'failed');
        }),
        c.on('ping', (ms) => chip.setPing(ms)),
        c.on('room', (r) => {
          if (r) {
            if (view === 'room') room.render(r);
            // 다시 연결했더니 방이 남아 있던 경우 등(만들기·들어가기 중이면 그쪽이 화면을 바꾼다)
            else if (view === 'hub' && !busy) setView('room');
          } else if (view === 'room') {
            setView(c.status === 'connected' ? 'hub' : 'lost');
          }
        }),
        c.on('error', (e) => {
          const text = errorText(e.code, e.message);
          if (busy === 'join') hub.setJoinError(text);
          else if (!busy) toast(text);
        }),
      );
      if (c.status === 'connected') setView(c.room ? 'room' : 'hub');
      else if (c.status === 'connecting') setView('connecting');
      else void connect();
    },
    onHide() {
      shown = false;
      for (const u of unsubs.splice(0)) u();
      hub.blurInputs();
    },
  };
}
