/** 按鈕加速①：立刻開始，失敗只 console.warn，不往外拋、不擋住 toast 或畫面。 */
export function runInBackground(work: () => Promise<unknown>, label: string): void {
  try {
    void work().catch((error: unknown) => {
      console.warn(label, error);
    });
  } catch (error) {
    console.warn(label, error);
  }
}
