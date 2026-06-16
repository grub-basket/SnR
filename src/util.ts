export function uid(): string { return Math.random().toString(36).slice(2, 9); }
export function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Render-time defense: a single polygon with tens of thousands of points
 *  would lag SVG paint without crashing. Legitimate use never approaches
 *  this — a hand-drawn cover usually has <20 vertices. The cap is a backstop
 *  against a malicious `.slide-and-reveal.json` shared via a vault, not a
 *  real authoring limit. Data on disk is left untouched; we only clamp at
 *  the SVG points-attribute write. */
export const MAX_POLY_POINTS = 1000;

/** Slice a points array down to MAX_POLY_POINTS. Pass-through if shorter. */
export function clampPoints<T>(pts: T[]): T[] {
  return pts.length > MAX_POLY_POINTS ? pts.slice(0, MAX_POLY_POINTS) : pts;
}
export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}
export function relTo(folder: string, fullPath: string): string {
  if (!folder) return fullPath;
  return fullPath.startsWith(folder + '/') ? fullPath.slice(folder.length + 1) : fullPath;
}
