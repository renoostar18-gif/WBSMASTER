import { describe, expect, it } from 'vitest';
import { faviconHref } from '../src/Logo.js';

describe('the tab icon', () => {
  const svg = (colour: string) => decodeURIComponent(faviconHref(colour).replace('data:image/svg+xml,', ''));

  it('is a self-contained image in the colour it is given', () => {
    const s = svg('#1661B6');
    expect(faviconHref('#1661B6')).toMatch(/^data:image\/svg\+xml,/);
    expect(s).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(s).toContain('fill="#1661B6"');
    expect(s).not.toContain('currentColor');
  });

  it('draws the spine and ten vanes (five a side) with nothing outside the 64-unit square', () => {
    const s = svg('#08776C');
    expect((s.match(/<rect /g) ?? []).length).toBe(11);
    expect(s).toContain('viewBox="0 0 64 64"');
  });
});
