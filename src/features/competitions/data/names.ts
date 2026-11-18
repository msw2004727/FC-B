/**
 * 取姓氏與單行清理。自後端 functions-cp `text.ts` 照抄 cleanLine、surnameOf、
 * minorPublicNameCandidates（含它們用到的常數），行為必須與後端一致。
 * 禁用字清單不在這裡：由管理員設在 cpConfig/launch.bannedWords，預設空，不寫死任何字。
 */

// 控制字元、零寬字元、雙向控制字元（防止藏字繞過禁用字或在畫面上反轉顯示）
// 另含分類為字母但畫面看不見的填充字（U+115F、U+1160、U+3164、U+FFA0、U+2800），Opus 終審 P3
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u115f\u1160\u3164\uffa0\u2800]/g;

/** 清理單行文字：NFKC、去不可見字元、壓空白、去頭尾。非字串回 null。 */
export function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.normalize('NFKC').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * 複姓表（§4.3）：命中取兩字。含台灣常見雙姓（張簡、范姜、周黃、張廖等）。
 * 伺服器常數；前端預覽用同一份（第 2 步畫面施工時由同步腳本帶過去）。
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
 * 未成年公開顯示名可接受的候選（球員或代表可修正姓氏判斷，但只能在這幾種之中選，
 * 防止把全名寫進公開投影）：
 * - 含漢字：從第一個漢字起算（「Amy王小美」→ 王小美），第一個候選是 surnameOf（含複姓），另加第一字、前兩字。
 * - 純外文：只取最後一個詞（姓）。
 * - 任何候選都不得等於完整真名（Opus 終審 P1-3：單詞外文名、單字名）；全部被排除時退回「首字母＋.」。
 */
export function minorPublicNameCandidates(realName: string): string[] {
  const s = cleanLine(realName) ?? '';
  if (!s) return [];
  const full = s.replace(/\s+/g, '');
  const out: string[] = [];
  const add = (c: string) => { if (c && c !== full && !out.includes(c)) out.push(c); };
  const chars = [...full];
  const hanAt = chars.findIndex((ch) => HAN_RE.test(ch));
  if (hanAt >= 0) {
    const han = chars.slice(hanAt);
    add(surnameOf(han.join('')));
    add(han[0] ?? '');
    if (han.length >= 3) add(han.slice(0, 2).join(''));
  } else {
    const words = s.split(' ').filter(Boolean);
    if (words.length >= 2) add(words[words.length - 1] ?? '');
  }
  if (out.length === 0) out.push(`${(chars[0] ?? '').toUpperCase()}.`);
  return out;
}
