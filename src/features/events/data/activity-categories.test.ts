import { describe, expect, it } from 'vitest';
import { getEventIntensity, isIntensityLevel } from './activity-categories';

describe('getEventIntensity 容錯', () => {
  it('undefined、null、BEGINNER、數字都當一般', () => {
    expect(getEventIntensity(undefined)).toBe('');
    expect(getEventIntensity(null)).toBe('');
    expect(getEventIntensity({})).toBe('');
    expect(getEventIntensity({ intensityLevel: undefined })).toBe('');
    expect(getEventIntensity({ intensityLevel: null })).toBe('');
    expect(getEventIntensity({ intensityLevel: 'BEGINNER' })).toBe('');
    expect(getEventIntensity({ intensityLevel: 1 })).toBe('');
    expect(getEventIntensity({ intensityLevel: 0 })).toBe('');
    expect(isIntensityLevel(undefined)).toBe(false);
    expect(isIntensityLevel(null)).toBe(false);
    expect(isIntensityLevel('BEGINNER')).toBe(false);
    expect(isIntensityLevel(1)).toBe(false);
  });

  it('只認目前開放的 beginner 與 high-intensity', () => {
    expect(getEventIntensity({ intensityLevel: 'beginner' })).toBe('beginner');
    expect(getEventIntensity({ intensityLevel: 'high-intensity' })).toBe('high-intensity');
    expect(isIntensityLevel('beginner')).toBe(true);
    expect(isIntensityLevel('high-intensity')).toBe(true);
  });
});
