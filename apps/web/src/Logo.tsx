/**
 * The WBS Master mark: a feather whose vanes are schedule bars (Raysha, ريشة, means feather).
 * It is drawn in one colour, `currentColor`, so it follows the colour theme. `faviconHref` makes the
 * same drawing as a browser-tab icon.
 */
const SPINE = { x: 30.5, y: 5, w: 3, h: 55 };
/** One row of vanes: top, the left bar's x and width, and the right bar's width (the right bar starts at x 33). */
const ROWS: [number, number, number, number][] = [[8, 26, 5, 9], [17, 19, 12, 16], [26, 14, 17, 20], [35, 16, 15, 18], [44, 22, 9, 11]];
const TILT = 'rotate(24 32 32)';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <g transform={TILT} fill="currentColor">
        <rect x={SPINE.x} y={SPINE.y} width={SPINE.w} height={SPINE.h} rx="1.5" />
        {ROWS.map(([y, lx, lw, rw]) => (
          <g key={y}>
            <rect x={lx} y={y} width={lw} height="6" rx="3" opacity=".7" />
            <rect x="33" y={y} width={rw} height="6" rx="3" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** The mark as a data address for `<link rel="icon">`, in the given colour. */
export function faviconHref(colour: string): string {
  const bars = ROWS.map(([y, lx, lw, rw]) => `<rect x="${lx}" y="${y}" width="${lw}" height="6" rx="3" opacity=".7"/><rect x="33" y="${y}" width="${rw}" height="6" rx="3"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="${TILT}" fill="${colour}"><rect x="${SPINE.x}" y="${SPINE.y}" width="${SPINE.w}" height="${SPINE.h}" rx="1.5"/>${bars}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Colour the browser-tab icon with the accent of the theme now showing. */
export function syncFavicon(): void {
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  link.href = faviconHref(colour);
}
