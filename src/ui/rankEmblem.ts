import { TIERS, type TierId } from '../data/ranks';

/**
 * 티어 문양(FIGHT GUYS 오리지널 디자인): 육각 메달 + 가운데 별 보석.
 * 티어가 오를수록 장식이 늘어난다: 은 = 옆 홈, 금 = 위 뿔, 플래티넘 = 옆 지느러미,
 * 다이아 = 큰 보석, 마스터 = 작은 날개, 그랜드마스터 = 큰 불꽃 날개, 챌린저 = 왕관과 빛살.
 */
const INK = '#12102a';

function hex(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function star(cx: number, cy: number, r: number, inner = 0.45): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export function rankEmblemSvg(tierId: TierId, uid = Math.random().toString(36).slice(2, 8)): string {
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0]!;
  const level = TIERS.indexOf(tier);
  const { light, dark, gem } = tier.colors;
  const g = `g${uid}`;
  const parts: string[] = [];
  const stroke = `stroke="${INK}" stroke-width="3" stroke-linejoin="round"`;

  // 뒤 장식(메달 뒤에 그린다)
  if (level >= 7) {
    // 챌린저: 빛살
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i;
      parts.push(`<path d="M50 52 L${(50 + 46 * Math.cos(a - 0.08)).toFixed(1)} ${(52 + 46 * Math.sin(a - 0.08)).toFixed(1)} L${(50 + 46 * Math.cos(a + 0.08)).toFixed(1)} ${(52 + 46 * Math.sin(a + 0.08)).toFixed(1)}Z" fill="${gem}" opacity="0.55"/>`);
    }
  }
  if (level >= 5) {
    // 마스터 이상: 날개(그랜드마스터부터 크고 불꽃 모양)
    const big = level >= 6;
    const wing = big
      ? 'M30 50 C12 44 4 30 6 16 C14 26 18 26 22 22 C20 32 24 38 30 40 Z'
      : 'M30 52 C18 48 12 40 12 30 C18 36 22 36 26 34 C25 42 27 46 30 46 Z';
    parts.push(`<path d="${wing}" fill="url(#${g})" ${stroke}/>`);
    parts.push(`<path d="${wing}" transform="translate(100 0) scale(-1 1)" fill="url(#${g})" ${stroke}/>`);
  }
  if (level >= 3) {
    // 플래티넘 이상: 옆 지느러미
    parts.push(`<path d="M22 56 L8 64 L24 70 Z" fill="${dark}" ${stroke}/>`);
    parts.push(`<path d="M78 56 L92 64 L76 70 Z" fill="${dark}" ${stroke}/>`);
  }
  if (level >= 2) {
    // 골드 이상: 위 뿔
    parts.push(`<path d="M42 22 L50 6 L58 22 Z" fill="url(#${g})" ${stroke}/>`);
  }

  // 메달 본체
  parts.push(`<polygon points="${hex(50, 54, 32)}" fill="url(#${g})" ${stroke}/>`);
  parts.push(`<polygon points="${hex(50, 54, 22)}" fill="${dark}" stroke="${INK}" stroke-width="2" opacity="0.9"/>`);
  if (level >= 1) {
    // 실버 이상: 옆 홈
    parts.push(`<path d="M20 48 h8 M72 48 h8 M20 60 h8 M72 60 h8" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`);
  }
  // 가운데 보석: 다이아 이상은 큰 마름모 보석, 아래는 별
  if (level >= 4) {
    parts.push(`<path d="M50 34 L64 52 L50 74 L36 52 Z" fill="${gem}" ${stroke}/>`);
    parts.push(`<path d="M36 52 H64 M50 34 L44 52 L50 74 L56 52 Z" fill="none" stroke="${dark}" stroke-width="1.5"/>`);
  } else {
    parts.push(`<polygon points="${star(50, 54, 15)}" fill="${gem}" ${stroke}/>`);
  }
  if (level >= 7) {
    // 챌린저: 왕관
    parts.push(`<path d="M34 24 L38 10 L44 18 L50 6 L56 18 L62 10 L66 24 Z" fill="#ffd34d" ${stroke}/>`);
  }

  return (
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>` +
    parts.join('') +
    `</svg>`
  );
}
