import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';

import type { ActivityRecordItem } from '../../data/activity-records';
import { ActivityRecordList } from './ActivityRecordList';

function item(name: string, displayStatus?: string, status = 'registered'): ActivityRecordItem {
  const it: ActivityRecordItem = { _docId: `d-${name}`, eventId: `e-${name}`, name, date: '10/01', status };
  if (displayStatus) it._displayStatus = displayStatus;
  return it;
}

function tagOf(container: Element, name: string): Element {
  const row = Array.from(container.querySelectorAll('.mini-activity')).find(
    (el) => el.querySelector('.mini-activity-name')?.textContent === name,
  );
  const tag = row?.querySelector('.mini-activity-tag');
  if (!tag) throw new Error(`tag not found for ${name}`);
  return tag;
}

describe('ActivityRecordList 標籤（T-039）', () => {
  afterEach(() => {
    cleanup();
  });

  it('incomplete 顯示「未完成」；missed 仍顯示「未出席」', () => {
    const { container } = render(
      <ActivityRecordList
        items={[item('OnlyCheckin', 'incomplete'), item('Absent', 'missed')]}
        page={1}
        onPage={vi.fn()}
      />,
    );
    expect(tagOf(container, 'OnlyCheckin').textContent).toBe('未完成');
    expect(tagOf(container, 'Absent').textContent).toBe('未出席');
  });

  it('incomplete 的 class 帶 incomplete（點與標籤），不會誤用 missed', () => {
    const { container } = render(
      <ActivityRecordList items={[item('OnlyCheckin', 'incomplete')]} page={1} onPage={vi.fn()} />,
    );
    const tag = tagOf(container, 'OnlyCheckin');
    expect(tag.classList.contains('incomplete')).toBe(true);
    expect(tag.classList.contains('missed')).toBe(false);
    expect(container.querySelector('.mini-activity-status.incomplete')).toBeTruthy();
  });

  it('其他標籤不變：完成／取消／已報名／候補中', () => {
    const { container } = render(
      <ActivityRecordList
        items={[
          item('C', 'completed'),
          item('X', undefined, 'cancelled'),
          item('R', undefined, 'registered'),
          item('W', undefined, 'waitlisted'),
        ]}
        page={1}
        onPage={vi.fn()}
      />,
    );
    expect(tagOf(container, 'C').textContent).toBe('完成');
    expect(tagOf(container, 'X').textContent).toBe('取消');
    expect(tagOf(container, 'R').textContent).toBe('已報名');
    expect(tagOf(container, 'W').textContent).toBe('候補中');
  });
});
