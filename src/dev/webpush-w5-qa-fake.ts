// 截圖台用：QA 判斷直接回「是 QA 帳號」，不讀登入狀態、不初始化 Firebase。
export function useQaSession(uid: string | null | undefined): { persona: string; agent: string | null } | null {
  return uid ? { persona: 'memberA', agent: null } : null;
}

// 截圖台用：LINE 好友狀態固定「已加好友」（與站長確認的預覽同一畫面，LINE 區不顯示提示列）。
export async function checkLineFriendship(): Promise<boolean> {
  return true;
}
