import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';

import { MyActivityStatsModal } from './MyActivityModals';

// 退修 1 #7：直接開 /my-activities 時「活動統計」彈窗沒有樣式（overlay 是 position:static）。
// 原因有兩個：頁面沒有 import A 的 .edu-info-* 樣式（edu-info-btn.css）；彈窗 createPortal 到 body 後離開了頁面的 .legacy-ui，
// 打包時限定在 .legacy-ui 內的 A 樣式套不到。兩者都要補。
describe('MyActivityStatsModal 的 A 樣式', () => {
  afterEach(() => {
    cleanup();
  });

  it('portal 到 body 的彈窗外包 .legacy-ui，.edu-info-overlay 是它的直接子層', () => {
    render(<MyActivityStatsModal open isAdmin={false} events={[]} nowMs={Date.now()} onClose={() => undefined} />);
    const overlay = document.body.querySelector('.edu-info-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.parentElement?.classList.contains('legacy-ui')).toBe(true);
    expect(overlay?.parentElement?.parentElement).toBe(document.body);
  });

  it('有 import 說明彈窗樣式 edu-info-btn.css（vitest 會略過 CSS，所以讀原始碼確認）', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/events/components/legacy/MyActivityModals.tsx'),
      'utf8',
    );
    expect(source).toContain("import '@/styles/legacy/edu-info-btn.css';");
  });
});
