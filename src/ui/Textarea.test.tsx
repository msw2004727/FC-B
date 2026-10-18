import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { setLocale, t } from '@/i18n/i18n';
import { Textarea } from './Textarea';
import { countTextarea } from './textarea-count';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Textarea', () => {
  it('counts code points and validates without truncating IME/paste content', () => {
    render(<Textarea label="Notes" value="甲乙丙" maxLength={2} required />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.value).toBe('甲乙丙');
    expect(input.validity.customError).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-count`);
    expect(input.closest('.ui-textarea--auto-grow')).not.toBeNull();
    expect(screen.getByText(t('ui.textarea.required'))).toBeTruthy();
    expect(screen.getByText(t('ui.textarea.tooLong'))).toBeTruthy();
    expect(screen.getByText(t('ui.textarea.count', { current: '3', max: '2' }))).toBeTruthy();
    expect(countTextarea('𠮷', 'zh-TW')).toBe(1);
  });

  it('uses word counts after locale changes', async () => {
    render(<Textarea label="Notes" value="Hello world" maxLength={4} />);
    await act(async () => { await setLocale('en'); });
    expect(screen.getByText(t('ui.textarea.count', { current: '2', max: '4' }))).toBeTruthy();
  });

  it('supports fixed mode and suppresses disabled/loading callbacks', () => {
    const change = vi.fn();
    const { rerender } = render(
      <Textarea label="Notes" value="" variant="fixed" onValueChange={change} />,
    );
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.closest('.ui-textarea--fixed')).not.toBeNull();
    fireEvent.input(input, { target: { value: 'Text' } });
    expect(change).toHaveBeenCalledWith('Text');

    change.mockClear();
    rerender(<Textarea label="Notes" value="" disabled onValueChange={change} />);
    fireEvent.input(input, { target: { value: 'Ignored' } });
    expect(change).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);

    rerender(<Textarea label="Notes" value="" loading onValueChange={change} />);
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(t('ui.textarea.loading'));
  });
});
