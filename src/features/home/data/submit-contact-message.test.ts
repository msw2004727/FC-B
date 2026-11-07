import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTACT_CONTACT_MAX,
  CONTACT_CONTENT_MAX,
  CONTACT_NAME_MAX,
  ContactValidationError,
  classifyContactSubmitError,
  contactFieldErrors,
  submitContactMessage,
} from './submit-contact-message';

const { callFnMock } = vi.hoisted(() => ({ callFnMock: vi.fn() }));

vi.mock('@/data/callables', () => ({
  callFn: (...args: unknown[]) => callFnMock(...args),
}));

const valid = { name: '小明', contact: 'line-id', content: '你好' };

beforeEach(() => {
  callFnMock.mockReset();
  callFnMock.mockResolvedValue({ success: true });
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
    })).toEqual(['name']);
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
    expect(classifyContactSubmitError({ code: 'unauthenticated' })).toBe('unauthenticated');
    expect(classifyContactSubmitError({ code: 'functions/unauthenticated' })).toBe('unauthenticated');
    expect(classifyContactSubmitError({ code: 'functions/internal', message: 'boom' })).toBe('other');
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

  it('欄位不合法時不呼叫 Callable', async () => {
    const error = await submitContactMessage({ name: '', contact: 'a', content: 'b' }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ContactValidationError);
    expect(callFnMock).not.toHaveBeenCalled();
  });
});
