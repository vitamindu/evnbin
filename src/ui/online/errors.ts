/** 서버 오류 코드(ServerMsg error.code) → 화면 문구 */
export function errorText(code: string, fallback?: string): string {
  switch (code) {
    case 'room_not_found':
      return 'ROOM NOT FOUND';
    case 'room_full':
      return 'THAT ROOM IS FULL';
    case 'in_progress':
      return 'MATCH ALREADY STARTED';
    case 'not_host':
      return 'ONLY THE HOST CAN START';
    case 'bad_version':
      return 'UPDATE THE GAME TO PLAY ONLINE';
    case 'bad_message':
      return 'SOMETHING WENT WRONG';
    default:
      return fallback ? fallback.toUpperCase() : 'SOMETHING WENT WRONG';
  }
}

/** createRoom/joinRoom 등이 던진 값에서 화면 문구를 뽑는다(code 필드, 또는 message가 오류 코드인 Error) */
export function errorFrom(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return errorText(code, fallback);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && /^[a-z_]+$/.test(msg)) return errorText(msg, fallback);
  }
  return fallback;
}
