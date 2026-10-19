// 舊版 A 的 CSS（原檔照搬）在打包時限定作用範圍到 `.legacy-ui` 之內。
//
// 2026-10-19：站長要求 FC-B 外觀照舊版。實測若把 A 的 base／layout 全域載入，
// 尚未改版、但用了同名 class（例如 .tab-bar、.page）的 B 頁面會跑版。
// 因此：原檔一字不改，打包時把每條選擇器改寫成只作用在 `.legacy-ui` 包住的區塊；
// 已改成 A 結構的頁面在最外層加 `class="legacy-ui"` 即套用 A 外觀。全部頁面改完後可拿掉本外掛。
//
// 改寫規則（只處理檔案路徑含 /legacy/ 的 .css）：
//   :root                       → .legacy-ui
//   html／body（含 body.x）      → .legacy-ui（含 .legacy-ui.x）
//   [data-theme="…"] …           → [data-theme="…"] .legacy-ui …（色票與暗色規則）
//   html[data-theme="…"] …       → 同上
//   *、*::before、*::after       → .legacy-ui *、…
//   其他                          → .legacy-ui <原選擇器>
//   @keyframes 內的規則不動；@media／@supports 內的規則照上述改寫。

const SCOPE = '.legacy-ui';
const THEME_RE = /^(?:html)?(\[data-theme(?:=["']?[\w-]+["']?)?\])(.*)$/s;
const ROOT_ELEMENT_RE = /^(?:html|body)(?![\w-])(.*)$/s;

/** 改寫單一選擇器（已去頭尾空白）。 */
export function scopeSelector(selector) {
  const sel = selector.trim();
  if (!sel) return sel;
  if (sel.startsWith(SCOPE)) return sel;

  if (sel.startsWith(':root')) {
    return SCOPE + sel.slice(':root'.length);
  }

  const theme = sel.match(THEME_RE);
  if (theme) {
    const rest = theme[2];
    if (!rest) return `${theme[1]} ${SCOPE}`;
    // `[data-theme="dark"] body` → 主題下的整個 scope
    const restTrim = rest.trim();
    const restRoot = restTrim.match(ROOT_ELEMENT_RE);
    if (restRoot) return `${theme[1]} ${SCOPE}${restRoot[1]}`;
    if (/^[\s>+~]/.test(rest)) return `${theme[1]} ${SCOPE} ${restTrim}`;
    // `[data-theme="dark"].x`：屬性與 class 在同一元素（html），套到 scope 上
    return `${theme[1]} ${SCOPE}${rest}`;
  }

  const rootEl = sel.match(ROOT_ELEMENT_RE);
  if (rootEl) {
    const rest = rootEl[1];
    if (!rest) return SCOPE;
    if (/^[\s>+~]/.test(rest)) return `${SCOPE} ${rest.trim()}`;
    return `${SCOPE}${rest}`;
  }

  return `${SCOPE} ${sel}`;
}

function insideKeyframes(rule) {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
    parent = parent.parent;
  }
  return false;
}

/** PostCSS 外掛：只處理路徑含 /legacy/ 的 CSS。 */
export function legacyCssScope() {
  return {
    postcssPlugin: 'legacy-css-scope',
    Once(root) {
      const file = String(root.source?.input?.file || '').replace(/\\/g, '/');
      if (!/\/legacy\/[^/]+\.css$/.test(file)) return;
      root.walkRules((rule) => {
        if (insideKeyframes(rule)) return;
        rule.selectors = rule.selectors.map(scopeSelector);
      });
    },
  };
}
legacyCssScope.postcss = true;
