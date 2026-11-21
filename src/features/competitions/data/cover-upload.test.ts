// 賽事封面上傳：資料夾鍵、路徑格式（與後端 functions-cp validate.ts#coverOf 同一條規則）、縮圖尺寸與格式、
// 2MB 上限、兩張同資料夾同 bucket、bucket 失敗改試下一個。
import { describe, expect, it, vi } from 'vitest';
import {
  COVER_MAX_BYTES,
  COVER_PATH_RE,
  CoverUploadError,
  coverExt,
  coverPath,
  dataUrlBytes,
  makeCoverThumb,
  newCoverFolder,
  uploadCompetitionCover,
  type CoverCanvasLike,
  type CoverPut,
  type CoverUploadDeps,
} from './cover-upload';

/** 後端 functions-cp/src/cp/validate.ts 的 COVER_PATH_RE（cp-cover-backend＠5812ea349）逐字抄來對照。 */
const BACKEND_COVER_PATH_RE = /^images\/competitions\/(c_[a-z0-9]{16})\/(cover|thumb)_[0-9]{13}\.(?:webp|jpg)$/;

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

function deps(extra: Partial<CoverUploadDeps> = {}, out: Drawn = { args: [], size: [0, 0], types: [] }): CoverUploadDeps {
  return {
    now: () => 1_700_000_000_123,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i * 7),
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

  it('讀不到圖丟 image', async () => {
    await expect(makeCoverThumb(WEBP, deps({ loadImage: async () => { throw new Error('x'); } }))).rejects.toMatchObject({ code: 'image' });
  });
});

describe('uploadCompetitionCover', () => {
  it('兩張傳到同一個資料夾、同一個 bucket、同一個毫秒，網址照後端要的格式回傳', async () => {
    const puts: string[] = [];
    const put: CoverPut = async (_data, path) => { puts.push(path); return storageUrl(path); };
    const result = await uploadCompetitionCover(WEBP, deps({ targets: async () => [put] }));
    expect(puts).toHaveLength(2);
    const [cover, thumb] = puts.map((p) => BACKEND_COVER_PATH_RE.exec(p));
    expect(cover?.[2]).toBe('cover');
    expect(thumb?.[2]).toBe('thumb');
    expect(cover?.[1]).toBe(thumb?.[1]);
    expect(puts[0]).toBe(`images/competitions/${cover?.[1]}/cover_1700000000123.webp`);
    expect(puts[1]).toBe(`images/competitions/${cover?.[1]}/thumb_1700000000123.webp`);
    expect(result).toEqual({ url: storageUrl(puts[0]!), thumb: storageUrl(puts[1]!), thumbSrc: WEBP });
  });

  it('JPEG 封面（舊 WebView）路徑副檔名是 .jpg', async () => {
    const puts: string[] = [];
    const out: Drawn = { args: [], size: [0, 0], types: [] };
    const put: CoverPut = async (_data, path) => { puts.push(path); return storageUrl(path); };
    await uploadCompetitionCover(JPEG, { ...deps({ targets: async () => [put] }), createCanvas: fakeCanvas(out, false) });
    expect(puts.map((p) => p.split('.').pop())).toEqual(['jpg', 'jpg']);
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
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('第一個 bucket 任一張失敗，整組改傳第二個 bucket（兩張仍同資料夾）', async () => {
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
    expect(second).toEqual(first);
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
