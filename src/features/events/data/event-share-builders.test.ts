import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEventFlexMessage,
  buildEventLiffUrl,
  buildEventShareAltText,
  buildEventShareOgUrl,
  buildExternalEventFlexMessage,
  buildExternalEventShareAltText,
  buildFlexInfoRow,
  buildShareUrl,
  getEventShareImageUrl,
  getEventShareVersion,
  getEventSportShareImageUrl,
  sanitizeEventShareImageUrl,
} from './event-share-builders';

beforeEach(() => {
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('M-091：照 A 分享 builder', () => {
  it('Mini App 與 OG 網址的字串、編碼、版本完全固定', () => {
    expect(buildEventLiffUrl(' a/b ')).toBe(
      'https://miniapp.line.me/2009525300-AuPGQ0sh?event=a%2Fb',
    );
    expect(buildShareUrl('team', ' a b ')).toBe(
      'https://miniapp.line.me/2009525300-AuPGQ0sh?team=a%20b',
    );
    expect(getEventShareVersion()).toBe('20260707');
    expect(buildEventShareOgUrl(' a/b ')).toBe(
      'https://toosterx.com/event-share/a%2Fb?v=20260707',
    );
  });

  it('替代文字保留全形括號、換行、空地點及熱度', () => {
    expect(buildEventShareAltText(
      { title: '週末場', date: '2026/10/25 10:00~12:00' },
      'URL',
      'warm',
    )).toBe('＜週末場＞\n日期：2026/10/25 10:00~12:00\n地點：\n熱度：報名熱烈增加中\nURL');
    const raw = '＜' + '😀'.repeat(410) + '＞\n日期：\n地點：\nURL';
    expect(buildEventShareAltText({ title: '😀'.repeat(410) }, 'URL'))
      .toBe(Array.from(raw).slice(0, 397).join('') + '...');
  });

  it('圖片依 A 優先序，拒絕非 http(s)', () => {
    expect(sanitizeEventShareImageUrl(1)).toBe('');
    expect(sanitizeEventShareImageUrl(' javascript:alert(1) ')).toBe('');
    expect(sanitizeEventShareImageUrl(' https://img.test/a.jpg ')).toBe('https://img.test/a.jpg');
    expect(getEventSportShareImageUrl(' BASKETBALL ')).toBe(
      'https://toosterx.com/assets/og/sports/basketball.jpg?v=20260707',
    );
    expect(getEventSportShareImageUrl('other')).toBe('');
    expect(getEventShareImageUrl({
      shareImageUrl: 'https://img.test/share.jpg',
      sportTag: 'football',
      image: 'https://img.test/cover.jpg',
    })).toBe('https://img.test/share.jpg');
    expect(getEventShareImageUrl({ sportTag: 'football' })).toBe(
      'https://toosterx.com/assets/og/sports/football.jpg?v=20260707',
    );
    expect(getEventShareImageUrl({ imageVariants: { cover: 'https://img.test/cover.jpg' } }))
      .toBe('https://img.test/cover.jpg');
  });

  it('最小 Flex 的完整物件照 A', () => {
    expect(buildEventFlexMessage({}, 'URL')).toEqual({
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [{
              type: 'text', text: '⚽ PLAY', size: 'xs', color: '#ffffff',
              weight: 'bold', align: 'center', gravity: 'center',
            }],
            backgroundColor: '#7c3aed',
            cornerRadius: '12px',
            paddingAll: '4px',
            paddingStart: '10px',
            paddingEnd: '10px',
            width: '90px',
          },
          {
            type: 'text', text: '活動', weight: 'bold', size: 'lg',
            wrap: true, maxLines: 2, margin: 'md',
          },
        ],
        paddingAll: '16px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#7c3aed',
          action: { type: 'uri', label: '立即報名', uri: 'URL' },
          height: 'sm',
        }],
        paddingAll: '12px',
      },
    });
  });

  it('資訊列與分隊只計 confirmed 且有效的 teamKey', () => {
    expect(buildFlexInfoRow('日期', '今天')).toEqual({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '日期', size: 'sm', color: '#888888', flex: 2 },
        { type: 'text', text: '今天', size: 'sm', color: '#333333', flex: 5, wrap: true },
      ],
    });
    const bubble = buildEventFlexMessage({
      date: '今天',
      location: '球場',
      feeEnabled: true,
      fee: 100,
      teamSplit: {
        enabled: true,
        teams: [{ key: 'a', name: '紅隊' }, { key: 'b', name: '藍隊' }],
      },
    }, 'URL', {
      heat: 'hot',
      registrations: [
        { status: 'confirmed', teamKey: 'a' },
        { status: 'waitlisted', teamKey: 'a' },
        { status: 'confirmed', teamKey: 'unknown' },
      ],
    });
    expect(bubble.body?.contents[2]).toEqual({
      type: 'box',
      layout: 'vertical',
      contents: [
        buildFlexInfoRow('日期', '今天'),
        buildFlexInfoRow('地點', '球場'),
        buildFlexInfoRow('熱度', '高人氣即將額滿'),
        buildFlexInfoRow('費用', '$100'),
        buildFlexInfoRow('分隊', '紅隊 1 vs 藍隊 0'),
      ],
      margin: 'lg',
      spacing: 'sm',
    });
    expect(JSON.stringify(buildEventFlexMessage({
      teamSplit: { enabled: true, teams: [] },
    }, 'URL'))).toContain('"text":"分隊"');
  });

  it('外部活動保留 A 未編碼 ID 的既有語意與 URL 覆寫', () => {
    expect(buildExternalEventShareAltText({ id: 'a/b', title: '外部' }))
      .toBe('＜外部＞\n日期：\n連結：https://miniapp.line.me/2009525300-AuPGQ0sh?event=a/b');
    expect(buildExternalEventShareAltText({ location: '球場' }, 'OG'))
      .toBe('＜＞\n日期：\n地點：球場\n連結：OG');
    const bubble = buildExternalEventFlexMessage({
      externalUrl: 'https://external.test',
      image: 'https://img.test/a.jpg',
    });
    expect(JSON.stringify(bubble.footer)).toContain('"label":"查看活動"');
    expect(JSON.stringify(bubble.footer)).toContain('"uri":"https://external.test"');
    expect(JSON.stringify(bubble.body)).toContain('"width":"110px"');
    expect(bubble.hero).toEqual({
      type: 'image', url: 'https://img.test/a.jpg',
      size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
    });
    expect(JSON.stringify(buildExternalEventFlexMessage({}).footer))
      .toContain('https://example.com');
  });
});
