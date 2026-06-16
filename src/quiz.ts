/**
 * Cross-diagram quiz mode — pool builder + scope plumbing.
 *
 * The quiz reuses existing cover data: any cover with a `targetRegion` is
 * eligible. The quiz UI shows the cropped target region as the prompt and
 * reveals the original image (with the label uncovered) as the answer.
 *
 * This module is intentionally view-agnostic — it just produces `QuizItem`s
 * from a chosen scope. The view layer (modal / ItemView) consumes them.
 */

import type { App } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';
import { ANNOT_FILE, LEGACY_ANNOT_FILE, IMG_RE, type FolderData, type Rect, type TargetRegion } from './types';
import { joinPath } from './util';

export type QuizScope =
  | { kind: 'folder'; folder: string }
  | { kind: 'folders'; folders: string[] };
  // 'slide' scope is just a folder scope filtered to one image — handled in
  // the caller, not a separate kind, to keep the pool builder small.

export interface QuizItem {
  /** Stable identifier of the source cover. Used as the score-log key. */
  coverId: string;
  /** Vault path of the source image. */
  imagePath: string;
  /** Folder this cover belongs to (the Slide & Reveal folder, not the image's parent). */
  folder: string;
  /** Relative path of the image within its folder — for re-keying into folderData. */
  relPath: string;
  /** Polygon region to crop and show as the quiz prompt. */
  targetRegion: TargetRegion;
  /** Optional aliases for the answer label — display & future grading. */
  aliases?: string[];
  /** The full cover (for revealing on answer + accessing labelRegion geometry). */
  cover: Rect;
}

/** Load a folder's annotation file. Reads the new filename first, falls back
 *  to the legacy one, returns null if neither exists or it's malformed. */
export async function loadFolderData(app: App, folder: string): Promise<FolderData | null> {
  const adapter = app.vault.adapter;
  for (const name of [ANNOT_FILE, LEGACY_ANNOT_FILE]) {
    const path = joinPath(folder, name);
    try {
      if (!(await adapter.exists(path))) continue;
      const raw = await adapter.read(path);
      const parsed = JSON.parse(raw) as FolderData;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Fall through; try the next candidate.
    }
  }
  return null;
}

/** Build a quiz pool from one or more folders. Returns every cover that has
 *  a `targetRegion` set, shuffled. */
export async function buildQuizPool(app: App, scope: QuizScope): Promise<QuizItem[]> {
  const folders = scope.kind === 'folder' ? [scope.folder] : scope.folders;
  const items: QuizItem[] = [];

  for (const folder of folders) {
    const data = await loadFolderData(app, folder);
    if (!data) continue;
    for (const [relPath, covers] of Object.entries(data.rects ?? {})) {
      if (!IMG_RE.test(relPath)) continue;
      for (const cover of covers) {
        if (!cover.targetRegion) continue;
        items.push({
          coverId: cover.id,
          imagePath: joinPath(folder, relPath),
          folder,
          relPath,
          targetRegion: cover.targetRegion,
          aliases: cover.aliases,
          cover,
        });
      }
    }
  }

  return shuffle(items);
}

/** Filter a pre-built pool down to a single image. Used for the "this slide"
 *  scope: caller builds the folder pool, then narrows. */
export function filterToImage(pool: QuizItem[], imagePath: string): QuizItem[] {
  return pool.filter(item => item.imagePath === imagePath);
}

/** Fisher-Yates. */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Resolve a vault folder path to a TFolder if it exists, else null. */
export function getFolder(app: App, path: string): TFolder | null {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFolder ? f : null;
}

/** Resolve an image vault path to a TFile, else null. */
export function getImage(app: App, path: string): TFile | null {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? f : null;
}

/** Convenience: warn the user if the pool is empty and explain why. */
export function warnIfEmpty(pool: QuizItem[]): boolean {
  if (pool.length > 0) return false;
  new Notice(
    'No quiz items found. Add a target region to a cover (click the cover, then "Add target region") to include it in the quiz.',
    6000,
  );
  return true;
}
