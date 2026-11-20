// 賽事頁的登入入口：沿用站內 signIn（LINE 登入，回跳到目前網址）。接受邀請頁與詳情頁的檢舉共用。

export async function cpSignIn(): Promise<void> {
  const auth = await import('@/data/auth');
  try {
    await auth.signIn();
  } catch (err) {
    // 導向 LINE 時會丟 LoginRedirectingError，不算失敗。
    if (!auth.isLoginRedirectingError(err)) throw err;
  }
}
