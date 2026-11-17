/** 아주 작은 DOM 생성 도우미. */
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** SVG 문자열을 담은 span */
export function icon(svg: string, className = 'ico'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.innerHTML = svg;
  return s;
}

/** 탭(클릭) 핸들러. 버튼 누름 효과는 CSS :active가 담당한다. */
export function onTap(node: HTMLElement, fn: (e: MouseEvent) => void) {
  node.addEventListener('click', (e) => {
    e.preventDefault();
    fn(e);
  });
}
