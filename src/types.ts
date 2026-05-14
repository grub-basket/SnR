export const VIEW_TYPE = 'slide-and-reveal-view';
export const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
export const ANNOT_FILE = '.slide-and-reveal.json';
/** Older name kept around so existing folders auto-migrate on load. */
export const LEGACY_ANNOT_FILE = '.image-annotator.json';

export type ShapeKind = 'rect' | 'polygon';

export interface Point { x: number; y: number; }

export interface Rect {
  id: string;
  kind?: ShapeKind;            // default 'rect' for back-compat
  x: number; y: number; w: number; h: number; // 0..1 (fraction of image dims) — bounding box
  points?: Point[];            // polygon vertices in 0..1 LOCAL to the bbox
  pair: number;                // 0 = unpaired
  seconds: number;             // 0 = use plugin default
  color: string;               // hex
  /** Optional second region pointing at the structure this label refers to.
   *  When set, this cover becomes eligible for cross-diagram quiz mode.
   *  Geometry mirrors a polygon Rect: bbox in image fractions + local points
   *  in 0..1 of that bbox. */
  targetRegion?: TargetRegion;
  /** Who/what authored the target region. Default 'manual'. Reserved for
   *  future image-analysis auto-targeting so inferred regions can be flagged
   *  for user review before counting in quizzes. */
  targetRegionSource?: 'manual' | 'inferred';
  /** Alternate accepted names for this label. Display use today
   *  ("also called: …"); future typed-answer grading will normalize against
   *  [labelText, ...aliases]. Optional. */
  aliases?: string[];
}

/** Polygon region in image-fractional coordinates. Same shape as a polygon
 *  Rect's geometry but standalone (no pair/color/etc). */
export interface TargetRegion {
  x: number; y: number; w: number; h: number; // bbox, 0..1 of image
  points: Point[];                              // vertices, 0..1 LOCAL to bbox
}

/** Persisted per-folder annotation file shape. v1 was a flat
 *  `{ [relPath]: Rect[] }` map; v2 wraps it so we can store an
 *  explicit display order independent of file names. */
export interface FolderData {
  rects: { [relPath: string]: Rect[] };
  order: string[];
  /** Persisted reveal-slider position per image. */
  revealSteps?: { [relPath: string]: number };
  /** Last-known scrollTop of the content pane, so reloads land where you left off. */
  scrollTop?: number;
}

/** How rectangles in the same pair share color when one is changed.
 *   - 'off':           no propagation. Each rect keeps its own color.
 *   - 'first-to-rest': only the first rect in the pair (the leader) pushes
 *                      its color to the others; editing a later member is
 *                      a local change.
 *   - 'all':           every member's color change propagates to the whole
 *                      pair. (Original behavior.)
 */
export type PairColorMode = 'off' | 'first-to-rest' | 'all';

export interface SlideAndRevealSettings {
  defaultSeconds: number;
  defaultColor: string;
  knownFolders: string[];
  imageScale: number;     // % of content width (25–150)
  sidebarWidth: number;   // px
  pairColorMode: PairColorMode;
  /** Which side of each image the reveal rail sits on. */
  railSide: 'left' | 'right';
  /** Left/Right arrow keys nudge zoom in/out. */
  arrowKeysZoom: boolean;
  /** Step (in percentage points) for each arrow-key zoom press. */
  arrowKeysZoomStep: number;
  /** Up/Down arrow keys step the reveal slider on the focused image. */
  arrowKeysReveal: boolean;
  /** Invert the reveal direction (default Up=hide / Down=reveal). */
  arrowKeysRevealInverted: boolean;
  /** How many pixels of wheel-delta count as one reveal step. Higher
   *  values mean a fast wheel needs more travel per step (good for
   *  gaming mice on Windows that fire huge deltas per click). */
  wheelStepThreshold: number;
  /** Mode: 'study' = wheel inside an image steps the reveal slider;
   *  'edit' = wheel is left alone (you scroll, you draw, you stay
   *  out of memorization mode). */
  mode: 'study' | 'edit';
  /** When zoom is past 100% the wheel normally passes through to
   *  native scroll (so you can see the wider image). Turn this on
   *  to keep wheel-steps active even when zoomed past 100%
   *  (only applies in study mode; ignored in edit mode). */
  wheelStepPast100: boolean;
}

export const DEFAULT_SETTINGS: SlideAndRevealSettings = {
  defaultSeconds: 3,
  defaultColor: '#3b82f6',
  knownFolders: [],
  imageScale: 80,
  sidebarWidth: 200,
  pairColorMode: 'all',
  railSide: 'left',
  arrowKeysZoom: true,
  arrowKeysZoomStep: 5,
  arrowKeysReveal: true,
  arrowKeysRevealInverted: false,
  wheelStepThreshold: 60,
  mode: 'study',
  wheelStepPast100: false
};
