import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '@/i18n/locales';
import { getCurrentLocale } from '@/i18n/i18n';
import { on } from '@/core/events';
import { FALLBACK_WORDS, type SegmenterFallbackLocale } from './segmenter-fallback-words';

// 英數代碼保護：符合代碼樣式且長度 ≤ 24 時包成 .ui-nobr。
// 對應 CSS `.ui-nobr { white-space: nowrap; }` 定義在 src/styles/base.css。
type SegmentLocale = SegmenterFallbackLocale;

type AsTag = 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';

const CACHE_LIMIT = 500;
const NOBR_CODE = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+$/;
const NOBR_MAX_LENGTH = 24;

// 「語系＋字串」→ 詞陣列。命中時重新插入至尾端（簡易 LRU）。
const cache = new Map<string, string[]>();
const segmenterCache = new Map<SegmentLocale, Intl.Segmenter>();

// 降級詞表在模組載入時先依長度排序一次，避免每次切詞重排。
const SORTED_FALLBACK_WORDS: Record<SegmentLocale, readonly string[]> = {
  'zh-TW': [...FALLBACK_WORDS['zh-TW']].sort((a, b) => b.length - a.length),
  'zh-CN': [...FALLBACK_WORDS['zh-CN']].sort((a, b) => b.length - a.length),
  ja: [...FALLBACK_WORDS.ja].sort((a, b) => b.length - a.length),
};

/** 測試用：清空切詞快取。 */
export function clearSegmentCacheForTest(): void {
  cache.clear();
}

/** 測試用：清空 Intl.Segmenter 實例快取。 */
export function clearSegmenterCacheForTest(): void {
  segmenterCache.clear();
}

function isSegmentLocale(locale: Locale): locale is SegmentLocale {
  return locale === 'zh-TW' || locale === 'zh-CN' || locale === 'ja';
}

function fallbackSegment(text: string, locale: SegmentLocale): string[] {
  if (!text) return [''];
  const sorted = SORTED_FALLBACK_WORDS[locale];
  const out: string[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    const m = sorted.find((w) => text.startsWith(w, i));
    if (m) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(m);
      i += m.length;
    } else {
      buf += text[i] ?? '';
      i += 1;
    }
  }
  if (buf) out.push(buf);
  return out.length > 0 ? out : [text];
}

function runSegmenter(text: string, locale: SegmentLocale): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Seg === 'function') {
    let seg = segmenterCache.get(locale);
    if (!seg) {
      seg = new Seg(locale, { granularity: 'word' });
      segmenterCache.set(locale, seg);
    }
    const out: string[] = [];
    for (const s of seg.segment(text)) out.push(s.segment);
    return out;
  }
  return fallbackSegment(text, locale);
}

/**
 * 依語系切詞，回傳詞陣列（供測試）。
 * 只有 zh-TW / zh-CN / ja 會切；其他語系直接回傳 `[text]`。
 * 相同「語系＋字串」會快取命中，回傳同一個陣列（請勿修改）。
 */
export function segmentForWrap(text: string, locale: Locale): string[] {
  if (!isSegmentLocale(locale)) return [text];
  const key = `${locale}::${text}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const parts = runSegmenter(text, locale);
  cache.set(key, parts);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return parts;
}

// 漢字、平假名、片假名字母（不含「・」「ー」等符號）
const CJK_CHAR = /[ぁ-ゖァ-ヺ㐀-䶿一-鿿豈-﫿]/;

/**
 * 只有前一段結尾與後一段開頭都是中日文字時才插 `<wbr>`：
 * 標點前後不插（避免標點被擠到行首，違反禁則），英數代碼內部不插（例如 zh-TW 不得在連字號處斷開）。
 */
export function shouldBreakBetween(prev: string, next: string): boolean {
  return CJK_CHAR.test(prev.slice(-1)) && CJK_CHAR.test(next.charAt(0));
}

export interface TextProps {
  as?: AsTag;
  class?: string;
  children?: ComponentChildren;
}

function stringify(children: ComponentChildren): string {
  if (children === null || children === undefined || children === false || children === true) {
    return '';
  }
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(stringify).join('');
  return '';
}

const ASCII_CODE_PIECE = /^[A-Za-z0-9_.-]+$/;

/**
 * 從 start 起取「連續英數代碼片段」的完整範圍（取代原本逐步累加、保留最短匹配的做法，
 * 因為超過長度上限的長代碼會被誤把前綴包成 .ui-nobr；Codex 第二輪複審指出）。
 * 回傳最後一個片段的索引；start 不是代碼片段時回傳 null。
 */
function codeRunEnd(segments: string[], start: number): number | null {
  let end: number | null = null;
  for (let k = start; k < segments.length; k++) {
    const piece = segments[k];
    if (piece === undefined || !ASCII_CODE_PIECE.test(piece)) break;
    end = k;
  }
  return end;
}

function buildSegmentNodes(segments: string[]): Array<string | JSX.Element> {
  const nodes: Array<string | JSX.Element> = [];
  let i = 0;
  let prev: string | undefined;

  while (i < segments.length) {
    const runEnd = codeRunEnd(segments, i);
    if (runEnd !== null) {
      const run = segments.slice(i, runEnd + 1).join('');
      // 完整代碼符合樣式且不超過上限才保護；否則整段原樣輸出（不插 wbr），不拆出前綴或後綴
      nodes.push(
        run.length <= NOBR_MAX_LENGTH && NOBR_CODE.test(run) ? (
          <span class="ui-nobr" key={`n${i}`}>
            {run}
          </span>
        ) : (
          run
        ),
      );
      prev = segments[runEnd];
      i = runEnd + 1;
      continue;
    }

    const s = segments[i];
    if (s) {
      if (prev && shouldBreakBetween(prev, s)) nodes.push(<wbr key={`w${i}`} />);
      nodes.push(s);
      prev = s;
    }
    i += 1;
  }

  return nodes;
}

/** 依附件 §5 實作「可換行但詞不拆開」。外層固定套 `ui-text` class。 */
export function Text({ as: Tag = 'span', class: className, children }: TextProps): JSX.Element {
  const [locale, setLocale] = useState<Locale>(getCurrentLocale());

  useEffect(() => {
    return on('locale:changed', ({ locale: next }) => setLocale(next));
  }, []);

  const text = stringify(children);
  const isSeg = isSegmentLocale(locale);
  const segments = isSeg ? segmentForWrap(text, locale) : [text];
  const nodes: Array<string | JSX.Element> = isSeg
    ? buildSegmentNodes(segments)
    : (text ? [text] : []);

  const cls = className ? `ui-text ${className}` : 'ui-text';
  return <Tag class={cls}>{nodes}</Tag>;
}
