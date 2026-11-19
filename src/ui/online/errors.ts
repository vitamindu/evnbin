/** 서버 오류 코드(ServerMsg error.code) → 화면 문구 */
export function errorText(code: string, fallback?: string): string {
  switch (code) {
    case 'room_not_found':
      return '방을 찾을 수 없어요';
    case 'room_full':
      return '방이 꽉 찼어요';
    case 'in_progress':
      return '이미 경기가 시작됐어요';
    case 'not_host':
      return '방장만 시작할 수 있어요';
    case 'bad_version':
      return '게임을 새로 고친 뒤 다시 들어와 주세요';
    case 'bad_message':
      return '문제가 생겼어요';
    default:
      return fallback || '문제가 생겼어요';
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
