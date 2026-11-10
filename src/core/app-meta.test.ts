import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_BUILD_FALLBACK,
  APP_BUILD_META,
  APP_SHA_FALLBACK,
  APP_SHA_META,
  APP_VERSION_FALLBACK,
  APP_VERSION_META,
  readAppBuild,
  readAppBuildId,
  readAppSha,
  readAppVersion,
  setAppMetaForTest,
} from './app-meta';

function setMeta(name: string, content: string | null): void {
  document.head.querySelector(`meta[name="${name}"]`)?.remove();
  if (content === null) return;
  const el = document.createElement('meta');
  el.setAttribute('name', name);
  el.setAttribute('content', content);
  document.head.appendChild(el);
}

afterEach(() => {
  setAppMetaForTest(null);
  for (const name of [APP_VERSION_META, APP_BUILD_META, APP_SHA_META]) {
    document.head.querySelector(`meta[name="${name}"]`)?.remove();
  }
});

describe('readAppVersion', () => {
  it('meta 有內容就讀那個值', () => {
    setMeta(APP_VERSION_META, '0.20261111a');
    expect(readAppVersion()).toBe('0.20261111a');
  });

  it('meta 缺少時退回 dev', () => {
    setMeta(APP_VERSION_META, null);
    expect(readAppVersion()).toBe(APP_VERSION_FALLBACK);
    expect(APP_VERSION_FALLBACK).toBe('dev');
  });

  it('meta 是空值或空白時退回 dev', () => {
    setMeta(APP_VERSION_META, '');
    expect(readAppVersion()).toBe('dev');
    setMeta(APP_VERSION_META, '   ');
    expect(readAppVersion()).toBe('dev');
  });
});

describe('readAppBuild / readAppSha', () => {
  it('meta 有內容、缺少、空值', () => {
    setMeta(APP_BUILD_META, '202611111234');
    setMeta(APP_SHA_META, 'abc1234');
    expect(readAppBuild()).toBe('202611111234');
    expect(readAppBuildId()).toBe(202611111234);
    expect(readAppSha()).toBe('abc1234');

    setMeta(APP_BUILD_META, null);
    setMeta(APP_SHA_META, null);
    expect(readAppBuild()).toBe(APP_BUILD_FALLBACK);
    expect(readAppBuildId()).toBe(0);
    expect(readAppSha()).toBe(APP_SHA_FALLBACK);

    setMeta(APP_BUILD_META, '');
    setMeta(APP_SHA_META, '  ');
    expect(readAppBuild()).toBe('0');
    expect(readAppBuildId()).toBe(0);
    expect(readAppSha()).toBe('dev');
  });

  it('建置編號不是正數時比較值是 0', () => {
    setMeta(APP_BUILD_META, 'dev');
    expect(readAppBuildId()).toBe(0);
  });
});

describe('setAppMetaForTest', () => {
  it('注入蓋過 document；只注入的欄位才蓋過', () => {
    setMeta(APP_VERSION_META, '0.20261111a');
    setMeta(APP_BUILD_META, '202611111111');
    setAppMetaForTest({ version: 'from-test' });
    expect(readAppVersion()).toBe('from-test');
    expect(readAppBuild()).toBe('202611111111');
    setAppMetaForTest({ version: null, build: '' });
    expect(readAppVersion()).toBe('dev');
    expect(readAppBuild()).toBe('0');
    setAppMetaForTest(null);
    expect(readAppVersion()).toBe('0.20261111a');
  });
});
