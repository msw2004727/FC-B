import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn(() => () => undefined),
}));

import { CompanionModal } from './CompanionModal';

describe('CompanionModal', () => {
  afterEach(() => {
    cleanup();
  });

  // 退修 1 #5：A 的 .modal 在 <800px 沒有 width，companion 彈窗又用 position:static 蓋掉 left/right:0，
  // 變成依內容縮成約 196px（手機 390 寬）；≥800px 才有 .modal{width:100%}。補 width:100%，上限仍是 340px。
  it('彈窗本體 width:100% 且上限 340px（手機寬度不會縮成內容寬）', () => {
    render(<CompanionModal mode="add" pending={false} onClose={() => undefined} onSave={() => undefined} />);
    const modal = document.querySelector<HTMLElement>('#companion-modal-overlay .modal');
    expect(modal).toBeTruthy();
    expect(modal?.style.width).toBe('100%');
    expect(modal?.style.maxWidth).toBe('340px');
    // 其餘照 A：static 定位、無位移
    expect(modal?.style.position).toBe('static');
    expect(modal?.style.transform).toBe('none');
  });
});
