// 高頻詞表：無 Intl.Segmenter 的降級路徑用。
// 只放多字詞；單字詞對字元間切分沒有意義（容器 keep-all 已防止 CJK 字元自動斷行）。
export type SegmenterFallbackLocale = 'zh-TW' | 'zh-CN' | 'ja';

export const FALLBACK_WORDS: Record<SegmenterFallbackLocale, readonly string[]> = {
  'zh-TW': [
    '報名',
    '候補',
    '活動',
    '俱樂部',
    '馬拉松',
    '簽到',
    '取消',
    '課程',
    '報名中',
    '已額滿',
  ],
  'zh-CN': [
    '报名',
    '候补',
    '活动',
    '俱乐部',
    '马拉松',
    '签到',
    '取消',
    '课程',
    '报名中',
    '已额满',
  ],
  ja: [
    '申し込み',
    'キャンセル待ち',
    'イベント',
    'クラブ',
    'マラソン',
    'チェックイン',
    'キャンセル',
    'コース',
    '受付中',
    '満員',
  ],
};
