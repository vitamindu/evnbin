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

/** public/ranks/<티어>.png 가 있으면 그 이미지를 쓴다(부팅 때 loadRankImages로 확인) */
const images = new Map<TierId, string>();

export async function loadRankImages(): Promise<void> {
  await Promise.all(
    TIERS.map(async (t) => {
      const url = `${import.meta.env.BASE_URL}ranks/${t.id}.png`;
      try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
        if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) images.set(t.id, url);
      } catch {
        /* 없으면 기본 문양 */
      }
    }),
  );
}

export function rankEmblemSvg(tierId: TierId, uid = Math.random().toString(36).slice(2, 8)): string {
  const img = images.get(tierId);
  if (img) return `<img src="${img}" alt="${tierId}" draggable="false" style="width:100%;height:100%;object-fit:contain">`;
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0]!;
  const level = TIERS.indexOf(tier);
  const { light, dark, gem } = tier.colors;
  const id = (n: string) => `${n}${uid}`;
  const s = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"`;
  const back: string[] = [];
  const front: string[] = [];
  const mirror = (d: string, fill: string, extra = '') =>
    `<path d="${d}" fill="${fill}" ${s} ${extra}/><path d="${d}" transform="translate(100 0) scale(-1 1)" fill="${fill}" ${s} ${extra}/>`;

  // ── 뒤 장식 ──
  if (level >= 7) {
    // 챌린저: 빛살 + 바깥 빛 고리
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI / 8) * i;
      const r = i % 2 ? 40 : 48;
      back.push(`<path d="M50 54 L${(50 + r * Math.cos(a - 0.06)).toFixed(1)} ${(54 + r * Math.sin(a - 0.06)).toFixed(1)} L${(50 + r * Math.cos(a + 0.06)).toFixed(1)} ${(54 + r * Math.sin(a + 0.06)).toFixed(1)}Z" fill="${gem}" opacity="0.5"/>`);
    }
    back.push(`<circle cx="50" cy="54" r="38" fill="url(#${id('glow')})"/>`);
  }
  if (level >= 6) {
    // 그랜드마스터 이상: 큰 불꽃 날개(깃 5개)
    for (let k = 0; k < 5; k++) {
      const y = 30 + k * 7;
      const x = 4 + k * 2.5;
      back.push(mirror(`M30 ${y + 8} C${x + 10} ${y + 6} ${x} ${y} ${x - 1} ${y - 8} C${x + 8} ${y - 2} ${x + 16} ${y - 1} 30 ${y + 1} Z`, `url(#${id('wing')})`));
    }
  } else if (level >= 5) {
    // 마스터: 깃 3개 날개
    for (let k = 0; k < 3; k++) {
      const y = 38 + k * 8;
      const x = 10 + k * 3;
      back.push(mirror(`M30 ${y + 7} C${x + 8} ${y + 6} ${x} ${y + 1} ${x - 1} ${y - 6} C${x + 7} ${y - 1} ${x + 14} ${y} 30 ${y + 1} Z`, `url(#${id('wing')})`));
    }
  }
  if (level >= 3) {
    // 플래티넘 이상: 옆 지느러미(다이아부터 더 크게)
    const big = level >= 4;
    back.push(mirror(big ? 'M22 50 L2 58 L10 64 L4 72 L24 70 Z' : 'M22 54 L8 62 L24 68 Z', `url(#${id('rim')})`));
  }
  if (level >= 2) {
    // 골드 이상: 위 뿔(다이아부터 세 갈래)
    back.push(`<path d="M41 26 L50 ${level >= 4 ? 2 : 8} L59 26 Z" fill="url(#${id('rim')})" ${s}/>`);
    if (level >= 4) back.push(mirror('M38 28 L32 12 L44 24 Z', `url(#${id('rim')})`));
    // 아래 잎사귀 장식
    back.push(mirror('M50 88 C40 92 30 88 26 80 C34 84 42 84 50 82 Z', `url(#${id('rim')})`));
  }

  // ── 메달 본체 ──
  front.push(`<polygon points="${hex(50, 54, 33)}" fill="url(#${id('rim')})" ${s}/>`);
  front.push(`<polygon points="${hex(50, 54, 26)}" fill="url(#${id('face')})" stroke="${INK}" stroke-width="1.8"/>`);
  // 광택: 테두리 위쪽 하이라이트
  front.push(`<path d="M24 41 L50 25 L76 41" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2.2" stroke-linecap="round"/>`);
  if (level === 0) {
    // 브론즈: 리벳 4개
    for (const [x, y] of [[30, 44], [70, 44], [30, 64], [70, 64]]) front.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="${light}" stroke="${INK}" stroke-width="1.2"/>`);
  }
  if (level >= 1) {
    // 실버 이상: 옆 홈 + 위 탭
    front.push(`<path d="M19 48 h7 M74 48 h7 M19 60 h7 M74 60 h7" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`);
    front.push(`<rect x="45" y="20" width="10" height="5" rx="2" fill="${light}" ${s}/>`);
  }
  // ── 가운데 보석 ──
  if (level >= 4) {
    front.push(`<circle cx="50" cy="54" r="16" fill="url(#${id('glow')})"/>`);
    front.push(`<path d="M50 36 L63 52 L50 72 L37 52 Z" fill="url(#${id('gem')})" ${s}/>`);
    front.push(`<path d="M37 52 H63 M50 36 L45 52 L50 72 L55 52 Z" fill="none" stroke="${dark}" stroke-width="1.3" opacity="0.8"/>`);
    front.push(`<path d="M44 44 L48 40" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.9"/>`);
  } else {
    front.push(`<polygon points="${star(50, 54, 15)}" fill="url(#${id('gem')})" ${s}/>`);
    front.push(`<circle cx="46" cy="49" r="2" fill="#ffffff" opacity="0.85"/>`);
  }
  if (level >= 7) {
    // 챌린저: 왕관
    front.push(`<path d="M33 24 L37 8 L44 17 L50 2 L56 17 L63 8 L67 24 Z" fill="url(#${id('crown')})" ${s}/>`);
    for (const x of [37, 50, 63]) front.push(`<circle cx="${x}" cy="${x === 50 ? 4 : 10}" r="2.4" fill="${gem}" stroke="${INK}" stroke-width="1.2"/>`);
  }

  const defs =
    `<linearGradient id="${id('rim')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.45" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>` +
    `<radialGradient id="${id('face')}" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="${light}" stop-opacity="0.85"/><stop offset="0.55" stop-color="${dark}"/><stop offset="1" stop-color="${INK}" stop-opacity="0.9"/></radialGradient>` +
    `<radialGradient id="${id('gem')}" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="${gem}"/><stop offset="1" stop-color="${light}"/></radialGradient>` +
    `<radialGradient id="${id('glow')}"><stop offset="0" stop-color="${gem}" stop-opacity="0.9"/><stop offset="1" stop-color="${gem}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id('wing')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>` +
    `<linearGradient id="${id('crown')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset="1" stop-color="#d9930f"/></linearGradient>`;

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${back.join('')}${front.join('')}</svg>`;
}
