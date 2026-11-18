/**
 * 서버 실행 진입점. `npm run server`(개발, tsx watch) / `npm run server:build && npm run server:start`(배포).
 *
 * 환경 변수
 *   PORT             포트(기본 8787). HTTP GET /health 와 웹소켓이 같은 포트
 *   HOST             바인드 주소(기본 0.0.0.0)
 *   ALLOWED_ORIGINS  허용할 페이지 주소(쉼표 구분, 예: https://example.github.io). 비우면 모두 허용
 *   START_DELAY_MS   경기 시작 전 준비 시간(기본 1500)
 */
import { startServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const startDelayMs = process.env.START_DELAY_MS ? Number(process.env.START_DELAY_MS) : undefined;

const server = await startServer({ port, host, allowedOrigins, startDelayMs });
console.log(`[server] listening on http://${host}:${server.port} (ws on the same port, GET /health)`);
if (allowedOrigins.length) console.log(`[server] allowed origins: ${allowedOrigins.join(', ')}`);

let closing = false;
const shutdown = (sig: string) => {
  if (closing) return;
  closing = true;
  console.log(`[server] ${sig}: closing`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
