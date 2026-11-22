// 賽事封面圖畫面：封面欄（選圖→裁切→上傳→交出網址、錯誤）、建賽送出（沒選不帶 cover 鍵）、伺服器欄位錯誤落在封面欄、
// 報隊管理換封面／移除（直接存）、已結束只能移除、下架時主辦看不到、詳情頂部封面在記分板上面、清單只在有封面時出縮圖。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markHistoryRoot } from '@/core/back-guard';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { CpCallError } from '../data/cp-callables';
import type { CpHostCreateInput, CpHostUpdateInput } from '../data/cp-callables';
import type { UploadedCover } from '../data/cover-upload';
import type { InAppListCard } from '../data/list-cards';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { InAppCardList } from '../components/InAppCardList';
import { adminActor, hostActor, idleActions, listInEnv, screenEnv, wizardSeed } from '../testing/screen-fixtures';
import { InAppSection } from '../components/InAppSection';
import { COVER_CROP, CoverField } from '../ui/cover-field';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import NewCompetitionPage from './NewCompetitionPage';

// 裁圖元件換成一顆「確認裁切」：按下去回傳固定的裁好圖片（真的裁圖要 canvas，jsdom 沒有）。
const CROPPED = 'data:image/webp;base64,Q1JPUFBFRA==';
const cropOptions: unknown[] = [];
vi.mock('@/features/events/components/event-form/ImageCropper', () => ({
  ImageCropper: ({ options, onConfirm, onCancel }: { options: unknown; onConfirm: (d: string) => void; onCancel: () => void }) => {
    cropOptions.push(options);
    return (
      <div>
        <button type="button" onClick={() => onConfirm(CROPPED)}>確認裁切</button>
        <button type="button" onClick={onCancel}>取消裁切</button>
      </div>
    );
  },
}));

const URL1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fcover_1700000000000.webp?alt=media&token=t';
const THUMB1 = 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fthumb_1700000000000.webp?alt=media&token=t';
const URL2 = URL1.replace(/c_a{16}/, 'c_bbbbbbbbbbbbbbbb');
const THUMB2 = THUMB1.replace(/c_a{16}/, 'c_bbbbbbbbbbbbbbbb');
const CARD2 = THUMB2.replace('thumb_', 'card_');
const COVER = { url: URL1, thumb: THUMB1 };
const THUMB_SRC = 'data:image/webp;base64,VEhVTUI=';

const scrollIntoView = vi.fn();

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

beforeEach(() => {
  cropOptions.length = 0;
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function okUpload(url = URL2, thumb = THUMB2) {
  return vi.fn(async (_d: string): Promise<UploadedCover> => ({ url, thumb, card: CARD2, thumbSrc: THUMB_SRC }));
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('沒有選檔 input');
  return input;
}

/**
 * 選檔：直接發原生 change。載了 preact/compat 時 @testing-library/preact 的 fireEvent.change 會改發 input 事件
 * （compat 把一般欄位的 onChange 換成 oninput），但 type="file" 的 onChange 仍是 change。
 */
function choose(file = new File([new Uint8Array([1, 2, 3])], 'pitch.png', { type: 'image/png' })): void {
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}

async function pickAndCrop(): Promise<void> {
  choose();
  fireEvent.click(await screen.findByRole('button', { name: '確認裁切' }));
}

function coverError(): string {
  return document.getElementById('cpf-cover-error')?.textContent ?? '';
}

function wizard(opts: {
  step?: 1 | 2 | 3;
  create?: (input: CpHostCreateInput) => Promise<{ cid: string; dvIds: string[] }>;
  upload?: CpInjectedEnv['coverUpload'];
  cover?: typeof COVER | null;
} = {}) {
  const create = vi.fn(opts.create ?? (async () => ({ cid: 'cid_new', dvIds: ['dv_1'] })));
  const base = screenEnv('wizard-1', { ...idleActions(), create });
  draw({
    ...base,
    preview: { ...base.preview, wizardStep: opts.step ?? 1 },
    wizardSeed: { ...wizardSeed(), cover: opts.cover ?? null },
    coverUpload: opts.upload,
  }, NewCompetitionPage);
  return { create };
}

describe('封面欄：選圖、裁切、上傳', () => {
  it('裁切設定是 8:3、1200×450、WebP 0.72；裁好上傳，預覽本機圖與清單縮圖，出現更換／移除', async () => {
    const upload = okUpload();
    wizard({ upload });
    expect(screen.getByRole('button', { name: '封面圖 上傳封面' })).toBeTruthy();
    await pickAndCrop();
    expect(cropOptions[0]).toEqual(COVER_CROP);
    expect(COVER_CROP).toMatchObject({ aspectRatio: 8 / 3, outputWidth: 1200, outputHeight: 450, outputType: 'image/webp', quality: 0.72 });
    expect(upload).toHaveBeenCalledWith(CROPPED);
    await screen.findByRole('button', { name: '更換' });
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy();
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.cpc img')].map((img) => img.getAttribute('src'));
    expect(imgs).toEqual([CROPPED, THUMB_SRC]);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(screen.getByRole('button', { name: '封面圖 上傳封面' })).toBeTruthy();
  });

  it('上傳中：圖片上蓋「上傳中」，按下一步擋下並說明', async () => {
    const upload = vi.fn(() => new Promise<UploadedCover>(() => {}));
    wizard({ upload });
    await pickAndCrop();
    expect(screen.getByRole('status').textContent).toContain('上傳中');
    expect(screen.queryByRole('button', { name: '更換' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(coverError()).toBe('封面還在上傳，請稍候');
    expect(document.activeElement?.id).toBe('cpf-cover');
    expect(screen.getByText('基本資料')).toBeTruthy();
  });

  it('上傳失敗：錯誤畫在封面欄，回到上傳前（不留半個封面）', async () => {
    const upload = vi.fn(async () => { throw new Error('offline'); });
    const { create } = wizard({ upload });
    await pickAndCrop();
    await waitFor(() => expect(coverError()).toBe('封面上傳失敗，請再試一次'));
    expect(screen.getByRole('button', { name: '封面圖 上傳封面' })).toBeTruthy();
    expect(document.querySelector('.cpc img')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('檔案類型不對、超過 5MB：不開裁圖，錯誤畫在封面欄', async () => {
    wizard({ upload: okUpload() });
    choose(new File(['x'], 'a.gif', { type: 'image/gif' }));
    await waitFor(() => expect(coverError()).toBe('請選 JPG、PNG、WebP 或 HEIC 圖片'));
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    choose(big);
    await waitFor(() => expect(coverError()).toBe('圖片不能超過 5MB'));
    expect(screen.queryByRole('button', { name: '確認裁切' })).toBeNull();
  });
});

describe('建賽送出', () => {
  it('沒選封面：create 的輸入不帶 cover 鍵（前端比後端先上時一般建賽不受影響）', async () => {
    const { create } = wizard({ step: 3 });
    expect(document.querySelector('.d2-hero__cover')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(Object.keys(create.mock.calls[0]![0])).not.toContain('cover');
  });

  it('選了封面：確認頁最上面顯示封面，create 帶 { url, thumb }', async () => {
    const { create } = wizard({ step: 3, cover: COVER });
    expect(document.querySelector('.d2-hero__cover')?.getAttribute('src')).toBe(URL1);
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].cover).toEqual(COVER);
  });

  it('第 1 步選圖上傳後一路建立：cover 是上傳回來的兩個網址', async () => {
    const { create } = wizard({ upload: okUpload() });
    await pickAndCrop();
    await screen.findByRole('button', { name: '更換' });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(document.querySelector('.d2-hero__cover')?.getAttribute('src')).toBe(CROPPED);
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].cover).toEqual({ url: URL2, thumb: THUMB2, card: CARD2 });
  });

  it.each([
    ['COVER_URL_NOT_ALLOWED', 'cover.url', '封面圖不合規定，請重新上傳'],
    ['COVER_URL_NOT_ALLOWED', 'cover.thumb', '封面圖不合規定，請重新上傳'],
    ['COVER_URL_NOT_ALLOWED', 'cover', '封面圖不合規定，請重新上傳'],
    ['FIELD_FORMAT', 'cover.url', '封面圖不合規定，請重新上傳'],
    ['FIELD_TYPE', 'cover', '封面圖不合規定，請重新上傳'],
    // 舊 cpHost（尚未部署封面後端）：onlyKeys 回 UNKNOWN_FIELD、field cover
    ['UNKNOWN_FIELD', 'cover', '目前還不能使用封面圖'],
  ])('後端回 %s（field %s）：跳回第 1 步，錯誤畫在封面欄並聚焦', async (reason, field, text) => {
    wizard({ step: 3, cover: COVER, create: async () => { throw new CpCallError(reason, { field }); } });
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(coverError()).toBe(text));
    await waitFor(() => expect(document.activeElement?.id).toBe('cpf-cover'));
    expect(screen.getByText('基本資料')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // 封面仍在，主辦可以按「移除」後再建立
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy();
  });
});

function manageEnv(patch: { endedAt?: number; status?: 'cancelled'; hidden?: boolean; cover?: typeof COVER | null } = {}, admin = false) {
  const base = screenEnv('host-pending');
  const update = vi.fn(async (input: CpHostUpdateInput) => ({ cid: input.cid }));
  const bundle = base.bundle!;
  const env: CpInjectedEnv = {
    ...base,
    actor: admin ? adminActor : hostActor,
    actions: { ...idleActions(), update },
    bundle: { ...bundle, competition: { ...bundle.competition!, ...patch } },
  };
  return { env, update };
}

function openPanel(): void {
  fireEvent.click(screen.getByRole('button', { name: '編輯賽事資訊' }));
}

// 建賽「取消」（cp-create-cancel）：封面在 form 裡，選了封面就算填過；上傳中 form 還沒封面，也一樣先問。
describe('建賽取消與封面', () => {
  const START = '/competitions/new';
  const ASK = '已填的內容不會保存，確定放棄建立？';

  beforeEach(() => {
    history.replaceState(null, '', START);
    markHistoryRoot();
  });

  afterEach(() => {
    cleanup();
    _resetAppConfirmForTest();
    _resetOverlayBackForTest();
  });

  function drawBlank(upload: CpInjectedEnv['coverUpload']): void {
    const env = screenEnv('wizard-1', idleActions());
    render(
      <LocationProvider>
        <CpEnvProvider value={{ ...env, wizardSeed: undefined, coverUpload: upload }}>
          <NewCompetitionPage />
        </CpEnvProvider>
        <AppConfirmHost />
      </LocationProvider>,
    );
  }

  const cancelBtn = () => [...document.querySelectorAll<HTMLButtonElement>('.cph-split button')].find((node) => node.textContent === '取消')!;
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('只選了封面（其他沒填）：按取消跳「放棄建立？」；繼續填寫封面還在，放棄才離開', async () => {
    drawBlank(okUpload());
    await pickAndCrop();
    await screen.findByRole('button', { name: '更換' });
    fireEvent.click(cancelBtn());
    await flush();
    expect(screen.getByRole('alertdialog').textContent).toContain(ASK);
    fireEvent.click(document.getElementById('app-confirm-cancel')!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(location.pathname).toBe(START);
    expect(document.querySelector('.cpc-pic img')?.getAttribute('src')).toBe(CROPPED);
    fireEvent.click(cancelBtn());
    await flush();
    fireEvent.click(document.getElementById('app-confirm-ok')!);
    await waitFor(() => expect(location.pathname).toBe('/tournaments'));
  });

  it('封面上傳中按取消：同一套確認；放棄後離開，上傳晚到也不寫回、不報錯', async () => {
    let finish: (up: UploadedCover) => void = () => {};
    drawBlank(vi.fn(() => new Promise<UploadedCover>((resolve) => { finish = resolve; })));
    await pickAndCrop();
    expect(screen.getByRole('status').textContent).toContain('上傳中');
    fireEvent.click(cancelBtn());
    await flush();
    expect(screen.getByRole('alertdialog').textContent).toContain(ASK);
    fireEvent.click(document.getElementById('app-confirm-ok')!);
    await waitFor(() => expect(location.pathname).toBe('/tournaments'));
    await act(async () => { finish({ url: URL2, thumb: THUMB2, card: CARD2, thumbSrc: THUMB_SRC }); await Promise.resolve(); });
    expect(location.pathname).toBe('/tournaments');
    expect(document.getElementById('cpf-cover-error')).toBeNull();
  });
});

describe('報隊管理：換封面、移除（按下去直接存）', () => {
  it('沒封面：選圖上傳後 update 帶 { cid, cover }，跳提示；再移除送 cover: null', async () => {
    const { env, update } = manageEnv();
    const show = vi.spyOn(toast, 'show');
    draw({ ...env, coverUpload: okUpload() }, CompetitionManagePage);
    openPanel();
    await pickAndCrop();
    await waitFor(() => expect(update).toHaveBeenCalledWith({ cid: 'cup', cover: { url: URL2, thumb: THUMB2, card: CARD2 } }));
    await screen.findByRole('button', { name: '更換' });
    expect(show).toHaveBeenCalledWith({ message: '已更新封面' });
    expect(document.querySelector('.cpc-pic img')?.getAttribute('src')).toBe(CROPPED);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ cid: 'cup', cover: null }));
    await screen.findByRole('button', { name: '封面圖 上傳封面' });
    expect(show).toHaveBeenLastCalledWith({ message: '已移除封面' });
  });

  it('儲存失敗：錯誤畫在封面欄，畫面維持原本的封面', async () => {
    const { env } = manageEnv({ cover: COVER });
    const update = vi.fn(async () => { throw new CpCallError('COMPETITION_CLOSED', { field: 'cover' }); });
    draw({ ...env, actions: { ...idleActions(), update }, coverUpload: okUpload() }, CompetitionManagePage);
    openPanel();
    await pickAndCrop();
    await waitFor(() => expect(coverError()).toBe('賽事已結束或取消，只能移除封面'));
    expect(document.querySelector('.cpc-pic img')?.getAttribute('src')).toBe(URL1);
  });

  it('已結束有封面：只有「移除」，沒有「更換」與選檔', () => {
    const { env } = manageEnv({ endedAt: 1, cover: COVER });
    draw(env, CompetitionManagePage);
    openPanel();
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '更換' })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('已取消沒封面：不畫封面欄', () => {
    const { env } = manageEnv({ status: 'cancelled', cover: null });
    draw(env, CompetitionManagePage);
    openPanel();
    expect(document.querySelector('.cpc')).toBeNull();
    expect(screen.getByRole('radio', { name: '聯賽' })).toBeTruthy();
  });

  it('下架：主辦看不到封面欄；管理員照畫', () => {
    const host = manageEnv({ hidden: true, cover: COVER });
    const view = draw(host.env, CompetitionManagePage);
    openPanel();
    expect(document.querySelector('.cpc')).toBeNull();
    expect(document.body.innerHTML).not.toContain(URL1);
    view.unmount();
    cleanup();
    const admin = manageEnv({ hidden: true, cover: COVER }, true);
    draw(admin.env, CompetitionManagePage);
    openPanel();
    expect(document.querySelector('.cpc-pic img')?.getAttribute('src')).toBe(URL1);
  });

  it('上傳中：「編輯賽事資訊」與「完成」都不能按，面板收不起來；傳完照常存檔、按鈕恢復', async () => {
    const { env, update } = manageEnv();
    let finish: (up: UploadedCover) => void = () => {};
    const upload = vi.fn(() => new Promise<UploadedCover>((resolve) => { finish = resolve; }));
    draw({ ...env, coverUpload: upload }, CompetitionManagePage);
    openPanel();
    await pickAndCrop();
    expect(screen.getByRole('status').textContent).toContain('上傳中');
    const toggle = screen.getByRole('button', { name: '編輯賽事資訊' }) as HTMLButtonElement;
    const done = screen.getByRole('button', { name: '完成' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(done.disabled).toBe(true);
    fireEvent.click(toggle);
    fireEvent.click(done);
    expect(document.querySelector('.cpc')).not.toBeNull();
    await act(async () => { finish({ url: URL2, thumb: THUMB2, card: CARD2, thumbSrc: THUMB_SRC }); });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ cid: 'cup', cover: { url: URL2, thumb: THUMB2, card: CARD2 } }));
    await screen.findByRole('button', { name: '更換' });
    expect(toggle.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(document.querySelector('.cpc')).toBeNull();
  });
});

describe('上傳逾時與錯誤記錄', () => {
  function timeoutError(): Error {
    const err = new Error('cover upload timed out https://x/?token=SECRET') as Error & { code: string };
    err.name = 'CoverUploadError';
    err.code = 'timeout';
    return err;
  }

  it('逾時：封面欄說明逾時、回到可重選；console.warn 只印 code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, update } = manageEnv();
    draw({ ...env, coverUpload: vi.fn(async () => { throw timeoutError(); }) }, CompetitionManagePage);
    openPanel();
    await pickAndCrop();
    await waitFor(() => expect(coverError()).toBe('封面上傳逾時，請檢查網路後重新選圖'));
    expect(screen.getByRole('button', { name: '封面圖 上傳封面' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '編輯賽事資訊' }) as HTMLButtonElement).disabled).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[cover] upload failed', 'timeout');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('不是 CoverUploadError（例如載入失敗）：一般失敗句，記錄 unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wizard({ upload: vi.fn(async () => { throw Object.assign(new Error('chunk'), { code: 'timeout' }); }) });
    await pickAndCrop();
    await waitFor(() => expect(coverError()).toBe('封面上傳失敗，請再試一次'));
    expect(warn).toHaveBeenCalledWith('[cover] upload failed', 'unknown');
  });

  it('上傳中被卸載：還給呼叫端「不忙」', async () => {
    const onBusyChange = vi.fn();
    const view = render(
      <CoverField
        ct={makeCompetitionsT({})}
        value={null}
        upload={() => new Promise<UploadedCover>(() => {})}
        onBusyChange={onBusyChange}
        onChange={() => {}}
      />,
    );
    await pickAndCrop();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
});

function detailEnv(patch: { hidden?: boolean; cover?: typeof COVER | null }, admin = false): CpInjectedEnv {
  const base = screenEnv('real-live');
  const bundle = base.bundle!;
  return {
    ...base,
    actor: admin ? adminActor : hostActor,
    bundle: { ...bundle, competition: { ...bundle.competition!, ...patch } },
  };
}

describe('詳情頂部', () => {
  it('有封面：玻璃框內、記分板上面', () => {
    draw(detailEnv({ cover: COVER }), CompetitionDetailPage);
    const img = document.querySelector<HTMLImageElement>('.d2-hero > .d2-hero__cover');
    expect(img?.getAttribute('src')).toBe(URL1);
    expect(img?.nextElementSibling?.classList.contains('d2-board')).toBe(true);
  });

  it('沒封面：與現況相同（沒有圖）', () => {
    draw(detailEnv({ cover: null }), CompetitionDetailPage);
    expect(document.querySelector('.d2-hero__cover')).toBeNull();
    expect(document.querySelector('.d2-hero')?.firstElementChild?.classList.contains('d2-board')).toBe(true);
  });

  it('下架：主辦看不到封面，管理員看得到', () => {
    const view = draw(detailEnv({ hidden: true, cover: COVER }), CompetitionDetailPage);
    expect(document.querySelector('.d2-hero__cover')).toBeNull();
    expect(document.body.innerHTML).not.toContain(URL1);
    view.unmount();
    cleanup();
    draw(detailEnv({ hidden: true, cover: COVER }, true), CompetitionDetailPage);
    expect(document.querySelector('.d2-hero__cover')?.getAttribute('src')).toBe(URL1);
  });

  it('載入完成就看得到：沒有 hidden、inline 樣式或等 onload 才加的 class', () => {
    draw(detailEnv({ cover: COVER }), CompetitionDetailPage);
    const img = document.querySelector<HTMLImageElement>('.d2-hero__cover')!;
    const before = img.className;
    act(() => { img.dispatchEvent(new Event('load')); });
    const after = document.querySelector<HTMLImageElement>('.d2-hero__cover');
    expect(after).toBe(img);
    expect(after?.className).toBe(before);
    expect(after?.hidden).toBe(false);
    expect(after?.getAttribute('style')).toBeNull();
  });

  it('圖載不到：整塊封面收起，版面回到沒封面的樣子', () => {
    draw(detailEnv({ cover: COVER }), CompetitionDetailPage);
    const img = document.querySelector<HTMLImageElement>('.d2-hero__cover')!;
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(document.querySelector('.d2-hero__cover')).toBeNull();
    expect(document.querySelector('.d2-hero')?.firstElementChild?.classList.contains('d2-board')).toBe(true);
  });
});

describe('封面樣式不靠動畫', () => {
  it('.d2-hero__cover、清單縮圖與卡板封面的規則沒有 opacity／animation／transition（背景分頁動畫被節流也不會卡在透明）', () => {
    const css = readFileSync(resolve('src/features/competitions/competitions.css'), 'utf8');
    const rules = css.match(/[^{}]*(?:d2-hero__cover|cpl-sb__img|cpl-sb--img)[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/opacity|animation|transition/);
  });
});

describe('狀態邊框色（站長 11-22，顧問 §3.576）', () => {
  it('邊框色只掛在卡片根節點的 data-phase／data-mark，不掛在 .cpl-sb--img：沒有封面的卡也有狀態邊框；進行中框線 2px', () => {
    const css = readFileSync(resolve('src/features/competitions/competitions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const edgeRules = css.match(/[^{}]*\{[^}]*--st-edge:[^}]*\}/g) ?? [];
    const selectors = edgeRules.map((rule) => rule.slice(0, rule.indexOf('{')).trim());
    for (const sel of ['.cpl-card[data-phase="recruit"]', '.cpl-card[data-phase="warm"]', '.cpl-card[data-phase="live"]', '.cpl-card[data-mark="postponed"]', '.cpl-card[data-mark="cancelled"]']) {
      expect(selectors.some((s) => s.endsWith(sel))).toBe(true);
    }
    for (const sel of selectors) expect(sel).not.toContain('cpl-sb--img');
    expect(css).toMatch(/\.cpl-card__link \{[^}]*box-shadow: inset 0 0 0 var\(--st-w, 1\.5px\) var\(--st-edge\)/);
    expect(css).toMatch(/\.cpl-card\[data-phase="live"\] \{[^}]*--st-w: 2px/);
  });
});

describe('清單卡', () => {
  it('一般卡（站長 11-22 統一）：有封面才放清單用圖並加 cpl-sb--img，不再出 56×42 縮圖；沒封面的卡版面照舊', () => {
    const card = (cid: string, cover: string): InAppListCard => ({
      cid, name: cid, category: 'league', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
      line: null, mine: false, ended: false, statusMark: null, cover,
    });
    render(
      <InAppCardList
        cards={[card('with', URL1), card('none', '')]}
        ct={makeCompetitionsT({})}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    const with_ = document.querySelector('[data-cid="with"]');
    const none = document.querySelector('[data-cid="none"]');
    const img = with_?.querySelector<HTMLImageElement>('.d2-sb > img.cpl-sb__img');
    expect(img?.getAttribute('src')).toBe(URL1);
    expect(img?.getAttribute('width')).toBe('800');
    expect(img?.getAttribute('height')).toBe('300');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(img?.hasAttribute('srcset')).toBe(false);
    expect(with_?.querySelector('img.cpl-xrow__img')).toBeNull();
    // 每張都是記分板卡（站長 11-22）：圖是板的第一個子節點，字在後面
    expect(with_?.querySelector('.d2-sb')?.className).toBe('d2-sb cpl-sb--img');
    expect(with_?.querySelector('.d2-sb')?.firstElementChild).toBe(img);
    expect(with_?.querySelector('.d2-sb > .cpl-card__name')).not.toBeNull();
    expect(none?.querySelector('img')).toBeNull();
    expect(none?.querySelector('.d2-sb')?.className).toBe('d2-sb');
    // 沒封面：純深色記分板卡（板底下直接是名稱）
    expect(none?.querySelector('.d2-sb > .cpl-card__name')).not.toBeNull();
  });

  it('卡板：有封面才在板裡放清單用圖並加 cpl-sb--img（第一張有圖的卡：eager＋fetchpriority=high）；沒封面的卡板結構照舊；圖載不到收回沒封面的卡板', () => {
    const board = (cid: string, cover: string): InAppListCard => ({
      cid, name: cid, category: 'cup', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
      line: { kind: 'deadline', date: '11/21 23:59' }, mine: false, ended: false, statusMark: null, cover,
    });
    const list = (card: InAppListCard) => (
      <InAppCardList
        cards={[card]}
        ct={makeCompetitionsT({})}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />
    );
    const { unmount } = render(list(board('with', URL1)));
    const sb = document.querySelector('[data-cid="with"] .d2-sb');
    const img = sb?.querySelector<HTMLImageElement>('img.cpl-sb__img');
    expect(sb?.classList.contains('cpl-sb--img')).toBe(true);
    // 卡板用清單用圖（卡資料的 cover）；圖是板的第一個子節點，字在後面
    expect(img?.getAttribute('src')).toBe(URL1);
    expect(img?.getAttribute('loading')).toBe('eager');
    expect(img?.getAttribute('fetchpriority')).toBe('high');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(img?.getAttribute('alt')).toBe('');
    expect(sb?.firstElementChild).toBe(img);
    act(() => { img!.dispatchEvent(new Event('error')); });
    expect(document.querySelector('[data-cid="with"] img')).toBeNull();
    expect(document.querySelector('[data-cid="with"] .d2-sb')?.className).toBe('d2-sb');
    unmount();

    render(list(board('none', '')));
    const plain = document.querySelector('[data-cid="none"] .d2-sb');
    expect(plain?.className).toBe('d2-sb');
    expect(plain?.querySelector('img')).toBeNull();
    expect(plain?.firstElementChild?.className).toBe('cpl-sb__top');
  });

  it('下架賽事：管理員看清單也一律不畫封面（卡板與一般卡都沒有圖）；沒下架的照常有圖', async () => {
    await loadCompetitionsDict('zh-TW');
    const env = { ...listInEnv(), actor: adminActor };
    const orig = env.repo.listPublic.bind(env.repo);
    // 正式查詢已帶 hidden == false；這裡故意讓下架文件混進來（例如經主辦俱樂部那條查詢），確認畫面這層也不畫
    env.repo.listPublic = async (includeInternal?: boolean) => (await orig(includeInternal)).map((doc) => (
      doc.id === 'live_cup' ? { ...doc, hidden: true, hiddenReason: '示範下架', cover: { url: URL1, thumb: THUMB1 } }
        : doc.id === 'warm_lg' ? { ...doc, cover: { url: URL2, thumb: THUMB2 } } : doc));
    render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="all" active />
        </CpEnvProvider>
      </LocationProvider>,
    );
    // 等當日摘要回來、卡板挑出後才斷言（獨立審查 P3：只等卡片出現時卡板還沒選出，測不到卡板這條路）
    await waitFor(() => expect(document.querySelector('[data-cid="live_cup"].cpl-card--board')).not.toBeNull());
    const hidden = document.querySelector('[data-cid="live_cup"]');
    expect(hidden?.querySelector('img')).toBeNull();
    expect(hidden?.querySelector('.cpl-sb--img')).toBeNull();
    expect(document.querySelector(`img[src="${URL1}"], img[src="${THUMB1}"]`)).toBeNull();
    // 對照：沒下架的那張有圖（縮圖或卡板原圖）
    expect(document.querySelector('[data-cid="warm_lg"] img')).not.toBeNull();
  });

  describe('載入策略（顧問設計稿「卡片縮圖與載入策略」第 6 節）', () => {
    const many = (n: number, noCoverAt: number[] = []): InAppListCard[] => Array.from({ length: n }, (_, i) => ({
      cid: `c${i}`, name: `c${i}`, category: 'league', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
      line: null, mine: false, ended: false, statusMark: null, cover: noCoverAt.includes(i) ? '' : `${URL1}&n=${i}`,
    }));
    const drawList = (cards: InAppListCard[]) => render(
      <InAppCardList cards={cards} ct={makeCompetitionsT({})} status="open" onlyMine={false} showCreate={false}
        onStatus={() => {}} onOnlyMine={() => {}} onCreate={() => {}} onOpen={() => {}} />,
    );
    const imgOf = (cid: string) => document.querySelector<HTMLImageElement>(`[data-cid="${cid}"] img.cpl-sb__img`);
    afterEach(() => { Reflect.deleteProperty(navigator, 'connection'); });

    it('前 3 張「有圖的」卡 eager（沒圖的卡不算名額），第 1 張 fetchpriority=high；其餘 lazy＋async', () => {
      drawList(many(6, [1]));
      expect(imgOf('c1')).toBeNull();
      expect(['c0', 'c2', 'c3', 'c4', 'c5'].map((cid) => imgOf(cid)?.getAttribute('loading'))).toEqual(['eager', 'eager', 'eager', 'lazy', 'lazy']);
      expect(imgOf('c0')?.getAttribute('fetchpriority')).toBe('high');
      for (const cid of ['c2', 'c3', 'c4', 'c5']) expect(imgOf(cid)?.hasAttribute('fetchpriority')).toBe(false);
      for (const cid of ['c0', 'c2', 'c3', 'c4', 'c5']) expect(imgOf(cid)?.getAttribute('decoding')).toBe('async');
    });

    it.each([
      ['saveData', { saveData: true }],
      ['2g', { effectiveType: '2g' }],
      ['slow-2g', { effectiveType: 'slow-2g' }],
    ])('省流量（%s）：只畫前 3 張有圖的卡，第 4 張起用沒有圖的版面', (_label, connection) => {
      Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
      drawList(many(5));
      expect(['c0', 'c1', 'c2'].every((cid) => imgOf(cid) !== null)).toBe(true);
      for (const cid of ['c3', 'c4']) {
        expect(imgOf(cid)).toBeNull();
        expect(document.querySelector(`[data-cid="${cid}"] a`)?.className).toBe('cpl-card__link');
      }
    });

    it('4g、沒有 saveData：照常全部畫（捲到才載）', () => {
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g', saveData: false }, configurable: true });
      drawList(many(5));
      expect(imgOf('c4')?.getAttribute('loading')).toBe('lazy');
    });
  });

  it('任何狀態都是同一種深色記分板卡（站長 11-22）：有封面就有 cpl-sb--img，不退回淺色卡或小縮圖', () => {
    const base = { name: 'x', category: 'cup' as const, date: '12/06', venue: '場地', firstMatchAt: 1, mine: false, ended: false, statusMark: null, cover: URL1 };
    const states: InAppListCard[] = [
      { ...base, cid: 'recruit', phase: 'recruit', line: { kind: 'deadline', date: '12/01 23:59' } },
      { ...base, cid: 'warm', phase: 'warm', line: { kind: 'warm', days: 3 } },
      { ...base, cid: 'live', phase: 'live', line: { kind: 'live', count: 2, time: '14:30' } },
      { ...base, cid: 'live_wait', phase: 'live', line: null },
      { ...base, cid: 'done', phase: 'done', line: null, ended: true },
      { ...base, cid: 'postponed', phase: 'warm', line: { kind: 'warm', days: 3 }, statusMark: 'postponed' },
      { ...base, cid: 'cancelled', phase: 'done', line: null, statusMark: 'cancelled' },
      { ...base, cid: 'noline', phase: null, line: null },
    ];
    render(
      <InAppCardList cards={states} ct={makeCompetitionsT({})} status="all" onlyMine={false} showCreate={false}
        onStatus={() => {}} onOnlyMine={() => {}} onCreate={() => {}} onOpen={() => {}} />,
    );
    for (const c of states) {
      const el = document.querySelector(`[data-cid="${c.cid}"]`);
      expect(el?.classList.contains('cpl-card--board')).toBe(true);
      expect(el?.querySelector('.d2-sb')?.classList.contains('cpl-sb--img')).toBe(true);
      expect(el?.querySelector('.d2-sb > img.cpl-sb__img')?.getAttribute('src')).toBe(URL1);
    }
    expect(document.querySelector('.cpl-xrow__img, .cpl-card__link--img')).toBeNull();
  });

  it('招募中（沒延期取消）才有光軌掛點；動態載入後掛上光軌，卸載不殘留 style 與光軌；各狀態有自己的 data-phase／data-mark（邊框色）', async () => {
    const base = { name: 'x', category: 'cup' as const, date: '', venue: '', firstMatchAt: 1, mine: false, ended: false, cover: '' };
    const cards: InAppListCard[] = [
      { ...base, cid: 'r', phase: 'recruit', statusMark: null, line: { kind: 'deadline', date: '12/01 23:59' } },
      { ...base, cid: 'w', phase: 'warm', statusMark: null, line: { kind: 'warm', days: 3 } },
      { ...base, cid: 'p', phase: 'recruit', statusMark: 'postponed', line: null },
      { ...base, cid: 'c', phase: 'done', statusMark: 'cancelled', line: null },
    ];
    const view = render(
      <InAppCardList cards={cards} ct={makeCompetitionsT({})} status="all" onlyMine={false} showCreate={false}
        onStatus={() => {}} onOnlyMine={() => {}} onCreate={() => {}} onOpen={() => {}} />,
    );
    expect([...document.querySelectorAll('.cpl-fx-slot')].map((el) => el.closest('[data-cid]')?.getAttribute('data-cid'))).toEqual(['r']);
    expect(document.querySelector('[data-cid="p"]')?.getAttribute('data-mark')).toBe('postponed');
    expect(document.querySelector('[data-cid="c"]')?.getAttribute('data-mark')).toBe('cancelled');
    expect(document.querySelector('[data-cid="w"]')?.hasAttribute('data-mark')).toBe(false);
    await waitFor(() => expect(document.querySelector('.cpl-fx-slot .burst')).not.toBeNull());
    view.unmount();
    expect(document.querySelector('style[data-cpl-fx-instance]')).toBeNull();
    expect(document.getElementById('cpl-recruit-fx-style')).toBeNull();
  });

  it('一般卡封面載不到：改畫沒封面的版面，不留空格', () => {
    const card: InAppListCard = {
      cid: 'bad', name: 'bad', category: 'league', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
      line: null, mine: false, ended: false, statusMark: null, cover: URL1,
    };
    render(
      <InAppCardList
        cards={[card]}
        ct={makeCompetitionsT({})}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    const img = document.querySelector<HTMLImageElement>('[data-cid="bad"] img')!;
    act(() => { img.dispatchEvent(new Event('error')); });
    const el = document.querySelector('[data-cid="bad"]');
    expect(el?.querySelector('img')).toBeNull();
    expect(el?.querySelector('.d2-sb')?.className).toBe('d2-sb');
    expect(el?.querySelector('.d2-sb > .cpl-card__name')).not.toBeNull();
  });
});
