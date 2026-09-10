import type { DataAdapter } from 'obsidian';
import { ANNOT_FILE, LEGACY_ANNOT_FILE, type FolderData, type Point, type Rect } from './types';
import { joinPath, safeColor, uid } from './util';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fraction = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const points = (v: unknown): v is Point[] => Array.isArray(v) && v.length >= 3
  && v.every(p => record(p) && fraction(p.x) && fraction(p.y));
const box = (v: Record<string, unknown>) => fraction(v.x) && fraction(v.y)
  && fraction(v.w) && v.w > 0 && fraction(v.h) && v.h > 0;
const relativePath = (v: unknown): v is string => typeof v === 'string' && !!v
  && !v.startsWith('/') && !v.includes('\\') && !v.split('/').some(p => p === '..' || p === '.' || !p);

export function emptyAnnotations(): FolderData {
  return { rects: Object.create(null), order: [], revealSteps: Object.create(null) };
}

/** Quiz readers can use valid entries; editors must not overwrite a partly invalid file. */
export function parseAnnotations(raw: string): { data: FolderData; valid: boolean } {
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error('Invalid annotation document');
  const modern = 'rects' in parsed || 'order' in parsed;
  const source = modern ? parsed.rects : parsed;
  if (!record(source) || (modern && !Array.isArray(parsed.order))) throw new Error('Invalid annotation document');
  const data = emptyAnnotations();
  let valid = true;
  for (const [path, entries] of Object.entries(source)) {
    if (!relativePath(path) || !Array.isArray(entries)) { valid = false; continue; }
    const covers: Rect[] = [];
    const ids = new Set<string>();
    for (const value of entries) {
      if (!record(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id) || !box(value)
          || (value.kind !== undefined && value.kind !== 'rect' && value.kind !== 'polygon')
          || (value.kind === 'polygon' && !points(value.points))) { valid = false; continue; }
      ids.add(value.id);
      const cover = { ...value, color: safeColor(value.color), pair: 0, seconds: 0 } as unknown as Rect;
      if (value.pair !== undefined && (!finite(value.pair) || value.pair < 0 || !Number.isInteger(value.pair))) valid = false;
      else cover.pair = (value.pair as number | undefined) ?? 0;
      if (value.seconds !== undefined && (!finite(value.seconds) || value.seconds < 0)) valid = false;
      else cover.seconds = (value.seconds as number | undefined) ?? 0;
      if (value.targetRegion !== undefined && (!record(value.targetRegion) || !box(value.targetRegion) || !points(value.targetRegion.points))) {
        delete cover.targetRegion; valid = false;
      }
      if (value.aliases !== undefined && (!Array.isArray(value.aliases) || !value.aliases.every(a => typeof a === 'string'))) {
        delete cover.aliases; valid = false;
      }
      covers.push(cover);
    }
    data.rects[path] = covers;
  }
  const order = modern ? parsed.order as unknown[] : Object.keys(data.rects).sort();
  data.order = [...new Set(order.filter(relativePath))];
  if (data.order.length !== order.length) valid = false;
  if (modern && parsed.revealSteps !== undefined) {
    if (!record(parsed.revealSteps)) valid = false;
    else for (const [path, step] of Object.entries(parsed.revealSteps)) {
      if (relativePath(path) && finite(step) && Number.isInteger(step) && step >= 0) data.revealSteps![path] = step;
      else valid = false;
    }
  }
  if (modern && parsed.scrollTop !== undefined) {
    if (finite(parsed.scrollTop) && parsed.scrollTop >= 0) data.scrollTop = parsed.scrollTop;
    else valid = false;
  }
  return { data, valid };
}

export interface AnnotationRevision { path: string; raw: string | null }

export async function readAnnotationRevision(adapter: DataAdapter, folder: string): Promise<AnnotationRevision> {
  for (const name of [ANNOT_FILE, LEGACY_ANNOT_FILE]) {
    const path = joinPath(folder, name);
    if (await adapter.exists(path)) return { path, raw: await adapter.read(path) };
  }
  return { path: joinPath(folder, ANNOT_FILE), raw: null };
}

/** Serialize this plugin's writers, then compare the file with what the view loaded.
 * External writers aren't locked by the adapter, so never claim filesystem-wide atomicity. */
export class AnnotationStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private adapter: DataAdapter) {}

  private run<T>(folder: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(folder) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(folder, next);
    void next.finally(() => { if (this.queues.get(folder) === next) this.queues.delete(folder); }).catch(() => {});
    return next;
  }

  load(folder: string): Promise<{ revision: AnnotationRevision; data: FolderData; valid: boolean }> {
    return this.run(folder, async () => {
      const revision = await readAnnotationRevision(this.adapter, folder);
      return { revision, ...(revision.raw === null ? { data: emptyAnnotations(), valid: true } : parseAnnotations(revision.raw)) };
    });
  }

  save(folder: string, expected: AnnotationRevision, raw: string): Promise<AnnotationRevision> {
    return this.run(folder, async () => {
      const current = await readAnnotationRevision(this.adapter, folder);
      if (current.path !== expected.path || current.raw !== expected.raw) {
        throw new Error('Annotations changed on disk or in another view. Saving is paused to protect those changes.');
      }
      const path = joinPath(folder, ANNOT_FILE);
      await this.adapter.write(path, raw);
      return { path, raw };
    });
  }

  /** Preserve both generations, so a legacy file cannot silently resurrect covers. */
  archive(folder: string): Promise<void> {
    return this.run(folder, async () => {
      const suffix = `.backup-${Date.now()}-${uid()}`;
      for (const name of [ANNOT_FILE, LEGACY_ANNOT_FILE]) {
        const path = joinPath(folder, name);
        if (await this.adapter.exists(path)) await this.adapter.rename(path, path + suffix);
      }
    });
  }
}
