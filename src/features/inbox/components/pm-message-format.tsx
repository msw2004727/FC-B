import type { JSX } from 'preact';

import { Text } from '@/ui/Text';

/** 照 A `_pmFormatTime`／B InboxPage 已審 helper：原樣搬出。 */
export function formatPmTime(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
  }
  if (typeof value === 'object' && value !== null) {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof maybeToDate === 'function') {
      try {
        return maybeToDate().toISOString().slice(0, 16).replace('T', ' ');
      } catch {
        return '';
      }
    }
  }
  return '';
}

/** 照 A `_pmSplitUrlTrailingPunctuation`：原樣搬出。 */
export function splitUrlTrailingPunctuation(raw: string): { urlText: string; suffix: string } {
  let urlText = String(raw || '');
  let suffix = '';
  while (
    urlText &&
    /[.,!?;:\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a)\]\}]/.test(urlText.slice(-1))
  ) {
    suffix = urlText.slice(-1) + suffix;
    urlText = urlText.slice(0, -1);
  }
  return { urlText, suffix };
}

/** 照 A `_pmNormalizeExternalHttpsUrl`：原樣搬出。 */
export function normalizeExternalHttpsUrl(value: string): string {
  try {
    const raw = String(value || '').trim();
    if (!raw || !/^https:\/\//i.test(raw)) return '';
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** 照 A `_pmRenderMessageBodyHtml`：原樣搬出為 JSX 節點版本。 */
export function renderPmMessageBody(body: string): {
  nodes: (string | JSX.Element)[];
  hasExternalLink: boolean;
} {
  const text = String(body || '');
  const urlPattern = /https:\/\/[^\s<>"'`]+/gi;
  const nodes: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let hasExternalLink = false;
  let keySeq = 0;

  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0] || '';
    const offset = Number(match.index || 0);
    const { urlText, suffix } = splitUrlTrailingPunctuation(rawUrl);
    const href = normalizeExternalHttpsUrl(urlText);
    if (!href) continue;

    if (offset > lastIndex) {
      nodes.push(text.slice(lastIndex, offset));
    }
    nodes.push(
      <a
        key={`link-${++keySeq}`}
        class="pm-message-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
      >
        <Text>{urlText}</Text>
      </a>,
    );
    if (suffix) nodes.push(suffix);
    lastIndex = offset + rawUrl.length;
    hasExternalLink = true;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  if (nodes.length === 0) {
    nodes.push(text);
  }
  return { nodes, hasExternalLink };
}
