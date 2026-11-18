import { describe, expect, it } from 'vitest';
import { BOOT_PRELOAD_SCRIPT_ID, computeBootPreload, injectBootPreload } from './boot-preload-html.ts';

const chunk = (fileName, { isEntry = false, imports = [], moduleIds = [], css = [] } = {}) => ({
  type: 'chunk',
  fileName,
  isEntry,
  imports,
  moduleIds,
  viteMetadata: { importedCss: new Set(css) },
});

function bundle() {
  const items = [
    chunk('assets/index-E.js', { isEntry: true, imports: ['assets/shared-S.js'], moduleIds: ['/p/src/main.tsx'] }),
    chunk('assets/shared-S.js', { moduleIds: ['/p/src/i18n/i18n.ts'] }),
    chunk('assets/EventDetailPage-D.js', {
      imports: ['assets/shared-S.js', 'assets/dep-A.js'],
      moduleIds: ['C:\\p\\src\\features\\events\\pages\\EventDetailPage.tsx'],
      css: ['assets/EventDetailPage-C.css'],
    }),
    chunk('assets/dep-A.js', { imports: ['assets/dep-B.js'], moduleIds: ['/p/src/x.ts'], css: ['assets/dep-A.css'] }),
    chunk('assets/dep-B.js', { moduleIds: ['/p/src/y.ts'] }),
    chunk('assets/index.esm-F.js', { imports: ['assets/fs-core-G.js'], moduleIds: ['/p/node_modules/firebase/firestore/dist/esm/index.esm.js'] }),
    chunk('assets/fs-core-G.js', { moduleIds: ['/p/node_modules/@firebase/firestore/dist/index.esm.js'] }),
    { type: 'asset', fileName: 'assets/EventDetailPage-C.css' },
  ];
  return Object.fromEntries(items.map((c) => [c.fileName, c]));
}

describe('boot-preload-html（顧問 §3.255 B′）', () => {
  it('詳情：目標 chunk 排第一，加上遞迴靜態 import，扣掉入口已載入的；CSS 照 Vite 依賴優先順序', () => {
    const map = computeBootPreload(bundle());
    expect(map.detail.js).toEqual(['/assets/EventDetailPage-D.js', '/assets/dep-A.js', '/assets/dep-B.js']);
    // 依賴（dep-A）的 CSS 在前、頁面自己的在後：後插入的樣式表優先，跟路由載入時一樣。
    expect(map.detail.css).toEqual(['/assets/dep-A.css', '/assets/EventDetailPage-C.css']);
    expect(map.firestore).toEqual({ js: ['/assets/index.esm-F.js', '/assets/fs-core-G.js'], css: [] });
  });

  it('找不到目標模組就讓建置失敗，不靜默少預載', () => {
    const b = bundle();
    delete b['assets/index.esm-F.js'];
    expect(() => computeBootPreload(b)).toThrow(/firebase\/firestore/);
  });

  it('注入在 </head> 前、type=application/json；< 轉義', () => {
    const html = injectBootPreload('<html><head><title>x</title></head><body></body></html>', {
      detail: { js: ['/assets/a</script>.js'], css: [] },
      firestore: { js: [], css: [] },
    });
    expect(html).toContain(`<script type="application/json" id="${BOOT_PRELOAD_SCRIPT_ID}">`);
    expect(html.indexOf(BOOT_PRELOAD_SCRIPT_ID)).toBeLessThan(html.indexOf('</head>'));
    expect(html).not.toContain('a</script>');
    expect(html).toContain('\\u003c/script>');
    expect(() => injectBootPreload('<html></html>', { detail: { js: [], css: [] }, firestore: { js: [], css: [] } })).toThrow();
  });
});
