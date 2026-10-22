/**
 * A `event-create.js` `_ceInfoData` 原文（建立活動表單每欄「?」說明），逐字照搬（T-013）。
 * body 是 A 的靜態 HTML，只能由 CeInfoDialog 以 dangerouslySetInnerHTML 輸出這裡的常數。
 */

export type CeInfoKey =
  | 'template'
  | 'title'
  | 'type'
  | 'region'
  | 'location'
  | 'time'
  | 'regOpen'
  | 'fee'
  | 'max'
  | 'age'
  | 'teamOnly'
  | 'delegate'
  | 'notes'
  | 'sport'
  | 'gender'
  | 'private'
  | 'socialLinks'
  | 'earlyBird'
  | 'gps'
  | 'teamSplit'
  | 'saveTemplate';

export const CE_INFO: Readonly<Record<CeInfoKey, { title: string; body: string }>> = {
  template: {
    title: "從範本建立",
    body: "載入之前儲存的活動設定，快速填入所有欄位。載入後仍可修改任何內容。",
  },
  title: {
    title: "活動名稱",
    body: "為活動取一個簡短好懂的名稱，上限 16 字。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">例：「週三足球」、「假日友誼賽」</p>",
  },
  type: {
    title: "活動類型",
    body: "<b>PLAY</b> — 一般揪團踢球<br><b>教學</b> — 教練帶隊訓練<br><b>觀賽</b> — 觀看比賽<p style=\"margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem\">類型會影響統計分類與首頁顯示位置。</p>",
  },
  region: {
    title: "活動地區",
    body: "選擇活動所在的地區分區。用戶可透過地區頁籤快速找到該區域的活動。<br><br>• <b>北部</b>：台北、新北、基隆、桃園、新竹、宜蘭<br>• <b>中部</b>：苗栗、台中、彰化、南投、雲林<br>• <b>南部</b>：嘉義、台南、高雄、屏東<br>• <b>東部&amp;外島</b>：花蓮、台東、澎湖、金門、連江<br><br>選擇分區後，<b>至少須勾選一個縣市</b>，不可全部取消。<br><br>管理員可關閉此選項，讓活動在所有地區頁籤都顯示。",
  },
  location: {
    title: "活動地點",
    body: "輸入場地名稱或地址。系統會記住最近使用的地點，下次可直接選取。",
  },
  time: {
    title: "活動時間",
    body: "選擇日期與開始 / 結束時間。<p style=\"margin:.4rem 0 0\">選擇<b>多個日期</b>可一次建立多場活動（批次建立），每場獨立管理報名與出席。</p>",
  },
  regOpen: {
    title: "開放報名時間",
    body: "開關預設關閉，代表活動建立後立即開放報名。<p style=\"margin:.3rem 0 0\"><b>開啟後</b>：需填寫完整的開放日期與時間，時間未到前顯示「即將開放」。</p><p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">多日期模式下可設「活動開始前 N 天 N 時」，系統會自動為每場計算各自的開放時間。若要讓用戶在正式開放前提前報名，請到「進階功能」開啟早鳥報名。</p>",
  },
  fee: {
    title: "費用",
    body: "開啟後輸入每人費用（新台幣）。金額會顯示在活動詳情頁，方便參加者提前準備。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">關閉 = 免費活動。</p>",
  },
  max: {
    title: "人數上限",
    body: "設定最多可報名的人數。額滿後新報名者自動進入<b>候補名單</b>，有人取消時系統依報名順序自動遞補。",
  },
  age: {
    title: "年齡限制",
    body: "設定參加者的最低年齡。填 <b>0</b> 表示不限年齡。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">年齡依個人資料中的生日計算。</p>",
  },
  teamOnly: {
    title: "俱樂部限定",
    body: "開啟後，只有指定俱樂部的成員可以報名。可選擇一個或多個俱樂部。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">非成員會看到「球隊限定」無法報名。</p>",
  },
  delegate: {
    title: "委託人",
    body: "指定最多 3 位管理員協助管理此活動，包括出席確認、編輯活動與簽到掃碼。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">被委託人會收到通知，並可在「我的活動」中看到此活動。</p>",
  },
  notes: {
    title: "注意事項",
    body: "填寫活動備註，例如場地規則、攜帶物品、付款方式等。上限 500 字，會顯示在活動詳情頁。",
  },
  sport: {
    title: "運動 / 場景標籤",
    body: "選擇活動的運動類別，用於分類與篩選。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">目前支援足球，未來將開放更多運動項目。</p>",
  },
  gender: {
    title: "性別限定",
    body: "開啟後，僅限所選性別可報名。不符合的用戶會看到限制提示。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">依個人資料中的性別欄位判斷；性別空白的用戶也無法報名。</p>",
  },
  private: {
    title: "私密活動",
    body: "開啟後活動<b>不會</b>出現在公開列表中，只有透過分享連結才能查看。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">適合內部活動或邀請制活動。</p>",
  },
  socialLinks: {
    title: "社群連結",
    body: "開啟後可放最多 5 個社群或外部連結。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見平台，並在活動詳情頁顯示成圓形連結按鈕。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">適合放社團公告、主辦社群、活動相簿或其他補充資訊。</p>",
  },
  earlyBird: {
    title: "早鳥報名",
    body: "此開關位於「進階功能」。開啟後，活動在正式開放報名前會顯示早鳥報名按鈕。用戶確認後會扣除設定積分並報名正取；活動取消時系統退回積分，用戶自行取消則不退回。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">積分範圍 10～500 分。早鳥不支援同行者，避免一人扣一次卻帶多人提前卡位。</p>",
  },
  gps: {
    title: "GPS功能",
    body: "開啟後才可使用「設定地圖座標」，讓活動儲存精準經緯度並出現在附近活動地圖。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">關閉時，地圖座標按鈕會反灰；已設定的座標會在送出時清除，只保留一般地點文字。</p>",
  },
  teamSplit: {
    title: "分隊功能（色衣分組）",
    body: "開啟後系統會在報名流程中加入<b>隊伍分配機制</b>，讓參加者到場前就知道自己穿什麼顏色背心。<p style=\"margin:.5rem 0 .2rem;font-weight:600\">三種模式</p><b>隨機分配</b> — 報名時系統自動平衡分配，適合彼此不認識的揪團。<br><b>自選隊伍</b> — 報名時用戶自己挑隊，適合朋友約好要同隊。<br><b>主辦分配</b> — 報名時不分隊，由主辦在報名名單手動安排。<p style=\"margin:.5rem 0 .2rem;font-weight:600\">隊伍數量</p>支援 2～4 隊，預設 2 隊（紅 vs 藍）。每隊以字母 A/B/C/D 加顏色識別，色盲用戶可透過字母辨別。<div style=\"margin:.6rem 0 .3rem;padding:.55rem .7rem;border:1.5px solid var(--accent);border-radius:8px\"><div style=\"font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:.3rem\">✅ 均分上限</div><div style=\"font-size:.75rem;margin-bottom:.35rem\">勾選後系統自動計算每隊人數上限，避免隊伍人數嚴重失衡。</div><div style=\"font-size:.75rem;font-weight:600;margin-bottom:.15rem\">計算方式</div><div style=\"font-size:.75rem;color:var(--text-secondary);margin-bottom:.3rem\">每隊上限 = 活動人數上限 ÷ 隊伍數（<b>無條件進位</b>）</div><div style=\"font-size:.75rem;font-weight:600;margin-bottom:.15rem\">範例</div><div style=\"font-size:.75rem;color:var(--text-secondary);margin-bottom:.25rem\">• 20 人活動 ÷ 2 隊 → 每隊上限 <b>10 人</b><br>• 20 人活動 ÷ 3 隊 → 每隊上限 <b>7 人</b><br><span style=\"padding-left:1rem;font-size:.7rem\">（20÷3=6.67 進位）</span><br>• 15 人活動 ÷ 4 隊 → 每隊上限 <b>4 人</b><br><span style=\"padding-left:1rem;font-size:.7rem\">（15÷4=3.75 進位）</span></div><div style=\"font-size:.72rem;color:var(--text-muted)\">自選模式：滿隊後無法再選該隊<br>隨機模式：系統自動平衡分配</div></div><p style=\"margin:.5rem 0 .2rem;font-weight:600\">鎖定時間（僅自選模式）</p>活動開始前 N 小時鎖定，用戶不能再更改隊伍。主辦隨時可調。<p style=\"margin:.5rem 0 .2rem;font-weight:600\">同行者</p>同行者預設跟主報名人同隊，不需額外操作。<p style=\"margin:.5rem 0 .2rem;font-weight:600\">管理操作</p>主辦/委託人可在活動詳情頁使用三個批次按鈕：<br>• <b>隨機</b> — 全部重新洗牌分隊<br>• <b>補齊</b> — 只分配還沒有隊的人<br>• <b>重置</b> — 清除所有隊伍分配<p style=\"margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem\">不管選哪種模式，主辦隨時可在報名名單點擊色衣圖示手動調整。未開啟分隊的活動一切與現在完全相同。</p>",
  },
  saveTemplate: {
    title: "儲存為範本",
    body: "將目前填寫的活動設定儲存為範本，下次建立類似活動可直接載入。<p style=\"margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem\">範本儲存在雲端，跨裝置可用，上限 30 個。</p>",
  },
};
