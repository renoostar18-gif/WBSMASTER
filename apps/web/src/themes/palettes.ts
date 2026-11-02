import data from './palettes.json';

/** Colours for one mode of a theme. These become the tokens in styles.css (see scripts/gen-palettes.mjs). */
export interface PaletteColours {
  bg: string; panel: string; ink: string; muted: string; line: string; line2: string;
  accent: string; accentInk: string; sel: string; nBg: string;
  /** Colours for WBS levels 2 to 6 (level 1 uses the accent). */
  levels: string[];
}
export interface Palette { id: string; name: { en: string; ar: string }; light: PaletteColours; dark: PaletteColours }

/** The colour themes people can choose, in the order shown. The first is the default (the original look). */
export const PALETTES: Palette[] = data as Palette[];
export const DEFAULT_PALETTE = PALETTES[0]!.id;
const STORE_KEY = 'wbs.palette';

export const isPalette = (id: unknown): id is string => typeof id === 'string' && PALETTES.some(p => p.id === id);
export const paletteById = (id: string): Palette => PALETTES.find(p => p.id === id) ?? PALETTES[0]!;

/** The theme this browser last used. */
export function storedPalette(): string {
  try { const v = localStorage.getItem(STORE_KEY); if (isPalette(v)) return v; } catch { /* storage blocked */ }
  return DEFAULT_PALETTE;
}

/** Show a theme now and remember it in this browser. */
export function applyPalette(id: string): void {
  const palette = isPalette(id) ? id : DEFAULT_PALETTE;
  document.documentElement.dataset.palette = palette;
  try { localStorage.setItem(STORE_KEY, palette); } catch { /* storage blocked */ }
}

/** Before the first paint: use the remembered theme, so the page does not open in teal and then change. */
export function initPalette(): void {
  document.documentElement.dataset.palette = storedPalette();
}
