/** 按鈕加速①：立刻開始，失敗只 console.warn，不往外拋、不擋住 toast 或畫面。 */
export function runInBackground(work: () => Promise<unknown>, label: string): void {
  void (async () => {
    try {
      await work();
    } catch (error) {
      console.warn(label, error);
    }
  })();
}
