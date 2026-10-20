interface ScrollPosition { key: string; top: number; left: number }

function keyedElements(root: HTMLElement): Array<[string, HTMLElement]> {
  const counts = new Map<string, number>();
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map((element) => {
    const name = element === root ? 'root' : element.dataset.ehScrollKey
      ?? `${element.tagName}:${element.className}`;
    const ordinal = counts.get(name) ?? 0;
    counts.set(name, ordinal + 1);
    return [`${name}:${ordinal}`, element];
  });
}

/** Includes nested timelines, sidebars, and horizontally scrolled tables. */
export function captureScrollState(root: HTMLElement): ScrollPosition[] {
  return keyedElements(root).filter(([, element]) => typeof element.scrollTop === 'number'
    && (element === root || element.scrollTop !== 0 || element.scrollLeft !== 0
      || element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth))
    .map(([key, element]) => ({ key, top: element.scrollTop, left: element.scrollLeft }));
}

export function restoreScrollState(root: HTMLElement, positions: ScrollPosition[]): void {
  const elements = new Map(keyedElements(root));
  for (const position of positions) {
    const element = elements.get(position.key);
    if (!element) continue;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  }
}
