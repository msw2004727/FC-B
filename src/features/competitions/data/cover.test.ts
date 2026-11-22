// 賽事封面讀取端：根文件 cover 欄的解析、下架時畫不畫、清單只在有封面時帶縮圖。
import { describe, expect, it } from 'vitest';
import { coverInput, coverOf, listImage, shownCover } from './cover';
import { competitionFromDoc } from './cp-repo';
import { assembleInAppCards } from './list-cards';
import { competition, NOW } from '../testing/screen-fixtures';

const URL1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fcover_1700000000000.webp?alt=media&token=t';
const THUMB1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fthumb_1700000000000.webp?alt=media&token=t';
const COVER = { url: URL1, thumb: THUMB1 };
const CARD1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fcard_1700000000000.webp?alt=media&token=t';

describe('card（800×300 清單卡圖，選填）', () => {
  it('coverOf 收合格的 card；不合格的 card 只當沒有，url、thumb 照收', () => {
    expect(coverOf({ ...COVER, card: CARD1 })).toEqual({ ...COVER, card: CARD1 });
    for (const bad of ['https://evil.example/card.webp', 'http://firebasestorage.googleapis.com/v0/b/b1/o/x', 1, null, '']) {
      expect(coverOf({ ...COVER, card: bad })).toEqual(COVER);
    }
    // card 合格也救不了缺 thumb 的封面
    expect(coverOf({ url: URL1, card: CARD1 })).toBeNull();
  });

  it('listImage：有 card 用 card，舊賽事沒有 card 退原圖 url；沒有封面是空字串', () => {
    expect(listImage({ ...COVER, card: CARD1 })).toBe(CARD1);
    expect(listImage(COVER)).toBe(URL1);
    expect(listImage(null)).toBe('');
    expect(listImage(undefined)).toBe('');
  });

  it('coverInput：有 card 送三鍵，沒有 card 只送 url、thumb（不送 card: null／undefined 鍵）', () => {
    expect(coverInput({ ...COVER, card: CARD1 })).toEqual({ url: URL1, thumb: THUMB1, card: CARD1 });
    expect(Object.keys(coverInput(COVER))).toEqual(['url', 'thumb']);
    // 本機預覽欄位（src、thumbSrc）不送
    expect(coverInput({ ...COVER, card: CARD1, src: 'data:x', thumbSrc: 'data:y' } as never)).toEqual({ url: URL1, thumb: THUMB1, card: CARD1 });
  });

});

describe('coverOf：根文件 cover 欄', () => {
  it('兩個網址都是 Firebase Storage 下載網址才收', () => {
    expect(coverOf(COVER)).toEqual(COVER);
    expect(coverOf({ ...COVER, extra: 1 })).toEqual(COVER);
  });

  it.each([
    ['沒有', undefined],
    ['null', null],
    ['陣列', [URL1, THUMB1]],
    ['少 thumb', { url: URL1 }],
    ['thumb 不是字串', { url: URL1, thumb: 1 }],
    ['外站網址', { url: 'https://evil.example/x.webp', thumb: THUMB1 }],
    ['外站但路徑像 Storage', { url: 'https://evil.example/v0/b/x/o/y?alt=media', thumb: THUMB1 }],
    ['http', { url: URL1.replace('https:', 'http:'), thumb: THUMB1 }],
    ['帶帳密', { url: URL1.replace('https://', 'https://a:b@'), thumb: THUMB1 }],
    ['帶埠號', { url: URL1.replace('.com/', '.com:8443/'), thumb: THUMB1 }],
    ['不是 /v0/b/', { url: 'https://firebasestorage.googleapis.com/x', thumb: THUMB1 }],
    ['javascript:', { url: 'javascript:alert(1)', thumb: THUMB1 }],
    ['超長', { url: `${URL1}${'a'.repeat(1200)}`, thumb: THUMB1 }],
  ])('%s → 當沒有封面', (_label, raw) => {
    expect(coverOf(raw)).toBeNull();
  });

  it('competitionFromDoc 帶出 cover；舊文件沒有這欄是 null', () => {
    const raw = {
      name: '示範盃', sport: 'football', hostType: 'personal', status: 'published', visibility: 'public',
      timezone: 'Asia/Taipei', regOpenAt: 1, regCloseAt: 2, firstMatchAt: 3, lastMatchAt: 4,
    };
    expect(competitionFromDoc('c1', { ...raw, cover: COVER })?.cover).toEqual(COVER);
    expect(competitionFromDoc('c1', raw)?.cover).toBeNull();
    expect(competitionFromDoc('c1', { ...raw, cover: { url: 'https://evil.example/a', thumb: THUMB1 } })?.cover).toBeNull();
  });
});

describe('shownCover：下架時主辦看不到、管理員照畫', () => {
  it('沒下架：誰都畫', () => {
    expect(shownCover({ hidden: false, cover: COVER }, false)).toEqual(COVER);
    expect(shownCover({ hidden: false, cover: COVER }, true)).toEqual(COVER);
  });

  it('下架：非管理員（主辦、共同主辦、俱樂部代表）不畫；管理員畫', () => {
    expect(shownCover({ hidden: true, cover: COVER }, false)).toBeNull();
    expect(shownCover({ hidden: true, cover: COVER }, true)).toEqual(COVER);
  });

  it('沒封面一律 null', () => {
    expect(shownCover({ hidden: false, cover: null }, true)).toBeNull();
    expect(shownCover({ hidden: false }, false)).toBeNull();
  });
});

describe('清單卡縮圖', () => {
  it('清單用圖：有 card 用 card、舊賽事退原圖 url；沒封面、下架是空字串', () => {
    const cards = assembleInAppCards({
      publicDocs: [
        competition({ id: 'with', name: '有封面', cover: COVER }),
        competition({ id: 'card', name: '有卡片圖', cover: { ...COVER, card: CARD1 } }),
        competition({ id: 'none', name: '沒封面' }),
      ],
      hosted: [competition({ id: 'hidden', name: '下架中', hidden: true, cover: { ...COVER, card: CARD1 } })],
      mine: [{ cid: 'named', name: '只有名稱', category: 'league', doc: null }],
      now: NOW,
    });
    const img = (cid: string) => cards.find((card) => card.cid === cid)?.cover;
    expect(img('with')).toBe(URL1);
    expect(img('card')).toBe(CARD1);
    expect(img('none')).toBe('');
    expect(img('hidden')).toBe('');
    expect(img('named')).toBe('');
  });
});
