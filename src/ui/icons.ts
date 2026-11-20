/** FIGHT GUYS 전용 아이콘(직접 그린 단순 도형 SVG). 외곽선은 --ink 색. */
const S = 'stroke="var(--ink)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const svg = (body: string) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const ICONS = {
  shop: svg(
    `<path d="M8 20h32v20a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#ffd34d" ${S}/>` +
      `<path d="M6 12l4-7h28l4 7v4a5 5 0 0 1-9 2 5 5 0 0 1-9 0 5 5 0 0 1-9 0 5 5 0 0 1-9-2z" fill="#ff5d5d" ${S}/>` +
      `<rect x="19" y="28" width="10" height="15" rx="2" fill="#7ad0ff" ${S}/>`,
  ),
  fighters: svg(
    `<circle cx="16" cy="17" r="8" fill="#7ad0ff" ${S}/><path d="M4 41c0-8 5-13 12-13s12 5 12 13z" fill="#7ad0ff" ${S}/>` +
      `<circle cx="32" cy="15" r="9" fill="#ffb347" ${S}/><path d="M18 42c0-9 6-15 14-15s14 6 14 15z" fill="#ffb347" ${S}/>`,
  ),
  news: svg(
    `<rect x="6" y="8" width="30" height="34" rx="3" fill="#f4f6ff" ${S}/>` +
      `<path d="M36 16h6v22a4 4 0 0 1-8 0" fill="#c9d3ff" ${S}/>` +
      `<path d="M12 16h18M12 23h18M12 30h12" ${S}/>`,
  ),
  friends: svg(
    `<circle cx="20" cy="18" r="9" fill="#8cf08a" ${S}/><path d="M5 42c0-9 7-14 15-14s15 5 15 14z" fill="#8cf08a" ${S}/>` +
      `<path d="M38 12v14M31 19h14" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M38 12v14M31 19h14" stroke="#ffd34d" stroke-width="3.5" stroke-linecap="round"/>`,
  ),
  party: svg(
    `<circle cx="11" cy="20" r="6" fill="#c792ff" ${S}/><circle cx="37" cy="20" r="6" fill="#c792ff" ${S}/>` +
      `<path d="M2 40c0-7 4-11 9-11s9 4 9 11zM28 40c0-7 4-11 9-11s9 4 9 11z" fill="#c792ff" ${S}/>` +
      `<circle cx="24" cy="16" r="8" fill="#ff8ad1" ${S}/><path d="M12 43c0-9 5-14 12-14s12 5 12 14z" fill="#ff8ad1" ${S}/>`,
  ),
  crew: svg(
    `<path d="M10 4v40" ${S}/>` +
      `<path d="M10 7h28l-6 9 6 9H10z" fill="#ff7a59" ${S}/>` +
      `<path d="M20 12l2 4 4 .5-3 3 1 4-4-2-4 2 1-4-3-3 4-.5z" fill="#ffd34d" stroke="var(--ink)" stroke-width="1.5"/>`,
  ),
  gear: svg(
    `<path d="M21 4h6l1 5 4 2 5-3 4 4-3 5 2 4 5 1v6l-5 1-2 4 3 5-4 4-5-3-4 2-1 5h-6l-1-5-4-2-5 3-4-4 3-5-2-4-5-1v-6l5-1 2-4-3-5 4-4 5 3 4-2z" fill="#d6dcf5" ${S}/>` +
      `<circle cx="24" cy="24" r="7" fill="#5a6390" ${S}/>`,
  ),
  coin: svg(
    `<circle cx="24" cy="24" r="19" fill="#ffc93c" ${S}/><circle cx="24" cy="24" r="12" fill="#ffe08a" stroke="#c98a10" stroke-width="3"/>` +
      `<path d="M24 17v14" stroke="#c98a10" stroke-width="4" stroke-linecap="round"/>`,
  ),
  crystal: svg(
    `<path d="M24 4l16 14-16 26L8 18z" fill="#5fd6ff" ${S}/><path d="M8 18h32M24 4l-7 14 7 26 7-26z" fill="none" stroke="#1d7fb8" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  trophy: svg(
    `<path d="M14 6h20v12a10 10 0 0 1-20 0z" fill="#ffc93c" ${S}/>` +
      `<path d="M14 10H7v4a7 7 0 0 0 8 7M34 10h7v4a7 7 0 0 1-8 7" fill="none" ${S}/>` +
      `<path d="M21 28h6v6h5v8H16v-8h5z" fill="#ffb020" ${S}/>`,
  ),
  plus: svg(`<path d="M24 8v32M8 24h32" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>`),
  back: svg(
    `<path d="M30 8L14 24l16 16" fill="none" stroke="var(--ink)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M30 8L14 24l16 16" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  next: svg(
    `<path d="M18 8l16 16-16 16" fill="none" stroke="var(--ink)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M18 8l16 16-16 16" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  prev: svg(
    `<path d="M30 8L14 24l16 16" fill="none" stroke="var(--ink)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M30 8L14 24l16 16" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  check: svg(`<path d="M9 25l10 10 20-22" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  close: svg(`<path d="M12 12l24 24M36 12L12 36" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`),
  pass: svg(
    `<path d="M6 12h36v8a4 4 0 0 0 0 8v8H6v-8a4 4 0 0 0 0-8z" fill="#ffd34d" ${S}/>` +
      `<path d="M24 15l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#ff7a59" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  // 역할 아이콘
  scatter: svg(
    `<circle cx="10" cy="24" r="5" fill="#ffffff" ${S}/>` +
      `<path d="M16 24h24M16 21l22-11M16 27l22 11" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M16 24h24M16 21l22-11M16 27l22 11" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`,
  ),
  marksman: svg(
    `<circle cx="24" cy="24" r="15" fill="none" stroke="var(--ink)" stroke-width="8"/>` +
      `<circle cx="24" cy="24" r="15" fill="none" stroke="#ffffff" stroke-width="4"/>` +
      `<path d="M24 3v13M24 32v13M3 24h13M32 24h13" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M24 3v13M24 32v13M3 24h13M32 24h13" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`,
  ),
  sniper: svg(
    `<circle cx="24" cy="24" r="17" fill="none" stroke="var(--ink)" stroke-width="7"/>` +
      `<circle cx="24" cy="24" r="17" fill="none" stroke="#ffffff" stroke-width="3"/>` +
      `<circle cx="24" cy="24" r="4" fill="#ff8fbf" stroke="var(--ink)" stroke-width="2.5"/>` +
      `<path d="M24 1v9M24 38v9M1 24h9M38 24h9" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M24 1v9M24 38v9M1 24h9M38 24h9" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`,
  ),
  tank: svg(`<path d="M24 4l17 6v12c0 11-7 18-17 22C14 40 7 33 7 22V10z" fill="#ffffff" ${S}/><path d="M24 12v24" stroke="var(--ink)" stroke-width="3"/>`),
  modeCrystal: svg(
    `<path d="M24 3l18 15-18 27L6 18z" fill="#4fe0c1" ${S}/><path d="M6 18h36M24 3l-8 15 8 27 8-27z" fill="none" stroke="#178a73" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  // 전투 조작
  /** 기본 공격: 오른쪽 위로 날아가는 탄 + 속도선 */
  attack: svg(
    `<g transform="rotate(-32 24 24)">` +
      `<path d="M3 19h7M1 24h9M3 29h7" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M3 19h7M1 24h9M3 29h7" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>` +
      `<path d="M14 16h15c7 0 12 4 15 8-3 4-8 8-15 8H14z" fill="#ffffff" ${S}/>` +
      `<path d="M21 16v16" stroke="var(--ink)" stroke-width="3"/>` +
      `</g>`,
  ),
  /** 궁극기: 여덟 갈래 폭발 + 번개 */
  super: svg(
    `<path d="M24 3l5 9 9.8-2.8L36 19l9 5-9 5 2.8 9.8L29 36l-5 9-5-9-9.8 2.8L12 29l-9-5 9-5-2.8-9.8L19 12z" fill="#ffd34d" ${S}/>` +
      `<path d="M27.5 11L17 26h6.5l-3 11L31.5 21H25z" fill="#ffffff" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>`,
  ),
  // 모드
  /** TRAINING: 받침대 위 과녁판 */
  modeTraining: svg(
    `<path d="M17 36l-5 9M31 36l5 9M24 38v7" fill="none" ${S}/>` +
      `<circle cx="24" cy="21" r="17" fill="#ffffff" ${S}/>` +
      `<circle cx="24" cy="21" r="11" fill="#ff5d5d" ${S}/>` +
      `<circle cx="24" cy="21" r="5.5" fill="#ffffff" ${S}/>` +
      `<circle cx="24" cy="21" r="1.8" fill="#ff5d5d"/>`,
  ),
  /** TEAM FIGHT: 마주 기운 파랑·빨강 방패 + 위의 별 불꽃 */
  modeTeamfight: svg(
    `<g transform="rotate(-14 15 27)"><path d="M15 11l10 4v8c0 8-4.5 12.5-10 15.5C9.5 35.5 5 31 5 23v-8z" fill="#4f8bff" ${S}/></g>` +
      `<g transform="rotate(14 33 27)"><path d="M33 11l10 4v8c0 8-4.5 12.5-10 15.5C27.5 35.5 23 31 23 23v-8z" fill="#ff5d5d" ${S}/></g>` +
      `<path d="M24 1.5l2.6 5.2 5.7.8-4.2 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.2-4 5.7-.8z" fill="#ffd34d" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/>`,
  ),
  /** 크리스탈 러시: 보라 크리스탈 하나(HUD·머리 위 개수) */
  rushGem: svg(
    `<path d="M24 3l13 11-13 31L11 14z" fill="#c38bff" ${S}/>` +
      `<path d="M11 14h26M24 3l-5 11 5 31 5-31z" fill="none" stroke="#7a3fd0" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M19 9l-3 4" stroke="#f3e6ff" stroke-width="2.5" stroke-linecap="round"/>`,
  ),
  /** 크리스탈 러시 모드: 큰 크리스탈 + 작은 크리스탈 둘 + 반짝임 */
  modeRush: svg(
    `<path d="M10 22l6 5-6 15-6-15z" fill="#9fd8ff" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M38 22l6 5-6 15-6-15z" fill="#ff9fd0" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M24 5l11 10-11 29-11-29z" fill="#c38bff" ${S}/>` +
      `<path d="M13 15h22M24 5l-4 10 4 29 4-29z" fill="none" stroke="#7a3fd0" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M41 6v8M37 10h8" stroke="#ffd34d" stroke-width="3" stroke-linecap="round"/>`,
  ),
  /** 새로 고침 */
  refresh: svg(
    `<path d="M38 20A15 15 0 1 0 39 30" fill="none" stroke="var(--ink)" stroke-width="10" stroke-linecap="round"/>` +
      `<path d="M38 20A15 15 0 1 0 39 30" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M30 17h10V7" fill="none" stroke="var(--ink)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M30 17h10V7" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  // 온라인 방
  copy: svg(
    `<rect x="17" y="5" width="24" height="29" rx="5" fill="#c9d3ff" ${S}/>` +
      `<rect x="7" y="14" width="24" height="29" rx="5" fill="#ffffff" ${S}/>` +
      `<path d="M13 23h12M13 30h12M13 37h7" stroke="#8b97cf" stroke-width="3" stroke-linecap="round"/>`,
  ),
  swap: svg(
    `<path d="M9 15h27M29 8l7 7-7 7M39 33H12M19 26l-7 7 7 7" fill="none" stroke="var(--ink)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M9 15h27M29 8l7 7-7 7" fill="none" stroke="#7fb2ff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M39 33H12M19 26l-7 7 7 7" fill="none" stroke="#ff8a8a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  /** 봇: 안테나 달린 네모 머리 */
  bot: svg(
    `<path d="M24 6v6" ${S}/><circle cx="24" cy="5.5" r="3.2" fill="#ffd34d" stroke="var(--ink)" stroke-width="2.5"/>` +
      `<path d="M5 22v9M43 22v9" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>` +
      `<rect x="8" y="12" width="32" height="29" rx="9" fill="#c9d3ff" ${S}/>` +
      `<rect x="13" y="19" width="22" height="13" rx="6.5" fill="#2a2f5a" stroke="var(--ink)" stroke-width="2.5"/>` +
      `<circle cx="19" cy="25.5" r="2.8" fill="#63dcff"/><circle cx="29" cy="25.5" r="2.8" fill="#63dcff"/>`,
  ),
  /** 방장 */
  crown: svg(
    `<path d="M6 17l9.5 8L24 11l8.5 14 9.5-8-4 21H10z" fill="#ffd34d" ${S}/>` +
      `<path d="M11.5 32h25" stroke="#c98a10" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="24" cy="10" r="3.2" fill="#ff8ad1" stroke="var(--ink)" stroke-width="2.5"/>`,
  ),
  /** 최고 활약 */
  star: svg(
    `<path d="M24 4l6.2 12.6 13.8 2-10 9.8 2.4 13.8L24 35.7l-12.4 6.5L14 28.4 4 18.6l13.8-2z" fill="#ffd34d" ${S}/>` +
      `<path d="M24 11l3.6 7.4" stroke="#fff6c2" stroke-width="3" stroke-linecap="round"/>`,
  ),
  /** 이름 고치기 */
  pencil: svg(
    `<path d="M9 39l2.5-10L31 9.5l7.5 7.5L19 36.5z" fill="#ffd34d" ${S}/>` +
      `<path d="M9 39l2.5-10 7.5 7.5z" fill="#ffe0b0" ${S}/>` +
      `<path d="M27 13.5l7.5 7.5" stroke="var(--ink)" stroke-width="3"/>`,
  ),
  /** 나가기: 문 + 화살표 */
  door: svg(
    `<path d="M8 6h20v36H8z" fill="#b07a52" ${S}/><path d="M12 10h12v28H12z" fill="#8a5a3c" stroke="var(--ink)" stroke-width="2"/>` +
      `<circle cx="22" cy="25" r="2" fill="#ffd34d" stroke="var(--ink)" stroke-width="1.5"/>` +
      `<path d="M27 24h15M36 18l6 6-6 6" fill="none" stroke="var(--ink)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M27 24h15M36 18l6 6-6 6" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  rotate: svg(
    `<rect x="14" y="6" width="20" height="36" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/>` +
      `<path d="M6 30a18 18 0 0 0 14 13M42 18A18 18 0 0 0 28 5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>` +
      `<path d="M20 43l-4 3M20 43l-2-4M28 5l4-3M28 5l2 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>`,
  ),
} as const;

export type IconName = keyof typeof ICONS;
