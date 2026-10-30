import { describe, expect, it } from 'vitest';
import { parseTaipei } from '@/core/taipei-time';
import en from '../locales/en.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import th from '../locales/th.json';
import vi from '../locales/vi.json';
import zhCn from '../locales/zh-CN.json';
import zhTw from '../locales/zh-TW.json';
import {
  bannerCardActions,
  bannerImageSrc,
  bannerLabel,
  buildBannerSave,
  fromDatetimeLocal,
  hasUnsafeLinkChars,
  isGeneralBannerDoc,
  isSavableLinkUrl,
  planBannerTransitions,
  remainDays,
  toBannerSlot,
  toDatetimeLocal,
  type BannerFormError,
  type BannerFormInput,
  type BannerSlot,
} from './banner-model';

const NOW = parseTaipei('2026/10/27 12:00') as number;

function slot(overrides: Partial<BannerSlot> = {}): BannerSlot {
  return {
    id: 'ban1',
    docId: 'ban1',
    slot: '1',
    slotName: '廣告位 1',
    title: '標題',
    subtitle: '',
    titleColor: '#ffffff',
    subtitleColor: '#e5edf8',
    image: 'https://example.com/a.webp',
    linkUrl: '',
    status: 'active',
    publishAt: '2026/10/01 09:00',
    unpublishAt: '',
    clicks: 0,
    ...overrides,
  };
}

function form(overrides: Partial<BannerFormInput> = {}): BannerFormInput {
  return {
    slotName: '廣告位 1',
    title: '標題',
    subtitle: '小標',
    titleColor: '#112233',
    subtitleColor: '#445566',
    linkUrl: 'https://example.com/x',
    mode: 'now',
    publishLocal: '',
    unpublishLocal: '',
    image: 'https://example.com/a.webp',
    ...overrides,
  };
}

describe('isGeneralBannerDoc（A getBanners 的排除條件）', () => {
  it('一般橫幅（ban1，type 缺值）算', () => {
    expect(isGeneralBannerDoc('ban1', { id: 'ban1', slot: 1, status: 'active' })).toBe(true);
  });

  it.each(['shotgame', 'watchParty', 'homeInfo', 'homeLayout'])('type=%s 排除', (type) => {
    expect(isGeneralBannerDoc('x1', { type })).toBe(false);
  });

  it.each(['home-info', 'home-layout'])('slot／id／文件 id 為 %s 排除', (key) => {
    expect(isGeneralBannerDoc('x1', { slot: key })).toBe(false);
    expect(isGeneralBannerDoc('x1', { id: key })).toBe(false);
    expect(isGeneralBannerDoc(key, {})).toBe(false);
  });
});

describe('toBannerSlot', () => {
  it('對應欄位並清理資料', () => {
    const mapped = toBannerSlot('ban2', {
      id: 'ban2',
      slot: 2,
      slotName: '廣告位 2',
      title: 'T',
      subtitle: 'S',
      titleColor: 'red',
      subtitleColor: '#AABBCC',
      image: 'javascript:alert(1)',
      linkUrl: '  https://example.com  ',
      status: 'scheduled',
      publishAt: '2026/10/28 10:00',
      unpublishAt: null,
      clicks: 3.8,
    });
    expect(mapped).toMatchObject({
      id: 'ban2',
      docId: 'ban2',
      slot: '2',
      titleColor: '#ffffff',
      subtitleColor: '#AABBCC',
      // F12：image 保留原值（不安全的值只是不顯示，不會被洗成空字串再寫成 null）。
      image: 'javascript:alert(1)',
      linkUrl: 'https://example.com',
      status: 'scheduled',
      publishAt: '2026/10/28 10:00',
      unpublishAt: '',
      clicks: 3,
    });
  });

  it('F12：非 http(s) 的既有圖片值保留原樣，儲存時原值寫回（不是 null）', () => {
    const mapped = toBannerSlot('ban1', { image: 'images/banners/ban1.png' });
    expect(mapped.image).toBe('images/banners/ban1.png');
    const saved = buildBannerSave(
      {
        slotName: 'A',
        title: '',
        subtitle: '',
        titleColor: '#ffffff',
        subtitleColor: '#e5edf8',
        linkUrl: '',
        mode: 'now',
        publishLocal: '',
        unpublishLocal: '',
        image: mapped.image,
      },
      NOW,
    );
    expect(saved).toMatchObject({ ok: true, write: { image: 'images/banners/ban1.png' } });
  });

  it('id 缺值用文件 id；未知狀態一律當作已下架（A 的 else 分支）', () => {
    const mapped = toBannerSlot('ban3', { status: 'weird', clicks: -2 });
    expect(mapped.id).toBe('ban3');
    expect(mapped.status).toBe('expired');
    expect(mapped.clicks).toBe(0);
  });
});

describe('bannerImageSrc（預覽只顯示安全來源）', () => {
  it('http(s) 與裁切後的 data:image 預覽可以；其他一律不顯示', () => {
    expect(bannerImageSrc('https://example.com/a.webp')).toBe('https://example.com/a.webp');
    expect(bannerImageSrc('http://example.com/a.png')).toBe('http://example.com/a.png');
    expect(bannerImageSrc('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    for (const bad of ['', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'images/a.png', '//example.com/a.png']) {
      expect(bannerImageSrc(bad)).toBe('');
    }
  });
});

describe('台北牆鐘 ↔ datetime-local', () => {
  it('往返不改字串', () => {
    expect(toDatetimeLocal('2026/10/27 09:05')).toBe('2026-10-27T09:05');
    expect(fromDatetimeLocal('2026-10-27T09:05')).toBe('2026/10/27 09:05');
    expect(fromDatetimeLocal(toDatetimeLocal('2026/12/31 23:59') ?? '')).toBe('2026/12/31 23:59');
  });

  it('空字串與無法解析', () => {
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal('not a time')).toBe('');
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('2026-13-45T99:99')).toBeNull();
  });
});

describe('remainDays（A _remainDays）', () => {
  it('進位、最少 0、無法解析為 0', () => {
    expect(remainDays('2026/10/28 12:00', NOW)).toBe(1);
    expect(remainDays('2026/10/28 12:01', NOW)).toBe(2);
    expect(remainDays('2026/10/27 12:00', NOW)).toBe(0);
    expect(remainDays('2026/10/01 00:00', NOW)).toBe(0);
    expect(remainDays('not a time', NOW)).toBe(0);
  });
});

describe('bannerCardActions（A _adActionBtns，type=banner）', () => {
  it('空位只有「設定」（edit）', () => {
    expect(bannerCardActions(slot({ status: 'empty' }), NOW)).toEqual(['edit']);
  });

  it('啟用中：編輯、下架、刪除', () => {
    expect(bannerCardActions(slot({ status: 'active' }), NOW)).toEqual(['edit', 'delist', 'clear']);
  });

  it('已排程：編輯、刪除（不能下架）', () => {
    expect(bannerCardActions(slot({ status: 'scheduled' }), NOW)).toEqual(['edit', 'clear']);
  });

  it('已下架：結束時間還沒到或永久才有重新上架', () => {
    expect(bannerCardActions(slot({ status: 'expired', unpublishAt: '' }), NOW)).toEqual([
      'edit',
      'relist',
      'clear',
    ]);
    expect(
      bannerCardActions(slot({ status: 'expired', unpublishAt: '2026/11/01 00:00' }), NOW),
    ).toEqual(['edit', 'relist', 'clear']);
    expect(
      bannerCardActions(slot({ status: 'expired', unpublishAt: '2026/10/27 12:00' }), NOW),
    ).toEqual(['edit', 'clear']);
    expect(
      bannerCardActions(slot({ status: 'expired', unpublishAt: '2026/10/01 00:00' }), NOW),
    ).toEqual(['edit', 'clear']);
  });
});

describe('buildBannerSave（A saveBanner 的驗證與組裝）', () => {
  it('立即啟用：status active、publishAt＝現在（台北牆鐘）', () => {
    const result = buildBannerSave(form(), NOW);
    expect(result).toEqual({
      ok: true,
      write: {
        title: '標題',
        subtitle: '小標',
        titleColor: '#112233',
        subtitleColor: '#445566',
        slotName: '廣告位 1',
        linkUrl: 'https://example.com/x',
        image: 'https://example.com/a.webp',
        publishAt: '2026/10/27 12:00',
        unpublishAt: null,
        status: 'active',
      },
    });
  });

  it('預約啟用：status scheduled、publishAt 取表單值；結束時間可選', () => {
    const result = buildBannerSave(
      form({ mode: 'scheduled', publishLocal: '2026-10-30T08:30', unpublishLocal: '2026-11-02T18:00' }),
      NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      write: { status: 'scheduled', publishAt: '2026/10/30 08:30', unpublishAt: '2026/11/02 18:00' },
    });
  });

  it('沒有圖片寫 null；字色不合法退回預設；欄位頭尾空白去掉', () => {
    const result = buildBannerSave(
      form({ image: '', titleColor: 'blue', subtitleColor: '', slotName: '  A  ', title: ' T ' }),
      NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      write: { image: null, titleColor: '#ffffff', subtitleColor: '#e5edf8', slotName: 'A', title: 'T' },
    });
  });

  it('A 的錯誤順序與邊界：18／32／12 字剛好可以，多 1 字不行', () => {
    expect(buildBannerSave(form({ title: 'a'.repeat(18) }), NOW).ok).toBe(true);
    expect(buildBannerSave(form({ title: 'a'.repeat(19) }), NOW)).toEqual({ ok: false, error: 'titleTooLong' });
    expect(buildBannerSave(form({ subtitle: 'b'.repeat(32) }), NOW).ok).toBe(true);
    expect(buildBannerSave(form({ subtitle: 'b'.repeat(33) }), NOW)).toEqual({ ok: false, error: 'subtitleTooLong' });
    expect(buildBannerSave(form({ slotName: 'c'.repeat(12) }), NOW).ok).toBe(true);
    expect(buildBannerSave(form({ slotName: 'c'.repeat(13) }), NOW)).toEqual({ ok: false, error: 'slotNameTooLong' });
    expect(buildBannerSave(form({ slotName: '   ' }), NOW)).toEqual({ ok: false, error: 'slotNameRequired' });
    // 同時有多個錯誤時，先回報大標題（A 的檢查順序）。
    expect(buildBannerSave(form({ title: 'a'.repeat(19), slotName: '' }), NOW)).toEqual({
      ok: false,
      error: 'titleTooLong',
    });
  });

  it('預約啟用沒填啟用時間 → publishRequired；時間格式壞掉 → timeInvalid', () => {
    expect(buildBannerSave(form({ mode: 'scheduled', publishLocal: '' }), NOW)).toEqual({
      ok: false,
      error: 'publishRequired',
    });
    expect(buildBannerSave(form({ mode: 'scheduled', publishLocal: 'zzz' }), NOW)).toEqual({
      ok: false,
      error: 'timeInvalid',
    });
    expect(buildBannerSave(form({ unpublishLocal: 'zzz' }), NOW)).toEqual({ ok: false, error: 'timeInvalid' });
  });

  it("F2：連結含空白、單雙引號、角括號、反引號、反斜線一律拒絕（A 首頁用 onclick=\"window.open('…')\"，引號能跳出字串）", () => {
    const bad = [
      "https://example.com/a'b",
      "https://example.com/');alert(1);//",
      'https://example.com/a"b',
      'https://example.com/a b',
      'https://example.com/<script>',
      'https://example.com/a`b',
      'https://example.com/a\\b',
      'https://example.com/\\',
    ];
    for (const linkUrl of bad) {
      expect(buildBannerSave(form({ linkUrl }), NOW)).toEqual({ ok: false, error: 'linkChars' });
    }
    // 控制字元（例如 Tab）由 safeBannerLinkUrl 先擋，回 linkInvalid。
    expect(buildBannerSave(form({ linkUrl: 'https://example.com/a\tb' }), NOW)).toEqual({
      ok: false,
      error: 'linkInvalid',
    });
    // scheme 不對時仍回 linkInvalid（先看 scheme）。
    expect(buildBannerSave(form({ linkUrl: "javascript:alert('x')" }), NOW)).toEqual({
      ok: false,
      error: 'linkInvalid',
    });
    // 正常網址（含 query、百分號編碼的引號）可以。
    for (const linkUrl of ['https://example.com/a?b=1&c=2#x', 'https://example.com/it%27s', 'https://例子.tw/a']) {
      expect(buildBannerSave(form({ linkUrl }), NOW).ok).toBe(true);
    }
  });

  it('hasUnsafeLinkChars／isSavableLinkUrl（表單與寫入層共用）', () => {
    expect(hasUnsafeLinkChars("a'b")).toBe(true);
    expect(hasUnsafeLinkChars('https://example.com/ok')).toBe(false);
    expect(isSavableLinkUrl('')).toBe(true);
    expect(isSavableLinkUrl('https://example.com/ok')).toBe(true);
    expect(isSavableLinkUrl("https://example.com/a'b")).toBe(false);
    expect(isSavableLinkUrl('ftp://example.com')).toBe(false);
  });

  it('F5：結束時間必須晚於現在（立即啟用也一樣）', () => {
    // NOW ＝ 2026/10/27 12:00（台北）
    expect(buildBannerSave(form({ unpublishLocal: '2026-10-27T12:00' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterNow',
    });
    expect(buildBannerSave(form({ unpublishLocal: '2026-10-27T11:59' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterNow',
    });
    expect(buildBannerSave(form({ unpublishLocal: '2020-01-01T00:00' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterNow',
    });
    const ok = buildBannerSave(form({ unpublishLocal: '2026-10-27T12:01' }), NOW);
    expect(ok).toMatchObject({ ok: true, write: { unpublishAt: '2026/10/27 12:01' } });
  });

  it('F5：預約啟用時，結束時間也必須晚於啟用時間（等於也不行）', () => {
    const scheduled = { mode: 'scheduled' as const, publishLocal: '2026-11-05T10:00' };
    expect(buildBannerSave(form({ ...scheduled, unpublishLocal: '2026-11-05T10:00' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterStart',
    });
    expect(buildBannerSave(form({ ...scheduled, unpublishLocal: '2026-11-04T10:00' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterStart',
    });
    expect(buildBannerSave(form({ ...scheduled, unpublishLocal: '2026-11-05T10:01' }), NOW)).toMatchObject({
      ok: true,
      write: { status: 'scheduled', publishAt: '2026/11/05 10:00', unpublishAt: '2026/11/05 10:01' },
    });
    // 結束時間已經過了，不論開始時間都先擋「晚於現在」。
    expect(buildBannerSave(form({ ...scheduled, unpublishLocal: '2026-10-01T00:00' }), NOW)).toEqual({
      ok: false,
      error: 'endNotAfterNow',
    });
  });

  it('F5：沒填結束時間（永久）不受影響', () => {
    expect(buildBannerSave(form({ unpublishLocal: '' }), NOW)).toMatchObject({ ok: true, write: { unpublishAt: null } });
  });

  it('連結：空字串可以；只收 http(s)（B 比 A 嚴，首頁只開得了 http/https）', () => {
    expect(buildBannerSave(form({ linkUrl: '' }), NOW).ok).toBe(true);
    expect(buildBannerSave(form({ linkUrl: 'http://example.com' }), NOW).ok).toBe(true);
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', '//example.com', 'example.com', '/events/1']) {
      expect(buildBannerSave(form({ linkUrl: bad }), NOW)).toEqual({ ok: false, error: 'linkInvalid' });
    }
  });
});

describe('bannerLabel（日誌對象的名稱）', () => {
  it('有名稱用名稱（去頭尾空白），沒有就「廣告位 {slot}」', () => {
    expect(bannerLabel({ slot: '1', slotName: ' 春季聯賽 ' })).toBe('春季聯賽');
    expect(bannerLabel({ slot: '2', slotName: '' })).toBe('廣告位 2');
    expect(bannerLabel({ slot: '3', slotName: '   ' })).toBe('廣告位 3');
  });

  it('轉換計畫帶 label（沒名稱的位用「廣告位 {slot}」）', () => {
    const plan = planBannerTransitions(
      [slot({ slot: '2', slotName: '', status: 'active', unpublishAt: '2026/10/27 11:00' })],
      NOW,
    );
    expect(plan[0]).toMatchObject({ label: '廣告位 2' });
  });
});

describe('planBannerTransitions（D1 (b) 惰性轉換）', () => {
  it('預約時間到了：scheduled → active', () => {
    const plan = planBannerTransitions(
      [slot({ status: 'scheduled', publishAt: '2026/10/27 11:59', unpublishAt: '2026/11/05 00:00' })],
      NOW,
    );
    expect(plan).toEqual([
      {
        docId: 'ban1',
        id: 'ban1',
        label: '廣告位 1',
        from: 'scheduled',
        to: 'active',
        reason: 'publish_due',
        publishAt: '2026/10/27 11:59',
        unpublishAt: '2026/11/05 00:00',
      },
    ]);
  });

  it('恰好等於現在算到期／算開始（<=）', () => {
    const start = planBannerTransitions([slot({ status: 'scheduled', publishAt: '2026/10/27 12:00' })], NOW);
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({ to: 'active' });
    const end = planBannerTransitions([slot({ status: 'active', unpublishAt: '2026/10/27 12:00' })], NOW);
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ from: 'active', to: 'expired', reason: 'unpublish_due' });
  });

  it('差一分鐘還沒到：不動', () => {
    expect(planBannerTransitions([slot({ status: 'scheduled', publishAt: '2026/10/27 12:01' })], NOW)).toEqual([]);
    expect(planBannerTransitions([slot({ status: 'active', unpublishAt: '2026/10/27 12:01' })], NOW)).toEqual([]);
  });

  it('跨日：昨天排程、今天開始', () => {
    const plan = planBannerTransitions(
      [slot({ status: 'scheduled', publishAt: '2026/10/26 23:59', unpublishAt: '2026/10/28 00:00' })],
      NOW,
    );
    expect(plan[0]).toMatchObject({ to: 'active' });
  });

  it('排程且開始、結束都過了：直接 expired（優先）', () => {
    const plan = planBannerTransitions(
      [slot({ status: 'scheduled', publishAt: '2026/10/20 00:00', unpublishAt: '2026/10/21 00:00' })],
      NOW,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ from: 'scheduled', to: 'expired', reason: 'unpublish_due' });
  });

  it('active 沒有結束時間、empty、expired、時間字串壞掉：都不動（冪等）', () => {
    const slots = [
      slot({ docId: 'a', status: 'active', unpublishAt: '' }),
      slot({ docId: 'b', status: 'empty', unpublishAt: '2020/01/01 00:00' }),
      slot({ docId: 'c', status: 'expired', unpublishAt: '2020/01/01 00:00' }),
      slot({ docId: 'd', status: 'active', unpublishAt: 'garbage' }),
      slot({ docId: 'e', status: 'scheduled', publishAt: 'garbage' }),
      slot({ docId: 'f', status: 'scheduled', publishAt: '' }),
    ];
    expect(planBannerTransitions(slots, NOW)).toEqual([]);
  });

  it('套用後再規劃一次不會再有轉換（冪等）', () => {
    const before = [
      slot({ docId: 'a', status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }),
      slot({ docId: 'b', status: 'active', unpublishAt: '2026/10/27 11:00' }),
    ];
    const plan = planBannerTransitions(before, NOW);
    const after = before.map((s) => {
      const t = plan.find((p) => p.docId === s.docId);
      return t ? { ...s, status: t.to } : s;
    });
    expect(planBannerTransitions(after, NOW)).toEqual([]);
  });
});

describe('表單錯誤碼與字典', () => {
  it('每個 BannerFormError 在 7 個語系都有文案（BannerForm 以 error.{code} 動態查字串）', () => {
    const codes: BannerFormError[] = [
      'titleTooLong',
      'subtitleTooLong',
      'slotNameRequired',
      'slotNameTooLong',
      'linkInvalid',
      'linkChars',
      'publishRequired',
      'timeInvalid',
      'endNotAfterNow',
      'endNotAfterStart',
    ];
    const dicts: Array<[string, Record<string, unknown>]> = [
      ['zh-TW', zhTw],
      ['zh-CN', zhCn],
      ['en', en],
      ['ja', ja],
      ['ko', ko],
      ['vi', vi],
      ['th', th],
    ];
    for (const [locale, dict] of dicts) {
      const errors = dict.error as Record<string, unknown>;
      for (const code of codes) {
        expect(typeof errors[code], `${locale}.error.${code}`).toBe('string');
        expect((errors[code] as string).trim().length, `${locale}.error.${code}`).toBeGreaterThan(0);
      }
    }
  });
});
