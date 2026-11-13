import { TextRun } from './types';

export function mapPdfFontToCss(fontName: string): string {
  const low = (fontName || '').toLowerCase();
  if (low.includes('times') || low === 'tiro' || low.includes('serif')) {
    return 'serif';
  }
  if (low.includes('cour') || low === 'cour' || low.includes('mono')) {
    return 'monospace';
  }
  return 'sans-serif';
}

export function coalesceRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.font === r.font &&
      prev.size === r.size &&
      prev.color === r.color &&
      Boolean(prev.bold) === Boolean(r.bold) &&
      Boolean(prev.italic) === Boolean(r.italic) &&
      (prev.link_uri || null) === (r.link_uri || null)
    ) {
      prev.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function applyStyleToRange(
  runs: TextRun[],
  start: number,
  end: number,
  patch: Partial<Pick<TextRun, 'font' | 'size' | 'color' | 'bold' | 'italic'>>
): TextRun[] {
  const totalLen = runs.reduce((acc, r) => acc + r.text.length, 0);
  const s = Math.max(0, Math.min(totalLen, start));
  const e = Math.max(s, Math.min(totalLen, end));
  if (s === e) return runs;

  const chars: TextRun[] = [];
  let idx = 0;
  for (const r of runs) {
    for (const ch of r.text) {
      if (idx >= s && idx < e) {
        chars.push({ ...r, ...patch, text: ch });
      } else {
        chars.push({ ...r, text: ch });
      }
      idx += 1;
    }
  }
  return coalesceRuns(chars);
}

export function getSelectionStyle(
  runs: TextRun[],
  start: number,
  end: number,
  fallback: TextRun
): { font: string; size: number; color: string; bold: boolean; italic: boolean; mixed: boolean } {
  const totalLen = runs.reduce((acc, r) => acc + r.text.length, 0);
  if (totalLen === 0 || runs.length === 0) {
    return {
      font: fallback.font,
      size: fallback.size,
      color: fallback.color,
      bold: fallback.bold,
      italic: fallback.italic,
      mixed: false,
    };
  }
  const s = Math.max(0, Math.min(totalLen - 1, start < end ? start : Math.max(0, start - 1)));
  const e = start < end ? Math.min(totalLen, end) : s + 1;

  const hitRuns: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const rEnd = pos + r.text.length;
    if (rEnd > s && pos < e) {
      hitRuns.push(r);
    }
    pos = rEnd;
  }
  if (hitRuns.length === 0) {
    const first = runs[0];
    return {
      font: first.font,
      size: first.size,
      color: first.color,
      bold: first.bold,
      italic: first.italic,
      mixed: false,
    };
  }
  const first = hitRuns[0];
  const mixed = hitRuns.some(
    (r) =>
      r.font !== first.font ||
      r.size !== first.size ||
      r.color !== first.color ||
      Boolean(r.bold) !== Boolean(first.bold) ||
      Boolean(r.italic) !== Boolean(first.italic)
  );
  return {
    font: first.font,
    size: first.size,
    color: first.color,
    bold: Boolean(first.bold),
    italic: Boolean(first.italic),
    mixed,
  };
}

export function replaceTextPreservingRuns(runs: TextRun[], newText: string, fallback: TextRun): TextRun[] {
  if (!runs.length) {
    return [{ ...fallback, text: newText }];
  }
  const oldText = runs.map((r) => r.text).join('');
  if (oldText === newText) return runs;

  // Expand to per-char styles
  const oldChars: TextRun[] = [];
  for (const r of runs) {
    for (const ch of r.text) {
      oldChars.push({ ...r, text: ch });
    }
  }

  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText[prefix] === newText[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const insertStyle =
    oldChars[Math.max(0, prefix - 1)] || oldChars[Math.min(oldChars.length - 1, prefix)] || fallback;
  const midLen = Math.max(0, newText.length - prefix - suffix);
  const nextChars: TextRun[] = [
    ...oldChars.slice(0, prefix),
    ...Array.from(newText.slice(prefix, prefix + midLen)).map((ch) => ({ ...insertStyle, text: ch })),
    ...oldChars.slice(oldChars.length - suffix),
  ];
  return coalesceRuns(nextChars);
}

export function serializeRunsToDom(container: HTMLElement, runs: TextRun[], zoom: number): void {
  container.innerHTML = '';
  for (const r of runs) {
    const span = document.createElement('span');
    span.dataset.font = r.font;
    span.dataset.size = String(r.size);
    span.dataset.color = r.color;
    span.dataset.bold = r.bold ? '1' : '0';
    span.dataset.italic = r.italic ? '1' : '0';
    if (r.link_uri) span.dataset.linkUri = r.link_uri;
    span.style.fontFamily = mapPdfFontToCss(r.font);
    span.style.fontSize = `${Math.max(8, r.size * zoom)}px`;
    span.style.color = r.color;
    span.style.fontWeight = r.bold ? '700' : '400';
    span.style.fontStyle = r.italic ? 'italic' : 'normal';
    if (r.link_uri) {
      span.style.textDecoration = 'underline';
    }
    span.textContent = r.text;
    container.appendChild(span);
  }
}

export function parseDomToRuns(container: HTMLElement, fallback: TextRun): TextRun[] {
  const out: TextRun[] = [];

  const readStyle = (el: HTMLElement | null, inherited: TextRun): TextRun => {
    if (!el || el === container) return inherited;
    if (el.dataset && el.dataset.font) {
      return {
        ...inherited,
        font: el.dataset.font,
        size: parseFloat(el.dataset.size || '') || inherited.size,
        color: el.dataset.color || inherited.color,
        bold: el.dataset.bold === '1',
        italic: el.dataset.italic === '1',
        link_uri: el.dataset.linkUri || null,
      };
    }
    return inherited;
  };

  const walk = (node: Node, style: TextRun) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.textContent || '';
      if (val) {
        out.push({ ...style, text: val });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      out.push({ ...style, text: '\n' });
      return;
    }
    const nextStyle = readStyle(el, style);
    const isBlock = tag === 'div' || tag === 'p';
    if (isBlock && out.length > 0 && !out[out.length - 1].text.endsWith('\n')) {
      out.push({ ...nextStyle, text: '\n' });
    }
    for (const child of Array.from(el.childNodes)) {
      walk(child, nextStyle);
    }
  };

  for (const child of Array.from(container.childNodes)) {
    walk(child, fallback);
  }
  return coalesceRuns(out);
}

export function getDomSelectionOffsets(container: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return { start: 0, end: 0 };
  }

  const measureOffset = (targetNode: Node, targetOffset: number): number => {
    let count = 0;
    let done = false;
    const walk = (node: Node) => {
      if (done) return;
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          count += targetOffset;
        } else {
          const children = Array.from(node.childNodes);
          for (let i = 0; i < Math.min(targetOffset, children.length); i++) {
            count += (children[i].textContent || '').length;
          }
        }
        done = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node.textContent || '').length;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName.toLowerCase();
        if (tag === 'br') {
          count += 1;
          return;
        }
        for (const ch of Array.from(node.childNodes)) {
          walk(ch);
          if (done) return;
        }
      }
    };
    walk(container);
    return count;
  };

  const a = measureOffset(range.startContainer, range.startOffset);
  const b = measureOffset(range.endContainer, range.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function setDomSelectionOffsets(container: HTMLElement, start: number, end: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const locate = (offset: number): { node: Node; offset: number } => {
    let remaining = Math.max(0, offset);
    let lastText: Text | null = null;
    const walk = (node: Node): { node: Node; offset: number } | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent || '').length;
        lastText = node as Text;
        if (remaining <= len) {
          return { node, offset: remaining };
        }
        remaining -= len;
        return null;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if ((node as HTMLElement).tagName.toLowerCase() === 'br') {
          if (remaining <= 1) {
            return { node: node.parentNode || container, offset: Array.from((node.parentNode || container).childNodes).indexOf(node as ChildNode) + remaining };
          }
          remaining -= 1;
          return null;
        }
        for (const ch of Array.from(node.childNodes)) {
          const found = walk(ch);
          if (found) return found;
        }
      }
      return null;
    };
    const found = walk(container);
    if (found) return found;
    if (lastText) {
      const txt = lastText as Text;
      return { node: txt, offset: (txt.textContent || '').length };
    }
    return { node: container, offset: container.childNodes.length };
  };

  const sLoc = locate(start);
  const eLoc = locate(end);
  const range = document.createRange();
  range.setStart(sLoc.node, sLoc.offset);
  range.setEnd(eLoc.node, eLoc.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}
