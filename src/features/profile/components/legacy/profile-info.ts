/**
 * A `profile-data.js` `_profileInfoData` 原文（個人頁各卡「?」說明），逐字照搬（T-019 M-121）。
 * body 是 A 的靜態 HTML，只能由 ProfileInfoButton 以 dangerouslySetInnerHTML 輸出這裡的常數。
 */

export type ProfileInfoKey =
  | 'myProfile'
  | 'secondaryIdentity'
  | 'lineNotify'
  | 'favorites'
  | 'companions'
  | 'records';

export const PROFILE_INFO: Readonly<Record<ProfileInfoKey, { title: string; body: string }>> = {
  myProfile: {
    title: "我的資料",
    body: "設定個人基本資訊，包含性別、生日、地區與運動類別等。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">用途</p>• 讓主辦人在報名名單中快速了解參加者背景<br>• 系統依據你的資料推薦合適的活動與俱樂部<br>• 部分活動可能依性別或年齡設定報名限制<p style=\"margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)\">資料僅用於平台功能，不會對外公開。</p>",
  },
  secondaryIdentity: {
    title: "第二身份",
    body: "第二身份是公開顯示用的暱稱與頭像，不會改變你的帳號、權限、報名資料或主身份紀錄。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">目前可用於</p>• 右上角與我的資料頁顯示<br>• 活動留言與回覆<br>• 用戶資料卡片的公開顯示<p style=\"margin:.4rem 0 .15rem;font-weight:600\">注意</p>私訊、報名、主辦管理、權限判斷與後台稽核仍使用主身份。若要編輯第二身份暱稱或頭像，請先關閉第二身份。",
  },
  lineNotify: {
    title: "LINE 推播通知",
    body: "綁定 LINE 帳號並加入官方好友後，系統會透過 LINE 推送即時通知。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">通知類型</p>• <b>活動提醒</b> — 報名成功確認、活動開始前提醒<br>• <b>系統通知</b> — 站內信、公告、候補遞補通知<br>• <b>賽事通知</b> — 賽程更新、對戰結果<p style=\"margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)\">綁定後可個別開關各類通知，隨時可解除綁定。</p>",
  },
  favorites: {
    title: "我的收藏",
    body: "將感興趣的活動加入收藏，方便日後快速查看。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">使用方式</p>• 在活動詳情頁點擊愛心即可收藏<br>• 收藏不代表報名，僅作為個人書籤<br>• 活動結束後收藏會自動歸檔",
  },
  companions: {
    title: "我的運動夥伴",
    body: "預先設定常一起參加活動的夥伴，報名時可一鍵帶入。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">使用方式</p>• 點擊「新增同行者」輸入名稱即可建立<br>• 報名活動時勾選同行者，系統自動一起報名<br>• 同行者佔用活動名額，取消報名時一併取消<p style=\"margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)\">適合家人、固定球友等經常同行的夥伴。</p>",
  },
  records: {
    title: "報名紀錄",
    body: "查看所有活動的參與紀錄，追蹤自己的運動歷程。<p style=\"margin:.4rem 0 .15rem;font-weight:600\">紀錄分類</p>• <b>已報名</b> — 尚未開始的活動<br>• <b>已完成</b> — 已簽到完成的活動<br>• <b>已取消</b> — 自行取消或被移除的報名",
  },
};
