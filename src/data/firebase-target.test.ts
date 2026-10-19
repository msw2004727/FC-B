import { describe, expect, it } from 'vitest';

import { FirebaseTargetBlockedError, assertFirebaseTargetAllowed } from './firebase';

describe('assertFirebaseTargetAllowed（本機不得連正式資料庫）', () => {
  it('連 emulator 時任何網址都允許', () => {
    expect(() => assertFirebaseTargetAllowed(true, 'localhost')).not.toThrow();
  });

  it.each([
    'localhost', '127.0.0.1', '::1', '[::1]', 'preview.localhost', 'LOCALHOST',
    '192.168.1.20', '10.0.0.5', '172.16.3.4', '172.31.255.1', 'my-pc.local', '0.0.0.0',
  ])(
    '不連 emulator 且網址為 %s 時拒絕',
    (host) => {
      expect(() => assertFirebaseTargetAllowed(false, host)).toThrow(FirebaseTargetBlockedError);
    },
  );

  it.each(['next.toosterx.com', 'fc-b.pages.dev', 'toosterx.com', '172.32.0.1', '8.8.8.8'])('正式網域 %s 允許', (host) => {
    expect(() => assertFirebaseTargetAllowed(false, host)).not.toThrow();
  });
});
