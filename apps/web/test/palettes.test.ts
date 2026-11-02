import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPalettes } from '../scripts/gen-palettes.mjs';
import { PALETTES, type PaletteColours, DEFAULT_PALETTE, isPalette, paletteById } from '../src/themes/palettes.js';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('colour themes', () => {
  it('offers ten themes with unique ids and a name in English and Arabic', () => {
    expect(PALETTES).toHaveLength(10);
    expect(new Set(PALETTES.map(p => p.id)).size).toBe(10);
    for (const p of PALETTES) {
      expect(p.id).toMatch(/^[a-z][a-z0-9-]{1,30}$/);
      expect(p.name.en.length).toBeGreaterThan(1);
      expect(p.name.ar).toMatch(/[؀-ۿ]/);
    }
  });

  it('starts with the original teal look as the default', () => {
    expect(DEFAULT_PALETTE).toBe('teal');
    expect(paletteById('teal').light.accent).toBe('#08776C');
    expect(paletteById('no-such-theme').id).toBe('teal');
    expect(isPalette('ocean')).toBe(true);
    expect(isPalette('nope')).toBe(false);
  });

  // text on its background, and the accent as text and as a fill, must stay readable in every theme, light and dark
  const rules: [string, (c: PaletteColours) => [string, string], number][] = [
    ['text on the page', c => [c.ink, c.bg], 7],
    ['text on panels', c => [c.ink, c.panel], 7],
    ['text on a selected row', c => [c.ink, c.sel], 7],
    ['text on grey badges', c => [c.ink, c.nBg], 7],
    ['secondary text on the page', c => [c.muted, c.bg], 4.5],
    ['secondary text on panels', c => [c.muted, c.panel], 4.5],
    ['accent as text on panels', c => [c.accent, c.panel], 4.5],
    ['accent as text on the page', c => [c.accent, c.bg], 4.5],
    ['text on an accent button', c => [c.accentInk, c.accent], 4.5],
    ['accent on a selected row', c => [c.accent, c.sel], 3],
  ];
  for (const p of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${p.id} (${mode}) stays readable`, () => {
        for (const [what, pair, need] of rules) {
          const [a, b] = pair(p[mode]);
          expect(contrast(a, b), `${p.id} ${mode}: ${what} (${a} on ${b})`).toBeGreaterThanOrEqual(need);
        }
      });
    }
  }

  // the six WBS level colours (the accent, then five more) must stay apart, or levels look alike in charts
  const hueOf = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const apart = (a: string, b: string) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d); };
  const isGrey = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    return Math.max(r, g, b) - Math.min(r, g, b) < 40;
  };
  for (const p of PALETTES.filter(x => x.id !== 'teal')) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${p.id} (${mode}) keeps the six level colours apart and readable`, () => {
        const c = p[mode];
        expect(c.levels).toHaveLength(5);
        const colours = [c.accent, ...c.levels];
        expect(new Set(colours).size).toBe(6);
        for (const x of c.levels) expect(contrast(x, c.panel), `${p.id} ${mode} level colour ${x}`).toBeGreaterThanOrEqual(3.5);
        const hued = colours.filter(x => !isGrey(x));
        for (let i = 0; i < hued.length; i++) for (let j = i + 1; j < hued.length; j++) {
          expect(apart(hued[i]!, hued[j]!), `${p.id} ${mode}: ${hued[i]} and ${hued[j]}`).toBeGreaterThanOrEqual(20);
        }
      });
    }
  }

  it('has a stylesheet that matches the theme data (run `pnpm --filter @wbs-master/web gen:palettes`)', () => {
    const css = readFileSync(new URL('../src/themes/palettes.css', import.meta.url), 'utf8');
    expect(css).toBe(renderPalettes(PALETTES));
    for (const p of PALETTES) expect(css).toContain(`:root[data-palette="${p.id}"]`);
  });
});
