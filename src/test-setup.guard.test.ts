import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getFirebase, getFirebaseCore, isLocalOrPrivateHostname } from '@/data/firebase';

// src/test-setup.ts 的全域擋網本身的驗收：測試不得連線正式 Firebase。
// 這個檔不 mock 任何東西、不掛載頁面，跑其他測試前可以先單跑它確認擋網已生效。

describe('test-setup 全域擋網', () => {
  it('getFirebase／getFirebaseCore 沒有被測試 mock 時立即 reject', async () => {
    await expect(getFirebase()).rejects.toThrow('測試未 mock Firebase：getFirebase');
    await expect(getFirebaseCore()).rejects.toThrow('測試未 mock Firebase：getFirebaseCore');
  });

  it('data/firebase.ts 其他匯出維持真實實作', () => {
    expect(isLocalOrPrivateHostname('localhost')).toBe(true);
    expect(isLocalOrPrivateHostname('toosterx.com')).toBe(false);
  });

  it.each([
    'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:runQuery',
    'https://asia-east1-p.cloudfunctions.net/fn',
    'https://fn-abc123-de.a.run.app/',
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k',
    'https://securetoken.googleapis.com/v1/token?key=k',
    'https://firebasestorage.googleapis.com/v0/b/bucket/o',
    'HTTPS://FIRESTORE.GOOGLEAPIS.COM/v1/x',
  ])('fetch 擋下 %s', async (url) => {
    await expect(fetch(url)).rejects.toThrow('test-setup: 測試不得連線 Firebase 線上端點');
    await expect(fetch(new URL(url))).rejects.toThrow('test-setup');
    await expect(fetch(new Request(url, { method: 'POST' }))).rejects.toThrow('test-setup');
  });

  it('Firestore SDK 的 gRPC 連線一律導向不可達的代理，本機 emulator 不受影響', () => {
    // 用 @firebase/firestore 實際解析到的那一份 @grpc/grpc-js，確認它讀到 test-setup 設的環境變數。
    const firestoreRequire = createRequire(createRequire(import.meta.url).resolve('@firebase/firestore'));
    const { mapProxyName } = firestoreRequire('@grpc/grpc-js/build/src/http_proxy.js') as {
      mapProxyName: (target: { scheme: string; path: string }, options: object) => { target: { path: string } };
    };
    expect(mapProxyName({ scheme: 'dns', path: 'firestore.googleapis.com:443' }, {}).target.path).toBe('127.0.0.1:9');
    expect(mapProxyName({ scheme: 'dns', path: '127.0.0.1:8080' }, {}).target.path).toBe('127.0.0.1:8080');
    expect(mapProxyName({ scheme: 'dns', path: 'localhost:8080' }, {}).target.path).toBe('localhost:8080');
  });
});
