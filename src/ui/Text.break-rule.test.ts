import { describe, expect, it } from 'vitest';
import { shouldBreakBetween } from '@/ui/Text';

describe('shouldBreakBetween（詞間換行規則）', () => {
  it('中文詞與詞之間允許換行', () => {
    expect(shouldBreakBetween('台北', '馬拉松')).toBe(true);
    expect(shouldBreakBetween('報名', '開始')).toBe(true);
  });

  it('日文假名詞之間允許換行', () => {
    expect(shouldBreakBetween('イベント', 'に')).toBe(true);
  });

  it('標點前後不插入（避免標點被擠到行首）', () => {
    expect(shouldBreakBetween('報名', '，')).toBe(false);
    expect(shouldBreakBetween('，', '俱樂部')).toBe(false);
    expect(shouldBreakBetween('資訊', '。')).toBe(false);
    expect(shouldBreakBetween('語言', '：')).toBe(false);
  });

  it('英數代碼內部與中英交界不插入', () => {
    expect(shouldBreakBetween('zh', '-')).toBe(false);
    expect(shouldBreakBetween('-', 'TW')).toBe(false);
    expect(shouldBreakBetween('使用', ' ')).toBe(false);
    expect(shouldBreakBetween('ToosterX', '，')).toBe(false);
  });

  it('中點與長音符號不視為可斷點', () => {
    expect(shouldBreakBetween('主題', '・')).toBe(false);
  });
});
