import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTACT_CONTACT_MAX,
  CONTACT_CONTENT_MAX,
  CONTACT_NAME_MAX,
  ContactValidationError,
  classifyContactSubmitError,
  contactCharCount,
  contactFieldErrors,
  contactInvalidField,
  submitContactMessage,
} from './submit-contact-message';

const { callFnMock } = vi.hoisted(() => ({ callFnMock: vi.fn() }));

vi.mock('@/data/callables', () => ({
  callFn: (...args: unknown[]) => callFnMock(...args),
}));

const valid = { name: '小明', contact: 'line-id', content: '你好' };

beforeEach(() => {
  callFnMock.mockReset();
  callFnMock.mockResolvedValue({ ok: true, id: 'm1' });
});

describe('contactFieldErrors', () => {
  it('空白與超長不通過，前後空白不算內容', () => {
    expect(contactFieldErrors({ name: '  ', contact: '', content: '   ' })).toEqual([
      'name',
      'contact',
      'content',
    ]);
    expect(contactFieldErrors({
      name: '名'.repeat(CONTACT_NAME_MAX + 1),
      contact: 'c'.repeat(CONTACT_CONTACT_MAX + 1),
      content: 'x'.repeat(CONTACT_CONTENT_MAX + 1),
    })).toEqual(['name', 'contact', 'content']);
    expect(contactFieldErrors({
      name: ` ${'名'.repeat(CONTACT_NAME_MAX)} `,
      contact: ' line ',
      content: ' 你好 ',
    })).toEqual([]);
  });

  it('與後端同規則：碼位計數、稱呼／聯絡方式不得含 Tab 或換行、只有控制字元算空白', () => {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    const control = String.fromCharCode(1);
    // emoji（代理對）算 1 字：剛好上限可過、多 1 字不過
    expect(contactCharCount('⚽'.repeat(3))).toBe(3);
    expect(contactFieldErrors({ ...valid, name: '⚽'.repeat(CONTACT_NAME_MAX) })).toEqual([]);
    expect(contactFieldErrors({ ...valid, name: '⚽'.repeat(CONTACT_NAME_MAX + 1) })).toEqual(['name']);
    expect(contactFieldErrors({ name: `小${tab}明`, contact: `a${newline}b`, content: `第一行${newline}第二行${tab}` }))
      .toEqual(['name', 'contact']);
    expect(contactFieldErrors({ ...valid, content: `${control}${control}` })).toEqual(['content']);
  });

  it('合法草稿沒有錯誤', () => {
    expect(contactFieldErrors(valid)).toEqual([]);
  });
});

describe('classifyContactSubmitError', () => {
  it('辨認 CONTACT_RATE_LIMITED、unauthenticated，其餘算一般失敗', () => {
    expect(classifyContactSubmitError({ code: 'CONTACT_RATE_LIMITED' })).toBe('rate_limited');
    expect(classifyContactSubmitError({
      code: 'functions/resource-exhausted',
      details: { code: 'CONTACT_RATE_LIMITED' },
    })).toBe('rate_limited');
    expect(classifyContactSubmitError({
      code: 'functions/unavailable',
      message: 'CONTACT_RATE_LIMITED',
    })).toBe('rate_limited');
    expect(classifyContactSubmitError({
      code: 'functions/resource-exhausted',
      details: { code: 'CONTACT_DAILY_LIMIT' },
    })).toBe('rate_limited');
    expect(classifyContactSubmitError({ code: 'unauthenticated' })).toBe('unauthenticated');
    expect(classifyContactSubmitError({ code: 'functions/unauthenticated' })).toBe('unauthenticated');
    expect(classifyContactSubmitError({ code: 'functions/internal', message: 'boom' })).toBe('other');
  });
});

describe('contactInvalidField', () => {
  it('INVALID_* 對回欄位，其他錯誤回 null', () => {
    expect(contactInvalidField({ code: 'functions/invalid-argument', details: { code: 'INVALID_NAME' } })).toBe('name');
    expect(contactInvalidField({ code: 'functions/invalid-argument', message: 'INVALID_CONTACT' })).toBe('contact');
    expect(contactInvalidField({ code: 'functions/invalid-argument', details: { code: 'INVALID_CONTENT' } })).toBe('content');
    expect(contactInvalidField({ code: 'functions/internal', message: 'boom' })).toBeNull();
  });
});

describe('submitContactMessage', () => {
  it('送出修剪後的欄位與 source fcb', async () => {
    await submitContactMessage({ name: '  小明  ', contact: ' line-id ', content: ' 你好 ' });
    expect(callFnMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledWith('submitContactMessage', {
      name: '小明',
      contact: 'line-id',
      content: '你好',
      source: 'fcb',
    });
  });

  it('送出前剝掉控制字元（與後端 stripControlChars 同範圍）', async () => {
    const control = String.fromCharCode(1);
    await submitContactMessage({ name: `小${control}明`, contact: 'line-id', content: `你${control}好` });
    expect(callFnMock).toHaveBeenCalledWith('submitContactMessage', {
      name: '小明',
      contact: 'line-id',
      content: '你好',
      source: 'fcb',
    });
  });

  it('欄位不合法時不呼叫 Callable', async () => {
    const error = await submitContactMessage({ name: '', contact: 'a', content: 'b' }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ContactValidationError);
    expect(callFnMock).not.toHaveBeenCalled();
  });
});
