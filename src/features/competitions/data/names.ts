/**
 * 取姓氏、單行清理、公開名遮字。自後端 functions-cp `text.ts` 照抄
 * cleanLine、surnameOf、maskedPublicName（含它們用到的常數），行為必須與後端一致。
 * 禁用字清單不在這裡：由管理員設在 cpConfig/launch.bannedWords，預設空，不寫死任何字。
 */

// 控制字元、零寬字元、雙向控制字元（含方向隔離 U+2066～U+2069；防止藏字繞過禁用字或在畫面上反轉顯示）
// 另含畫面看不見的格式字元：軟連字號 U+00AD、阿拉伯字母標記 U+061C、蒙古文母音分隔 U+180E、已棄用格式字元 U+206A～U+206F（與主站 event-comment-notify.js 對齊，顧問 §3.799）
// 另含分類為字母但畫面看不見的填充字（U+115F、U+1160、U+3164、U+FFA0、U+2800），Opus 終審 P3
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u00ad\u061c\u180e\u2060-\u2064\u2066-\u206f\ufeff\u115f\u1160\u3164\uffa0\u2800]/g;

/** 清理單行文字：NFKC、去不可見字元、壓空白、去頭尾。非字串回 null。 */
export function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.normalize('NFKC').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * 複姓表（§4.3）：命中取兩字。含台灣常見雙姓（張簡、范姜、周黃、張廖等）。
 * 伺服器常數；前端預覽用同一份。
 */
export const COMPOUND_SURNAMES: readonly string[] = Object.freeze([
  '歐陽', '司馬', '諸葛', '上官', '東方', '皇甫', '張簡', '范姜', '周黃', '張廖',
  '夏侯', '尉遲', '公孫', '令狐', '慕容', '長孫', '宇文', '司徒', '端木', '澹臺',
  '西門', '南宮', '呼延', '軒轅', '東郭', '鍾離', '赫連', '濮陽', '太史', '申屠',
  '陳黃', '江謝', '張李', '劉張', '黃林',
]);

const HAN_RE = /^\p{Script=Han}/u;

/** 取姓氏：中文名取第一字（複姓取兩字）；外文名取最後一個詞。空字串回空字串。 */
export function surnameOf(realName: string): string {
  const s = cleanLine(realName) ?? '';
  if (!s) return '';
  if (HAN_RE.test(s)) {
    const chars = [...s.replace(/\s+/g, '')];
    const two = chars.slice(0, 2).join('');
    if (chars.length >= 3 && COMPOUND_SURNAMES.includes(two)) return two;
    return chars[0] ?? '';
  }
  const words = s.split(' ').filter(Boolean);
  return words[words.length - 1] ?? '';
}

/**
 * 公開顯示名遮字（站長 11-18：未成年與代填成年沒填暱稱時，一律遮住姓氏後的第一個字）：
 * - 含漢字：從第一個漢字起算；姓氏照 surnameOf（複姓表命中且至少 3 字才取兩字）；
 *   王小明→王O明、歐陽娜娜→歐陽O娜、王明→王O、林→林O、Amy王小美→王O美。
 * - 外文多個詞：名字只留首字母＋姓（John Smith→J. Smith、Mary Ann Lee→M. Lee）。
 * - 外文單一個詞：首字母＋.（ChenXiaoming→C.）。
 * 遮字用半形大寫 O。結果一定不等於完整真名。
 */
export const MASK_CHAR = 'O';
export function maskedPublicName(realName: string): string {
  const s = cleanLine(realName) ?? '';
  if (!s) return '';
  const chars = [...s.replace(/\s+/g, '')];
  const hanAt = chars.findIndex((ch) => HAN_RE.test(ch));
  if (hanAt >= 0) {
    const han = chars.slice(hanAt).join('');
    const sur = surnameOf(han);
    const given = [...han].slice([...sur].length);
    return sur + MASK_CHAR + given.slice(1).join('');
  }
  const words = s.split(' ').filter(Boolean);
  const firstWord = words[0] ?? '';
  const lastWord = words[words.length - 1] ?? '';
  if (words.length >= 2) return `${[...firstWord][0]?.toUpperCase() ?? ''}. ${lastWord}`;
  return `${[...s][0]?.toUpperCase() ?? ''}.`;
}
