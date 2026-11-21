// 賽事封面圖畫面：封面欄（選圖→裁切→上傳→交出網址、錯誤）、建賽送出（沒選不帶 cover 鍵）、伺服器欄位錯誤落在封面欄、
// 報隊管理換封面／移除（直接存）、已結束只能移除、下架時主辦看不到、詳情頂部封面在記分板上面、清單只在有封面時出縮圖。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/ui/Toast';
import { CpCallError } from '../data/cp-callables';
import type { CpHostCreateInput, CpHostUpdateInput } from '../data/cp-callables';
import type { UploadedCover } from '../data/cover-upload';
import type { InAppListCard } from '../data/list-cards';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { InAppCardList } from '../components/InAppCardList';
import { adminActor, hostActor, idleActions, screenEnv, wizardSeed } from '../testing/screen-fixtures';
import { COVER_CROP } from '../ui/cover-field';
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
  return vi.fn(async (_d: string): Promise<UploadedCover> => ({ url, thumb, thumbSrc: THUMB_SRC }));
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
    expect(create.mock.calls[0]![0].cover).toEqual({ url: URL2, thumb: THUMB2 });
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

describe('報隊管理：換封面、移除（按下去直接存）', () => {
  it('沒封面：選圖上傳後 update 帶 { cid, cover }，跳提示；再移除送 cover: null', async () => {
    const { env, update } = manageEnv();
    const show = vi.spyOn(toast, 'show');
    draw({ ...env, coverUpload: okUpload() }, CompetitionManagePage);
    openPanel();
    await pickAndCrop();
    await waitFor(() => expect(update).toHaveBeenCalledWith({ cid: 'cup', cover: { url: URL2, thumb: THUMB2 } }));
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
});

describe('清單卡', () => {
  it('只有帶縮圖的卡出現 56×42 縮圖；沒封面的卡版面照舊', () => {
    const card = (cid: string, thumb: string): InAppListCard => ({
      cid, name: cid, category: 'league', phase: 'recruit', date: '', venue: '', firstMatchAt: 1,
      line: null, mine: false, ended: false, statusMark: null, thumb,
    });
    render(
      <InAppCardList
        cards={[card('with', THUMB1), card('none', '')]}
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
    expect(with_?.querySelector('img.cpl-xrow__img')?.getAttribute('src')).toBe(THUMB1);
    expect(with_?.querySelector('a')?.className).toBe('cpl-card__link cpl-card__link--img');
    expect(none?.querySelector('img')).toBeNull();
    expect(none?.querySelector('a')?.className).toBe('cpl-card__link');
    // 沒封面的卡結構與改版前相同：連結底下直接是名稱與分類列
    expect(none?.querySelector('a > .cpl-card__name')).not.toBeNull();
  });
});
