import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { ExternalEventEditError } from '../data/external-event-edit';
import type { EventDoc } from '../data/types';
import { ExternalEventEditModal } from './ExternalEventEditModal';

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn(), enabled: false, crop: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('../data/external-event-edit', async (original) => ({
  ...await original<typeof import('../data/external-event-edit')>(), saveExternalEventEdit: mocks.save,
}));
vi.mock('../data/activity-map-config', async (original) => ({
  ...await original<typeof import('../data/activity-map-config')>(),
  isActivityMapLocationPickerEnabled: () => mocks.enabled,
  loadActivityMapLocationPickerEnabled: async () => mocks.enabled,
  subscribeActivityMapFeature: () => () => undefined,
}));
vi.mock('./event-form/ImageCropper', () => ({ ImageCropper: (props: {
  options: unknown; onConfirm(value: string): void; onCancel(): void;
}) => {
  mocks.crop(props.options);
  return <div><button onClick={() => props.onConfirm('data:image/webp;base64,AA==')}>確認裁圖</button>
    <button onClick={props.onCancel}>取消裁圖</button></div>;
} }));
const event: EventDoc & { sportTag: string } = {
  id: 'public', _docId: 'document', type: 'external', creatorUid: 'owner',
  title: '外部足球', date: '2026/1/5 09:00~11:00', location: '球場', sportTag: 'football',
  externalUrl: 'https://example.test/activity', image: 'https://example.test/cover',
};
const viewer = {
  ...createMinimalViewer('owner'), capabilities: ['user.activity.own_edit_basic'],
};
function mount(target = event) {
  const onClose = vi.fn(); const onSaved = vi.fn();
  return { ...render(<ExternalEventEditModal event={target} viewer={viewer} onClose={onClose} onSaved={onSaved} />), onClose, onSaved };
}
function input(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function change(id: string, value: string): void { fireEvent.input(input(id), { target: { value } }); }
function pickFile(file: File): void {
  Object.defineProperty(input('cee-image'), 'files', { value: [file], configurable: true });
  fireEvent(input('cee-image'), new Event('change', { bubbles: true }));
}
function save(): void { fireEvent.click(screen.getByRole('button', { name: '儲存修改' })); }

beforeEach(() => { vi.clearAllMocks(); mocks.enabled = false; mocks.save.mockResolvedValue({ title: '外部足球' }); });
afterEach(() => { cleanup(); _resetOverlayBackForTest(); });

describe('ExternalEventEditModal', () => {
  it('A DOM、標題、欄位、回填、提示與無範本；遮罩不關窗', () => {
    const { onClose } = mount();
    expect(screen.getByRole('dialog').id).toBe('create-external-event-modal');
    expect(screen.getByText('編輯活動連結')).toBeTruthy();
    expect(input('cee-title').value).toBe('外部足球');
    expect(input('cee-title').maxLength).toBe(16);
    expect(input('cee-date').value).toBe('2026-01-05');
    expect(input('cee-start-time').value).toBe('09:00');
    expect(input('cee-end-time').value).toBe('11:00');
    expect(input('cee-location').value).toBe('球場');
    expect(input('cee-external-url').value).toBe(event.externalUrl);
    expect(input('cee-sport-tag').value).toBe('football');
    expect(document.querySelector('#cee-upload-preview img')?.getAttribute('src')).toBe(event.image);
    expect(document.querySelector('[id^="cee-template"]')).toBeNull();
    expect(screen.queryByText('GPS功能開關')).toBeNull();
    expect(screen.getByText('地圖定位未開啟')).toBeTruthy();
    fireEvent.click(document.getElementById('modal-overlay')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('驗證只顯示 A 訊息、不寫入；修正後過去日期可儲存', async () => {
    const { onClose, onSaved } = mount();
    change('cee-title', ''); save();
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '請輸入活動名稱', tone: 'error' });
    change('cee-title', '外部足球'); change('cee-external-url', 'http://example.test'); save();
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '活動連結必須以 https:// 開頭', tone: 'error' });
    expect(mocks.save).not.toHaveBeenCalled();
    change('cee-external-url', 'https://example.test'); save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '活動連結「外部足球」已更新！' });
    expect(mocks.save.mock.calls[0]?.[1].dateVal).toBe('2026-01-05');
  });
  it('連點只儲存一次，送出中保護關閉與欄位；失敗恢復按鈕且不洩漏錯誤', async () => {
    let reject!: (error: unknown) => void;
    mocks.save.mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
    const { onClose, onSaved } = mount();
    const button = screen.getByRole('button', { name: '儲存修改' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存中...' }).disabled).toBe(true);
    expect(input('cee-title').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '資料儲存中，請稍候', tone: 'error' });
    await act(async () => reject(new Error('permission-denied RAW_UID_AND_URL')));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存修改' }).disabled).toBe(false));
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '更新失敗，請稍後再試', tone: 'error' });
    expect(JSON.stringify(mocks.toast.mock.calls)).not.toContain('RAW_UID');
    expect(onSaved).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue({ title: '外部足球' }); save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });
  it('最新文件權限撤銷的安全訊息，表單保留可重試', async () => {
    mocks.save.mockRejectedValue(new ExternalEventEditError('權限不足'));
    const { onClose } = mount(); save();
    await waitFor(() => expect(mocks.toast).toHaveBeenLastCalledWith({ message: '權限不足', tone: 'error' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '儲存修改' }).disabled).toBe(false);
  });
  it('運動選單共用搜尋與選取，送出採新標籤', async () => {
    mount(); fireEvent.click(document.getElementById('cee-sport-selected')!);
    change('cee-sport-search', '籃球');
    fireEvent.click(screen.getByRole('option', { name: '籃球' }));
    expect(input('cee-sport-tag').value).toBe('basketball');
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[1].sportTag).toBe('basketball');
  });
  it('地圖旗標開時沿用既有草稿；地點變更讓座標失效', async () => {
    mocks.enabled = true;
    mount({ ...event, lat: 25, lng: 121, mapLocationConfirmed: true, mapAddress: '地址' } as typeof event);
    expect(screen.getByText('已設定地圖座標')).toBeTruthy();
    change('cee-location', '新球場');
    expect(screen.getByText('地點文字已變更，請重新確認')).toBeTruthy();
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[2]).toMatchObject({ mapPickerEnabled: true, lat: null, lng: null, mapLocationConfirmed: false });
  });
  it('封面只裁一張 8:3，確認後顯示新圖並送 data URL，沒有第二個裁切', async () => {
    mount();
    pickFile(new File(['image'], 'cover.png', { type: 'image/png' }));
    await screen.findByRole('button', { name: '確認裁圖' });
    expect(mocks.crop).toHaveBeenLastCalledWith({ aspectRatio: 8 / 3, outputWidth: 1200, outputType: 'image/webp', quality: 0.9 });
    fireEvent.click(screen.getByRole('button', { name: '確認裁圖' }));
    expect(screen.queryByRole('button', { name: '確認裁圖' })).toBeNull();
    expect(document.querySelector('#cee-upload-preview img')?.getAttribute('src')).toBe('data:image/webp;base64,AA==');
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[1].image).toBe('data:image/webp;base64,AA==');
  });
  it('取消裁圖保留原圖；不支援的格式提示安全文字', async () => {
    mount();
    pickFile(new File(['x'], 'bad.txt', { type: 'text/plain' }));
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '請上傳 JPG / PNG / WebP 圖片', tone: 'error' });
    pickFile(new File(['image'], 'cover.png', { type: 'image/png' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消裁圖' }));
    expect(document.querySelector('#cee-upload-preview img')?.getAttribute('src')).toBe(event.image);
  });
  it('卸載後的儲存回覆不關閉其他表單、不刷新或吐出過期成功訊息', async () => {
    let resolve!: (value: { title: string }) => void;
    mocks.save.mockReturnValue(new Promise(r => { resolve = r; }));
    const { unmount, onClose, onSaved } = mount(); save(); unmount();
    await act(async () => resolve({ title: '外部足球' }));
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
