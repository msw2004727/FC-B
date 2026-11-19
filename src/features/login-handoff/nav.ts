let replaceImpl = (url: string): void => {
  location.replace(url);
};

export function replacePage(url: string): void {
  replaceImpl(url);
}

/** 測試用。jsdom 的 location.replace 不可覆寫。 */
export function _setReplaceForTest(fn: ((url: string) => void) | null): void {
  replaceImpl = fn ?? ((url: string) => { location.replace(url); });
}
