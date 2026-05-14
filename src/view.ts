import { ItemView, Notice, Scope, TAbstractFile, TFile, TFolder, WorkspaceLeaf, ViewStateResult, setIcon } from 'obsidian';
import type SlideAndRevealPlugin from './main';
import { VIEW_TYPE, IMG_RE, ANNOT_FILE, LEGACY_ANNOT_FILE, FolderData, Rect, Point, TargetRegion } from './types';
import { clamp01, joinPath, relTo, uid } from './util';
import { RenameModal } from './modals';
import { ScopePickerModal } from './quiz-modals';

type UndoOp =
  | { type: 'data'; snap: string }
  | { type: 'rename'; oldPath: string; newPath: string };

/** Destination for a polygon draft. 'newShape' (default) means the finalize
 *  step creates a new polygon cover. 'target' means we're drawing a
 *  targetRegion for an existing cover (cross-diagram quiz authoring). */
type PolyDraftDestination =
  | { kind: 'newShape' }
  | { kind: 'target'; coverId: string };

interface PolyDraft {
  file: TFile;
  canvas: HTMLElement;
  block: HTMLElement;
  points: Point[]; // canvas-relative 0..1
  svg: SVGSVGElement;
  poly: SVGPolylineElement;
  cleanup: () => void;
  destination: PolyDraftDestination;
}

export class SlideAndRevealView extends ItemView {
  plugin: SlideAndRevealPlugin;
  folderPath = '';
  folderData: FolderData = { rects: {}, order: [], revealSteps: {} };
  timers = new Map<string, number>();
  drawingPaths = new Set<string>();           // rectangle draw mode
  polyDrawingPaths = new Set<string>();        // polygon draw mode
  saveQueued = false;

  /** When non-null, the user is mid-draft of a target region for this cover
   *  (cross-diagram quiz authoring). Routes canvas clicks to addPolyPoint
   *  even when polyDrawingPaths doesn't include the image. */
  private targetDraftCoverId: string | null = null;

  // Layout refs
  private scrollerEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private headerToolsEl!: HTMLElement;

  // Polygon draft state
  private polyDraft: PolyDraft | null = null;

  // Undo / redo. Two op types: a folderData snapshot, or a vault file
  // rename (so undoing the rename actually moves the file back).
  private undoStack: UndoOp[] = [];
  private redoStack: UndoOp[] = [];
  private MAX_HISTORY = 50;

  // Reveal-progress slider state lives on folderData.revealSteps, keyed by
  // image relPath. Don't keep a parallel in-memory map — it drifts out of
  // sync after undo/redo restores folderData from a snapshot.

  // Source path of the thumbnail currently being dragged (fallback for
  // dataTransfer in case the browser strips text/plain).
  private draggingThumbPath: string | null = null;

  // Currently selected shape (set by selectShape, cleared on render and
  // by the floating-toolbar offClick). Used by the Delete/Backspace
  // keyboard shortcut to know what to remove.
  private selection: { canvas: HTMLElement; file: TFile; rect: Rect; el: HTMLElement } | null = null;

  /** Parallel selection for target regions. Lives separately because a
   *  target region isn't a Rect — it's a sub-field of its owning cover. */
  private targetSelection: {
    canvas: HTMLElement; file: TFile; cover: Rect; el: HTMLElement;
  } | null = null;

  /** Tracks the most recently-attached body-level mousedown listener used
   *  by selectShape / selectTargetRegion. We remove it before adding a new
   *  one — otherwise stale listeners from a previous selection fire on the
   *  next click and tear down the new toolbar before its buttons' click
   *  events can fire. */
  private currentOffClick: ((e: MouseEvent) => void) | null = null;

  // Scope used to claim Escape from Obsidian's keymap whenever this view
  // is the active one. Pushed/popped on active-leaf changes.
  private escScope!: Scope;
  private escScopePushed = false;

  constructor(leaf: WorkspaceLeaf, plugin: SlideAndRevealPlugin) {
    super(leaf);
    this.plugin = plugin;
    // Build the Esc-swallowing scope once. We push it on the global keymap
    // stack only while this view is the active one, so other apps/tabs
    // still get Esc.
    this.escScope = new Scope(this.app.scope);
    this.escScope.register([], 'Escape', (e) => {
      e.preventDefault();
      return false; // tell Obsidian we consumed it
    });
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.folderPath ? `Slide & Reveal: ${this.folderPath}` : 'Slide & Reveal'; }
  getIcon(): string { return 'image'; }

  getState(): Record<string, unknown> {
    const s = (super.getState() as Record<string, unknown>) || {};
    s.folderPath = this.folderPath;
    return s;
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as { folderPath?: string };
    if (s && typeof s.folderPath === 'string') {
      this.folderPath = s.folderPath;
      await this.loadFolderData();
      this.undoStack = [];
      this.redoStack = [];
      this.render();
    }
    return super.setState(state, result);
  }

  /** Push/pop the Esc-swallowing scope based on whether this view is
   *  currently the active workspace leaf. */
  private syncEscScope(): void {
    const active = this.app.workspace.getActiveViewOfType(SlideAndRevealView) === this;
    if (active && !this.escScopePushed) {
      this.app.keymap.pushScope(this.escScope);
      this.escScopePushed = true;
    } else if (!active && this.escScopePushed) {
      this.app.keymap.popScope(this.escScope);
      this.escScopePushed = false;
    }
  }

  async onOpen(): Promise<void> {
    this.render();
    // Esc handling: combine the keymap scope (the proper Obsidian way to
    // claim a hotkey) with the document capture-phase listener below as
    // a backup.
    this.syncEscScope();
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncEscScope()));

    // Trackpad pinch / Ctrl+wheel zooms anywhere in the view. Bind on
    // containerEl so it works over the sidebar, header, content pane,
    // canvas, etc. — wherever the user happens to gesture.
    this.registerDomEvent(this.containerEl, 'wheel', (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // 0.3 chosen empirically: a normal-strength pinch nudges 1–3% per
      // event without making aggressive pinches overshoot.
      const cur = this.plugin.settings.imageScale;
      this.setImageScale(cur - e.deltaY * 0.3, true);
    }, { passive: false });

    const refresh = (f: TAbstractFile) => {
      if (f instanceof TFile && IMG_RE.test(f.path)) this.render();
    };
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));

    // Rename: remap folderData keys for images that move within our folder
    this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;
      const inFolderNow = this.folderPath && (file.path === this.folderPath || file.path.startsWith(this.folderPath + '/'));
      const wasInFolder = this.folderPath && (oldPath === this.folderPath || oldPath.startsWith(this.folderPath + '/'));
      if (!inFolderNow && !wasInFolder) return;
      if (IMG_RE.test(oldPath) || IMG_RE.test(file.path)) {
        const oldKey = relTo(this.folderPath, oldPath);
        const newKey = relTo(this.folderPath, file.path);
        if (oldKey !== newKey) {
          if (this.folderData.rects[oldKey]) {
            this.folderData.rects[newKey] = this.folderData.rects[oldKey];
            delete this.folderData.rects[oldKey];
          }
          // Preserve display position by renaming the entry in `order`.
          const idx = this.folderData.order.indexOf(oldKey);
          if (idx >= 0) this.folderData.order[idx] = newKey;
          this.saveFolderData();
        }
        this.render();
      }
    }));

    // Escape needs a CAPTURE-phase listener at the document level — Obsidian
    // registers its own tab-switch handler that fires before our bubble-phase
    // containerEl listener could. This catches Escape first whenever the
    // event originates inside our view, then stops everything (including
    // immediate-propagation siblings).
    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as Node | null;
      if (!target || !this.containerEl.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, { capture: true });

    // Other shortcuts (Mod+Z / Mod+Shift+Z / Mod+Y / arrows / Del)
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // Don't hijack Delete/Backspace while the user is typing in a
      // text/number field (sec, pair, rename modal, etc.).
      const t = e.target as HTMLElement;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);
      if (!inField && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (this.targetSelection) {
          e.preventDefault();
          e.stopPropagation();
          this.deleteSelectedTargetRegion();
          return;
        }
        if (this.selection) {
          e.preventDefault();
          e.stopPropagation();
          this.deleteSelectedShape();
          return;
        }
      }
      if (mod && !e.altKey && key === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (mod && !e.altKey && key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        this.redo();
        return;
      }
      // Arrow-key zoom (only when not in a text field, no modifiers).
      if (!inField && !mod && !e.altKey && !e.shiftKey
          && this.plugin.settings.arrowKeysZoom
          && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        e.stopPropagation();
        const step = this.plugin.settings.arrowKeysZoomStep || 5;
        const cur = this.plugin.settings.imageScale;
        this.setImageScale(e.key === 'ArrowRight' ? cur + step : cur - step);
        return;
      }
      // Arrow-key handling for ↑/↓ (only when not typing, no modifiers).
      if (!inField && !mod && !e.altKey && !e.shiftKey
          && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (this.plugin.settings.arrowKeysReveal) {
          // Reveal-mode: step the rail on the focused image.
          const ctx = this.currentImageContext();
          if (!ctx) return;
          e.preventDefault();
          e.stopPropagation();
          const inverted = this.plugin.settings.arrowKeysRevealInverted;
          // Default: Up = hide (-1), Down = reveal (+1). Invert flips both.
          const isDown = e.key === 'ArrowDown';
          const delta = (isDown !== inverted) ? +1 : -1;
          this.bumpRevealStep(ctx.file, ctx.canvas, delta);
        } else if (this.scrollerEl) {
          // Scroll-mode: nudge the content pane by a normal-feeling
          // arrow-scroll amount. We have to do this manually because
          // the focused element (root) isn't itself the scroll
          // container — arrow keys would otherwise no-op in our view.
          e.preventDefault();
          e.stopPropagation();
          const SCROLL_PX = 60;
          this.scrollerEl.scrollTop += (e.key === 'ArrowDown' ? SCROLL_PX : -SCROLL_PX);
        }
        return;
      }
    });
  }

  async onClose(): Promise<void> {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.cancelPolyDraft();
    if (this.escScopePushed) {
      this.app.keymap.popScope(this.escScope);
      this.escScopePushed = false;
    }
  }

  annotFilePath(): string { return joinPath(this.folderPath, ANNOT_FILE); }

  async loadFolderData(): Promise<void> {
    this.folderData = { rects: {}, order: [], revealSteps: {} };
    if (!this.folderPath) return;
    const newPath = this.annotFilePath();
    const legacyPath = joinPath(this.folderPath, LEGACY_ANNOT_FILE);
    // Prefer the new file; fall back to the legacy .image-annotator.json.
    // First save under the new name will write to ANNOT_FILE; the legacy
    // file is left in place (user can delete it from Finder if they want).
    let path = newPath;
    if (!(await this.app.vault.adapter.exists(newPath))
        && (await this.app.vault.adapter.exists(legacyPath))) {
      path = legacyPath;
    }
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.rects && typeof parsed.rects === 'object' && Array.isArray(parsed.order)) {
            // v2 / v2.1 / v2.2 — already in the new shape.
            this.folderData = {
              rects: parsed.rects,
              order: parsed.order,
              revealSteps: (parsed.revealSteps && typeof parsed.revealSteps === 'object')
                ? parsed.revealSteps
                : {},
              scrollTop: typeof parsed.scrollTop === 'number' ? parsed.scrollTop : 0
            };
          } else {
            // v1 — flat { [relPath]: Rect[] }. Migrate.
            const rects = parsed as { [k: string]: Rect[] };
            this.folderData = {
              rects,
              order: Object.keys(rects).sort(),
              revealSteps: {}
            };
          }
        }
      }
    } catch (e) {
      console.error('Slide & Reveal: failed to load', path, e);
      new Notice(`Slide & Reveal: couldn't read ${path}`);
    }
  }

  async saveFolderData(): Promise<void> {
    if (!this.folderPath) return;
    try {
      await this.app.vault.adapter.write(this.annotFilePath(), JSON.stringify(this.folderData, null, 2));
      this.plugin.rememberFolder(this.folderPath);
    } catch (e) {
      console.error('Slide & Reveal: failed to save', e);
      new Notice('Slide & Reveal: save failed (see console)');
    }
  }

  scheduleSave(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    window.setTimeout(async () => {
      this.saveQueued = false;
      await this.saveFolderData();
    }, 250);
  }

  // ---------- Undo / redo ----------
  snapshot(): void {
    this.undoStack.push({ type: 'data', snap: JSON.stringify(this.folderData) });
    if (this.undoStack.length > this.MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  recordRename(oldPath: string, newPath: string): void {
    this.undoStack.push({ type: 'rename', oldPath, newPath });
    if (this.undoStack.length > this.MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  private async applyOp(op: UndoOp, opposite: 'undoStack' | 'redoStack'): Promise<void> {
    if (op.type === 'data') {
      this[opposite].push({ type: 'data', snap: JSON.stringify(this.folderData) });
      this.folderData = JSON.parse(op.snap);
      await this.saveFolderData();
      this.render();
    } else {
      // Reverse the rename. Resolve the file at its CURRENT path.
      const cur = op.type === 'rename' ? op.newPath : '';
      const target = op.type === 'rename' ? op.oldPath : '';
      const file = this.app.vault.getAbstractFileByPath(cur);
      if (!(file instanceof TFile)) {
        new Notice(`Can't undo rename: file not found at ${cur}`);
        return;
      }
      // Push the reversed op onto the opposite stack BEFORE renaming so the
      // rename event handler doesn't see an empty redo stack.
      this[opposite].push({ type: 'rename', oldPath: cur, newPath: target });
      try {
        await this.app.fileManager.renameFile(file, target);
      } catch (e) {
        console.error(e);
        new Notice('Rename undo failed (see console)');
        // Roll the op back since it didn't actually happen.
        this[opposite].pop();
      }
    }
  }
  async undo(): Promise<void> {
    const op = this.undoStack.pop();
    if (!op) { new Notice('Nothing to undo'); return; }
    await this.applyOp(op, 'redoStack');
  }
  async redo(): Promise<void> {
    const op = this.redoStack.pop();
    if (!op) { new Notice('Nothing to redo'); return; }
    await this.applyOp(op, 'undoStack');
  }

  handleEscape(): void {
    if (this.polyDraft) { this.cancelPolyDraft(); return; }
    const root = this.containerEl.children[1] as HTMLElement;
    const tb = root.querySelector('.sNr-rect-toolbar');
    if (tb) tb.remove();
    root.querySelectorAll('.sNr-rect.sNr-selected').forEach((r) => r.classList.remove('sNr-selected'));
  }

  // ---------- Render ----------
  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    // Preserve scroll position across re-renders (every action that
    // calls render() — adding shapes, drawing, deleting, etc. — would
    // otherwise jump back to the top of the content pane). On the
    // first render of a freshly-opened view, scrollerEl doesn't exist
    // yet, so fall back to the persisted scrollTop in folderData.
    const savedScroll = this.scrollerEl
      ? this.scrollerEl.scrollTop
      : (this.folderData.scrollTop ?? 0);
    // The selection toolbar lives on document.body (so it can't be
    // clipped by canvas overflow). Clean up any stragglers before
    // rebuilding the view. Same for thumbnail tooltips. The selection
    // pointer goes stale on rebuild (DOM nodes destroyed) — clear it.
    document.body.querySelectorAll('.sNr-rect-toolbar').forEach((t) => t.remove());
    document.body.querySelectorAll('.sNr-tip').forEach((t) => t.remove());
    this.selection = null;
    root.empty();
    root.addClass('sNr-view');
    root.tabIndex = -1; // make focusable so keydown bubbles up here

    const settings = this.plugin.settings;
    root.style.setProperty('--sNr-scale', settings.imageScale + '%');
    root.style.setProperty('--sNr-sidebar-w', settings.sidebarWidth + 'px');

    // ---- Header ----
    const header = root.createDiv({ cls: 'sNr-header' });
    header.createEl('h3', {
      text: this.folderPath
        ? `Folder: ${this.folderPath}`
        : 'No folder — right-click a folder in the file explorer and choose "Open Slide & Reveal here".'
    });

    if (!this.folderPath) return;

    const row = header.createDiv({ cls: 'sNr-header-row' });
    this.iconBtn(row, 'eye', 'Reveal all').onclick = () => this.toggleAll(root, true);
    this.iconBtn(row, 'eye-off', 'Hide all').onclick = () => this.toggleAll(root, false);
    const refreshBtn = row.createEl('button');
    setIcon(refreshBtn, 'rotate-cw');
    refreshBtn.title = 'Refresh view';
    refreshBtn.onclick = () => this.render();

    const resetSlidersBtn = row.createEl('button');
    setIcon(resetSlidersBtn, 'list-restart');
    resetSlidersBtn.title = 'Reset all reveal sliders to 0';
    resetSlidersBtn.onclick = async () => {
      this.snapshot();
      this.folderData.revealSteps = {};
      await this.saveFolderData();
      this.render();
    };

    // Mode toggle (Study ↔ Edit). The icon shows the *current* mode
    // and clicking toggles. Tooltip explains the switch.
    const modeBtn = row.createEl('button', { cls: 'sNr-mode-btn' });
    const updateModeBtn = () => {
      const m = this.plugin.settings.mode;
      modeBtn.empty();
      setIcon(modeBtn, m === 'study' ? 'book-open' : 'pencil');
      modeBtn.title = m === 'study'
        ? 'Mode: Study (wheel steps the reveal slider). Click to switch to Edit.'
        : 'Mode: Edit (wheel scrolls normally; no reveal stepping). Click to switch to Study.';
      modeBtn.classList.toggle('sNr-mode-edit', m === 'edit');
    };
    updateModeBtn();
    modeBtn.onclick = async () => {
      this.plugin.settings.mode = this.plugin.settings.mode === 'study' ? 'edit' : 'study';
      await this.plugin.saveSettings();
      updateModeBtn();
    };

    const undoBtn = row.createEl('button');
    setIcon(undoBtn, 'undo-2');
    undoBtn.title = 'Undo (⌘Z)';
    undoBtn.onclick = () => this.undo();
    const redoBtn = row.createEl('button');
    setIcon(redoBtn, 'redo-2');
    redoBtn.title = 'Redo (⇧⌘Z)';
    redoBtn.onclick = () => this.redo();

    const prevBtn = row.createEl('button');
    setIcon(prevBtn, 'arrow-up');
    prevBtn.title = 'Previous image';
    prevBtn.onclick = () => this.jumpImage(-1);
    const nextBtn = row.createEl('button');
    setIcon(nextBtn, 'arrow-down');
    nextBtn.title = 'Next image';
    nextBtn.onclick = () => this.jumpImage(+1);

    // Header tools that act on the currently-focused image. Live in the
    // header so they're always reachable; populated by refreshHeaderTools()
    // which is called on render and on scroll (active state updates as
    // the focused image changes).
    this.headerToolsEl = row.createDiv({ cls: 'sNr-header-tools' });
    this.refreshHeaderTools();

    // Size control lives at the END of the header row — visually grouped
    // away from the action buttons.
    const scale = row.createDiv({ cls: 'sNr-scale' });
    const sizeIcon = scale.createSpan({ cls: 'sNr-iconbtn-ico' });
    setIcon(sizeIcon, 'maximize-2');
    scale.createSpan({ text: 'Size' });
    // Step-down button (companion to slider + % input). Uses the same
    // arrow-key zoom step so all three modes feel consistent.
    const stepDown = scale.createEl('button', { cls: 'sNr-scale-step' });
    setIcon(stepDown, 'minus');
    stepDown.title = `Smaller (−${settings.arrowKeysZoomStep || 5}%)`;
    stepDown.onclick = () => this.setImageScale(
      this.plugin.settings.imageScale - (this.plugin.settings.arrowKeysZoomStep || 5),
      true,
    );
    // Slider covers the common 25–200% range. For anything bigger, type
    // it into the % box (no upper limit there besides sanity).
    const slider = scale.createEl('input', { type: 'range', cls: 'sNr-scale-slider' });
    slider.min = '25'; slider.max = '200'; slider.step = '5';
    slider.value = String(Math.min(200, settings.imageScale));
    const stepUp = scale.createEl('button', { cls: 'sNr-scale-step' });
    setIcon(stepUp, 'plus');
    stepUp.title = `Bigger (+${settings.arrowKeysZoomStep || 5}%)`;
    stepUp.onclick = () => this.setImageScale(
      this.plugin.settings.imageScale + (this.plugin.settings.arrowKeysZoomStep || 5),
      true,
    );
    const pctInput = scale.createEl('input', { type: 'text', cls: 'sNr-scale-pct' });
    pctInput.value = settings.imageScale + '%';
    pctInput.title = 'Image size — type any percentage (e.g. 250%) for values past 200%';

    slider.oninput = () => this.setImageScale(parseInt(slider.value, 10), false);
    slider.onchange = () => this.setImageScale(parseInt(slider.value, 10), true);
    pctInput.onfocus = () => pctInput.select();
    const commitPct = () => {
      // Strip everything except digits + decimal so '250 %' / '250%' / '250'
      // all parse correctly.
      const m = pctInput.value.replace(/[^0-9.]/g, '');
      const n = parseFloat(m);
      if (isFinite(n) && n > 0) this.setImageScale(n, true);
      else pctInput.value = this.plugin.settings.imageScale + '%';
    };
    pctInput.onchange = commitPct;
    pctInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitPct(); pctInput.blur(); }
      // Don't let arrow keys inside this input trigger view-level zoom.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'
          || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
      }
    });

    // Quiz entry point — to the right of the % input. Opens the
    // cross-diagram quiz scope picker.
    const quizBtn = row.createEl('button', { cls: 'sNr-iconbtn sNr-header-quiz' });
    const quizIco = quizBtn.createSpan({ cls: 'sNr-iconbtn-ico' });
    setIcon(quizIco, 'crosshair');
    quizBtn.createSpan({ cls: 'sNr-iconbtn-text', text: 'Quiz' });
    quizBtn.title = 'Cross-diagram quiz: pick a scope and drill from cropped target regions';
    quizBtn.onclick = () => new ScopePickerModal(this.plugin).open();

    // ---- Body ----
    const body = root.createDiv({ cls: 'sNr-body' });
    this.sidebarEl = body.createDiv({ cls: 'sNr-sidebar' });
    const divider = body.createDiv({ cls: 'sNr-divider' });
    this.scrollerEl = body.createDiv({ cls: 'sNr-content' });
    this.bindDivider(divider, root);

    // Persist the scroll position so the view reopens where you left off.
    // scheduleSave throttles to ~250ms so continuous scrolling is cheap.
    // Also refresh the header tools' active state since the focused image
    // can change as you scroll.
    let scrollRefreshScheduled = false;
    this.scrollerEl.addEventListener('scroll', () => {
      this.folderData.scrollTop = this.scrollerEl.scrollTop;
      this.scheduleSave();
      if (!scrollRefreshScheduled) {
        scrollRefreshScheduled = true;
        requestAnimationFrame(() => {
          scrollRefreshScheduled = false;
          this.refreshHeaderTools();
        });
      }
    });

    const tf = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (!(tf instanceof TFolder)) {
      this.scrollerEl.createEl('p', { text: `Folder "${this.folderPath}" not found in vault.` });
      return;
    }

    const images: TFile[] = [];
    const walk = (fld: TFolder) => {
      for (const ch of fld.children) {
        if (ch instanceof TFolder) walk(ch);
        else if (ch instanceof TFile && IMG_RE.test(ch.path)) images.push(ch);
      }
    };
    walk(tf);

    // Reconcile folderData.order with what's actually on disk:
    //  - Append newly-discovered images to the end.
    //  - Drop entries for images that no longer exist.
    // This keeps the user's explicit ordering stable across renames.
    const rels = images.map((f) => relTo(this.folderPath, f.path));
    const relSet = new Set(rels);
    const orderSet = new Set(this.folderData.order);
    let orderChanged = false;
    for (const r of rels) {
      if (!orderSet.has(r)) { this.folderData.order.push(r); orderSet.add(r); orderChanged = true; }
    }
    const filtered = this.folderData.order.filter((p) => relSet.has(p));
    if (filtered.length !== this.folderData.order.length) {
      this.folderData.order = filtered; orderChanged = true;
    }
    if (orderChanged) this.scheduleSave();

    const orderIndex = new Map(this.folderData.order.map((p, i) => [p, i]));
    images.sort((a, b) => {
      const ai = orderIndex.get(relTo(this.folderPath, a.path)) ?? Infinity;
      const bi = orderIndex.get(relTo(this.folderPath, b.path)) ?? Infinity;
      return ai - bi;
    });

    if (!images.length) {
      this.scrollerEl.createEl('p', { text: 'No images found in this folder.' });
      return;
    }
    for (const img of images) this.renderThumb(img);
    for (const img of images) this.renderImage(img);

    // The header tools were built BEFORE the image blocks existed, so
    // currentImageContext() returned null and they painted disabled.
    // Refresh now that the blocks are in the DOM. Defer to after the
    // scroll restore so currentBlockIndex sees the right viewport.
    requestAnimationFrame(() => {
      this.scrollerEl.scrollTop = savedScroll;
      this.refreshHeaderTools();
    });

    // Keep keyboard focus on the root so undo/redo (and other shortcuts)
    // keep working after actions that destroy the previously-focused
    // element (e.g. clicking the trash button to delete a rect).
    if (!root.contains(document.activeElement)) root.focus();
  }

  bindDivider(divider: HTMLElement, root: HTMLElement): void {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = this.sidebarEl.offsetWidth;
      divider.addClass('sNr-dragging');
      const move = (ev: MouseEvent) => {
        const newW = Math.max(60, Math.min(600, startW + (ev.clientX - startX)));
        root.style.setProperty('--sNr-sidebar-w', newW + 'px');
      };
      const up = async () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        divider.removeClass('sNr-dragging');
        this.plugin.settings.sidebarWidth = this.sidebarEl.offsetWidth;
        await this.plugin.saveSettings();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  renderThumb(file: TFile): void {
    const thumb = this.sidebarEl.createDiv({ cls: 'sNr-thumb' });
    thumb.dataset.path = file.path;
    thumb.draggable = true;
    const img = thumb.createEl('img');
    img.src = this.app.vault.getResourcePath(file);
    // Without these the browser uses the inner <img>'s native image-drag,
    // which hijacks the drag event and prevents our thumb-level dragstart
    // from firing — that was the root cause of "reordering doesn't work".
    img.draggable = false;
    img.style.pointerEvents = 'none';
    const rel = relTo(this.folderPath, file.path);
    thumb.createDiv({ cls: 'sNr-thumb-label', text: rel });

    // Body-attached tooltip with position: fixed so it can't be clipped
    // by ancestor overflow (the thumb itself has overflow: hidden for
    // its rounded corners, and the sidebar clips horizontal overflow).
    let tipEl: HTMLElement | null = null;
    const showTip = () => {
      if (tipEl) return;
      tipEl = document.body.createDiv({ cls: 'sNr-tip' });
      tipEl.setText(rel);
      const r = thumb.getBoundingClientRect();
      // Place to the right; flip to the left if there isn't room.
      const tipW = tipEl.offsetWidth;
      let left = r.right + 8;
      if (left + tipW > window.innerWidth - 8) left = r.left - tipW - 8;
      tipEl.style.left = left + 'px';
      tipEl.style.top = (r.top + 4) + 'px';
    };
    const hideTip = () => {
      if (tipEl) { tipEl.remove(); tipEl = null; }
    };
    thumb.addEventListener('mouseenter', showTip);
    thumb.addEventListener('mouseleave', hideTip);
    // If the thumb gets removed (re-render) while the cursor is on it,
    // mouseleave never fires. Cleaning up is handled in render() — see
    // the .sNr-tip cleanup there.
    thumb.addEventListener('dragstart', hideTip);
    thumb.onclick = () => {
      const target = this.scrollerEl.querySelector(
        `.sNr-block[data-path="${CSS.escape(file.path)}"]`
      ) as HTMLElement | null;
      if (target) {
        // Instant jump (no smooth scroll — long slides take too long)
        this.scrollerEl.scrollTop = target.offsetTop - this.scrollerEl.offsetTop;
      }
      this.sidebarEl.querySelectorAll('.sNr-thumb-active').forEach((t) => t.removeClass('sNr-thumb-active'));
      thumb.addClass('sNr-thumb-active');
    };

    // Drag-and-drop reordering: writes to folderData.order.
    // We also stash the source path on the view as a fallback in case
    // dataTransfer.getData() comes back empty (some browsers / Electron
    // strip text/plain when the drag crosses certain boundaries).
    thumb.addEventListener('dragstart', (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', file.path); } catch { /* ignore */ }
      }
      this.draggingThumbPath = file.path;
      thumb.addClass('sNr-dragging');
    });
    thumb.addEventListener('dragend', () => {
      thumb.removeClass('sNr-dragging');
      this.draggingThumbPath = null;
      this.sidebarEl.querySelectorAll('.sNr-thumb').forEach((t) => {
        t.classList.remove('sNr-drop-above', 'sNr-drop-below');
      });
    });
    thumb.addEventListener('dragover', (e: DragEvent) => {
      // Only respond to our own thumb drags
      if (!this.draggingThumbPath || this.draggingThumbPath === file.path) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const r = thumb.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      // Clear other indicators in the sidebar so only one slot is highlighted
      this.sidebarEl.querySelectorAll('.sNr-thumb').forEach((t) => {
        if (t !== thumb) t.classList.remove('sNr-drop-above', 'sNr-drop-below');
      });
      thumb.classList.toggle('sNr-drop-above', before);
      thumb.classList.toggle('sNr-drop-below', !before);
    });
    thumb.addEventListener('dragleave', (e: DragEvent) => {
      // Only clear if leaving for something OUTSIDE this thumb
      const related = e.relatedTarget as Node | null;
      if (related && thumb.contains(related)) return;
      thumb.classList.remove('sNr-drop-above', 'sNr-drop-below');
    });
    thumb.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      thumb.classList.remove('sNr-drop-above', 'sNr-drop-below');
      const sourcePath = e.dataTransfer?.getData('text/plain') || this.draggingThumbPath || '';
      if (!sourcePath || sourcePath === file.path) return;
      const r = thumb.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      const sourceRel = relTo(this.folderPath, sourcePath);
      const targetRel = relTo(this.folderPath, file.path);
      const order = this.folderData.order;
      const fromIdx = order.indexOf(sourceRel);
      if (fromIdx < 0) return;
      this.snapshot();
      order.splice(fromIdx, 1);
      let toIdx = order.indexOf(targetRel);
      if (toIdx < 0) toIdx = order.length;
      if (!before) toIdx += 1;
      order.splice(toIdx, 0, sourceRel);
      await this.saveFolderData();
      this.render();
    });
  }

  /** Index of the block whose top is closest to the current scroll position. */
  private currentBlockIndex(blocks: HTMLElement[]): number {
    const top = this.scrollerEl.scrollTop;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bottom = b.offsetTop - this.scrollerEl.offsetTop + b.offsetHeight;
      if (bottom > top + 10) return i;
    }
    return blocks.length - 1;
  }

  /** Move +1 / -1 in the image list and instant-scroll to it. */
  jumpImage(delta: number): void {
    const blocks = Array.from(this.scrollerEl.querySelectorAll('.sNr-block')) as HTMLElement[];
    if (!blocks.length) return;
    const cur = this.currentBlockIndex(blocks);
    const next = Math.max(0, Math.min(blocks.length - 1, cur + delta));
    const target = blocks[next];
    this.scrollerEl.scrollTop = target.offsetTop - this.scrollerEl.offsetTop;
    const path = target.dataset.path;
    if (path) {
      this.sidebarEl.querySelectorAll('.sNr-thumb-active').forEach((t) => t.removeClass('sNr-thumb-active'));
      const thumb = this.sidebarEl.querySelector(`.sNr-thumb[data-path="${CSS.escape(path)}"]`);
      if (thumb) thumb.addClass('sNr-thumb-active');
    }
  }

  toggleAll(scopeEl: HTMLElement, reveal: boolean): void {
    scopeEl.querySelectorAll('.sNr-rect').forEach((r) => r.classList.toggle('sNr-revealed', reveal));
  }

  rectsFor(file: TFile): { key: string; list: Rect[] } {
    const key = relTo(this.folderPath, file.path);
    if (!this.folderData.rects[key]) this.folderData.rects[key] = [];
    return { key, list: this.folderData.rects[key] };
  }

  /** Next pair number to assign for a new shape on this image. */
  nextPairFor(file: TFile): number {
    const { list } = this.rectsFor(file);
    let max = 0;
    for (const r of list) if (r.pair > max) max = r.pair;
    return max + 1;
  }

  renderImage(file: TFile): void {
    const block = this.scrollerEl.createDiv({ cls: 'sNr-block' });
    block.dataset.path = file.path;

    const top = block.createDiv({ cls: 'sNr-block-top' });
    const titleWrap = top.createDiv({ cls: 'sNr-title-wrap' });
    titleWrap.createEl('h4', { text: relTo(this.folderPath, file.path) });
    const renameBtn = titleWrap.createEl('button', { cls: 'sNr-rename-btn' });
    setIcon(renameBtn, 'pencil');
    renameBtn.title = 'Rename file';
    renameBtn.onclick = () => this.renameFile(file);
    // The per-image action buttons (Rectangle/Polygon/Reveal/Hide) used to
    // live here; they were moved to the main header so they're always
    // reachable without scrolling. They act on whichever image is at the
    // top of the visible area (currentImageContext).

    const body = block.createDiv({ cls: 'sNr-block-body' });
    // Rail position is per-user setting. Insertion order determines which
    // side it lands on in the flex row; CSS class swaps the divider border.
    const railOnRight = this.plugin.settings.railSide === 'right';
    let railHost: HTMLElement;
    let canvas: HTMLElement;
    if (railOnRight) {
      canvas = body.createDiv({ cls: 'sNr-canvas' });
      railHost = body.createDiv({ cls: 'sNr-rail-host sNr-rail-right' });
    } else {
      railHost = body.createDiv({ cls: 'sNr-rail-host' });
      canvas = body.createDiv({ cls: 'sNr-canvas' });
    }
    if (this.drawingPaths.has(file.path)) canvas.addClass('sNr-drawing');
    // The 'sNr-drafting' outline is shared between rectangle and polygon
    // modes — both should make it obvious which image the next click
    // will land on.
    if (this.drawingPaths.has(file.path) || this.polyDrawingPaths.has(file.path)) {
      block.addClass('sNr-drafting');
    }
    // Target-region drafting also gets the drafting outline so the user
    // knows which image their clicks will land on.
    if (this.targetDraftCoverId && this.polyDraft && this.polyDraft.file === file) {
      block.addClass('sNr-drafting');
    }

    const imgEl = canvas.createEl('img');
    imgEl.src = this.app.vault.getResourcePath(file);

    const { list } = this.rectsFor(file);
    for (const r of list) {
      this.renderShape(canvas, file, r);
      if (r.targetRegion) this.renderTargetRegionOverlay(canvas, r);
    }

    // Reveal-progress rail (vertical slider on the left of the image).
    this.renderRail(railHost, file, canvas);

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.drawingPaths.has(file.path) && (e.target === canvas || e.target === imgEl)) {
        this.beginRectDrag(canvas, file, e);
        return;
      }
      if (this.polyDrawingPaths.has(file.path) && (e.target === canvas || e.target === imgEl)) {
        this.addPolyPoint(canvas, file, block, e);
        return;
      }
      // Target-region drafting: only on the image that owns the cover.
      if (
        this.targetDraftCoverId &&
        this.polyDraft &&
        this.polyDraft.file === file &&
        this.polyDraft.destination.kind === 'target' &&
        (e.target === canvas || e.target === imgEl)
      ) {
        this.addPolyPoint(canvas, file, block, e);
        return;
      }
    });

    // Double-click on canvas (not on rect) commits poly
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.polyDrawingPaths.has(file.path) || (this.targetDraftCoverId && this.polyDraft?.file === file)) {
        e.preventDefault(); e.stopPropagation();
        this.commitPolyDraft();
      }
    });
  }

  // ---------- Rectangle drawing ----------
  private beginRectDrag(canvas: HTMLElement, file: TFile, e: MouseEvent): void {
    e.preventDefault();
    const cb = canvas.getBoundingClientRect();
    const sx = (e.clientX - cb.left) / cb.width;
    const sy = (e.clientY - cb.top) / cb.height;
    const ghost = canvas.createDiv({ cls: 'sNr-rect' });
    ghost.style.setProperty('--sNr-color', this.plugin.settings.defaultColor);

    const move = (ev: MouseEvent) => {
      const cx = (ev.clientX - cb.left) / cb.width;
      const cy = (ev.clientY - cb.top) / cb.height;
      const x = clamp01(Math.min(sx, cx));
      const y = clamp01(Math.min(sy, cy));
      const w = clamp01(Math.abs(cx - sx));
      const h = clamp01(Math.abs(cy - sy));
      ghost.style.left = (x * 100) + '%';
      ghost.style.top = (y * 100) + '%';
      ghost.style.width = (w * 100) + '%';
      ghost.style.height = (h * 100) + '%';
    };
    const up = async (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      ghost.remove();
      const cx = (ev.clientX - cb.left) / cb.width;
      const cy = (ev.clientY - cb.top) / cb.height;
      const x = clamp01(Math.min(sx, cx));
      const y = clamp01(Math.min(sy, cy));
      const w = clamp01(Math.abs(cx - sx));
      const h = clamp01(Math.abs(cy - sy));
      if (w < 0.01 || h < 0.01) return;
      this.snapshot();
      const rect: Rect = {
        id: uid(), kind: 'rect', x, y, w, h,
        pair: this.nextPairFor(file),
        seconds: this.plugin.settings.defaultSeconds,
        color: this.plugin.settings.defaultColor
      };
      const { list } = this.rectsFor(file);
      list.push(rect);
      await this.saveFolderData();
      // Stay in rectangle-draw mode so the user can keep adding without
      // re-clicking the button. Click 'Rectangle' again to exit.
      this.render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // ---------- Polygon drafting ----------
  private addPolyPoint(canvas: HTMLElement, file: TFile, block: HTMLElement, e: MouseEvent): void {
    e.preventDefault();
    const cb = canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - cb.left) / cb.width);
    const y = clamp01((e.clientY - cb.top) / cb.height);

    if (!this.polyDraft || this.polyDraft.canvas !== canvas) {
      this.cancelPolyDraft();
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('sNr-poly-draft');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      svg.appendChild(poly);
      canvas.appendChild(svg);
      this.polyDraft = {
        file, canvas, block, points: [], svg, poly,
        cleanup: () => svg.remove(),
        destination: { kind: 'newShape' },
      };
    }
    this.polyDraft.points.push({ x, y });
    this.repaintPolyDraft();
  }

  private repaintPolyDraft(): void {
    if (!this.polyDraft) return;
    const { svg, poly, points } = this.polyDraft;
    poly.setAttribute('points', points.map((p) => `${p.x * 100},${p.y * 100}`).join(' '));
    // dot at each vertex
    svg.querySelectorAll('circle').forEach((c) => c.remove());
    for (const p of points) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(p.x * 100));
      c.setAttribute('cy', String(p.y * 100));
      c.setAttribute('r', '1.2');
      svg.appendChild(c);
    }
  }

  cancelPolyDraft(): void {
    if (!this.polyDraft) return;
    this.polyDraft.cleanup();
    this.polyDraft = null;
    this.targetDraftCoverId = null;
  }

  async commitPolyDraft(): Promise<void> {
    const draft = this.polyDraft;
    if (!draft) return;
    if (draft.points.length < 3) {
      new Notice('Need at least 3 points for a polygon.');
      return;
    }
    const { file, points, destination } = draft;
    // Compute bbox
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    const localPts: Point[] = points.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));

    if (destination.kind === 'target') {
      // Cross-diagram quiz authoring: attach a targetRegion to the existing
      // cover rather than creating a new shape.
      const { list } = this.rectsFor(file);
      const cover = list.find((r) => r.id === destination.coverId);
      if (!cover) {
        new Notice('Cover no longer exists — target region not saved.');
        this.cancelPolyDraft();
        this.render();
        return;
      }
      this.snapshot();
      const region: TargetRegion = { x: minX, y: minY, w, h, points: localPts };
      cover.targetRegion = region;
      cover.targetRegionSource = 'manual';
      await this.saveFolderData();
      this.cancelPolyDraft();
      new Notice('Target region added — this label is now in the quiz pool.');
      this.render();
      return;
    }

    this.snapshot();
    const shape: Rect = {
      id: uid(), kind: 'polygon',
      x: minX, y: minY, w, h,
      points: localPts,
      pair: this.nextPairFor(file),
      seconds: this.plugin.settings.defaultSeconds,
      color: this.plugin.settings.defaultColor
    };
    const { list } = this.rectsFor(file);
    list.push(shape);
    await this.saveFolderData();
    this.cancelPolyDraft();
    // Stay in polygon-draw mode so the user can keep adding without
    // re-clicking the button. Click 'Polygon' again (or Cancel) to exit.
    this.render();
  }

  /** Start drafting a target region for a specific cover. Sets up polyDraft
   *  with destination=target and the target-drafting state flag. Existing
   *  polygon-draw mode (if any) is cancelled. */
  beginTargetRegionDraft(canvas: HTMLElement, file: TFile, block: HTMLElement, coverId: string): void {
    // Cancel any conflicting state first.
    this.cancelPolyDraft();
    this.polyDrawingPaths.delete(file.path);
    this.drawingPaths.delete(file.path);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('sNr-poly-draft', 'sNr-target-draft');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    svg.appendChild(poly);
    canvas.appendChild(svg);
    this.polyDraft = {
      file, canvas, block, points: [], svg, poly,
      cleanup: () => svg.remove(),
      destination: { kind: 'target', coverId },
    };
    this.targetDraftCoverId = coverId;
    new Notice('Click vertices over the structure this label points to, then Finalize. Esc is disabled — use the Cancel button.');
    // DO NOT full-render here: render() rebuilds the canvas, which would
    // orphan polyDraft.canvas and make the next click create a brand-new
    // newShape-destination draft (and silently drop the target binding).
    // Just refresh the header so Finalize/Cancel show up, and toggle the
    // drafting outline on the block manually.
    block.addClass('sNr-drafting');
    this.refreshHeaderTools();
  }

  /** Select a target region: shows draggable vertex handles + a mini
   *  floating toolbar (delete only for now). Sibling of selectShape, but
   *  the target region is not a Rect — it's a sub-field of its cover. */
  selectTargetRegion(canvas: HTMLElement, file: TFile, cover: Rect, el: HTMLElement): void {
    if (!cover.targetRegion) return;
    const root = canvas.closest('.sNr-view') as HTMLElement;
    // Clean up any other selections / toolbars.
    root.querySelectorAll('.sNr-rect.sNr-selected').forEach((r) => r.classList.remove('sNr-selected'));
    root.querySelectorAll('.sNr-target-region.sNr-selected').forEach((r) => r.classList.remove('sNr-selected'));
    document.body.querySelectorAll('.sNr-rect-toolbar').forEach((t) => t.remove());
    root.querySelectorAll('.sNr-vertex').forEach((v) => v.remove());
    el.classList.add('sNr-selected');
    this.selection = null; // not a shape selection
    this.targetSelection = { canvas, file, cover, el };

    this.renderTargetRegionVertices(canvas, file, cover, el);

    const tb = document.body.createDiv({ cls: 'sNr-rect-toolbar' });
    const reposition = () => {
      const rb = el.getBoundingClientRect();
      const tbW = tb.offsetWidth || 200;
      const tbH = tb.offsetHeight || 38;
      const margin = 8;
      let top = rb.top - tbH - 6;
      if (top < margin) top = rb.bottom + 6;
      let left = rb.left;
      const maxLeft = window.innerWidth - tbW - margin;
      if (left > maxLeft) left = maxLeft;
      if (left < margin) left = margin;
      tb.style.top = top + 'px';
      tb.style.left = left + 'px';
    };
    requestAnimationFrame(reposition);
    this.scrollerEl.addEventListener('scroll', reposition);
    window.addEventListener('resize', reposition);
    const detachReposition = () => {
      this.scrollerEl.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };

    const labelText = cover.pair > 0 ? `Target #${cover.pair}` : 'Target (unpaired)';
    tb.createSpan({ cls: 'sNr-tb-label', text: labelText });
    tb.createDiv({ cls: 'sNr-tb-divider' });

    const del = tb.createEl('button', { cls: 'sNr-tb-icon-btn sNr-tb-danger' });
    setIcon(del, 'trash-2');
    del.title = 'Delete target region (cover stays; this label leaves the quiz pool)';
    del.onclick = async (e) => {
      e.stopPropagation();
      tb.remove();
      detachReposition();
      await this.removeTargetRegion(file, cover.id);
    };

    if (this.currentOffClick) {
      document.removeEventListener('mousedown', this.currentOffClick, true);
      this.currentOffClick = null;
    }
    const offClick = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target) return;
      if (tb.contains(target) || el.contains(target)) return;
      if (target.closest && target.closest('.sNr-vertex')) return;
      tb.remove();
      el.classList.remove('sNr-selected');
      canvas.querySelectorAll('.sNr-vertex[data-target-cover-id]').forEach((v) => v.remove());
      detachReposition();
      this.targetSelection = null;
      document.removeEventListener('mousedown', offClick, true);
      if (this.currentOffClick === offClick) this.currentOffClick = null;
    };
    this.currentOffClick = offClick;
    document.addEventListener('mousedown', offClick, true);
  }

  /** Delete the currently-selected target region (Del/Backspace path). */
  async deleteSelectedTargetRegion(): Promise<void> {
    const sel = this.targetSelection;
    if (!sel) return;
    this.targetSelection = null;
    document.body.querySelectorAll('.sNr-rect-toolbar').forEach((t) => t.remove());
    await this.removeTargetRegion(sel.file, sel.cover.id);
  }

  /** Draw draggable handles at each vertex of a target region. Mirrors
   *  renderPolyVertices but operates on cover.targetRegion. */
  renderTargetRegionVertices(canvas: HTMLElement, file: TFile, cover: Rect, el: HTMLElement): void {
    const tr = cover.targetRegion;
    if (!tr) return;
    canvas.querySelectorAll(`.sNr-vertex[data-target-cover-id="${cover.id}"]`).forEach((v) => v.remove());
    for (let i = 0; i < tr.points.length; i++) {
      const idx = i;
      const p = tr.points[i];
      const v = canvas.createDiv({ cls: 'sNr-vertex sNr-vertex-target' });
      v.dataset.targetCoverId = cover.id;
      v.dataset.vertexIdx = String(idx);
      const cx = tr.x + p.x * tr.w;
      const cy = tr.y + p.y * tr.h;
      v.style.left = (cx * 100) + '%';
      v.style.top = (cy * 100) + '%';

      v.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = canvas.getBoundingClientRect();
        this.snapshot();
        const move = (mv: MouseEvent) => {
          const nx = clamp01((mv.clientX - cb.left) / cb.width);
          const ny = clamp01((mv.clientY - cb.top) / cb.height);
          v.style.left = (nx * 100) + '%';
          v.style.top = (ny * 100) + '%';
          tr.points[idx] = {
            x: (nx - tr.x) / tr.w,
            y: (ny - tr.y) / tr.h,
          };
          const polyEl = el.querySelector('polygon');
          if (polyEl) {
            polyEl.setAttribute(
              'points',
              tr.points.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(' '),
            );
          }
        };
        const up = async () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          this.normalizeTargetRegion(tr);
          await this.saveFolderData();
          this.render();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });

      // Right-click vertex to delete (min 3).
      v.addEventListener('contextmenu', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (tr.points.length <= 3) {
          new Notice('A target region needs at least 3 points.');
          return;
        }
        this.snapshot();
        tr.points.splice(idx, 1);
        this.normalizeTargetRegion(tr);
        await this.saveFolderData();
        this.render();
      });
    }
  }

  /** Recompute the SVG connector line between a cover and its target
   *  region. Called whenever either end moves. */
  updateTargetConnector(canvas: HTMLElement, cover: Rect): void {
    if (!cover.targetRegion) return;
    const svg = canvas.querySelector(
      `svg.sNr-target-connector[data-cover-id="${cover.id}"]`,
    ) as SVGSVGElement | null;
    if (!svg) return;
    const line = svg.querySelector('line');
    if (!line) return;
    const tr = cover.targetRegion;
    const cx = (cover.x + cover.w / 2) * 100;
    const cy = (cover.y + cover.h / 2) * 100;
    const tx = (tr.x + tr.w / 2) * 100;
    const ty = (tr.y + tr.h / 2) * 100;
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(tx));
    line.setAttribute('y2', String(ty));
  }

  /** Same as normalizePolygon but for a TargetRegion. */
  private normalizeTargetRegion(tr: { x: number; y: number; w: number; h: number; points: Point[] }): void {
    const canvasPts = tr.points.map((p) => ({
      x: tr.x + p.x * tr.w,
      y: tr.y + p.y * tr.h,
    }));
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of canvasPts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    minX = clamp01(minX); minY = clamp01(minY);
    maxX = clamp01(maxX); maxY = clamp01(maxY);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    tr.x = minX; tr.y = minY; tr.w = w; tr.h = h;
    tr.points = canvasPts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
  }

  /** Remove a target region from a cover (undoable). */
  async removeTargetRegion(file: TFile, coverId: string): Promise<void> {
    const { list } = this.rectsFor(file);
    const cover = list.find((r) => r.id === coverId);
    if (!cover || !cover.targetRegion) return;
    this.snapshot();
    delete cover.targetRegion;
    delete cover.targetRegionSource;
    await this.saveFolderData();
    new Notice('Target region removed.');
    this.render();
  }

  // ---------- Render target region overlay ----------
  /** Faint dashed polygon over a cover's targetRegion, plus a connector
   *  line from the cover's bbox centre to the target's centre, so the
   *  pairing is visible during authoring/study. */
  renderTargetRegionOverlay(canvas: HTMLElement, cover: Rect): void {
    const tr = cover.targetRegion;
    if (!tr) return;
    const file = this.currentImageContext()?.file ?? null;
    const wrap = canvas.createDiv({ cls: 'sNr-target-region' });
    wrap.dataset.coverId = cover.id;
    wrap.style.left = (tr.x * 100) + '%';
    wrap.style.top = (tr.y * 100) + '%';
    wrap.style.width = (tr.w * 100) + '%';
    wrap.style.height = (tr.h * 100) + '%';
    wrap.style.setProperty('--sNr-color', cover.color || this.plugin.settings.defaultColor);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', tr.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' '));
    svg.appendChild(poly);
    wrap.appendChild(svg);

    // Look up the owning file once via the parent block.
    const resolveFile = (): TFile | null => {
      const block = wrap.closest('.sNr-block') as HTMLElement | null;
      const path = block?.dataset.path;
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return f instanceof TFile ? f : file;
    };

    // Click → select (open the mini toolbar + vertex handles).
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = resolveFile();
      if (f) this.selectTargetRegion(canvas, f, cover, wrap);
    });

    // Mousedown → potential drag. Mirrors the shape drag logic: shift the
    // whole bbox while keeping its size and local points fixed. Click still
    // fires on mouseup-without-drag, so selection isn't affected.
    wrap.addEventListener('mousedown', (e) => {
      // Don't start drags from vertex handles — they have their own logic.
      if ((e.target as HTMLElement).classList.contains('sNr-vertex')) return;
      if (!cover.targetRegion) return;
      e.preventDefault();
      e.stopPropagation();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const tr = cover.targetRegion;
      const ox = tr.x, oy = tr.y;
      let snapped = false;
      const move = (mv: MouseEvent) => {
        const dx = (mv.clientX - startX) / cb.width;
        const dy = (mv.clientY - startY) / cb.height;
        // Only take a snapshot once we've actually moved — pure clicks
        // shouldn't push an undo entry.
        if (!snapped && (Math.abs(dx) + Math.abs(dy)) > 0.001) {
          this.snapshot();
          snapped = true;
        }
        tr.x = clamp01(Math.min(1 - tr.w, Math.max(0, ox + dx)));
        tr.y = clamp01(Math.min(1 - tr.h, Math.max(0, oy + dy)));
        wrap.style.left = (tr.x * 100) + '%';
        wrap.style.top = (tr.y * 100) + '%';
        // Keep the connector line in sync.
        this.updateTargetConnector(canvas, cover);
        // Keep vertex handles in sync if this region is selected.
        canvas.querySelectorAll(`.sNr-vertex[data-target-cover-id="${cover.id}"]`).forEach((v, i) => {
          const p = tr.points[i];
          if (!p) return;
          (v as HTMLElement).style.left = ((tr.x + p.x * tr.w) * 100) + '%';
          (v as HTMLElement).style.top = ((tr.y + p.y * tr.h) * 100) + '%';
        });
      };
      const up = async () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (snapped) await this.saveFolderData();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // Connector line between cover bbox centre and target bbox centre.
    // We render it as an SVG <line> spanning the entire canvas with
    // preserveAspectRatio="none", so the math is in pure 0..100 image
    // fractions regardless of the canvas's actual pixel aspect ratio.
    const connectorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    connectorSvg.classList.add('sNr-target-connector');
    connectorSvg.dataset.coverId = cover.id;
    connectorSvg.setAttribute('viewBox', '0 0 100 100');
    connectorSvg.setAttribute('preserveAspectRatio', 'none');
    connectorSvg.style.setProperty('--sNr-color', cover.color || this.plugin.settings.defaultColor);
    const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    connectorSvg.appendChild(lineEl);
    canvas.appendChild(connectorSvg);
    this.updateTargetConnector(canvas, cover);
  }

  // ---------- Render shape (rect or polygon) ----------
  renderShape(canvas: HTMLElement, file: TFile, rect: Rect): void {
    const isPoly = rect.kind === 'polygon' && Array.isArray(rect.points);
    const el = canvas.createDiv({ cls: 'sNr-rect' });
    if (isPoly) el.classList.add('sNr-shape-poly');
    el.style.left = (rect.x * 100) + '%';
    el.style.top = (rect.y * 100) + '%';
    el.style.width = (rect.w * 100) + '%';
    el.style.height = (rect.h * 100) + '%';
    el.style.setProperty('--sNr-color', rect.color || this.plugin.settings.defaultColor);
    el.dataset.id = rect.id;
    el.dataset.pair = String(rect.pair || 0);

    // Pair number renders as a SIBLING in the canvas (see renderPairOverlay).
    this.renderPairOverlay(canvas, rect);

    let dragTarget: HTMLElement | SVGElement = el;
    if (isPoly) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', rect.points!.map((p) => `${p.x * 100},${p.y * 100}`).join(' '));
      svg.appendChild(poly);
      el.appendChild(svg);
      dragTarget = poly;
    }

    const handle = el.createDiv({ cls: 'sNr-handle' });

    dragTarget.addEventListener('click', (ev: Event) => {
      const e = ev as MouseEvent;
      if (e.detail === 0) return;
      e.stopPropagation();
      this.selectShape(canvas, file, rect, el);
    });
    dragTarget.addEventListener('dblclick', (ev: Event) => {
      const e = ev as MouseEvent;
      e.stopPropagation();
      this.togglePair(canvas, rect, !el.classList.contains('sNr-revealed'));
    });

    // Drag body to move
    dragTarget.addEventListener('mousedown', (ev: Event) => {
      const e = ev as MouseEvent;
      if (e.target === handle) return;
      if (this.drawingPaths.has(file.path) || this.polyDrawingPaths.has(file.path)) return;
      e.preventDefault();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const ox = rect.x, oy = rect.y;
      this.snapshot();
      const move = (mv: MouseEvent) => {
        const dx = (mv.clientX - startX) / cb.width;
        const dy = (mv.clientY - startY) / cb.height;
        rect.x = clamp01(Math.min(1 - rect.w, Math.max(0, ox + dx)));
        rect.y = clamp01(Math.min(1 - rect.h, Math.max(0, oy + dy)));
        el.style.left = (rect.x * 100) + '%';
        el.style.top = (rect.y * 100) + '%';
        this.updatePairOverlayPosition(canvas, rect);
        // If this cover has a target region, the connector originates at
        // its bbox centre — refresh it live.
        if (rect.targetRegion) this.updateTargetConnector(canvas, rect);
      };
      const up = async () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        await this.saveFolderData();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // Resize handle (works for rect AND polygon — scales bbox; polygon points are local 0..1, so they auto-scale)
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const ow = rect.w, oh = rect.h;
      this.snapshot();
      const move = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / cb.width;
        const dy = (ev.clientY - startY) / cb.height;
        rect.w = clamp01(Math.max(0.01, Math.min(1 - rect.x, ow + dx)));
        rect.h = clamp01(Math.max(0.01, Math.min(1 - rect.y, oh + dy)));
        el.style.width = (rect.w * 100) + '%';
        el.style.height = (rect.h * 100) + '%';
        // Pair tag is centered on the shape, so resizing also moves it.
        this.updatePairOverlayPosition(canvas, rect);
        // Same for the target connector (bbox-center moves on resize).
        if (rect.targetRegion) this.updateTargetConnector(canvas, rect);
      };
      const up = async () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        await this.saveFolderData();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  /** Build ordered groups of shape ids for the reveal slider. Paired shapes are
   *  grouped by their pair number (ascending); unpaired shapes are each their
   *  own slot, appended in original order. */
  computeRevealGroups(file: TFile): string[][] {
    const { list } = this.rectsFor(file);
    const pairMap = new Map<number, string[]>();
    const unpaired: string[] = [];
    for (const r of list) {
      if (r.pair && r.pair > 0) {
        const ids = pairMap.get(r.pair) ?? [];
        ids.push(r.id);
        pairMap.set(r.pair, ids);
      } else {
        unpaired.push(r.id);
      }
    }
    const sortedPairs = Array.from(pairMap.keys()).sort((a, b) => a - b);
    const groups: string[][] = sortedPairs.map((p) => pairMap.get(p)!);
    for (const id of unpaired) groups.push([id]);
    return groups;
  }

  /** Set the reveal slider position for an image. Step 0 = all hidden;
   *  step N reveals the first N groups. Persists to folderData. */
  setRevealStep(file: TFile, canvas: HTMLElement, groups: string[][], step: number): void {
    const clamped = Math.max(0, Math.min(groups.length, step));
    if (!this.folderData.revealSteps) this.folderData.revealSteps = {};
    const relKey = relTo(this.folderPath, file.path);
    if (this.folderData.revealSteps[relKey] !== clamped) {
      this.folderData.revealSteps[relKey] = clamped;
      this.scheduleSave();
    }
    // Progress drives a subtle "fade as you advance" effect: remaining
    // covers get a touch more transparent as more groups are revealed,
    // and the rail itself fades a bit so it gets out of the way once
    // you've made it most of the way through. Floors keep things
    // legible and visible at any progress.
    const progress = groups.length > 0 ? clamped / groups.length : 0;
    const coverAlpha = Math.max(0.55, 1 - progress * 0.45);
    const railAlpha = Math.max(0.4, 1 - progress * 0.5);
    for (let i = 0; i < groups.length; i++) {
      const reveal = i < clamped;
      for (const id of groups[i]) {
        const el = canvas.querySelector(`.sNr-rect[data-id="${id}"]`) as HTMLElement | null;
        if (!el) continue;
        el.classList.toggle('sNr-revealed', reveal);
        // Apply the progressive cover-fade only to still-hidden shapes.
        // (Revealed ones use the existing .sNr-revealed opacity rule.)
        el.style.setProperty('--sNr-cover-alpha', reveal ? '1' : String(coverAlpha));
        // Pair # overlay tracks the cover (see togglePair): visible when
        // the cover is up, hidden once the shape is revealed.
        const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${id}"]`);
        if (ov) ov.classList.toggle('sNr-pair-overlay--visible', !reveal);
      }
    }
    const block = canvas.closest('.sNr-block') as HTMLElement | null;
    const rail = block?.querySelector('.sNr-rail') as HTMLElement | null;
    if (rail) {
      const total = groups.length;
      const thumb = rail.querySelector('.sNr-rail-thumb') as HTMLElement | null;
      if (thumb) {
        thumb.style.top = total === 0 ? '50%' : (clamped / total * 100) + '%';
        // Only the thumb fades as it travels down — the rest of the rail
        // (line, dots, chevrons, label) stays at full opacity for clarity.
        thumb.style.opacity = String(railAlpha);
      }
      const label = rail.querySelector('.sNr-rail-label') as HTMLElement | null;
      if (label) label.setText(`${clamped}/${total}`);
    }
  }

  bumpRevealStep(file: TFile, canvas: HTMLElement, delta: number): void {
    const groups = this.computeRevealGroups(file);
    const relKey = relTo(this.folderPath, file.path);
    const cur = this.folderData.revealSteps?.[relKey] ?? 0;
    this.setRevealStep(file, canvas, groups, cur + delta);
  }

  /** Render the vertical reveal-slider on the left side of an image. */
  renderRail(host: HTMLElement, file: TFile, canvas: HTMLElement): void {
    const groups = this.computeRevealGroups(file);
    const total = groups.length;
    const rail = host.createDiv({ cls: 'sNr-rail' });

    // Step-back button at the top of the rail.
    const upBtn = rail.createDiv({ cls: 'sNr-rail-btn sNr-rail-up' });
    setIcon(upBtn, 'chevron-up');
    upBtn.title = 'Hide one (one step up)';
    upBtn.onclick = (e) => { e.stopPropagation(); this.bumpRevealStep(file, canvas, -1); };

    // The track lives inside a flex-grow wrapper so it fills the rail
    // height between the two buttons.
    const trackWrap = rail.createDiv({ cls: 'sNr-rail-trackwrap' });
    const track = trackWrap.createDiv({ cls: 'sNr-rail-track' });
    for (let i = 0; i <= total; i++) {
      const dot = track.createDiv({ cls: 'sNr-rail-dot' });
      dot.style.top = total === 0 ? '50%' : (i / total * 100) + '%';
      dot.dataset.step = String(i);
      dot.title = `Reveal ${i}/${total}`;
      const stepNum = i;
      dot.onclick = (e) => { e.stopPropagation(); this.setRevealStep(file, canvas, groups, stepNum); };
    }
    const thumb = track.createDiv({ cls: 'sNr-rail-thumb' });

    // Step-forward button at the bottom of the rail.
    const downBtn = rail.createDiv({ cls: 'sNr-rail-btn sNr-rail-down' });
    setIcon(downBtn, 'chevron-down');
    downBtn.title = 'Reveal one (one step down)';
    downBtn.onclick = (e) => { e.stopPropagation(); this.bumpRevealStep(file, canvas, +1); };

    rail.createDiv({ cls: 'sNr-rail-label' });

    // Apply the saved step (else default 0) so the visuals are correct
    // on first paint.
    const relKey = relTo(this.folderPath, file.path);
    const cur = this.folderData.revealSteps?.[relKey] ?? 0;
    this.setRevealStep(file, canvas, groups, cur);

    // Drag the thumb (or click+drag anywhere on the track) to scrub the
    // reveal slider. Snaps to the nearest step on each mouse move.
    const beginScrub = (startEvt: MouseEvent) => {
      startEvt.preventDefault();
      const trackRect = track.getBoundingClientRect();
      const stepFromY = (clientY: number): number => {
        if (trackRect.height <= 0) return 0;
        const rel = (clientY - trackRect.top) / trackRect.height;
        return Math.max(0, Math.min(total, Math.round(rel * total)));
      };
      this.setRevealStep(file, canvas, groups, stepFromY(startEvt.clientY));
      const move = (mv: MouseEvent) => {
        this.setRevealStep(file, canvas, groups, stepFromY(mv.clientY));
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    thumb.addEventListener('mousedown', beginScrub);
    track.addEventListener('mousedown', (e) => {
      // Don't double-trigger when the click was a dot (which has its own onclick)
      if ((e.target as HTMLElement).classList.contains('sNr-rail-dot')) return;
      if (e.target === thumb) return; // thumb has its own listener
      beginScrub(e);
    });

    // Mouse-wheel inside the canvas advances/retreats the slider one step
    // at a time. Outside the canvas (the gap between blocks, the sidebar,
    // the header) wheel events are NOT intercepted, so the user can scroll
    // the image list normally.
    //
    // Special case: when zoom > 100% the image overflows horizontally and
    // there's not much "outside" left to scroll the list. Bail out of
    // wheel-steals so the user can scroll past the image and reach the
    // next one. They can still use ↑/↓ arrow keys to scrub the rail.
    let accum = 0;
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      // Trackpad pinch / Ctrl+wheel = zoom. Let the view-level zoom
      // handler take it (don't preventDefault here so the parent's
      // wheel listener can act on the same event).
      if (e.ctrlKey) return;
      // Edit mode: wheel is hands-off. User can scroll the list,
      // navigate through images, no reveal stepping.
      if (this.plugin.settings.mode === 'edit') return;
      // Past 100% zoom we usually pass-through so the user can scroll
      // through the now-wider image. The wheelStepPast100 setting flips
      // that — keep stepping the rail even when zoomed (useful if
      // you've sized up and still want to scroll-study).
      if (this.plugin.settings.imageScale > 100 && !this.plugin.settings.wheelStepPast100) return;
      e.preventDefault();
      // Read the threshold every event so settings changes apply
      // immediately without needing to re-render.
      const STEP = Math.max(10, this.plugin.settings.wheelStepThreshold || 60);
      accum += e.deltaY;
      while (accum >= STEP) { accum -= STEP; this.bumpRevealStep(file, canvas, +1); }
      while (accum <= -STEP) { accum += STEP; this.bumpRevealStep(file, canvas, -1); }
    }, { passive: false });
  }

  togglePair(canvas: HTMLElement, rect: Rect, reveal: boolean): void {
    const pair = rect.pair || 0;
    const targets: Element[] = pair > 0
      ? Array.from(canvas.querySelectorAll(`.sNr-rect[data-pair="${pair}"]`))
      : Array.from(canvas.querySelectorAll(`.sNr-rect[data-id="${rect.id}"]`));
    targets.forEach((t) => {
      t.classList.toggle('sNr-revealed', reveal);
      // Pair # overlay shows ONLY when the cover is up (i.e. NOT revealed),
      // so during study you see the colored covers tagged with their pair
      // numbers. Once the cover fades away the underlying label is what
      // matters and the number gets out of the way.
      const id = (t as HTMLElement).dataset.id;
      if (id) {
        const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${id}"]`);
        if (ov) ov.classList.toggle('sNr-pair-overlay--visible', !reveal);
      }
    });
  }

  flashPair(canvas: HTMLElement, rect: Rect, onEnd?: () => void): void {
    this.togglePair(canvas, rect, true);
    const seconds = (rect.seconds && rect.seconds > 0) ? rect.seconds : this.plugin.settings.defaultSeconds;
    const existing = this.timers.get(rect.id);
    if (existing) clearTimeout(existing);
    const t = window.setTimeout(() => {
      this.togglePair(canvas, rect, false);
      this.timers.delete(rect.id);
      onEnd?.();
    }, seconds * 1000);
    this.timers.set(rect.id, t);
  }

  /** Cancel an in-flight flash timer for `rect` (if any) and immediately
   *  hide the pair. */
  cancelFlash(canvas: HTMLElement, rect: Rect): void {
    const existing = this.timers.get(rect.id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(rect.id);
    }
    this.togglePair(canvas, rect, false);
  }

  applyColor(canvas: HTMLElement, file: TFile, rect: Rect, newColor: string): void {
    rect.color = newColor;
    const ownEl = canvas.querySelector(`.sNr-rect[data-id="${rect.id}"]`) as HTMLElement | null;
    if (ownEl) ownEl.style.setProperty('--sNr-color', newColor);

    const mode = this.plugin.settings.pairColorMode;
    if (rect.pair && rect.pair > 0 && mode !== 'off') {
      const { list } = this.rectsFor(file);
      // 'first-to-rest': only the first member of the pair (in list order)
      // is allowed to push its color onto the rest.
      if (mode === 'first-to-rest') {
        const leader = list.find((r) => r.pair === rect.pair);
        if (!leader || leader.id !== rect.id) {
          this.scheduleSave();
          return;
        }
      }
      for (const other of list) {
        if (other.id === rect.id || other.pair !== rect.pair) continue;
        other.color = newColor;
        const otherEl = canvas.querySelector(`.sNr-rect[data-id="${other.id}"]`) as HTMLElement | null;
        if (otherEl) otherEl.style.setProperty('--sNr-color', newColor);
      }
    }
    this.scheduleSave();
  }

  /** Recompute a polygon's bbox from its current vertex positions and remap its local points. */
  normalizePolygon(rect: Rect): void {
    if (rect.kind !== 'polygon' || !rect.points) return;
    // points are local 0..1 of the current bbox — map to canvas coords first
    const canvasPts = rect.points.map((p) => ({
      x: rect.x + p.x * rect.w,
      y: rect.y + p.y * rect.h
    }));
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of canvasPts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    minX = clamp01(minX); minY = clamp01(minY);
    maxX = clamp01(maxX); maxY = clamp01(maxY);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    rect.x = minX; rect.y = minY; rect.w = w; rect.h = h;
    rect.points = canvasPts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
  }

  /** Draw draggable handles at each polygon vertex. Called when a polygon is selected. */
  renderPolyVertices(canvas: HTMLElement, file: TFile, rect: Rect, el: HTMLElement): void {
    if (rect.kind !== 'polygon' || !rect.points) return;
    canvas.querySelectorAll(`.sNr-vertex[data-shape-id="${rect.id}"]`).forEach((v) => v.remove());
    for (let i = 0; i < rect.points.length; i++) {
      const idx = i;
      const p = rect.points[i];
      const v = canvas.createDiv({ cls: 'sNr-vertex' });
      v.dataset.shapeId = rect.id;
      v.dataset.vertexIdx = String(idx);
      const cx = rect.x + p.x * rect.w;
      const cy = rect.y + p.y * rect.h;
      v.style.left = (cx * 100) + '%';
      v.style.top = (cy * 100) + '%';

      v.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = canvas.getBoundingClientRect();
        this.snapshot();
        const move = (mv: MouseEvent) => {
          const nx = clamp01((mv.clientX - cb.left) / cb.width);
          const ny = clamp01((mv.clientY - cb.top) / cb.height);
          v.style.left = (nx * 100) + '%';
          v.style.top = (ny * 100) + '%';
          rect.points![idx] = {
            x: (nx - rect.x) / rect.w,
            y: (ny - rect.y) / rect.h
          };
          const poly = el.querySelector('polygon');
          if (poly) {
            poly.setAttribute(
              'points',
              rect.points!.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(' ')
            );
          }
        };
        const up = async () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          this.normalizePolygon(rect);
          await this.saveFolderData();
          this.render();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });

      // Right-click a vertex to delete it (if more than 3 remain)
      v.addEventListener('contextmenu', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!rect.points || rect.points.length <= 3) {
          new Notice('A polygon needs at least 3 points.');
          return;
        }
        this.snapshot();
        rect.points.splice(idx, 1);
        this.normalizePolygon(rect);
        await this.saveFolderData();
        this.render();
      });
    }
  }

  /** Rebuild the header's per-image tool buttons. Active state reflects
   *  whichever image is currently at the top of the visible area
   *  (currentImageContext). Called on render and on scroll. */
  refreshHeaderTools(): void {
    const tools = this.headerToolsEl;
    if (!tools) return;
    tools.empty();
    const ctx = this.currentImageContext();
    const file = ctx?.file ?? null;

    // Mark the currently-focused block so CSS can highlight it. Cheap to
    // do here because refreshHeaderTools already fires on every scroll-rAF.
    if (this.scrollerEl) {
      const blocks = Array.from(this.scrollerEl.querySelectorAll('.sNr-block')) as HTMLElement[];
      const focusedPath = ctx ? ctx.file.path : null;
      for (const b of blocks) {
        b.classList.toggle('sNr-focused', b.dataset.path === focusedPath);
      }
    }

    const drawBtn = this.iconBtn(tools, 'square', 'Rectangle');
    drawBtn.title = 'Add rectangle to the focused image (drag on it)';
    if (file && this.drawingPaths.has(file.path)) drawBtn.addClass('sNr-active');
    if (!file) drawBtn.disabled = true;
    drawBtn.onclick = () => {
      if (!file) return;
      if (this.drawingPaths.has(file.path)) this.drawingPaths.delete(file.path);
      else { this.drawingPaths.add(file.path); this.polyDrawingPaths.delete(file.path); }
      this.render();
    };

    const polyBtn = this.iconBtn(tools, 'pentagon', 'Polygon');
    polyBtn.title = 'Add polygon to the focused image (click vertices, then Finalize)';
    if (file && this.polyDrawingPaths.has(file.path)) polyBtn.addClass('sNr-active');
    if (!file) polyBtn.disabled = true;
    polyBtn.onclick = () => {
      if (!file) return;
      if (this.polyDrawingPaths.has(file.path)) {
        this.polyDrawingPaths.delete(file.path);
        this.cancelPolyDraft();
      } else {
        this.polyDrawingPaths.add(file.path);
        this.drawingPaths.delete(file.path);
      }
      this.render();
    };

    // Finalize/Cancel buttons appear whenever a draft is in flight,
    // regardless of which image is currently focused — otherwise scrolling
    // away from the drafting image makes them disappear mid-task.
    const draftingFile = this.polyDraft?.file ?? null;
    const isTargetDrafting = this.polyDraft?.destination.kind === 'target';
    const regularDraftingActive = !!(draftingFile && this.polyDrawingPaths.has(draftingFile.path));
    if (this.polyDraft && (regularDraftingActive || isTargetDrafting)) {
      const doneBtn = tools.createEl('button', { cls: 'sNr-iconbtn sNr-iconbtn-icon-only sNr-poly-done' });
      setIcon(doneBtn, 'check');
      doneBtn.title = isTargetDrafting ? 'Finalize target region' : 'Finalize polygon';
      doneBtn.onclick = () => this.commitPolyDraft();
      const cancelBtn = tools.createEl('button', { cls: 'sNr-iconbtn sNr-iconbtn-icon-only sNr-poly-cancel' });
      setIcon(cancelBtn, 'x');
      cancelBtn.title = isTargetDrafting ? 'Cancel target region' : 'Cancel polygon';
      cancelBtn.onclick = () => {
        const df = draftingFile;
        this.cancelPolyDraft();
        if (df) this.polyDrawingPaths.delete(df.path);
        this.render();
      };
    }

    const revealBtn = this.iconBtn(tools, 'eye', 'Reveal');
    revealBtn.title = 'Reveal all shapes on the focused image';
    if (!ctx) revealBtn.disabled = true;
    revealBtn.onclick = () => {
      if (!ctx) return;
      ctx.canvas.querySelectorAll('.sNr-rect').forEach((r) => r.classList.add('sNr-revealed'));
    };
    const hideBtn = this.iconBtn(tools, 'eye-off', 'Hide');
    hideBtn.title = 'Hide all shapes on the focused image';
    if (!ctx) hideBtn.disabled = true;
    hideBtn.onclick = () => {
      if (!ctx) return;
      ctx.canvas.querySelectorAll('.sNr-rect').forEach((r) => r.classList.remove('sNr-revealed'));
    };
  }

  /** The image whose block is currently scrolled-to (used by keyboard
   *  shortcuts that need to know which image to act on). */
  /** Public accessor for the currently-focused image path. Used by the
   *  quiz scope picker so its "this slide" choice matches the same image
   *  the focused-block outline highlights. */
  getFocusedImagePath(): string | null {
    return this.currentImageContext()?.file.path ?? null;
  }

  private currentImageContext(): { file: TFile; canvas: HTMLElement } | null {
    if (!this.scrollerEl) return null;
    const blocks = Array.from(this.scrollerEl.querySelectorAll('.sNr-block')) as HTMLElement[];
    if (!blocks.length) return null;
    const block = blocks[this.currentBlockIndex(blocks)];
    const path = block.dataset.path;
    if (!path) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return null;
    const canvas = block.querySelector('.sNr-canvas') as HTMLElement | null;
    if (!canvas) return null;
    return { file: f, canvas };
  }

  /** Single source of truth for changing the image-scale percentage.
   *  Updates settings, the CSS variable, and (if rendered) the slider
   *  + the % text input. Clamped to [5, 1000]. */
  setImageScale(n: number, save = true): void {
    const clamped = Math.max(5, Math.min(1000, Math.round(n)));
    this.plugin.settings.imageScale = clamped;
    const root = this.containerEl.children[1] as HTMLElement;
    if (root) root.style.setProperty('--sNr-scale', clamped + '%');
    const slider = root?.querySelector('.sNr-scale-slider') as HTMLInputElement | null;
    if (slider) slider.value = String(Math.min(200, clamped));
    const pct = root?.querySelector('.sNr-scale-pct') as HTMLInputElement | null;
    if (pct) pct.value = clamped + '%';
    if (save) this.plugin.saveSettings();
  }

  /** Render (or update) the pair-number tag for a shape as a SIBLING of
   *  the shape inside the canvas — not as a child. Children inherit the
   *  shape's opacity (which becomes 0.08 when revealed), so the number
   *  used to disappear along with the cover. As a sibling it stays at
   *  full opacity regardless of reveal state, and stacks on top because
   *  of z-index. */
  private renderPairOverlay(canvas: HTMLElement, rect: Rect): void {
    canvas.querySelectorAll(`.sNr-pair-overlay[data-shape-id="${rect.id}"]`).forEach((n) => n.remove());
    if (!rect.pair || rect.pair <= 0) return;
    const tag = canvas.createDiv({ cls: 'sNr-pair-overlay', text: '#' + rect.pair });
    tag.dataset.shapeId = rect.id;
    // Center of the shape's bounding box. CSS uses
    // transform: translate(-50%, -50%) to center on this point.
    tag.style.left = ((rect.x + rect.w / 2) * 100) + '%';
    tag.style.top = ((rect.y + rect.h / 2) * 100) + '%';
    // Visibility tracks the cover: visible when the cover is up
    // (shape NOT revealed). Mirror the shape's current state so a
    // freshly-created or pair-edited overlay paints correctly without
    // waiting for the next togglePair / setRevealStep call.
    const shapeEl = canvas.querySelector(`.sNr-rect[data-id="${rect.id}"]`) as HTMLElement | null;
    if (!shapeEl || !shapeEl.classList.contains('sNr-revealed')) {
      tag.classList.add('sNr-pair-overlay--visible');
    }
  }

  /** Sync just the position of an existing pair overlay to its shape's
   *  current bbox. Cheap to call from drag/resize move handlers. */
  private updatePairOverlayPosition(canvas: HTMLElement, rect: Rect): void {
    const tag = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${rect.id}"]`) as HTMLElement | null;
    if (!tag) return;
    tag.style.left = ((rect.x + rect.w / 2) * 100) + '%';
    tag.style.top = ((rect.y + rect.h / 2) * 100) + '%';
  }

  /** Delete the currently-selected shape (called by Del/Backspace and the
   *  toolbar trash button). Snapshots first so it's undoable. */
  async deleteSelectedShape(): Promise<void> {
    const sel = this.selection;
    if (!sel) return;
    this.snapshot();
    const { key, list } = this.rectsFor(sel.file);
    this.folderData.rects[key] = list.filter((r) => r.id !== sel.rect.id);
    await this.saveFolderData();
    this.render();
  }

  /** Create a button with a Lucide icon followed by text. */
  private iconBtn(parent: HTMLElement, icon: string, text: string, opts?: { cls?: string }): HTMLButtonElement {
    const btn = parent.createEl('button', { cls: 'sNr-iconbtn' + (opts?.cls ? ' ' + opts.cls : '') });
    const ico = btn.createSpan({ cls: 'sNr-iconbtn-ico' });
    setIcon(ico, icon);
    if (text) btn.createSpan({ cls: 'sNr-iconbtn-text', text });
    return btn;
  }

  /** Attach a vertical pair of ▲/▼ buttons beside a number input that
   *  step it by its `step` attribute and trigger 'change'. The browser's
   *  native spinner controls are inconsistent across platforms; explicit
   *  buttons make it obvious you can click to nudge values. */
  private attachStepperButtons(wrap: HTMLElement, input: HTMLInputElement): void {
    const btns = wrap.createDiv({ cls: 'sNr-stepper-btns' });
    const up = btns.createDiv({ cls: 'sNr-stepper-btn' });
    setIcon(up, 'chevron-up');
    up.title = 'Increase';
    up.onclick = (e) => {
      e.stopPropagation();
      input.stepUp();
      input.dispatchEvent(new Event('change'));
    };
    const down = btns.createDiv({ cls: 'sNr-stepper-btn' });
    setIcon(down, 'chevron-down');
    down.title = 'Decrease';
    down.onclick = (e) => {
      e.stopPropagation();
      input.stepDown();
      input.dispatchEvent(new Event('change'));
    };
  }

  // ---------- Floating per-rect toolbar ----------
  selectShape(canvas: HTMLElement, file: TFile, rect: Rect, el: HTMLElement): void {
    const root = canvas.closest('.sNr-view') as HTMLElement;
    root.querySelectorAll('.sNr-rect.sNr-selected').forEach((r) => r.classList.remove('sNr-selected'));
    root.querySelectorAll('.sNr-target-region.sNr-selected').forEach((r) => r.classList.remove('sNr-selected'));
    // The toolbar is body-attached (position: fixed), so clean up there.
    document.body.querySelectorAll('.sNr-rect-toolbar').forEach((t) => t.remove());
    root.querySelectorAll('.sNr-vertex').forEach((v) => v.remove());
    el.classList.add('sNr-selected');
    this.selection = { canvas, file, rect, el };
    this.targetSelection = null;

    if (rect.kind === 'polygon') this.renderPolyVertices(canvas, file, rect, el);

    const tb = document.body.createDiv({ cls: 'sNr-rect-toolbar' });
    // Position is computed from el.getBoundingClientRect() and clamped to
    // the viewport, so toolbars near the right/bottom edge stay visible.
    const reposition = () => {
      const rb = el.getBoundingClientRect();
      const tbW = tb.offsetWidth || 280;
      const tbH = tb.offsetHeight || 38;
      const margin = 8;
      // Prefer above; fall back to below if there's no room above.
      let top = rb.top - tbH - 6;
      if (top < margin) top = rb.bottom + 6;
      // Prefer left-aligned with the rect; clamp into viewport.
      let left = rb.left;
      const maxLeft = window.innerWidth - tbW - margin;
      if (left > maxLeft) left = maxLeft;
      if (left < margin) left = margin;
      tb.style.top = top + 'px';
      tb.style.left = left + 'px';
    };
    // Defer first reposition so offsetWidth/Height reflect actual content.
    requestAnimationFrame(reposition);
    this.scrollerEl.addEventListener('scroll', reposition);
    window.addEventListener('resize', reposition);
    const detachReposition = () => {
      this.scrollerEl.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };

    const bToggle = tb.createEl('button', { cls: 'sNr-tb-icon-btn' });
    const setToggleIcon = (revealed: boolean) => {
      bToggle.empty();
      setIcon(bToggle, revealed ? 'eye' : 'eye-off');
      bToggle.title = revealed ? 'Hide this shape (or pair)' : 'Reveal this shape (or pair)';
    };
    setToggleIcon(el.classList.contains('sNr-revealed'));
    bToggle.onclick = (e) => {
      e.stopPropagation();
      const reveal = !el.classList.contains('sNr-revealed');
      this.togglePair(canvas, rect, reveal);
      setToggleIcon(reveal);
    };

    tb.createDiv({ cls: 'sNr-tb-divider' });

    // Flash button: timer icon by default, inherits the shape's color
    // (so it's visually associated with what it'll reveal). When a flash
    // is in flight, the button pulses; hovering it swaps the icon to
    // 'x' (cancel) and clicking either while pulsing or while hovering
    // cancels the timer + hides immediately.
    const bFlash = tb.createEl('button', { cls: 'sNr-tb-icon-btn sNr-tb-flash' });
    const setFlashIcon = (icon: 'timer' | 'x') => { bFlash.empty(); setIcon(bFlash, icon); };
    const refreshFlash = () => {
      const active = this.timers.has(rect.id);
      bFlash.classList.toggle('sNr-tb-flash-active', active);
      bFlash.title = active
        ? 'Cancel timer (hide now)'
        : `Flash: reveal then auto-hide after ${rect.seconds || this.plugin.settings.defaultSeconds} sec`;
      // Default icon when not hovered. Hover handlers override during hover.
      setFlashIcon(active && bFlash.matches(':hover') ? 'x' : 'timer');
    };
    refreshFlash();
    bFlash.addEventListener('mouseenter', () => {
      if (this.timers.has(rect.id)) setFlashIcon('x');
    });
    bFlash.addEventListener('mouseleave', () => {
      setFlashIcon('timer');
    });
    bFlash.onclick = (e) => {
      e.stopPropagation();
      if (this.timers.has(rect.id)) {
        this.cancelFlash(canvas, rect);
        refreshFlash();
        setFlashIcon('timer');
      } else {
        this.flashPair(canvas, rect, () => {
          // Timer fired naturally — restore default appearance.
          refreshFlash();
        });
        refreshFlash();
      }
    };

    tb.createSpan({ cls: 'sNr-tb-label', text: 'Sec' });
    const secWrap = tb.createDiv({ cls: 'sNr-stepper' });
    const sec = secWrap.createEl('input', { type: 'number' });
    sec.title = `Reveal-then-hide duration in seconds (default ${this.plugin.settings.defaultSeconds})`;
    sec.placeholder = `${this.plugin.settings.defaultSeconds} sec`;
    sec.value = rect.seconds ? String(rect.seconds) : '';
    sec.min = '0'; sec.step = '0.5';
    this.attachStepperButtons(secWrap, sec);
    sec.onchange = async () => {
      this.snapshot();
      const v = parseFloat(sec.value);
      rect.seconds = isFinite(v) && v > 0 ? v : 0;
      await this.saveFolderData();
    };

    tb.createDiv({ cls: 'sNr-tb-divider' });
    tb.createSpan({ cls: 'sNr-tb-label', text: 'Pair' });
    const pairWrap = tb.createDiv({ cls: 'sNr-stepper' });
    const pair = pairWrap.createEl('input', { type: 'number' });
    pair.value = String(rect.pair || 0);
    pair.min = '0'; pair.step = '1';
    pair.placeholder = 'Pair #';
    pair.title = 'Pair number (0 = unpaired). Shapes sharing a pair number reveal/hide together.';
    this.attachStepperButtons(pairWrap, pair);
    pair.onchange = async () => {
      this.snapshot();
      const v = parseInt(pair.value, 10);
      rect.pair = isFinite(v) && v > 0 ? v : 0;
      el.dataset.pair = String(rect.pair);
      this.renderPairOverlay(canvas, rect);
      // When joining an EXISTING pair, the joining shape adopts the
      // leader's color. This works in every mode except 'off' — the
      // 'all' / 'first-to-rest' modes both want pairs to look uniform,
      // and the right answer when a follower joins is to inherit (not
      // overwrite the leader). 'off' truly means "no color sync" so
      // we leave the new shape's own color alone there.
      if (rect.pair > 0 && this.plugin.settings.pairColorMode !== 'off') {
        const { list } = this.rectsFor(file);
        const leader = list.find((r) => r.id !== rect.id && r.pair === rect.pair);
        if (leader) {
          rect.color = leader.color;
          el.style.setProperty('--sNr-color', leader.color);
        }
      }
      await this.saveFolderData();
    };

    // 'Insert pair' button: compacts the distinct pair numbers above the
    // entered value down to N+1, N+2, N+3 … so the sequence is tightly
    // packed. Pairs ≤ N (including the current shape's, and any peers
    // that share its pair) are untouched. Group-aware: shapes sharing
    // the same old pair end up sharing the same new pair.
    //
    //   Example: pairs in image are {3, 6, 8, 12}, user enters 3
    //   → result: {3, 4, 5, 6}
    const insertBtn = tb.createEl('button', { cls: 'sNr-tb-icon-btn' });
    setIcon(insertBtn, 'list-plus');
    insertBtn.title = 'Renumber higher pairs: compact every distinct pair number greater than the entered value into N+1, N+2, … (this shape and any peers ≤ N keep their numbers).';
    insertBtn.onclick = async (e) => {
      e.stopPropagation();
      const target = parseInt(pair.value, 10);
      if (!isFinite(target) || target <= 0) {
        new Notice('Enter a positive pair number first.');
        return;
      }
      const { list } = this.rectsFor(file);
      // Distinct pair values strictly greater than the target, ascending.
      const higher = Array.from(new Set(
        list.filter((r) => r.pair > target).map((r) => r.pair)
      )).sort((a, b) => a - b);
      // Build oldPair → newPair: first higher group → target+1, etc.
      const remap = new Map<number, number>();
      higher.forEach((p, i) => remap.set(p, target + 1 + i));

      // Skip if nothing actually changes (already tightly packed).
      let willChange = false;
      for (const [old, neu] of remap) if (old !== neu) { willChange = true; break; }
      if (!willChange) {
        new Notice('Pair numbers above ' + target + ' are already compact.');
        return;
      }

      this.snapshot();
      let changed = 0;
      for (const r of list) {
        const newPair = remap.get(r.pair);
        if (newPair !== undefined && newPair !== r.pair) {
          r.pair = newPair;
          changed++;
          const otherEl = canvas.querySelector(`.sNr-rect[data-id="${r.id}"]`) as HTMLElement | null;
          if (otherEl) otherEl.dataset.pair = String(r.pair);
          const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${r.id}"]`) as HTMLElement | null;
          if (ov) ov.setText('#' + r.pair);
        }
      }
      await this.saveFolderData();
      new Notice(`Renumbered ${changed} shape${changed === 1 ? '' : 's'} above pair ${target}.`);
      this.render();
    };

    tb.createDiv({ cls: 'sNr-tb-divider' });

    // Custom color control: a round CSS button whose background = current
    // color, plus a hidden native <input type="color"> we trigger with
    // .click(). This avoids browser-specific oval swatch rendering.
    const colorWrap = tb.createSpan({ cls: 'sNr-color-wrap' });
    const colorBtn = colorWrap.createDiv({ cls: 'sNr-color-btn' });
    colorBtn.style.background = rect.color || this.plugin.settings.defaultColor;
    colorBtn.title = 'Pick color';
    const colorInput = colorWrap.createEl('input', { type: 'color' });
    colorInput.value = rect.color || this.plugin.settings.defaultColor;
    colorBtn.onclick = (e) => { e.stopPropagation(); colorInput.click(); };
    let colorSnapshotted = false;
    colorInput.oninput = () => {
      if (!colorSnapshotted) { this.snapshot(); colorSnapshotted = true; }
      this.applyColor(canvas, file, rect, colorInput.value);
      colorBtn.style.background = colorInput.value;
    };

    tb.createDiv({ cls: 'sNr-tb-divider' });

    // Target-region button: enrolls this cover in the cross-diagram quiz
    // pool. If a target region already exists, the button removes it.
    const tgtBtn = tb.createEl('button', { cls: 'sNr-tb-icon-btn' });
    const refreshTgt = () => {
      tgtBtn.empty();
      const has = !!rect.targetRegion;
      setIcon(tgtBtn, has ? 'target' : 'crosshair');
      tgtBtn.classList.toggle('sNr-tb-target-active', has);
      tgtBtn.title = has
        ? 'Remove target region (this label leaves the quiz pool)'
        : 'Add target region: a polygon over the structure this label points to. Required for cross-diagram quiz mode.';
    };
    refreshTgt();
    tgtBtn.onclick = async (e) => {
      e.stopPropagation();
      if (rect.targetRegion) {
        // Select the target region for adjustment (vertex edits + delete).
        // Find the rendered overlay element first.
        const overlay = canvas.querySelector(
          `.sNr-target-region[data-cover-id="${rect.id}"]`,
        ) as HTMLElement | null;
        if (!overlay) {
          // Shouldn't happen — the overlay is rendered alongside the cover.
          // Fall back to just letting the user re-draw by deleting.
          new Notice('Target region overlay missing. Re-rendering.');
          this.render();
          return;
        }
        this.selectTargetRegion(canvas, file, rect, overlay);
      } else {
        const block = canvas.closest('.sNr-block') as HTMLElement | null;
        if (!block) return;
        this.beginTargetRegionDraft(canvas, file, block, rect.id);
      }
    };

    tb.createDiv({ cls: 'sNr-tb-divider' });

    const del = tb.createEl('button', { cls: 'sNr-tb-icon-btn sNr-tb-danger' });
    setIcon(del, 'trash-2');
    del.title = 'Delete shape (Del / Backspace)';
    del.onclick = (e) => { e.stopPropagation(); this.deleteSelectedShape(); };

    // Replace any previously-attached offClick listener before adding the
    // new one. A stale offClick from a prior selection (with its own
    // captured `tb` / `el`) would otherwise fire here and remove the new
    // toolbar before its buttons' click handlers can run.
    if (this.currentOffClick) {
      document.removeEventListener('mousedown', this.currentOffClick, true);
      this.currentOffClick = null;
    }
    const offClick = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target) return;
      // Don't deselect when clicking inside the toolbar, the shape itself,
      // or any of its vertex handles.
      if (tb.contains(target) || el.contains(target)) return;
      if (target.closest && target.closest('.sNr-vertex')) return;
      tb.remove();
      el.classList.remove('sNr-selected');
      canvas.querySelectorAll('.sNr-vertex').forEach((v) => v.remove());
      detachReposition();
      this.selection = null;
      document.removeEventListener('mousedown', offClick, true);
      if (this.currentOffClick === offClick) this.currentOffClick = null;
    };
    this.currentOffClick = offClick;
    document.addEventListener('mousedown', offClick, true);
  }

  // ---------- File rename ----------
  renameFile(file: TFile): void {
    new RenameModal(this.app, file.name, async (newName) => {
      const parent = file.parent ? file.parent.path : '';
      const newPath = parent ? `${parent}/${newName}` : newName;
      const oldPath = file.path;
      try {
        await this.app.fileManager.renameFile(file, newPath);
        // Record AFTER success so a failed rename doesn't pollute the stack.
        this.recordRename(oldPath, newPath);
      } catch (e) {
        console.error(e);
        new Notice('Rename failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }).open();
  }
}
