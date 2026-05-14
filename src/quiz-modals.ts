/**
 * Cross-diagram quiz mode — UI layer.
 *
 * `ScopePickerModal` asks the user how wide a pool to draw from (this slide,
 * this folder, or a set of folders). `QuizModal` runs the actual quiz: it
 * shows the cropped target region as the prompt and reveals the source image
 * with the relevant label highlighted as the answer.
 *
 * Pool building lives in `quiz.ts`; this file is just glue and DOM.
 */

import { App, Modal, Notice, Setting, TFile, setIcon } from 'obsidian';
import type SlideAndRevealPlugin from './main';
import type { Rect } from './types';
import { VIEW_TYPE } from './types';
import {
  buildQuizPool,
  filterToImage,
  getImage,
  loadFolderData,
  warnIfEmpty,
  type QuizItem,
  type QuizScope,
} from './quiz';
import type { FolderData } from './types';
import type { SlideAndRevealView } from './view';

/** Try to find an active Slide & Reveal view so the modal can default
 *  scopes like "this slide" / "this folder" to its current context. */
export function activeSnRView(app: App): SlideAndRevealView | null {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE);
  // Prefer the currently active leaf if it's an S&R view; fall back to any.
  const active = app.workspace.activeLeaf;
  if (active && leaves.includes(active)) return active.view as SlideAndRevealView;
  return leaves[0] ? (leaves[0].view as SlideAndRevealView) : null;
}

/** Delegate to the view's own focus logic so the "this slide" scope agrees
 *  with the focused-block outline in the UI. */
function currentImagePath(view: SlideAndRevealView | null): string | null {
  return view ? view.getFocusedImagePath() : null;
}

/** Scope picker. Three buttons; "Multiple folders…" routes to a
 *  checkbox-list picker. */
export class ScopePickerModal extends Modal {
  constructor(private plugin: SlideAndRevealPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText('Quiz: choose scope');
    contentEl.empty();
    contentEl.createEl('p', {
      text: 'Pull labels from where? Only covers that have a target region count — add one via the crosshair button on a cover.',
    });

    const view = activeSnRView(this.app);
    const imagePath = currentImagePath(view);
    const folder = view?.folderPath ?? null;
    const knownFolders = this.plugin.settings.knownFolders.slice();

    const btnRow = contentEl.createDiv({ cls: 'sNr-quiz-scope-row' });

    const slideBtn = btnRow.createEl('button', { text: 'This slide' });
    slideBtn.title = imagePath
      ? `Pool: labels on ${imagePath}`
      : 'Open a Slide & Reveal view first.';
    slideBtn.disabled = !imagePath || !folder;
    slideBtn.onclick = async () => {
      if (!imagePath || !folder) return;
      const pool = filterToImage(
        await buildQuizPool(this.app, { kind: 'folder', folder }),
        imagePath,
      );
      if (warnIfEmpty(pool)) return;
      this.close();
      new QuizModal(this.plugin, pool, `this slide (${imagePath.split('/').pop()})`).open();
    };

    const folderBtn = btnRow.createEl('button', { text: 'This folder' });
    folderBtn.title = folder
      ? `Pool: labels across all slides in ${folder}`
      : 'Open a Slide & Reveal view first.';
    folderBtn.disabled = !folder;
    folderBtn.onclick = async () => {
      if (!folder) return;
      const pool = await buildQuizPool(this.app, { kind: 'folder', folder });
      if (warnIfEmpty(pool)) return;
      this.close();
      new QuizModal(this.plugin, pool, folder).open();
    };

    const multiBtn = btnRow.createEl('button', { text: 'Multiple folders…' });
    multiBtn.title = knownFolders.length
      ? `Pool: union of selected folders (${knownFolders.length} available)`
      : 'No known folders yet.';
    multiBtn.disabled = knownFolders.length === 0;
    multiBtn.onclick = () => {
      this.close();
      new MultiFolderPickerModal(this.plugin, knownFolders, folder).open();
    };

    contentEl.createDiv({
      cls: 'sNr-quiz-scope-hint',
      text: 'Tip: each quiz item is one cover with a target region. Without target regions, the pool is empty.',
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

/** Checkbox list of known folders. "Start" builds a multi-folder pool. */
export class MultiFolderPickerModal extends Modal {
  private picked = new Set<string>();
  constructor(
    private plugin: SlideAndRevealPlugin,
    private folders: string[],
    private defaultFolder: string | null,
  ) {
    super(plugin.app);
    if (defaultFolder) this.picked.add(defaultFolder);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText('Quiz: pick folders');
    contentEl.empty();

    const list = contentEl.createDiv({ cls: 'sNr-quiz-folder-list' });
    for (const f of this.folders) {
      new Setting(list)
        .setName(f)
        .addToggle((t) => {
          t.setValue(this.picked.has(f));
          t.onChange((v) => {
            if (v) this.picked.add(f); else this.picked.delete(f);
          });
        });
    }

    const row = contentEl.createDiv({ cls: 'sNr-quiz-scope-row' });
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const start = row.createEl('button', { text: 'Start quiz', cls: 'mod-cta' });
    start.onclick = async () => {
      const folders = Array.from(this.picked);
      if (!folders.length) { new Notice('Pick at least one folder.'); return; }
      const scope: QuizScope = { kind: 'folders', folders };
      const pool = await buildQuizPool(this.app, scope);
      if (warnIfEmpty(pool)) return;
      this.close();
      const label = folders.length === 1 ? folders[0] : `${folders.length} folders`;
      new QuizModal(this.plugin, pool, label).open();
    };
  }

  onClose(): void { this.contentEl.empty(); }
}

/** The quiz runner. Each item shows the cropped target region as the prompt;
 *  "Show answer" replaces it with the full image and a highlight around the
 *  cover (the label position) plus any aliases. "Next" advances. */
export class QuizModal extends Modal {
  private index = 0;
  private revealed = false;
  private rightCount = 0;
  private wrongCount = 0;
  /** Current view mode for the stage area. 'cropped' zooms into whichever
   *  region is relevant for the current step (target while prompting, cover
   *  while showing the answer — labels are easier to read up close). 'full'
   *  shows the whole source image with that region outlined. Sticky across
   *  steps so the user can pick a preference and keep it. */
  private viewMode: 'cropped' | 'full' = 'cropped';

  /** Per-folder annotation cache. The full-image preview overlays *all*
   *  cover concealers (otherwise the user could just read every label in
   *  the image and cheat the quiz). Loading happens lazily and is cached
   *  for the lifetime of the modal — pool building has already touched
   *  the same files, but those calls were one-shot. */
  private folderCache = new Map<string, FolderData | null>();

  private async coversFor(item: QuizItem): Promise<Rect[]> {
    let fd = this.folderCache.get(item.folder);
    if (fd === undefined) {
      fd = await loadFolderData(this.app, item.folder);
      this.folderCache.set(item.folder, fd);
    }
    if (!fd) return [];
    return fd.rects?.[item.relPath] ?? [];
  }

  constructor(
    private plugin: SlideAndRevealPlugin,
    private pool: QuizItem[],
    private scopeLabel: string,
  ) {
    super(plugin.app);
    this.modalEl.addClass('sNr-quiz-modal');
  }

  onOpen(): void { this.renderStep(); }
  onClose(): void { this.contentEl.empty(); }

  private renderStep(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(
      `Quiz — ${this.scopeLabel} — ${this.index + 1} / ${this.pool.length}`,
    );

    const item = this.pool[this.index];
    if (!item) { this.renderDone(); return; }

    const stage = contentEl.createDiv({ cls: 'sNr-quiz-stage' });
    if (this.revealed) {
      this.renderAnswer(stage, item);
    } else {
      this.renderPrompt(stage, item);
    }

    // View-mode toggle: zoomed crop vs. full image with highlight. Sits
    // between the stage and the action buttons so it always relates to
    // the visible content.
    const modeRow = contentEl.createDiv({ cls: 'sNr-quiz-mode-row' });
    const toggleBtn = modeRow.createEl('button', { cls: 'sNr-quiz-mode-toggle' });
    const cropped = this.viewMode === 'cropped';
    const subject = this.revealed ? 'label' : 'target';
    setIcon(toggleBtn, cropped ? 'maximize-2' : 'minimize-2');
    toggleBtn.appendChild(document.createTextNode(
      cropped ? `  Show whole image (with ${subject} outlined)` : `  Show only the ${subject}`,
    ));
    toggleBtn.title = 'Toggle between zoomed-in crop and the full image';
    toggleBtn.onclick = () => {
      this.viewMode = cropped ? 'full' : 'cropped';
      this.renderStep();
    };

    const controls = contentEl.createDiv({ cls: 'sNr-quiz-controls' });
    if (!this.revealed) {
      const btn = controls.createEl('button', { text: 'Show answer', cls: 'mod-cta' });
      btn.onclick = () => { this.revealed = true; this.renderStep(); };
    } else {
      // Self-grade buttons (the v2 score log spec will read these, but for
      // now they just feed a session-only counter shown on Done).
      const wrong = controls.createEl('button', { cls: 'sNr-quiz-wrong' });
      setIcon(wrong, 'x'); wrong.appendChild(document.createTextNode(' Missed it'));
      wrong.onclick = () => { this.wrongCount++; this.advance(); };

      const right = controls.createEl('button', { cls: 'sNr-quiz-right mod-cta' });
      setIcon(right, 'check'); right.appendChild(document.createTextNode(' Got it'));
      right.onclick = () => { this.rightCount++; this.advance(); };
    }

    const meta = contentEl.createDiv({ cls: 'sNr-quiz-meta' });
    meta.setText(`From: ${item.imagePath}`);
  }

  private renderPrompt(stage: HTMLElement, item: QuizItem): void {
    stage.createDiv({ cls: 'sNr-quiz-question', text: 'What is this?' });
    if (this.viewMode === 'cropped') {
      this.renderCroppedRegion(stage, item, item.targetRegion);
    } else {
      // Full-image mode: highlight the target region rather than the cover.
      this.renderFullWithOutline(stage, item, item.targetRegion);
    }
  }

  /** Position and scale `img` inside `cropBox` so the (x,y,w,h) fractional
   *  region of the source fills the box without distortion. */
  private applyCrop(
    cropBox: HTMLElement,
    img: HTMLImageElement,
    x: number, y: number, w: number, h: number,
  ): void {
    const natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW || !natH) return;
    const bboxW = natW * w, bboxH = natH * h;
    // Available room. The modal is fluid — we cap by viewport.
    const MAX_W = Math.min(640, window.innerWidth - 120);
    const MAX_H = Math.min(420, window.innerHeight - 280);
    const scale = Math.min(MAX_W / bboxW, MAX_H / bboxH);
    const dispW = bboxW * scale, dispH = bboxH * scale;
    cropBox.style.width = dispW + 'px';
    cropBox.style.height = dispH + 'px';
    img.style.width = (natW * scale) + 'px';
    img.style.height = (natH * scale) + 'px';
    img.style.left = (-x * natW * scale) + 'px';
    img.style.top = (-y * natH * scale) + 'px';
  }

  private renderAnswer(stage: HTMLElement, item: QuizItem): void {
    const wrap = stage.createDiv({ cls: 'sNr-quiz-answer' });
    // Use the cover's bbox as the "region" for both modes — cropping to it
    // makes the label text readable; outlining it on the full image shows
    // where the label sits.
    const coverRegion = {
      x: item.cover.x, y: item.cover.y, w: item.cover.w, h: item.cover.h,
    };
    if (this.viewMode === 'cropped') {
      this.renderCroppedRegion(wrap, item, coverRegion);
    } else {
      this.renderFullWithOutline(wrap, item, coverRegion, /* outlineCover */ true);
    }

    if (item.aliases && item.aliases.length) {
      const aliases = wrap.createDiv({ cls: 'sNr-quiz-aliases' });
      aliases.setText('Also called: ' + item.aliases.join(', '));
    }
  }

  /** Shared crop renderer: shows the (x,y,w,h) region of the source image
   *  filling a box, aspect-preserved. A small margin is added on each side
   *  so the cropped view has some breathing room — text near the edge of
   *  a tight cover bbox would otherwise touch the crop boundary and feel
   *  cut off even though it's technically inside. */
  private renderCroppedRegion(
    parent: HTMLElement,
    item: QuizItem,
    region: { x: number; y: number; w: number; h: number },
  ): void {
    const tFile = getImage(this.app, item.imagePath);
    if (!tFile) { parent.createDiv({ text: 'Image missing: ' + item.imagePath }); return; }
    const cropBox = parent.createDiv({ cls: 'sNr-quiz-crop' });
    const img = cropBox.createEl('img');
    img.src = this.app.vault.getResourcePath(tFile);
    // Pad each side by 12% of the region's own dimension, clamped to the
    // image bounds. Padding scales with region size so small labels get a
    // generous halo and big regions barely change.
    const PAD = 0.12;
    const padX = region.w * PAD;
    const padY = region.h * PAD;
    const x = Math.max(0, region.x - padX);
    const y = Math.max(0, region.y - padY);
    const w = Math.min(1 - x, region.w + 2 * padX);
    const h = Math.min(1 - y, region.h + 2 * padY);
    img.onload = () => this.applyCrop(cropBox, img, x, y, w, h);
  }

  /** Full image with a colored outline around the focal region. If
   *  `outlineCover` is true we render the cover polygon outline (matches
   *  the cover's actual shape); otherwise a plain rectangle outline of
   *  the bbox is sufficient (used for the target region in prompt mode). */
  private renderFullWithOutline(
    parent: HTMLElement,
    item: QuizItem,
    region: { x: number; y: number; w: number; h: number },
    outlineCover: boolean = false,
  ): void {
    const tFile = getImage(this.app, item.imagePath);
    if (!tFile) { parent.createDiv({ text: 'Image missing: ' + item.imagePath }); return; }
    const imgWrap = parent.createDiv({ cls: 'sNr-quiz-answer-img' });
    const img = imgWrap.createEl('img');
    img.src = this.app.vault.getResourcePath(tFile);
    img.onload = async () => {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const MAX_W = Math.min(720, window.innerWidth - 120);
      const MAX_H = Math.min(520, window.innerHeight - 280);
      const scale = Math.min(MAX_W / natW, MAX_H / natH);
      const dispW = natW * scale, dispH = natH * scale;
      imgWrap.style.width = dispW + 'px';
      imgWrap.style.height = dispH + 'px';
      img.style.width = dispW + 'px';
      img.style.height = dispH + 'px';

      // Render concealer overlays so the user can't just read every label
      // when in full-image mode. In prompt mode (outlineCover=false), keep
      // every cover concealed. In answer mode (outlineCover=true), the
      // cover being asked about is shown as an outline only — every other
      // cover stays concealed so unrelated labels don't leak.
      const covers = await this.coversFor(item);
      for (const c of covers) {
        const isAnswer = outlineCover && c.id === item.cover.id;
        if (isAnswer) {
          this.drawAnswerOverlay(imgWrap, c);
        } else {
          this.renderConcealer(imgWrap, c);
        }
      }

      if (!outlineCover) {
        // Prompt: also draw the target region outline so the user knows
        // which part of the (still-fully-concealed) image they're being
        // asked to identify.
        const box = imgWrap.createDiv({ cls: 'sNr-quiz-label-outline-rect' });
        box.style.left = (region.x * 100) + '%';
        box.style.top = (region.y * 100) + '%';
        box.style.width = (region.w * 100) + '%';
        box.style.height = (region.h * 100) + '%';
        box.style.borderColor = item.cover.color || this.plugin.settings.defaultColor;
      }
    };
  }

  /** Opaque concealer overlay matching a cover's shape (rect or polygon).
   *  Used in full-image quiz previews so labels under unrelated covers
   *  don't leak into the user's view. */
  private renderConcealer(host: HTMLElement, cover: Rect): void {
    const color = cover.color || this.plugin.settings.defaultColor;
    const wrap = host.createDiv({ cls: 'sNr-quiz-concealer' });
    wrap.style.left = (cover.x * 100) + '%';
    wrap.style.top = (cover.y * 100) + '%';
    wrap.style.width = (cover.w * 100) + '%';
    wrap.style.height = (cover.h * 100) + '%';
    if (cover.kind === 'polygon' && cover.points) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', cover.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' '));
      poly.style.fill = color;
      svg.appendChild(poly);
      wrap.appendChild(svg);
    } else {
      wrap.style.background = color;
    }
  }

  /** Outline the cover (label region) on the answer image. Polygon if the
   *  cover has points; bbox rectangle otherwise. */
  private drawAnswerOverlay(host: HTMLElement, cover: Rect): void {
    const color = cover.color || this.plugin.settings.defaultColor;
    if (cover.kind === 'polygon' && cover.points) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('sNr-quiz-label-outline');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const pts = cover.points.map((p) => {
        const xx = (cover.x + p.x * cover.w) * 100;
        const yy = (cover.y + p.y * cover.h) * 100;
        return `${xx},${yy}`;
      }).join(' ');
      poly.setAttribute('points', pts);
      poly.style.stroke = color;
      svg.appendChild(poly);
      host.appendChild(svg);
    } else {
      const box = host.createDiv({ cls: 'sNr-quiz-label-outline-rect' });
      box.style.left = (cover.x * 100) + '%';
      box.style.top = (cover.y * 100) + '%';
      box.style.width = (cover.w * 100) + '%';
      box.style.height = (cover.h * 100) + '%';
      box.style.borderColor = color;
    }
  }

  private advance(): void {
    this.index++;
    this.revealed = false;
    this.renderStep();
  }

  private renderDone(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText('Quiz complete');
    const done = contentEl.createDiv({ cls: 'sNr-quiz-done' });
    const total = this.rightCount + this.wrongCount;
    const pct = total === 0 ? 0 : Math.round(100 * this.rightCount / total);
    done.createEl('p', { text: `Got ${this.rightCount} of ${total} (${pct}%).` });
    done.createEl('p', {
      cls: 'sNr-quiz-done-note',
      text: 'Score log persistence is a v2 feature — this result is session-only.',
    });
    const row = contentEl.createDiv({ cls: 'sNr-quiz-controls' });
    const again = row.createEl('button', { text: 'Restart (reshuffle)', cls: 'mod-cta' });
    again.onclick = () => {
      // Reshuffle in place.
      for (let i = this.pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
      }
      this.index = 0;
      this.revealed = false;
      this.rightCount = 0;
      this.wrongCount = 0;
      this.renderStep();
    };
    const close = row.createEl('button', { text: 'Close' });
    close.onclick = () => this.close();
  }
}
