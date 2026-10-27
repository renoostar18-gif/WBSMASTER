import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/next.js';

describe('safeNext', () => {
  it('keeps pages of this site', () => {
    expect(safeNext('/invite/abc_DEF-123')).toBe('/invite/abc_DEF-123');
    expect(safeNext('/billing/x?payment=paid')).toBe('/billing/x?payment=paid');
  });

  it('refuses other sites and odd paths', () => {
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\\/evil.example', '/x\\y', '/\tevil', 'javascript:alert(1)']) {
      expect(safeNext(bad), String(bad)).toBe('/');
    }
  });
});
