// 賽事封面上傳：資料夾鍵、路徑格式（與後端 functions-cp validate.ts#coverOf 同一條規則）、縮圖尺寸與格式、
// 2MB 上限、三張（封面、縮圖、800×300 卡片圖）同資料夾同 bucket、bucket 失敗改試下一個。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COVER_MAX_BYTES,
  COVER_PATH_RE,
  COVER_UPLOAD_TIMEOUT_MS,
  CoverUploadError,
  coverExt,
  coverPath,
  dataUrlBytes,
  makeCoverCard,
  makeCoverThumb,
  newCoverFolder,
  uploadCompetitionCover,
  type CoverCanvasLike,
  type CoverPut,
  type CoverUploadDeps,
} from './cover-upload';

/** 後端 functions-cp/src/cp/validate.ts 的 COVER_PATH_RE（cp-cover-backend＠0253ed24b，cphost-00004-fol）逐字抄來對照。 */
const BACKEND_COVER_PATH_RE = /^images\/competitions\/(c_[a-z0-9]{16})\/(cover|thumb|card)_[0-9]{13}\.(?:webp|jpg)$/;

const WEBP = 'data:image/webp;base64,UklGRg==';
const JPEG = 'data:image/jpeg;base64,/9j/4A==';
const PNG = 'data:image/png;base64,iVBORw==';

interface Drawn { args: number[]; size: [number, number]; types: string[] }

function fakeCanvas(out: Drawn, supportsWebp = true): () => CoverCanvasLike {
  return () => {
    const canvas: CoverCanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (_img: never, ...args: number[]) => {
          out.args = args;
          out.size = [canvas.width, canvas.height];
        },
      }),
      toDataURL: (type: string, quality?: number) => {
        out.types.push(`${type}@${quality}`);
        if (type === 'image/webp') return supportsWebp ? WEBP : PNG;
        return JPEG;
      },
    };
    return canvas;
  };
}

/** 亂數每次呼叫都不同（計數器）：若程式多產生一個資料夾，兩張的資料夾就會對不上。 */
function countingBytes() {
  let call = 0;
  return vi.fn((n: number) => {
    call += 1;
    return Uint8Array.from({ length: n }, (_, i) => i * 7 + call);
  });
}

function deps(extra: Partial<CoverUploadDeps> = {}, out: Drawn = { args: [], size: [0, 0], types: [] }): CoverUploadDeps {
  return {
    now: () => 1_700_000_000_123,
    randomBytes: countingBytes(),
    loadImage: async () => ({ width: 1200, height: 450 }),
    createCanvas: fakeCanvas(out),
    ...extra,
  };
}

function storageUrl(path: string, bucket = 'b1'): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=abc-123`;
}

describe('資料夾鍵與路徑', () => {
  it('資料夾鍵是 c_ ＋ 16 碼 a-z0-9，不含 cid、uid', () => {
    expect(newCoverFolder((n) => new Uint8Array(n))).toBe('c_aaaaaaaaaaaaaaaa');
    expect(newCoverFolder((n) => Uint8Array.from({ length: n }, () => 255))).toBe(`c_${'d'.repeat(16)}`);
    for (let i = 0; i < 50; i++) expect(newCoverFolder()).toMatch(/^c_[a-z0-9]{16}$/);
  });

  it('路徑符合後端 COVER_PATH_RE：cover_／thumb_ ＋ 13 碼毫秒、webp 或 jpg', () => {
    const folder = newCoverFolder();
    for (const kind of ['cover', 'thumb'] as const) {
      for (const ext of ['webp', 'jpg'] as const) {
        const p = coverPath(folder, kind, 1_700_000_000_123, ext);
        expect(p).toMatch(BACKEND_COVER_PATH_RE);
        expect(p).toMatch(COVER_PATH_RE);
      }
    }
    expect(String(COVER_PATH_RE)).toBe(String(BACKEND_COVER_PATH_RE).replace('(?:webp|jpg)', '(webp|jpg)'));
  });

  it('格式只收 WebP、JPEG；大小以 base64 解碼後計算', () => {
    expect(coverExt(WEBP)).toBe('webp');
    expect(coverExt(JPEG)).toBe('jpg');
    expect(coverExt('data:image/jpg;base64,AA==')).toBe('jpg');
    expect(coverExt(PNG)).toBeNull();
    expect(dataUrlBytes('data:image/webp;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/webp;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/webp;base64,AA==')).toBe(1);
  });
});

describe('清單縮圖', () => {
  it('取封面正中央 4:3 縮成 224×168，WebP 0.72', async () => {
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    await expect(makeCoverThumb(WEBP, deps({}, out))).resolves.toBe(WEBP);
    expect(out.size).toEqual([224, 168]);
    // 1200×450 的正中央 4:3＝x 300 起、寬 600、高 450
    expect(out.args).toEqual([300, 0, 600, 450, 0, 0, 224, 168]);
    expect(out.types).toEqual(['image/webp@0.72']);
  });

  it('直圖切上下，仍是 4:3', async () => {
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    await makeCoverThumb(WEBP, deps({ loadImage: async () => ({ width: 400, height: 900 }) }, out));
    expect(out.args).toEqual([0, 300, 400, 300, 0, 0, 224, 168]);
  });

  it('不支援 WebP 的舊 WebView 退 JPEG 0.8', async () => {
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    const result = await makeCoverThumb(JPEG, { ...deps({}, out), createCanvas: fakeCanvas(out, false) });
    expect(result).toBe(JPEG);
    expect(out.types).toEqual(['image/webp@0.72', 'image/jpeg@0.8']);
  });

  it('卡片圖：整張等比縮成 800×300、不裁切，WebP 0.72；不支援 WebP 退 JPEG 0.8', async () => {
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    await expect(makeCoverCard(WEBP, deps({}, out))).resolves.toBe(WEBP);
    expect(out.size).toEqual([800, 300]);
    expect(out.args).toEqual([0, 0, 1200, 450, 0, 0, 800, 300]);
    expect(out.types).toEqual(['image/webp@0.72']);
    const old: Drawn = { args: [], size: [0, 0], types: [] };
    await expect(makeCoverCard(JPEG, { ...deps({}, old), createCanvas: fakeCanvas(old, false) })).resolves.toBe(JPEG);
    expect(old.types).toEqual(['image/webp@0.72', 'image/jpeg@0.8']);
  });

  it('讀不到圖丟 image', async () => {
    await expect(makeCoverCard(WEBP, deps({ loadImage: async () => { throw new Error('x'); } }))).rejects.toMatchObject({ code: 'image' });
    await expect(makeCoverThumb(WEBP, deps({ loadImage: async () => { throw new Error('x'); } }))).rejects.toMatchObject({ code: 'image' });
  });
});

describe('uploadCompetitionCover', () => {
  it('三張傳到同一個資料夾、同一個 bucket、同一個毫秒，網址照後端要的格式回傳', async () => {
    const puts: string[] = [];
    const put: CoverPut = async (_data, path) => { puts.push(path); return storageUrl(path); };
    const randomBytes = countingBytes();
    const result = await uploadCompetitionCover(WEBP, deps({ targets: async () => [put], randomBytes }));
    expect(puts).toHaveLength(3);
    // 資料夾只產生一次（newCoverFolder 每次呼叫 randomBytes(16) 一次），三張共用
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(randomBytes).toHaveBeenCalledWith(16);
    const [cover, thumb, card] = puts.map((p) => BACKEND_COVER_PATH_RE.exec(p));
    expect(cover?.[2]).toBe('cover');
    expect(thumb?.[2]).toBe('thumb');
    expect(card?.[2]).toBe('card');
    expect(cover?.[1]).toBe(thumb?.[1]);
    expect(card?.[1]).toBe(cover?.[1]);
    expect(puts[0]).toBe(`images/competitions/${cover?.[1]}/cover_1700000000123.webp`);
    expect(puts[1]).toBe(`images/competitions/${cover?.[1]}/thumb_1700000000123.webp`);
    expect(puts[2]).toBe(`images/competitions/${cover?.[1]}/card_1700000000123.webp`);
    expect(result).toEqual({ url: storageUrl(puts[0]!), thumb: storageUrl(puts[1]!), card: storageUrl(puts[2]!), thumbSrc: WEBP });
  });

  it('JPEG 封面（舊 WebView）路徑副檔名是 .jpg', async () => {
    const puts: string[] = [];
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    const put: CoverPut = async (_data, path) => { puts.push(path); return storageUrl(path); };
    await uploadCompetitionCover(JPEG, { ...deps({ targets: async () => [put] }), createCanvas: fakeCanvas(out, false) });
    expect(puts.map((p) => p.split('.').pop())).toEqual(['jpg', 'jpg', 'jpg']);
    for (const p of puts) expect(p).toMatch(BACKEND_COVER_PATH_RE);
  });

  it('封面不是 WebP／JPEG 丟 format；≥ 2MB 丟 too-large（Storage 規則 < 2MB）；都不上傳', async () => {
    const put = vi.fn<CoverPut>(async () => 'x');
    await expect(uploadCompetitionCover(PNG, deps({ targets: async () => [put] }))).rejects.toMatchObject({ code: 'format' });
    const big = `data:image/webp;base64,${'A'.repeat(Math.ceil((COVER_MAX_BYTES * 4) / 3))}`;
    expect(dataUrlBytes(big)).toBeGreaterThanOrEqual(COVER_MAX_BYTES);
    await expect(uploadCompetitionCover(big, deps({ targets: async () => [put] }))).rejects.toMatchObject({ code: 'too-large' });
    const justUnder = `data:image/webp;base64,${'A'.repeat(Math.floor(((COVER_MAX_BYTES - 1) * 4) / 3))}`;
    expect(dataUrlBytes(justUnder)).toBeLessThan(COVER_MAX_BYTES);
    await expect(uploadCompetitionCover(justUnder, deps({ targets: async () => [put] }))).resolves.toMatchObject({ url: 'x' });
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('第一個 bucket 卡片圖失敗，整組改傳第二個 bucket（三張仍同資料夾）', async () => {
    const first: string[] = [];
    const second: string[] = [];
    const a: CoverPut = async (_d, path) => {
      first.push(path);
      if (path.includes('/card_')) throw new Error('quota');
      return storageUrl(path, 'a');
    };
    const b: CoverPut = async (_d, path) => { second.push(path); return storageUrl(path, 'b'); };
    const result = await uploadCompetitionCover(WEBP, deps({ targets: async () => [a, b] }));
    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    expect([result.url, result.thumb, result.card].every((u) => u.includes('/v0/b/b/'))).toBe(true);
  });

  it('第一個 bucket 縮圖失敗，整組改傳第二個 bucket', async () => {
    const first: string[] = [];
    const second: string[] = [];
    const a: CoverPut = async (_d, path) => {
      first.push(path);
      if (path.includes('/thumb_')) throw new Error('quota');
      return storageUrl(path, 'a');
    };
    const b: CoverPut = async (_d, path) => { second.push(path); return storageUrl(path, 'b'); };
    const result = await uploadCompetitionCover(WEBP, deps({ targets: async () => [a, b] }));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(3);
    expect(second.slice(0, 2)).toEqual(first);
    expect(result.url).toContain('/v0/b/b/');
    expect(result.thumb).toContain('/v0/b/b/');
  });

  it('全部 bucket 失敗丟 upload', async () => {
    const fail: CoverPut = async () => { throw new Error('offline'); };
    const err = await uploadCompetitionCover(WEBP, deps({ targets: async () => [fail, fail] })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoverUploadError);
    expect((err as CoverUploadError).code).toBe('upload');
  });
});

describe('上傳逾時（不改全站共用的 SDK maxUploadRetryTime，自己計時）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('預設 60 秒；卡住的上傳到時丟 timeout，之後不再試下一個 bucket', async () => {
    vi.useFakeTimers();
    expect(COVER_UPLOAD_TIMEOUT_MS).toBe(60_000);
    const hang = vi.fn<CoverPut>(() => new Promise<string>(() => {}));
    const next = vi.fn<CoverPut>(async (_d, path) => storageUrl(path));
    const result = uploadCompetitionCover(WEBP, deps({ targets: async () => [hang, next] })).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(hang).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(err).toBeInstanceOf(CoverUploadError);
    expect((err as CoverUploadError).code).toBe('timeout');
    expect(next).not.toHaveBeenCalled();
  });

  it('封面那張逾時後才傳完：不再傳縮圖', async () => {
    vi.useFakeTimers();
    let finish: (url: string) => void = () => {};
    const paths: string[] = [];
    const slow: CoverPut = (_d, path) => {
      paths.push(path);
      return new Promise<string>((resolve) => { finish = resolve; });
    };
    const result = uploadCompetitionCover(WEBP, deps({ targets: async () => [slow], timeoutMs: 1000 })).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'timeout' });
    finish('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/cover_');
  });

  it('縮圖那張逾時後才傳完：不再傳卡片圖', async () => {
    vi.useFakeTimers();
    let finish: (url: string) => void = () => {};
    const paths: string[] = [];
    const slow: CoverPut = (_d, path) => {
      paths.push(path);
      if (path.includes('/cover_')) return Promise.resolve(storageUrl(path));
      return new Promise<string>((resolve) => { finish = resolve; });
    };
    const result = uploadCompetitionCover(WEBP, deps({ targets: async () => [slow], timeoutMs: 1000 })).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'timeout' });
    finish('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain('/thumb_');
  });

  it('時間內完成：正常回傳，計時器清掉', async () => {
    vi.useFakeTimers();
    const put: CoverPut = async (_d, path) => storageUrl(path);
    await expect(uploadCompetitionCover(WEBP, deps({ targets: async () => [put] }))).resolves.toMatchObject({ thumbSrc: WEBP });
    expect(vi.getTimerCount()).toBe(0);
  });
});
