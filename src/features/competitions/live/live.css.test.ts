import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('寬螢幕記分板', () => {
  it('視窗寬至少 600px 時記分板限寬置中，只多這一條', () => {
    const css = readFileSync(resolve(__dirname, 'live.css'), 'utf8');
    const marker = '@media (min-width: 600px)';
    expect(css.split(marker)).toHaveLength(2);
    const start = css.indexOf(marker);
    const blockEnd = css.indexOf('}', css.indexOf('}', start) + 1);
    const block = css.slice(start, blockEnd + 1);
    expect(block).toContain('.s4-root');
    expect(block).toContain('max-width: 480px');
    expect(block).toContain('margin-inline: auto');
    expect(css.slice(0, start)).not.toContain('max-width: 480px');
    expect(css.slice(0, start)).not.toContain('margin-inline: auto');
  });
});
