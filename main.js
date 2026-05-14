"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SlideAndRevealPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/types.ts
var VIEW_TYPE = "slide-and-reveal-view";
var IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
var ANNOT_FILE = ".slide-and-reveal.json";
var LEGACY_ANNOT_FILE = ".image-annotator.json";
var DEFAULT_SETTINGS = {
  defaultSeconds: 3,
  defaultColor: "#3b82f6",
  knownFolders: [],
  imageScale: 80,
  sidebarWidth: 200,
  pairColorMode: "all",
  railSide: "left",
  arrowKeysZoom: true,
  arrowKeysZoomStep: 5,
  arrowKeysReveal: true,
  arrowKeysRevealInverted: false,
  wheelStepThreshold: 60,
  mode: "study",
  wheelStepPast100: false
};

// src/view.ts
var import_obsidian4 = require("obsidian");

// src/util.ts
function uid() {
  return Math.random().toString(36).slice(2, 9);
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function joinPath(folder, name) {
  return folder ? `${folder}/${name}` : name;
}
function relTo(folder, fullPath) {
  if (!folder) return fullPath;
  return fullPath.startsWith(folder + "/") ? fullPath.slice(folder.length + 1) : fullPath;
}

// src/modals.ts
var import_obsidian = require("obsidian");
var FolderPickerModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, folders, onPick) {
    super(app);
    this.folders = folders;
    this.onPick = onPick;
    this.setPlaceholder("Pick a Slide & Reveal folder\u2026");
  }
  getItems() {
    return this.folders;
  }
  getItemText(item) {
    return item;
  }
  onChooseItem(item) {
    this.onPick(item);
  }
};
var RenameModal = class extends import_obsidian.Modal {
  constructor(app, current, onSubmit) {
    super(app);
    this.current = current;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    this.titleEl.setText("Rename file");
    this.contentEl.createEl("p", { text: "Enter a new file name (extension included):" });
    this.inputEl = this.contentEl.createEl("input", { type: "text" });
    this.inputEl.value = this.current;
    this.inputEl.style.width = "100%";
    this.inputEl.focus();
    const dot = this.current.lastIndexOf(".");
    if (dot > 0) this.inputEl.setSelectionRange(0, dot);
    else this.inputEl.select();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
    const row = this.contentEl.createDiv();
    row.style.marginTop = "10px";
    row.style.textAlign = "right";
    row.style.gap = "6px";
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const ok = row.createEl("button", { text: "Rename" });
    ok.style.marginLeft = "6px";
    ok.onclick = () => this.submit();
  }
  submit() {
    const v = this.inputEl.value.trim();
    if (v && v !== this.current) this.onSubmit(v);
    this.close();
  }
};

// src/quiz-modals.ts
var import_obsidian3 = require("obsidian");

// src/quiz.ts
var import_obsidian2 = require("obsidian");
async function loadFolderData(app, folder) {
  const adapter = app.vault.adapter;
  for (const name of [ANNOT_FILE, LEGACY_ANNOT_FILE]) {
    const path = joinPath(folder, name);
    try {
      if (!await adapter.exists(path)) continue;
      const raw = await adapter.read(path);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
    }
  }
  return null;
}
async function buildQuizPool(app, scope) {
  const folders = scope.kind === "folder" ? [scope.folder] : scope.folders;
  const items = [];
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
          cover
        });
      }
    }
  }
  return shuffle(items);
}
function filterToImage(pool, imagePath) {
  return pool.filter((item) => item.imagePath === imagePath);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function getImage(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  return f && "stat" in f ? f : null;
}
function warnIfEmpty(pool) {
  if (pool.length > 0) return false;
  new import_obsidian2.Notice(
    'No quiz items found. Add a target region to a cover (click the cover, then "Add target region") to include it in the quiz.',
    6e3
  );
  return true;
}

// src/quiz-modals.ts
function activeSnRView(app) {
  const leaves = app.workspace.getLeavesOfType(VIEW_TYPE);
  const active = app.workspace.activeLeaf;
  if (active && leaves.includes(active)) return active.view;
  return leaves[0] ? leaves[0].view : null;
}
function currentImagePath(view) {
  return view ? view.getFocusedImagePath() : null;
}
var ScopePickerModal = class extends import_obsidian3.Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Quiz: choose scope");
    contentEl.empty();
    contentEl.createEl("p", {
      text: "Pull labels from where? Only covers that have a target region count \u2014 add one via the crosshair button on a cover."
    });
    const view = activeSnRView(this.app);
    const imagePath = currentImagePath(view);
    const folder = view?.folderPath ?? null;
    const knownFolders = this.plugin.settings.knownFolders.slice();
    const btnRow = contentEl.createDiv({ cls: "sNr-quiz-scope-row" });
    const slideBtn = btnRow.createEl("button", { text: "This slide" });
    slideBtn.title = imagePath ? `Pool: labels on ${imagePath}` : "Open a Slide & Reveal view first.";
    slideBtn.disabled = !imagePath || !folder;
    slideBtn.onclick = async () => {
      if (!imagePath || !folder) return;
      const pool = filterToImage(
        await buildQuizPool(this.app, { kind: "folder", folder }),
        imagePath
      );
      if (warnIfEmpty(pool)) return;
      this.close();
      new QuizModal(this.plugin, pool, `this slide (${imagePath.split("/").pop()})`).open();
    };
    const folderBtn = btnRow.createEl("button", { text: "This folder" });
    folderBtn.title = folder ? `Pool: labels across all slides in ${folder}` : "Open a Slide & Reveal view first.";
    folderBtn.disabled = !folder;
    folderBtn.onclick = async () => {
      if (!folder) return;
      const pool = await buildQuizPool(this.app, { kind: "folder", folder });
      if (warnIfEmpty(pool)) return;
      this.close();
      new QuizModal(this.plugin, pool, folder).open();
    };
    const multiBtn = btnRow.createEl("button", { text: "Multiple folders\u2026" });
    multiBtn.title = knownFolders.length ? `Pool: union of selected folders (${knownFolders.length} available)` : "No known folders yet.";
    multiBtn.disabled = knownFolders.length === 0;
    multiBtn.onclick = () => {
      this.close();
      new MultiFolderPickerModal(this.plugin, knownFolders, folder).open();
    };
    contentEl.createDiv({
      cls: "sNr-quiz-scope-hint",
      text: "Tip: each quiz item is one cover with a target region. Without target regions, the pool is empty."
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var MultiFolderPickerModal = class extends import_obsidian3.Modal {
  constructor(plugin, folders, defaultFolder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folders = folders;
    this.defaultFolder = defaultFolder;
    this.picked = /* @__PURE__ */ new Set();
    if (defaultFolder) this.picked.add(defaultFolder);
  }
  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Quiz: pick folders");
    contentEl.empty();
    const list = contentEl.createDiv({ cls: "sNr-quiz-folder-list" });
    for (const f of this.folders) {
      new import_obsidian3.Setting(list).setName(f).addToggle((t) => {
        t.setValue(this.picked.has(f));
        t.onChange((v) => {
          if (v) this.picked.add(f);
          else this.picked.delete(f);
        });
      });
    }
    const row = contentEl.createDiv({ cls: "sNr-quiz-scope-row" });
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const start = row.createEl("button", { text: "Start quiz", cls: "mod-cta" });
    start.onclick = async () => {
      const folders = Array.from(this.picked);
      if (!folders.length) {
        new import_obsidian3.Notice("Pick at least one folder.");
        return;
      }
      const scope = { kind: "folders", folders };
      const pool = await buildQuizPool(this.app, scope);
      if (warnIfEmpty(pool)) return;
      this.close();
      const label = folders.length === 1 ? folders[0] : `${folders.length} folders`;
      new QuizModal(this.plugin, pool, label).open();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QuizModal = class extends import_obsidian3.Modal {
  constructor(plugin, pool, scopeLabel) {
    super(plugin.app);
    this.plugin = plugin;
    this.pool = pool;
    this.scopeLabel = scopeLabel;
    this.index = 0;
    this.revealed = false;
    this.rightCount = 0;
    this.wrongCount = 0;
    /** Current view mode for the stage area. 'cropped' zooms into whichever
     *  region is relevant for the current step (target while prompting, cover
     *  while showing the answer — labels are easier to read up close). 'full'
     *  shows the whole source image with that region outlined. Sticky across
     *  steps so the user can pick a preference and keep it. */
    this.viewMode = "cropped";
    /** Per-folder annotation cache. The full-image preview overlays *all*
     *  cover concealers (otherwise the user could just read every label in
     *  the image and cheat the quiz). Loading happens lazily and is cached
     *  for the lifetime of the modal — pool building has already touched
     *  the same files, but those calls were one-shot. */
    this.folderCache = /* @__PURE__ */ new Map();
    this.modalEl.addClass("sNr-quiz-modal");
  }
  async coversFor(item) {
    let fd = this.folderCache.get(item.folder);
    if (fd === void 0) {
      fd = await loadFolderData(this.app, item.folder);
      this.folderCache.set(item.folder, fd);
    }
    if (!fd) return [];
    return fd.rects?.[item.relPath] ?? [];
  }
  onOpen() {
    this.renderStep();
  }
  onClose() {
    this.contentEl.empty();
  }
  renderStep() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(
      `Quiz \u2014 ${this.scopeLabel} \u2014 ${this.index + 1} / ${this.pool.length}`
    );
    const item = this.pool[this.index];
    if (!item) {
      this.renderDone();
      return;
    }
    const stage = contentEl.createDiv({ cls: "sNr-quiz-stage" });
    if (this.revealed) {
      this.renderAnswer(stage, item);
    } else {
      this.renderPrompt(stage, item);
    }
    const modeRow = contentEl.createDiv({ cls: "sNr-quiz-mode-row" });
    const toggleBtn = modeRow.createEl("button", { cls: "sNr-quiz-mode-toggle" });
    const cropped = this.viewMode === "cropped";
    const subject = this.revealed ? "label" : "target";
    (0, import_obsidian3.setIcon)(toggleBtn, cropped ? "maximize-2" : "minimize-2");
    toggleBtn.appendChild(document.createTextNode(
      cropped ? `  Show whole image (with ${subject} outlined)` : `  Show only the ${subject}`
    ));
    toggleBtn.title = "Toggle between zoomed-in crop and the full image";
    toggleBtn.onclick = () => {
      this.viewMode = cropped ? "full" : "cropped";
      this.renderStep();
    };
    const controls = contentEl.createDiv({ cls: "sNr-quiz-controls" });
    if (!this.revealed) {
      const btn = controls.createEl("button", { text: "Show answer", cls: "mod-cta" });
      btn.onclick = () => {
        this.revealed = true;
        this.renderStep();
      };
    } else {
      const wrong = controls.createEl("button", { cls: "sNr-quiz-wrong" });
      (0, import_obsidian3.setIcon)(wrong, "x");
      wrong.appendChild(document.createTextNode(" Missed it"));
      wrong.onclick = () => {
        this.wrongCount++;
        this.advance();
      };
      const right = controls.createEl("button", { cls: "sNr-quiz-right mod-cta" });
      (0, import_obsidian3.setIcon)(right, "check");
      right.appendChild(document.createTextNode(" Got it"));
      right.onclick = () => {
        this.rightCount++;
        this.advance();
      };
    }
    const meta = contentEl.createDiv({ cls: "sNr-quiz-meta" });
    meta.setText(`From: ${item.imagePath}`);
  }
  renderPrompt(stage, item) {
    stage.createDiv({ cls: "sNr-quiz-question", text: "What is this?" });
    if (this.viewMode === "cropped") {
      this.renderCroppedRegion(stage, item, item.targetRegion);
    } else {
      this.renderFullWithOutline(stage, item, item.targetRegion);
    }
  }
  /** Position and scale `img` inside `cropBox` so the (x,y,w,h) fractional
   *  region of the source fills the box without distortion. */
  applyCrop(cropBox, img, x, y, w, h) {
    const natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW || !natH) return;
    const bboxW = natW * w, bboxH = natH * h;
    const MAX_W = Math.min(640, window.innerWidth - 120);
    const MAX_H = Math.min(420, window.innerHeight - 280);
    const scale = Math.min(MAX_W / bboxW, MAX_H / bboxH);
    const dispW = bboxW * scale, dispH = bboxH * scale;
    cropBox.style.width = dispW + "px";
    cropBox.style.height = dispH + "px";
    img.style.width = natW * scale + "px";
    img.style.height = natH * scale + "px";
    img.style.left = -x * natW * scale + "px";
    img.style.top = -y * natH * scale + "px";
  }
  renderAnswer(stage, item) {
    const wrap = stage.createDiv({ cls: "sNr-quiz-answer" });
    const coverRegion = {
      x: item.cover.x,
      y: item.cover.y,
      w: item.cover.w,
      h: item.cover.h
    };
    if (this.viewMode === "cropped") {
      this.renderCroppedRegion(wrap, item, coverRegion);
    } else {
      this.renderFullWithOutline(
        wrap,
        item,
        coverRegion,
        /* outlineCover */
        true
      );
    }
    if (item.aliases && item.aliases.length) {
      const aliases = wrap.createDiv({ cls: "sNr-quiz-aliases" });
      aliases.setText("Also called: " + item.aliases.join(", "));
    }
  }
  /** Shared crop renderer: shows the (x,y,w,h) region of the source image
   *  filling a box, aspect-preserved. A small margin is added on each side
   *  so the cropped view has some breathing room — text near the edge of
   *  a tight cover bbox would otherwise touch the crop boundary and feel
   *  cut off even though it's technically inside. */
  renderCroppedRegion(parent, item, region) {
    const tFile = getImage(this.app, item.imagePath);
    if (!tFile) {
      parent.createDiv({ text: "Image missing: " + item.imagePath });
      return;
    }
    const cropBox = parent.createDiv({ cls: "sNr-quiz-crop" });
    const img = cropBox.createEl("img");
    img.src = this.app.vault.getResourcePath(tFile);
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
  renderFullWithOutline(parent, item, region, outlineCover = false) {
    const tFile = getImage(this.app, item.imagePath);
    if (!tFile) {
      parent.createDiv({ text: "Image missing: " + item.imagePath });
      return;
    }
    const imgWrap = parent.createDiv({ cls: "sNr-quiz-answer-img" });
    const img = imgWrap.createEl("img");
    img.src = this.app.vault.getResourcePath(tFile);
    img.onload = async () => {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const MAX_W = Math.min(720, window.innerWidth - 120);
      const MAX_H = Math.min(520, window.innerHeight - 280);
      const scale = Math.min(MAX_W / natW, MAX_H / natH);
      const dispW = natW * scale, dispH = natH * scale;
      imgWrap.style.width = dispW + "px";
      imgWrap.style.height = dispH + "px";
      img.style.width = dispW + "px";
      img.style.height = dispH + "px";
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
        const box = imgWrap.createDiv({ cls: "sNr-quiz-label-outline-rect" });
        box.style.left = region.x * 100 + "%";
        box.style.top = region.y * 100 + "%";
        box.style.width = region.w * 100 + "%";
        box.style.height = region.h * 100 + "%";
        box.style.borderColor = item.cover.color || this.plugin.settings.defaultColor;
      }
    };
  }
  /** Opaque concealer overlay matching a cover's shape (rect or polygon).
   *  Used in full-image quiz previews so labels under unrelated covers
   *  don't leak into the user's view. */
  renderConcealer(host, cover) {
    const color = cover.color || this.plugin.settings.defaultColor;
    const wrap = host.createDiv({ cls: "sNr-quiz-concealer" });
    wrap.style.left = cover.x * 100 + "%";
    wrap.style.top = cover.y * 100 + "%";
    wrap.style.width = cover.w * 100 + "%";
    wrap.style.height = cover.h * 100 + "%";
    if (cover.kind === "polygon" && cover.points) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", cover.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" "));
      poly.style.fill = color;
      svg.appendChild(poly);
      wrap.appendChild(svg);
    } else {
      wrap.style.background = color;
    }
  }
  /** Outline the cover (label region) on the answer image. Polygon if the
   *  cover has points; bbox rectangle otherwise. */
  drawAnswerOverlay(host, cover) {
    const color = cover.color || this.plugin.settings.defaultColor;
    if (cover.kind === "polygon" && cover.points) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("sNr-quiz-label-outline");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const pts = cover.points.map((p) => {
        const xx = (cover.x + p.x * cover.w) * 100;
        const yy = (cover.y + p.y * cover.h) * 100;
        return `${xx},${yy}`;
      }).join(" ");
      poly.setAttribute("points", pts);
      poly.style.stroke = color;
      svg.appendChild(poly);
      host.appendChild(svg);
    } else {
      const box = host.createDiv({ cls: "sNr-quiz-label-outline-rect" });
      box.style.left = cover.x * 100 + "%";
      box.style.top = cover.y * 100 + "%";
      box.style.width = cover.w * 100 + "%";
      box.style.height = cover.h * 100 + "%";
      box.style.borderColor = color;
    }
  }
  advance() {
    this.index++;
    this.revealed = false;
    this.renderStep();
  }
  renderDone() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText("Quiz complete");
    const done = contentEl.createDiv({ cls: "sNr-quiz-done" });
    const total = this.rightCount + this.wrongCount;
    const pct = total === 0 ? 0 : Math.round(100 * this.rightCount / total);
    done.createEl("p", { text: `Got ${this.rightCount} of ${total} (${pct}%).` });
    done.createEl("p", {
      cls: "sNr-quiz-done-note",
      text: "Score log persistence is a v2 feature \u2014 this result is session-only."
    });
    const row = contentEl.createDiv({ cls: "sNr-quiz-controls" });
    const again = row.createEl("button", { text: "Restart (reshuffle)", cls: "mod-cta" });
    again.onclick = () => {
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
    const close = row.createEl("button", { text: "Close" });
    close.onclick = () => this.close();
  }
};

// src/view.ts
var SlideAndRevealView = class _SlideAndRevealView extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.folderPath = "";
    this.folderData = { rects: {}, order: [], revealSteps: {} };
    this.timers = /* @__PURE__ */ new Map();
    this.drawingPaths = /* @__PURE__ */ new Set();
    // rectangle draw mode
    this.polyDrawingPaths = /* @__PURE__ */ new Set();
    // polygon draw mode
    this.saveQueued = false;
    /** When non-null, the user is mid-draft of a target region for this cover
     *  (cross-diagram quiz authoring). Routes canvas clicks to addPolyPoint
     *  even when polyDrawingPaths doesn't include the image. */
    this.targetDraftCoverId = null;
    // Polygon draft state
    this.polyDraft = null;
    // Undo / redo. Two op types: a folderData snapshot, or a vault file
    // rename (so undoing the rename actually moves the file back).
    this.undoStack = [];
    this.redoStack = [];
    this.MAX_HISTORY = 50;
    // Reveal-progress slider state lives on folderData.revealSteps, keyed by
    // image relPath. Don't keep a parallel in-memory map — it drifts out of
    // sync after undo/redo restores folderData from a snapshot.
    // Source path of the thumbnail currently being dragged (fallback for
    // dataTransfer in case the browser strips text/plain).
    this.draggingThumbPath = null;
    // Currently selected shape (set by selectShape, cleared on render and
    // by the floating-toolbar offClick). Used by the Delete/Backspace
    // keyboard shortcut to know what to remove.
    this.selection = null;
    /** Parallel selection for target regions. Lives separately because a
     *  target region isn't a Rect — it's a sub-field of its owning cover. */
    this.targetSelection = null;
    /** Tracks the most recently-attached body-level mousedown listener used
     *  by selectShape / selectTargetRegion. We remove it before adding a new
     *  one — otherwise stale listeners from a previous selection fire on the
     *  next click and tear down the new toolbar before its buttons' click
     *  events can fire. */
    this.currentOffClick = null;
    this.escScopePushed = false;
    this.plugin = plugin;
    this.escScope = new import_obsidian4.Scope(this.app.scope);
    this.escScope.register([], "Escape", (e) => {
      e.preventDefault();
      return false;
    });
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return this.folderPath ? `Slide & Reveal: ${this.folderPath}` : "Slide & Reveal";
  }
  getIcon() {
    return "image";
  }
  getState() {
    const s = super.getState() || {};
    s.folderPath = this.folderPath;
    return s;
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.folderPath === "string") {
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
  syncEscScope() {
    const active = this.app.workspace.getActiveViewOfType(_SlideAndRevealView) === this;
    if (active && !this.escScopePushed) {
      this.app.keymap.pushScope(this.escScope);
      this.escScopePushed = true;
    } else if (!active && this.escScopePushed) {
      this.app.keymap.popScope(this.escScope);
      this.escScopePushed = false;
    }
  }
  async onOpen() {
    this.render();
    this.syncEscScope();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncEscScope()));
    this.registerDomEvent(this.containerEl, "wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const cur = this.plugin.settings.imageScale;
      this.setImageScale(cur - e.deltaY * 0.3, true);
    }, { passive: false });
    const refresh = (f) => {
      if (f instanceof import_obsidian4.TFile && IMG_RE.test(f.path)) this.render();
    };
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof import_obsidian4.TFile)) return;
      const inFolderNow = this.folderPath && (file.path === this.folderPath || file.path.startsWith(this.folderPath + "/"));
      const wasInFolder = this.folderPath && (oldPath === this.folderPath || oldPath.startsWith(this.folderPath + "/"));
      if (!inFolderNow && !wasInFolder) return;
      if (IMG_RE.test(oldPath) || IMG_RE.test(file.path)) {
        const oldKey = relTo(this.folderPath, oldPath);
        const newKey = relTo(this.folderPath, file.path);
        if (oldKey !== newKey) {
          if (this.folderData.rects[oldKey]) {
            this.folderData.rects[newKey] = this.folderData.rects[oldKey];
            delete this.folderData.rects[oldKey];
          }
          const idx = this.folderData.order.indexOf(oldKey);
          if (idx >= 0) this.folderData.order[idx] = newKey;
          this.saveFolderData();
        }
        this.render();
      }
    }));
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key !== "Escape") return;
      const target = e.target;
      if (!target || !this.containerEl.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, { capture: true });
    this.registerDomEvent(this.containerEl, "keydown", (e) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!inField && (e.key === "Delete" || e.key === "Backspace")) {
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
      if (mod && !e.altKey && key === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && !e.altKey && key === "y") {
        e.preventDefault();
        e.stopPropagation();
        this.redo();
        return;
      }
      if (!inField && !mod && !e.altKey && !e.shiftKey && this.plugin.settings.arrowKeysZoom && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        e.stopPropagation();
        const step = this.plugin.settings.arrowKeysZoomStep || 5;
        const cur = this.plugin.settings.imageScale;
        this.setImageScale(e.key === "ArrowRight" ? cur + step : cur - step);
        return;
      }
      if (!inField && !mod && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (this.plugin.settings.arrowKeysReveal) {
          const ctx = this.currentImageContext();
          if (!ctx) return;
          e.preventDefault();
          e.stopPropagation();
          const inverted = this.plugin.settings.arrowKeysRevealInverted;
          const isDown = e.key === "ArrowDown";
          const delta = isDown !== inverted ? 1 : -1;
          this.bumpRevealStep(ctx.file, ctx.canvas, delta);
        } else if (this.scrollerEl) {
          e.preventDefault();
          e.stopPropagation();
          const SCROLL_PX = 60;
          this.scrollerEl.scrollTop += e.key === "ArrowDown" ? SCROLL_PX : -SCROLL_PX;
        }
        return;
      }
    });
  }
  async onClose() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.cancelPolyDraft();
    if (this.escScopePushed) {
      this.app.keymap.popScope(this.escScope);
      this.escScopePushed = false;
    }
  }
  annotFilePath() {
    return joinPath(this.folderPath, ANNOT_FILE);
  }
  async loadFolderData() {
    this.folderData = { rects: {}, order: [], revealSteps: {} };
    if (!this.folderPath) return;
    const newPath = this.annotFilePath();
    const legacyPath = joinPath(this.folderPath, LEGACY_ANNOT_FILE);
    let path = newPath;
    if (!await this.app.vault.adapter.exists(newPath) && await this.app.vault.adapter.exists(legacyPath)) {
      path = legacyPath;
    }
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.rects && typeof parsed.rects === "object" && Array.isArray(parsed.order)) {
            this.folderData = {
              rects: parsed.rects,
              order: parsed.order,
              revealSteps: parsed.revealSteps && typeof parsed.revealSteps === "object" ? parsed.revealSteps : {},
              scrollTop: typeof parsed.scrollTop === "number" ? parsed.scrollTop : 0
            };
          } else {
            const rects = parsed;
            this.folderData = {
              rects,
              order: Object.keys(rects).sort(),
              revealSteps: {}
            };
          }
        }
      }
    } catch (e) {
      console.error("Slide & Reveal: failed to load", path, e);
      new import_obsidian4.Notice(`Slide & Reveal: couldn't read ${path}`);
    }
  }
  async saveFolderData() {
    if (!this.folderPath) return;
    try {
      await this.app.vault.adapter.write(this.annotFilePath(), JSON.stringify(this.folderData, null, 2));
      this.plugin.rememberFolder(this.folderPath);
    } catch (e) {
      console.error("Slide & Reveal: failed to save", e);
      new import_obsidian4.Notice("Slide & Reveal: save failed (see console)");
    }
  }
  scheduleSave() {
    if (this.saveQueued) return;
    this.saveQueued = true;
    window.setTimeout(async () => {
      this.saveQueued = false;
      await this.saveFolderData();
    }, 250);
  }
  // ---------- Undo / redo ----------
  snapshot() {
    this.undoStack.push({ type: "data", snap: JSON.stringify(this.folderData) });
    if (this.undoStack.length > this.MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  recordRename(oldPath, newPath) {
    this.undoStack.push({ type: "rename", oldPath, newPath });
    if (this.undoStack.length > this.MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  async applyOp(op, opposite) {
    if (op.type === "data") {
      this[opposite].push({ type: "data", snap: JSON.stringify(this.folderData) });
      this.folderData = JSON.parse(op.snap);
      await this.saveFolderData();
      this.render();
    } else {
      const cur = op.type === "rename" ? op.newPath : "";
      const target = op.type === "rename" ? op.oldPath : "";
      const file = this.app.vault.getAbstractFileByPath(cur);
      if (!(file instanceof import_obsidian4.TFile)) {
        new import_obsidian4.Notice(`Can't undo rename: file not found at ${cur}`);
        return;
      }
      this[opposite].push({ type: "rename", oldPath: cur, newPath: target });
      try {
        await this.app.fileManager.renameFile(file, target);
      } catch (e) {
        console.error(e);
        new import_obsidian4.Notice("Rename undo failed (see console)");
        this[opposite].pop();
      }
    }
  }
  async undo() {
    const op = this.undoStack.pop();
    if (!op) {
      new import_obsidian4.Notice("Nothing to undo");
      return;
    }
    await this.applyOp(op, "redoStack");
  }
  async redo() {
    const op = this.redoStack.pop();
    if (!op) {
      new import_obsidian4.Notice("Nothing to redo");
      return;
    }
    await this.applyOp(op, "undoStack");
  }
  handleEscape() {
    if (this.polyDraft) {
      this.cancelPolyDraft();
      return;
    }
    const root = this.containerEl.children[1];
    const tb = root.querySelector(".sNr-rect-toolbar");
    if (tb) tb.remove();
    root.querySelectorAll(".sNr-rect.sNr-selected").forEach((r) => r.classList.remove("sNr-selected"));
  }
  // ---------- Render ----------
  render() {
    const root = this.containerEl.children[1];
    const savedScroll = this.scrollerEl ? this.scrollerEl.scrollTop : this.folderData.scrollTop ?? 0;
    document.body.querySelectorAll(".sNr-rect-toolbar").forEach((t) => t.remove());
    document.body.querySelectorAll(".sNr-tip").forEach((t) => t.remove());
    this.selection = null;
    root.empty();
    root.addClass("sNr-view");
    root.tabIndex = -1;
    const settings = this.plugin.settings;
    root.style.setProperty("--sNr-scale", settings.imageScale + "%");
    root.style.setProperty("--sNr-sidebar-w", settings.sidebarWidth + "px");
    const header = root.createDiv({ cls: "sNr-header" });
    header.createEl("h3", {
      text: this.folderPath ? `Folder: ${this.folderPath}` : 'No folder \u2014 right-click a folder in the file explorer and choose "Open Slide & Reveal here".'
    });
    if (!this.folderPath) return;
    const row = header.createDiv({ cls: "sNr-header-row" });
    this.iconBtn(row, "eye", "Reveal all").onclick = () => this.toggleAll(root, true);
    this.iconBtn(row, "eye-off", "Hide all").onclick = () => this.toggleAll(root, false);
    const refreshBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(refreshBtn, "rotate-cw");
    refreshBtn.title = "Refresh view";
    refreshBtn.onclick = () => this.render();
    const resetSlidersBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(resetSlidersBtn, "list-restart");
    resetSlidersBtn.title = "Reset all reveal sliders to 0";
    resetSlidersBtn.onclick = async () => {
      this.snapshot();
      this.folderData.revealSteps = {};
      await this.saveFolderData();
      this.render();
    };
    const modeBtn = row.createEl("button", { cls: "sNr-mode-btn" });
    const updateModeBtn = () => {
      const m = this.plugin.settings.mode;
      modeBtn.empty();
      (0, import_obsidian4.setIcon)(modeBtn, m === "study" ? "book-open" : "pencil");
      modeBtn.title = m === "study" ? "Mode: Study (wheel steps the reveal slider). Click to switch to Edit." : "Mode: Edit (wheel scrolls normally; no reveal stepping). Click to switch to Study.";
      modeBtn.classList.toggle("sNr-mode-edit", m === "edit");
    };
    updateModeBtn();
    modeBtn.onclick = async () => {
      this.plugin.settings.mode = this.plugin.settings.mode === "study" ? "edit" : "study";
      await this.plugin.saveSettings();
      updateModeBtn();
    };
    const undoBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(undoBtn, "undo-2");
    undoBtn.title = "Undo (\u2318Z)";
    undoBtn.onclick = () => this.undo();
    const redoBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(redoBtn, "redo-2");
    redoBtn.title = "Redo (\u21E7\u2318Z)";
    redoBtn.onclick = () => this.redo();
    const prevBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(prevBtn, "arrow-up");
    prevBtn.title = "Previous image";
    prevBtn.onclick = () => this.jumpImage(-1);
    const nextBtn = row.createEl("button");
    (0, import_obsidian4.setIcon)(nextBtn, "arrow-down");
    nextBtn.title = "Next image";
    nextBtn.onclick = () => this.jumpImage(1);
    this.headerToolsEl = row.createDiv({ cls: "sNr-header-tools" });
    this.refreshHeaderTools();
    const scale = row.createDiv({ cls: "sNr-scale" });
    const sizeIcon = scale.createSpan({ cls: "sNr-iconbtn-ico" });
    (0, import_obsidian4.setIcon)(sizeIcon, "maximize-2");
    scale.createSpan({ text: "Size" });
    const stepDown = scale.createEl("button", { cls: "sNr-scale-step" });
    (0, import_obsidian4.setIcon)(stepDown, "minus");
    stepDown.title = `Smaller (\u2212${settings.arrowKeysZoomStep || 5}%)`;
    stepDown.onclick = () => this.setImageScale(
      this.plugin.settings.imageScale - (this.plugin.settings.arrowKeysZoomStep || 5),
      true
    );
    const slider = scale.createEl("input", { type: "range", cls: "sNr-scale-slider" });
    slider.min = "25";
    slider.max = "200";
    slider.step = "5";
    slider.value = String(Math.min(200, settings.imageScale));
    const stepUp = scale.createEl("button", { cls: "sNr-scale-step" });
    (0, import_obsidian4.setIcon)(stepUp, "plus");
    stepUp.title = `Bigger (+${settings.arrowKeysZoomStep || 5}%)`;
    stepUp.onclick = () => this.setImageScale(
      this.plugin.settings.imageScale + (this.plugin.settings.arrowKeysZoomStep || 5),
      true
    );
    const pctInput = scale.createEl("input", { type: "text", cls: "sNr-scale-pct" });
    pctInput.value = settings.imageScale + "%";
    pctInput.title = "Image size \u2014 type any percentage (e.g. 250%) for values past 200%";
    slider.oninput = () => this.setImageScale(parseInt(slider.value, 10), false);
    slider.onchange = () => this.setImageScale(parseInt(slider.value, 10), true);
    pctInput.onfocus = () => pctInput.select();
    const commitPct = () => {
      const m = pctInput.value.replace(/[^0-9.]/g, "");
      const n = parseFloat(m);
      if (isFinite(n) && n > 0) this.setImageScale(n, true);
      else pctInput.value = this.plugin.settings.imageScale + "%";
    };
    pctInput.onchange = commitPct;
    pctInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPct();
        pctInput.blur();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.stopPropagation();
      }
    });
    const quizBtn = row.createEl("button", { cls: "sNr-iconbtn sNr-header-quiz" });
    const quizIco = quizBtn.createSpan({ cls: "sNr-iconbtn-ico" });
    (0, import_obsidian4.setIcon)(quizIco, "crosshair");
    quizBtn.createSpan({ cls: "sNr-iconbtn-text", text: "Quiz" });
    quizBtn.title = "Cross-diagram quiz: pick a scope and drill from cropped target regions";
    quizBtn.onclick = () => new ScopePickerModal(this.plugin).open();
    const body = root.createDiv({ cls: "sNr-body" });
    this.sidebarEl = body.createDiv({ cls: "sNr-sidebar" });
    const divider = body.createDiv({ cls: "sNr-divider" });
    this.scrollerEl = body.createDiv({ cls: "sNr-content" });
    this.bindDivider(divider, root);
    let scrollRefreshScheduled = false;
    this.scrollerEl.addEventListener("scroll", () => {
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
    if (!(tf instanceof import_obsidian4.TFolder)) {
      this.scrollerEl.createEl("p", { text: `Folder "${this.folderPath}" not found in vault.` });
      return;
    }
    const images = [];
    const walk = (fld) => {
      for (const ch of fld.children) {
        if (ch instanceof import_obsidian4.TFolder) walk(ch);
        else if (ch instanceof import_obsidian4.TFile && IMG_RE.test(ch.path)) images.push(ch);
      }
    };
    walk(tf);
    const rels = images.map((f) => relTo(this.folderPath, f.path));
    const relSet = new Set(rels);
    const orderSet = new Set(this.folderData.order);
    let orderChanged = false;
    for (const r of rels) {
      if (!orderSet.has(r)) {
        this.folderData.order.push(r);
        orderSet.add(r);
        orderChanged = true;
      }
    }
    const filtered = this.folderData.order.filter((p) => relSet.has(p));
    if (filtered.length !== this.folderData.order.length) {
      this.folderData.order = filtered;
      orderChanged = true;
    }
    if (orderChanged) this.scheduleSave();
    const orderIndex = new Map(this.folderData.order.map((p, i) => [p, i]));
    images.sort((a, b) => {
      const ai = orderIndex.get(relTo(this.folderPath, a.path)) ?? Infinity;
      const bi = orderIndex.get(relTo(this.folderPath, b.path)) ?? Infinity;
      return ai - bi;
    });
    if (!images.length) {
      this.scrollerEl.createEl("p", { text: "No images found in this folder." });
      return;
    }
    for (const img of images) this.renderThumb(img);
    for (const img of images) this.renderImage(img);
    requestAnimationFrame(() => {
      this.scrollerEl.scrollTop = savedScroll;
      this.refreshHeaderTools();
    });
    if (!root.contains(document.activeElement)) root.focus();
  }
  bindDivider(divider, root) {
    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = this.sidebarEl.offsetWidth;
      divider.addClass("sNr-dragging");
      const move = (ev) => {
        const newW = Math.max(60, Math.min(600, startW + (ev.clientX - startX)));
        root.style.setProperty("--sNr-sidebar-w", newW + "px");
      };
      const up = async () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        divider.removeClass("sNr-dragging");
        this.plugin.settings.sidebarWidth = this.sidebarEl.offsetWidth;
        await this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  renderThumb(file) {
    const thumb = this.sidebarEl.createDiv({ cls: "sNr-thumb" });
    thumb.dataset.path = file.path;
    thumb.draggable = true;
    const img = thumb.createEl("img");
    img.src = this.app.vault.getResourcePath(file);
    img.draggable = false;
    img.style.pointerEvents = "none";
    const rel = relTo(this.folderPath, file.path);
    thumb.createDiv({ cls: "sNr-thumb-label", text: rel });
    let tipEl = null;
    const showTip = () => {
      if (tipEl) return;
      tipEl = document.body.createDiv({ cls: "sNr-tip" });
      tipEl.setText(rel);
      const r = thumb.getBoundingClientRect();
      const tipW = tipEl.offsetWidth;
      let left = r.right + 8;
      if (left + tipW > window.innerWidth - 8) left = r.left - tipW - 8;
      tipEl.style.left = left + "px";
      tipEl.style.top = r.top + 4 + "px";
    };
    const hideTip = () => {
      if (tipEl) {
        tipEl.remove();
        tipEl = null;
      }
    };
    thumb.addEventListener("mouseenter", showTip);
    thumb.addEventListener("mouseleave", hideTip);
    thumb.addEventListener("dragstart", hideTip);
    thumb.onclick = () => {
      const target = this.scrollerEl.querySelector(
        `.sNr-block[data-path="${CSS.escape(file.path)}"]`
      );
      if (target) {
        this.scrollerEl.scrollTop = target.offsetTop - this.scrollerEl.offsetTop;
      }
      this.sidebarEl.querySelectorAll(".sNr-thumb-active").forEach((t) => t.removeClass("sNr-thumb-active"));
      thumb.addClass("sNr-thumb-active");
    };
    thumb.addEventListener("dragstart", (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", file.path);
        } catch {
        }
      }
      this.draggingThumbPath = file.path;
      thumb.addClass("sNr-dragging");
    });
    thumb.addEventListener("dragend", () => {
      thumb.removeClass("sNr-dragging");
      this.draggingThumbPath = null;
      this.sidebarEl.querySelectorAll(".sNr-thumb").forEach((t) => {
        t.classList.remove("sNr-drop-above", "sNr-drop-below");
      });
    });
    thumb.addEventListener("dragover", (e) => {
      if (!this.draggingThumbPath || this.draggingThumbPath === file.path) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const r = thumb.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      this.sidebarEl.querySelectorAll(".sNr-thumb").forEach((t) => {
        if (t !== thumb) t.classList.remove("sNr-drop-above", "sNr-drop-below");
      });
      thumb.classList.toggle("sNr-drop-above", before);
      thumb.classList.toggle("sNr-drop-below", !before);
    });
    thumb.addEventListener("dragleave", (e) => {
      const related = e.relatedTarget;
      if (related && thumb.contains(related)) return;
      thumb.classList.remove("sNr-drop-above", "sNr-drop-below");
    });
    thumb.addEventListener("drop", async (e) => {
      e.preventDefault();
      thumb.classList.remove("sNr-drop-above", "sNr-drop-below");
      const sourcePath = e.dataTransfer?.getData("text/plain") || this.draggingThumbPath || "";
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
  currentBlockIndex(blocks) {
    const top = this.scrollerEl.scrollTop;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bottom = b.offsetTop - this.scrollerEl.offsetTop + b.offsetHeight;
      if (bottom > top + 10) return i;
    }
    return blocks.length - 1;
  }
  /** Move +1 / -1 in the image list and instant-scroll to it. */
  jumpImage(delta) {
    const blocks = Array.from(this.scrollerEl.querySelectorAll(".sNr-block"));
    if (!blocks.length) return;
    const cur = this.currentBlockIndex(blocks);
    const next = Math.max(0, Math.min(blocks.length - 1, cur + delta));
    const target = blocks[next];
    this.scrollerEl.scrollTop = target.offsetTop - this.scrollerEl.offsetTop;
    const path = target.dataset.path;
    if (path) {
      this.sidebarEl.querySelectorAll(".sNr-thumb-active").forEach((t) => t.removeClass("sNr-thumb-active"));
      const thumb = this.sidebarEl.querySelector(`.sNr-thumb[data-path="${CSS.escape(path)}"]`);
      if (thumb) thumb.addClass("sNr-thumb-active");
    }
  }
  toggleAll(scopeEl, reveal) {
    scopeEl.querySelectorAll(".sNr-rect").forEach((r) => r.classList.toggle("sNr-revealed", reveal));
  }
  rectsFor(file) {
    const key = relTo(this.folderPath, file.path);
    if (!this.folderData.rects[key]) this.folderData.rects[key] = [];
    return { key, list: this.folderData.rects[key] };
  }
  /** Next pair number to assign for a new shape on this image. */
  nextPairFor(file) {
    const { list } = this.rectsFor(file);
    let max = 0;
    for (const r of list) if (r.pair > max) max = r.pair;
    return max + 1;
  }
  renderImage(file) {
    const block = this.scrollerEl.createDiv({ cls: "sNr-block" });
    block.dataset.path = file.path;
    const top = block.createDiv({ cls: "sNr-block-top" });
    const titleWrap = top.createDiv({ cls: "sNr-title-wrap" });
    titleWrap.createEl("h4", { text: relTo(this.folderPath, file.path) });
    const renameBtn = titleWrap.createEl("button", { cls: "sNr-rename-btn" });
    (0, import_obsidian4.setIcon)(renameBtn, "pencil");
    renameBtn.title = "Rename file";
    renameBtn.onclick = () => this.renameFile(file);
    const body = block.createDiv({ cls: "sNr-block-body" });
    const railOnRight = this.plugin.settings.railSide === "right";
    let railHost;
    let canvas;
    if (railOnRight) {
      canvas = body.createDiv({ cls: "sNr-canvas" });
      railHost = body.createDiv({ cls: "sNr-rail-host sNr-rail-right" });
    } else {
      railHost = body.createDiv({ cls: "sNr-rail-host" });
      canvas = body.createDiv({ cls: "sNr-canvas" });
    }
    if (this.drawingPaths.has(file.path)) canvas.addClass("sNr-drawing");
    if (this.drawingPaths.has(file.path) || this.polyDrawingPaths.has(file.path)) {
      block.addClass("sNr-drafting");
    }
    if (this.targetDraftCoverId && this.polyDraft && this.polyDraft.file === file) {
      block.addClass("sNr-drafting");
    }
    const imgEl = canvas.createEl("img");
    imgEl.src = this.app.vault.getResourcePath(file);
    const { list } = this.rectsFor(file);
    for (const r of list) {
      this.renderShape(canvas, file, r);
      if (r.targetRegion) this.renderTargetRegionOverlay(canvas, r);
    }
    this.renderRail(railHost, file, canvas);
    canvas.addEventListener("mousedown", (e) => {
      if (this.drawingPaths.has(file.path) && (e.target === canvas || e.target === imgEl)) {
        this.beginRectDrag(canvas, file, e);
        return;
      }
      if (this.polyDrawingPaths.has(file.path) && (e.target === canvas || e.target === imgEl)) {
        this.addPolyPoint(canvas, file, block, e);
        return;
      }
      if (this.targetDraftCoverId && this.polyDraft && this.polyDraft.file === file && this.polyDraft.destination.kind === "target" && (e.target === canvas || e.target === imgEl)) {
        this.addPolyPoint(canvas, file, block, e);
        return;
      }
    });
    canvas.addEventListener("dblclick", (e) => {
      if (this.polyDrawingPaths.has(file.path) || this.targetDraftCoverId && this.polyDraft?.file === file) {
        e.preventDefault();
        e.stopPropagation();
        this.commitPolyDraft();
      }
    });
  }
  // ---------- Rectangle drawing ----------
  beginRectDrag(canvas, file, e) {
    e.preventDefault();
    const cb = canvas.getBoundingClientRect();
    const sx = (e.clientX - cb.left) / cb.width;
    const sy = (e.clientY - cb.top) / cb.height;
    const ghost = canvas.createDiv({ cls: "sNr-rect" });
    ghost.style.setProperty("--sNr-color", this.plugin.settings.defaultColor);
    const move = (ev) => {
      const cx = (ev.clientX - cb.left) / cb.width;
      const cy = (ev.clientY - cb.top) / cb.height;
      const x = clamp01(Math.min(sx, cx));
      const y = clamp01(Math.min(sy, cy));
      const w = clamp01(Math.abs(cx - sx));
      const h = clamp01(Math.abs(cy - sy));
      ghost.style.left = x * 100 + "%";
      ghost.style.top = y * 100 + "%";
      ghost.style.width = w * 100 + "%";
      ghost.style.height = h * 100 + "%";
    };
    const up = async (ev) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      ghost.remove();
      const cx = (ev.clientX - cb.left) / cb.width;
      const cy = (ev.clientY - cb.top) / cb.height;
      const x = clamp01(Math.min(sx, cx));
      const y = clamp01(Math.min(sy, cy));
      const w = clamp01(Math.abs(cx - sx));
      const h = clamp01(Math.abs(cy - sy));
      if (w < 0.01 || h < 0.01) return;
      this.snapshot();
      const rect = {
        id: uid(),
        kind: "rect",
        x,
        y,
        w,
        h,
        pair: this.nextPairFor(file),
        seconds: this.plugin.settings.defaultSeconds,
        color: this.plugin.settings.defaultColor
      };
      const { list } = this.rectsFor(file);
      list.push(rect);
      await this.saveFolderData();
      this.render();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  // ---------- Polygon drafting ----------
  addPolyPoint(canvas, file, block, e) {
    e.preventDefault();
    const cb = canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - cb.left) / cb.width);
    const y = clamp01((e.clientY - cb.top) / cb.height);
    if (!this.polyDraft || this.polyDraft.canvas !== canvas) {
      this.cancelPolyDraft();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("sNr-poly-draft");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      svg.appendChild(poly);
      canvas.appendChild(svg);
      this.polyDraft = {
        file,
        canvas,
        block,
        points: [],
        svg,
        poly,
        cleanup: () => svg.remove(),
        destination: { kind: "newShape" }
      };
    }
    this.polyDraft.points.push({ x, y });
    this.repaintPolyDraft();
  }
  repaintPolyDraft() {
    if (!this.polyDraft) return;
    const { svg, poly, points } = this.polyDraft;
    poly.setAttribute("points", points.map((p) => `${p.x * 100},${p.y * 100}`).join(" "));
    svg.querySelectorAll("circle").forEach((c) => c.remove());
    for (const p of points) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(p.x * 100));
      c.setAttribute("cy", String(p.y * 100));
      c.setAttribute("r", "1.2");
      svg.appendChild(c);
    }
  }
  cancelPolyDraft() {
    if (!this.polyDraft) return;
    this.polyDraft.cleanup();
    this.polyDraft = null;
    this.targetDraftCoverId = null;
  }
  async commitPolyDraft() {
    const draft = this.polyDraft;
    if (!draft) return;
    if (draft.points.length < 3) {
      new import_obsidian4.Notice("Need at least 3 points for a polygon.");
      return;
    }
    const { file, points, destination } = draft;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    const localPts = points.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
    if (destination.kind === "target") {
      const { list: list2 } = this.rectsFor(file);
      const cover = list2.find((r) => r.id === destination.coverId);
      if (!cover) {
        new import_obsidian4.Notice("Cover no longer exists \u2014 target region not saved.");
        this.cancelPolyDraft();
        this.render();
        return;
      }
      this.snapshot();
      const region = { x: minX, y: minY, w, h, points: localPts };
      cover.targetRegion = region;
      cover.targetRegionSource = "manual";
      await this.saveFolderData();
      this.cancelPolyDraft();
      new import_obsidian4.Notice("Target region added \u2014 this label is now in the quiz pool.");
      this.render();
      return;
    }
    this.snapshot();
    const shape = {
      id: uid(),
      kind: "polygon",
      x: minX,
      y: minY,
      w,
      h,
      points: localPts,
      pair: this.nextPairFor(file),
      seconds: this.plugin.settings.defaultSeconds,
      color: this.plugin.settings.defaultColor
    };
    const { list } = this.rectsFor(file);
    list.push(shape);
    await this.saveFolderData();
    this.cancelPolyDraft();
    this.render();
  }
  /** Start drafting a target region for a specific cover. Sets up polyDraft
   *  with destination=target and the target-drafting state flag. Existing
   *  polygon-draw mode (if any) is cancelled. */
  beginTargetRegionDraft(canvas, file, block, coverId) {
    this.cancelPolyDraft();
    this.polyDrawingPaths.delete(file.path);
    this.drawingPaths.delete(file.path);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("sNr-poly-draft", "sNr-target-draft");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    svg.appendChild(poly);
    canvas.appendChild(svg);
    this.polyDraft = {
      file,
      canvas,
      block,
      points: [],
      svg,
      poly,
      cleanup: () => svg.remove(),
      destination: { kind: "target", coverId }
    };
    this.targetDraftCoverId = coverId;
    new import_obsidian4.Notice("Click vertices over the structure this label points to, then Finalize. Esc is disabled \u2014 use the Cancel button.");
    block.addClass("sNr-drafting");
    this.refreshHeaderTools();
  }
  /** Select a target region: shows draggable vertex handles + a mini
   *  floating toolbar (delete only for now). Sibling of selectShape, but
   *  the target region is not a Rect — it's a sub-field of its cover. */
  selectTargetRegion(canvas, file, cover, el) {
    if (!cover.targetRegion) return;
    const root = canvas.closest(".sNr-view");
    root.querySelectorAll(".sNr-rect.sNr-selected").forEach((r) => r.classList.remove("sNr-selected"));
    root.querySelectorAll(".sNr-target-region.sNr-selected").forEach((r) => r.classList.remove("sNr-selected"));
    document.body.querySelectorAll(".sNr-rect-toolbar").forEach((t) => t.remove());
    root.querySelectorAll(".sNr-vertex").forEach((v) => v.remove());
    el.classList.add("sNr-selected");
    this.selection = null;
    this.targetSelection = { canvas, file, cover, el };
    this.renderTargetRegionVertices(canvas, file, cover, el);
    const tb = document.body.createDiv({ cls: "sNr-rect-toolbar" });
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
      tb.style.top = top + "px";
      tb.style.left = left + "px";
    };
    requestAnimationFrame(reposition);
    this.scrollerEl.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    const detachReposition = () => {
      this.scrollerEl.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
    const labelText = cover.pair > 0 ? `Target #${cover.pair}` : "Target (unpaired)";
    tb.createSpan({ cls: "sNr-tb-label", text: labelText });
    tb.createDiv({ cls: "sNr-tb-divider" });
    const del = tb.createEl("button", { cls: "sNr-tb-icon-btn sNr-tb-danger" });
    (0, import_obsidian4.setIcon)(del, "trash-2");
    del.title = "Delete target region (cover stays; this label leaves the quiz pool)";
    del.onclick = async (e) => {
      e.stopPropagation();
      tb.remove();
      detachReposition();
      await this.removeTargetRegion(file, cover.id);
    };
    if (this.currentOffClick) {
      document.removeEventListener("mousedown", this.currentOffClick, true);
      this.currentOffClick = null;
    }
    const offClick = (ev) => {
      const target = ev.target;
      if (!target) return;
      if (tb.contains(target) || el.contains(target)) return;
      if (target.closest && target.closest(".sNr-vertex")) return;
      tb.remove();
      el.classList.remove("sNr-selected");
      canvas.querySelectorAll(".sNr-vertex[data-target-cover-id]").forEach((v) => v.remove());
      detachReposition();
      this.targetSelection = null;
      document.removeEventListener("mousedown", offClick, true);
      if (this.currentOffClick === offClick) this.currentOffClick = null;
    };
    this.currentOffClick = offClick;
    document.addEventListener("mousedown", offClick, true);
  }
  /** Delete the currently-selected target region (Del/Backspace path). */
  async deleteSelectedTargetRegion() {
    const sel = this.targetSelection;
    if (!sel) return;
    this.targetSelection = null;
    document.body.querySelectorAll(".sNr-rect-toolbar").forEach((t) => t.remove());
    await this.removeTargetRegion(sel.file, sel.cover.id);
  }
  /** Draw draggable handles at each vertex of a target region. Mirrors
   *  renderPolyVertices but operates on cover.targetRegion. */
  renderTargetRegionVertices(canvas, file, cover, el) {
    const tr = cover.targetRegion;
    if (!tr) return;
    canvas.querySelectorAll(`.sNr-vertex[data-target-cover-id="${cover.id}"]`).forEach((v) => v.remove());
    for (let i = 0; i < tr.points.length; i++) {
      const idx = i;
      const p = tr.points[i];
      const v = canvas.createDiv({ cls: "sNr-vertex sNr-vertex-target" });
      v.dataset.targetCoverId = cover.id;
      v.dataset.vertexIdx = String(idx);
      const cx = tr.x + p.x * tr.w;
      const cy = tr.y + p.y * tr.h;
      v.style.left = cx * 100 + "%";
      v.style.top = cy * 100 + "%";
      v.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = canvas.getBoundingClientRect();
        this.snapshot();
        const move = (mv) => {
          const nx = clamp01((mv.clientX - cb.left) / cb.width);
          const ny = clamp01((mv.clientY - cb.top) / cb.height);
          v.style.left = nx * 100 + "%";
          v.style.top = ny * 100 + "%";
          tr.points[idx] = {
            x: (nx - tr.x) / tr.w,
            y: (ny - tr.y) / tr.h
          };
          const polyEl = el.querySelector("polygon");
          if (polyEl) {
            polyEl.setAttribute(
              "points",
              tr.points.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(" ")
            );
          }
        };
        const up = async () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          this.normalizeTargetRegion(tr);
          await this.saveFolderData();
          this.render();
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      v.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (tr.points.length <= 3) {
          new import_obsidian4.Notice("A target region needs at least 3 points.");
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
  updateTargetConnector(canvas, cover) {
    if (!cover.targetRegion) return;
    const svg = canvas.querySelector(
      `svg.sNr-target-connector[data-cover-id="${cover.id}"]`
    );
    if (!svg) return;
    const line = svg.querySelector("line");
    if (!line) return;
    const tr = cover.targetRegion;
    const cx = (cover.x + cover.w / 2) * 100;
    const cy = (cover.y + cover.h / 2) * 100;
    const tx = (tr.x + tr.w / 2) * 100;
    const ty = (tr.y + tr.h / 2) * 100;
    line.setAttribute("x1", String(cx));
    line.setAttribute("y1", String(cy));
    line.setAttribute("x2", String(tx));
    line.setAttribute("y2", String(ty));
  }
  /** Same as normalizePolygon but for a TargetRegion. */
  normalizeTargetRegion(tr) {
    const canvasPts = tr.points.map((p) => ({
      x: tr.x + p.x * tr.w,
      y: tr.y + p.y * tr.h
    }));
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of canvasPts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    minX = clamp01(minX);
    minY = clamp01(minY);
    maxX = clamp01(maxX);
    maxY = clamp01(maxY);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    tr.x = minX;
    tr.y = minY;
    tr.w = w;
    tr.h = h;
    tr.points = canvasPts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
  }
  /** Remove a target region from a cover (undoable). */
  async removeTargetRegion(file, coverId) {
    const { list } = this.rectsFor(file);
    const cover = list.find((r) => r.id === coverId);
    if (!cover || !cover.targetRegion) return;
    this.snapshot();
    delete cover.targetRegion;
    delete cover.targetRegionSource;
    await this.saveFolderData();
    new import_obsidian4.Notice("Target region removed.");
    this.render();
  }
  // ---------- Render target region overlay ----------
  /** Faint dashed polygon over a cover's targetRegion, plus a connector
   *  line from the cover's bbox centre to the target's centre, so the
   *  pairing is visible during authoring/study. */
  renderTargetRegionOverlay(canvas, cover) {
    const tr = cover.targetRegion;
    if (!tr) return;
    const file = this.currentImageContext()?.file ?? null;
    const wrap = canvas.createDiv({ cls: "sNr-target-region" });
    wrap.dataset.coverId = cover.id;
    wrap.style.left = tr.x * 100 + "%";
    wrap.style.top = tr.y * 100 + "%";
    wrap.style.width = tr.w * 100 + "%";
    wrap.style.height = tr.h * 100 + "%";
    wrap.style.setProperty("--sNr-color", cover.color || this.plugin.settings.defaultColor);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", tr.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" "));
    svg.appendChild(poly);
    wrap.appendChild(svg);
    const resolveFile = () => {
      const block = wrap.closest(".sNr-block");
      const path = block?.dataset.path;
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return f instanceof import_obsidian4.TFile ? f : file;
    };
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      const f = resolveFile();
      if (f) this.selectTargetRegion(canvas, f, cover, wrap);
    });
    wrap.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("sNr-vertex")) return;
      if (!cover.targetRegion) return;
      e.preventDefault();
      e.stopPropagation();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const tr2 = cover.targetRegion;
      const ox = tr2.x, oy = tr2.y;
      let snapped = false;
      const move = (mv) => {
        const dx = (mv.clientX - startX) / cb.width;
        const dy = (mv.clientY - startY) / cb.height;
        if (!snapped && Math.abs(dx) + Math.abs(dy) > 1e-3) {
          this.snapshot();
          snapped = true;
        }
        tr2.x = clamp01(Math.min(1 - tr2.w, Math.max(0, ox + dx)));
        tr2.y = clamp01(Math.min(1 - tr2.h, Math.max(0, oy + dy)));
        wrap.style.left = tr2.x * 100 + "%";
        wrap.style.top = tr2.y * 100 + "%";
        this.updateTargetConnector(canvas, cover);
        canvas.querySelectorAll(`.sNr-vertex[data-target-cover-id="${cover.id}"]`).forEach((v, i) => {
          const p = tr2.points[i];
          if (!p) return;
          v.style.left = (tr2.x + p.x * tr2.w) * 100 + "%";
          v.style.top = (tr2.y + p.y * tr2.h) * 100 + "%";
        });
      };
      const up = async () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (snapped) await this.saveFolderData();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    const connectorSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorSvg.classList.add("sNr-target-connector");
    connectorSvg.dataset.coverId = cover.id;
    connectorSvg.setAttribute("viewBox", "0 0 100 100");
    connectorSvg.setAttribute("preserveAspectRatio", "none");
    connectorSvg.style.setProperty("--sNr-color", cover.color || this.plugin.settings.defaultColor);
    const lineEl = document.createElementNS("http://www.w3.org/2000/svg", "line");
    connectorSvg.appendChild(lineEl);
    canvas.appendChild(connectorSvg);
    this.updateTargetConnector(canvas, cover);
  }
  // ---------- Render shape (rect or polygon) ----------
  renderShape(canvas, file, rect) {
    const isPoly = rect.kind === "polygon" && Array.isArray(rect.points);
    const el = canvas.createDiv({ cls: "sNr-rect" });
    if (isPoly) el.classList.add("sNr-shape-poly");
    el.style.left = rect.x * 100 + "%";
    el.style.top = rect.y * 100 + "%";
    el.style.width = rect.w * 100 + "%";
    el.style.height = rect.h * 100 + "%";
    el.style.setProperty("--sNr-color", rect.color || this.plugin.settings.defaultColor);
    el.dataset.id = rect.id;
    el.dataset.pair = String(rect.pair || 0);
    this.renderPairOverlay(canvas, rect);
    let dragTarget = el;
    if (isPoly) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", rect.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" "));
      svg.appendChild(poly);
      el.appendChild(svg);
      dragTarget = poly;
    }
    const handle = el.createDiv({ cls: "sNr-handle" });
    dragTarget.addEventListener("click", (ev) => {
      const e = ev;
      if (e.detail === 0) return;
      e.stopPropagation();
      this.selectShape(canvas, file, rect, el);
    });
    dragTarget.addEventListener("dblclick", (ev) => {
      const e = ev;
      e.stopPropagation();
      this.togglePair(canvas, rect, !el.classList.contains("sNr-revealed"));
    });
    dragTarget.addEventListener("mousedown", (ev) => {
      const e = ev;
      if (e.target === handle) return;
      if (this.drawingPaths.has(file.path) || this.polyDrawingPaths.has(file.path)) return;
      e.preventDefault();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const ox = rect.x, oy = rect.y;
      this.snapshot();
      const move = (mv) => {
        const dx = (mv.clientX - startX) / cb.width;
        const dy = (mv.clientY - startY) / cb.height;
        rect.x = clamp01(Math.min(1 - rect.w, Math.max(0, ox + dx)));
        rect.y = clamp01(Math.min(1 - rect.h, Math.max(0, oy + dy)));
        el.style.left = rect.x * 100 + "%";
        el.style.top = rect.y * 100 + "%";
        this.updatePairOverlayPosition(canvas, rect);
        if (rect.targetRegion) this.updateTargetConnector(canvas, rect);
      };
      const up = async () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        await this.saveFolderData();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cb = canvas.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const ow = rect.w, oh = rect.h;
      this.snapshot();
      const move = (ev) => {
        const dx = (ev.clientX - startX) / cb.width;
        const dy = (ev.clientY - startY) / cb.height;
        rect.w = clamp01(Math.max(0.01, Math.min(1 - rect.x, ow + dx)));
        rect.h = clamp01(Math.max(0.01, Math.min(1 - rect.y, oh + dy)));
        el.style.width = rect.w * 100 + "%";
        el.style.height = rect.h * 100 + "%";
        this.updatePairOverlayPosition(canvas, rect);
        if (rect.targetRegion) this.updateTargetConnector(canvas, rect);
      };
      const up = async () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        await this.saveFolderData();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  /** Build ordered groups of shape ids for the reveal slider. Paired shapes are
   *  grouped by their pair number (ascending); unpaired shapes are each their
   *  own slot, appended in original order. */
  computeRevealGroups(file) {
    const { list } = this.rectsFor(file);
    const pairMap = /* @__PURE__ */ new Map();
    const unpaired = [];
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
    const groups = sortedPairs.map((p) => pairMap.get(p));
    for (const id of unpaired) groups.push([id]);
    return groups;
  }
  /** Set the reveal slider position for an image. Step 0 = all hidden;
   *  step N reveals the first N groups. Persists to folderData. */
  setRevealStep(file, canvas, groups, step) {
    const clamped = Math.max(0, Math.min(groups.length, step));
    if (!this.folderData.revealSteps) this.folderData.revealSteps = {};
    const relKey = relTo(this.folderPath, file.path);
    if (this.folderData.revealSteps[relKey] !== clamped) {
      this.folderData.revealSteps[relKey] = clamped;
      this.scheduleSave();
    }
    const progress = groups.length > 0 ? clamped / groups.length : 0;
    const coverAlpha = Math.max(0.55, 1 - progress * 0.45);
    const railAlpha = Math.max(0.4, 1 - progress * 0.5);
    for (let i = 0; i < groups.length; i++) {
      const reveal = i < clamped;
      for (const id of groups[i]) {
        const el = canvas.querySelector(`.sNr-rect[data-id="${id}"]`);
        if (!el) continue;
        el.classList.toggle("sNr-revealed", reveal);
        el.style.setProperty("--sNr-cover-alpha", reveal ? "1" : String(coverAlpha));
        const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${id}"]`);
        if (ov) ov.classList.toggle("sNr-pair-overlay--visible", !reveal);
      }
    }
    const block = canvas.closest(".sNr-block");
    const rail = block?.querySelector(".sNr-rail");
    if (rail) {
      const total = groups.length;
      const thumb = rail.querySelector(".sNr-rail-thumb");
      if (thumb) {
        thumb.style.top = total === 0 ? "50%" : clamped / total * 100 + "%";
        thumb.style.opacity = String(railAlpha);
      }
      const label = rail.querySelector(".sNr-rail-label");
      if (label) label.setText(`${clamped}/${total}`);
    }
  }
  bumpRevealStep(file, canvas, delta) {
    const groups = this.computeRevealGroups(file);
    const relKey = relTo(this.folderPath, file.path);
    const cur = this.folderData.revealSteps?.[relKey] ?? 0;
    this.setRevealStep(file, canvas, groups, cur + delta);
  }
  /** Render the vertical reveal-slider on the left side of an image. */
  renderRail(host, file, canvas) {
    const groups = this.computeRevealGroups(file);
    const total = groups.length;
    const rail = host.createDiv({ cls: "sNr-rail" });
    const upBtn = rail.createDiv({ cls: "sNr-rail-btn sNr-rail-up" });
    (0, import_obsidian4.setIcon)(upBtn, "chevron-up");
    upBtn.title = "Hide one (one step up)";
    upBtn.onclick = (e) => {
      e.stopPropagation();
      this.bumpRevealStep(file, canvas, -1);
    };
    const trackWrap = rail.createDiv({ cls: "sNr-rail-trackwrap" });
    const track = trackWrap.createDiv({ cls: "sNr-rail-track" });
    for (let i = 0; i <= total; i++) {
      const dot = track.createDiv({ cls: "sNr-rail-dot" });
      dot.style.top = total === 0 ? "50%" : i / total * 100 + "%";
      dot.dataset.step = String(i);
      dot.title = `Reveal ${i}/${total}`;
      const stepNum = i;
      dot.onclick = (e) => {
        e.stopPropagation();
        this.setRevealStep(file, canvas, groups, stepNum);
      };
    }
    const thumb = track.createDiv({ cls: "sNr-rail-thumb" });
    const downBtn = rail.createDiv({ cls: "sNr-rail-btn sNr-rail-down" });
    (0, import_obsidian4.setIcon)(downBtn, "chevron-down");
    downBtn.title = "Reveal one (one step down)";
    downBtn.onclick = (e) => {
      e.stopPropagation();
      this.bumpRevealStep(file, canvas, 1);
    };
    rail.createDiv({ cls: "sNr-rail-label" });
    const relKey = relTo(this.folderPath, file.path);
    const cur = this.folderData.revealSteps?.[relKey] ?? 0;
    this.setRevealStep(file, canvas, groups, cur);
    const beginScrub = (startEvt) => {
      startEvt.preventDefault();
      const trackRect = track.getBoundingClientRect();
      const stepFromY = (clientY) => {
        if (trackRect.height <= 0) return 0;
        const rel = (clientY - trackRect.top) / trackRect.height;
        return Math.max(0, Math.min(total, Math.round(rel * total)));
      };
      this.setRevealStep(file, canvas, groups, stepFromY(startEvt.clientY));
      const move = (mv) => {
        this.setRevealStep(file, canvas, groups, stepFromY(mv.clientY));
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    thumb.addEventListener("mousedown", beginScrub);
    track.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("sNr-rail-dot")) return;
      if (e.target === thumb) return;
      beginScrub(e);
    });
    let accum = 0;
    canvas.addEventListener("wheel", (e) => {
      if (e.ctrlKey) return;
      if (this.plugin.settings.mode === "edit") return;
      if (this.plugin.settings.imageScale > 100 && !this.plugin.settings.wheelStepPast100) return;
      e.preventDefault();
      const STEP = Math.max(10, this.plugin.settings.wheelStepThreshold || 60);
      accum += e.deltaY;
      while (accum >= STEP) {
        accum -= STEP;
        this.bumpRevealStep(file, canvas, 1);
      }
      while (accum <= -STEP) {
        accum += STEP;
        this.bumpRevealStep(file, canvas, -1);
      }
    }, { passive: false });
  }
  togglePair(canvas, rect, reveal) {
    const pair = rect.pair || 0;
    const targets = pair > 0 ? Array.from(canvas.querySelectorAll(`.sNr-rect[data-pair="${pair}"]`)) : Array.from(canvas.querySelectorAll(`.sNr-rect[data-id="${rect.id}"]`));
    targets.forEach((t) => {
      t.classList.toggle("sNr-revealed", reveal);
      const id = t.dataset.id;
      if (id) {
        const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${id}"]`);
        if (ov) ov.classList.toggle("sNr-pair-overlay--visible", !reveal);
      }
    });
  }
  flashPair(canvas, rect, onEnd) {
    this.togglePair(canvas, rect, true);
    const seconds = rect.seconds && rect.seconds > 0 ? rect.seconds : this.plugin.settings.defaultSeconds;
    const existing = this.timers.get(rect.id);
    if (existing) clearTimeout(existing);
    const t = window.setTimeout(() => {
      this.togglePair(canvas, rect, false);
      this.timers.delete(rect.id);
      onEnd?.();
    }, seconds * 1e3);
    this.timers.set(rect.id, t);
  }
  /** Cancel an in-flight flash timer for `rect` (if any) and immediately
   *  hide the pair. */
  cancelFlash(canvas, rect) {
    const existing = this.timers.get(rect.id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(rect.id);
    }
    this.togglePair(canvas, rect, false);
  }
  applyColor(canvas, file, rect, newColor) {
    rect.color = newColor;
    const ownEl = canvas.querySelector(`.sNr-rect[data-id="${rect.id}"]`);
    if (ownEl) ownEl.style.setProperty("--sNr-color", newColor);
    const mode = this.plugin.settings.pairColorMode;
    if (rect.pair && rect.pair > 0 && mode !== "off") {
      const { list } = this.rectsFor(file);
      if (mode === "first-to-rest") {
        const leader = list.find((r) => r.pair === rect.pair);
        if (!leader || leader.id !== rect.id) {
          this.scheduleSave();
          return;
        }
      }
      for (const other of list) {
        if (other.id === rect.id || other.pair !== rect.pair) continue;
        other.color = newColor;
        const otherEl = canvas.querySelector(`.sNr-rect[data-id="${other.id}"]`);
        if (otherEl) otherEl.style.setProperty("--sNr-color", newColor);
      }
    }
    this.scheduleSave();
  }
  /** Recompute a polygon's bbox from its current vertex positions and remap its local points. */
  normalizePolygon(rect) {
    if (rect.kind !== "polygon" || !rect.points) return;
    const canvasPts = rect.points.map((p) => ({
      x: rect.x + p.x * rect.w,
      y: rect.y + p.y * rect.h
    }));
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of canvasPts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    minX = clamp01(minX);
    minY = clamp01(minY);
    maxX = clamp01(maxX);
    maxY = clamp01(maxY);
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    rect.x = minX;
    rect.y = minY;
    rect.w = w;
    rect.h = h;
    rect.points = canvasPts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
  }
  /** Draw draggable handles at each polygon vertex. Called when a polygon is selected. */
  renderPolyVertices(canvas, file, rect, el) {
    if (rect.kind !== "polygon" || !rect.points) return;
    canvas.querySelectorAll(`.sNr-vertex[data-shape-id="${rect.id}"]`).forEach((v) => v.remove());
    for (let i = 0; i < rect.points.length; i++) {
      const idx = i;
      const p = rect.points[i];
      const v = canvas.createDiv({ cls: "sNr-vertex" });
      v.dataset.shapeId = rect.id;
      v.dataset.vertexIdx = String(idx);
      const cx = rect.x + p.x * rect.w;
      const cy = rect.y + p.y * rect.h;
      v.style.left = cx * 100 + "%";
      v.style.top = cy * 100 + "%";
      v.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = canvas.getBoundingClientRect();
        this.snapshot();
        const move = (mv) => {
          const nx = clamp01((mv.clientX - cb.left) / cb.width);
          const ny = clamp01((mv.clientY - cb.top) / cb.height);
          v.style.left = nx * 100 + "%";
          v.style.top = ny * 100 + "%";
          rect.points[idx] = {
            x: (nx - rect.x) / rect.w,
            y: (ny - rect.y) / rect.h
          };
          const poly = el.querySelector("polygon");
          if (poly) {
            poly.setAttribute(
              "points",
              rect.points.map((pt) => `${pt.x * 100},${pt.y * 100}`).join(" ")
            );
          }
        };
        const up = async () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          this.normalizePolygon(rect);
          await this.saveFolderData();
          this.render();
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      v.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!rect.points || rect.points.length <= 3) {
          new import_obsidian4.Notice("A polygon needs at least 3 points.");
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
  refreshHeaderTools() {
    const tools = this.headerToolsEl;
    if (!tools) return;
    tools.empty();
    const ctx = this.currentImageContext();
    const file = ctx?.file ?? null;
    if (this.scrollerEl) {
      const blocks = Array.from(this.scrollerEl.querySelectorAll(".sNr-block"));
      const focusedPath = ctx ? ctx.file.path : null;
      for (const b of blocks) {
        b.classList.toggle("sNr-focused", b.dataset.path === focusedPath);
      }
    }
    const drawBtn = this.iconBtn(tools, "square", "Rectangle");
    drawBtn.title = "Add rectangle to the focused image (drag on it)";
    if (file && this.drawingPaths.has(file.path)) drawBtn.addClass("sNr-active");
    if (!file) drawBtn.disabled = true;
    drawBtn.onclick = () => {
      if (!file) return;
      if (this.drawingPaths.has(file.path)) this.drawingPaths.delete(file.path);
      else {
        this.drawingPaths.add(file.path);
        this.polyDrawingPaths.delete(file.path);
      }
      this.render();
    };
    const polyBtn = this.iconBtn(tools, "pentagon", "Polygon");
    polyBtn.title = "Add polygon to the focused image (click vertices, then Finalize)";
    if (file && this.polyDrawingPaths.has(file.path)) polyBtn.addClass("sNr-active");
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
    const draftingFile = this.polyDraft?.file ?? null;
    const isTargetDrafting = this.polyDraft?.destination.kind === "target";
    const regularDraftingActive = !!(draftingFile && this.polyDrawingPaths.has(draftingFile.path));
    if (this.polyDraft && (regularDraftingActive || isTargetDrafting)) {
      const doneBtn = tools.createEl("button", { cls: "sNr-iconbtn sNr-iconbtn-icon-only sNr-poly-done" });
      (0, import_obsidian4.setIcon)(doneBtn, "check");
      doneBtn.title = isTargetDrafting ? "Finalize target region" : "Finalize polygon";
      doneBtn.onclick = () => this.commitPolyDraft();
      const cancelBtn = tools.createEl("button", { cls: "sNr-iconbtn sNr-iconbtn-icon-only sNr-poly-cancel" });
      (0, import_obsidian4.setIcon)(cancelBtn, "x");
      cancelBtn.title = isTargetDrafting ? "Cancel target region" : "Cancel polygon";
      cancelBtn.onclick = () => {
        const df = draftingFile;
        this.cancelPolyDraft();
        if (df) this.polyDrawingPaths.delete(df.path);
        this.render();
      };
    }
    const revealBtn = this.iconBtn(tools, "eye", "Reveal");
    revealBtn.title = "Reveal all shapes on the focused image";
    if (!ctx) revealBtn.disabled = true;
    revealBtn.onclick = () => {
      if (!ctx) return;
      ctx.canvas.querySelectorAll(".sNr-rect").forEach((r) => r.classList.add("sNr-revealed"));
    };
    const hideBtn = this.iconBtn(tools, "eye-off", "Hide");
    hideBtn.title = "Hide all shapes on the focused image";
    if (!ctx) hideBtn.disabled = true;
    hideBtn.onclick = () => {
      if (!ctx) return;
      ctx.canvas.querySelectorAll(".sNr-rect").forEach((r) => r.classList.remove("sNr-revealed"));
    };
  }
  /** The image whose block is currently scrolled-to (used by keyboard
   *  shortcuts that need to know which image to act on). */
  /** Public accessor for the currently-focused image path. Used by the
   *  quiz scope picker so its "this slide" choice matches the same image
   *  the focused-block outline highlights. */
  getFocusedImagePath() {
    return this.currentImageContext()?.file.path ?? null;
  }
  currentImageContext() {
    if (!this.scrollerEl) return null;
    const blocks = Array.from(this.scrollerEl.querySelectorAll(".sNr-block"));
    if (!blocks.length) return null;
    const block = blocks[this.currentBlockIndex(blocks)];
    const path = block.dataset.path;
    if (!path) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian4.TFile)) return null;
    const canvas = block.querySelector(".sNr-canvas");
    if (!canvas) return null;
    return { file: f, canvas };
  }
  /** Single source of truth for changing the image-scale percentage.
   *  Updates settings, the CSS variable, and (if rendered) the slider
   *  + the % text input. Clamped to [5, 1000]. */
  setImageScale(n, save = true) {
    const clamped = Math.max(5, Math.min(1e3, Math.round(n)));
    this.plugin.settings.imageScale = clamped;
    const root = this.containerEl.children[1];
    if (root) root.style.setProperty("--sNr-scale", clamped + "%");
    const slider = root?.querySelector(".sNr-scale-slider");
    if (slider) slider.value = String(Math.min(200, clamped));
    const pct = root?.querySelector(".sNr-scale-pct");
    if (pct) pct.value = clamped + "%";
    if (save) this.plugin.saveSettings();
  }
  /** Render (or update) the pair-number tag for a shape as a SIBLING of
   *  the shape inside the canvas — not as a child. Children inherit the
   *  shape's opacity (which becomes 0.08 when revealed), so the number
   *  used to disappear along with the cover. As a sibling it stays at
   *  full opacity regardless of reveal state, and stacks on top because
   *  of z-index. */
  renderPairOverlay(canvas, rect) {
    canvas.querySelectorAll(`.sNr-pair-overlay[data-shape-id="${rect.id}"]`).forEach((n) => n.remove());
    if (!rect.pair || rect.pair <= 0) return;
    const tag = canvas.createDiv({ cls: "sNr-pair-overlay", text: "#" + rect.pair });
    tag.dataset.shapeId = rect.id;
    tag.style.left = (rect.x + rect.w / 2) * 100 + "%";
    tag.style.top = (rect.y + rect.h / 2) * 100 + "%";
    const shapeEl = canvas.querySelector(`.sNr-rect[data-id="${rect.id}"]`);
    if (!shapeEl || !shapeEl.classList.contains("sNr-revealed")) {
      tag.classList.add("sNr-pair-overlay--visible");
    }
  }
  /** Sync just the position of an existing pair overlay to its shape's
   *  current bbox. Cheap to call from drag/resize move handlers. */
  updatePairOverlayPosition(canvas, rect) {
    const tag = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${rect.id}"]`);
    if (!tag) return;
    tag.style.left = (rect.x + rect.w / 2) * 100 + "%";
    tag.style.top = (rect.y + rect.h / 2) * 100 + "%";
  }
  /** Delete the currently-selected shape (called by Del/Backspace and the
   *  toolbar trash button). Snapshots first so it's undoable. */
  async deleteSelectedShape() {
    const sel = this.selection;
    if (!sel) return;
    this.snapshot();
    const { key, list } = this.rectsFor(sel.file);
    this.folderData.rects[key] = list.filter((r) => r.id !== sel.rect.id);
    await this.saveFolderData();
    this.render();
  }
  /** Create a button with a Lucide icon followed by text. */
  iconBtn(parent, icon, text, opts) {
    const btn = parent.createEl("button", { cls: "sNr-iconbtn" + (opts?.cls ? " " + opts.cls : "") });
    const ico = btn.createSpan({ cls: "sNr-iconbtn-ico" });
    (0, import_obsidian4.setIcon)(ico, icon);
    if (text) btn.createSpan({ cls: "sNr-iconbtn-text", text });
    return btn;
  }
  /** Attach a vertical pair of ▲/▼ buttons beside a number input that
   *  step it by its `step` attribute and trigger 'change'. The browser's
   *  native spinner controls are inconsistent across platforms; explicit
   *  buttons make it obvious you can click to nudge values. */
  attachStepperButtons(wrap, input) {
    const btns = wrap.createDiv({ cls: "sNr-stepper-btns" });
    const up = btns.createDiv({ cls: "sNr-stepper-btn" });
    (0, import_obsidian4.setIcon)(up, "chevron-up");
    up.title = "Increase";
    up.onclick = (e) => {
      e.stopPropagation();
      input.stepUp();
      input.dispatchEvent(new Event("change"));
    };
    const down = btns.createDiv({ cls: "sNr-stepper-btn" });
    (0, import_obsidian4.setIcon)(down, "chevron-down");
    down.title = "Decrease";
    down.onclick = (e) => {
      e.stopPropagation();
      input.stepDown();
      input.dispatchEvent(new Event("change"));
    };
  }
  // ---------- Floating per-rect toolbar ----------
  selectShape(canvas, file, rect, el) {
    const root = canvas.closest(".sNr-view");
    root.querySelectorAll(".sNr-rect.sNr-selected").forEach((r) => r.classList.remove("sNr-selected"));
    root.querySelectorAll(".sNr-target-region.sNr-selected").forEach((r) => r.classList.remove("sNr-selected"));
    document.body.querySelectorAll(".sNr-rect-toolbar").forEach((t) => t.remove());
    root.querySelectorAll(".sNr-vertex").forEach((v) => v.remove());
    el.classList.add("sNr-selected");
    this.selection = { canvas, file, rect, el };
    this.targetSelection = null;
    if (rect.kind === "polygon") this.renderPolyVertices(canvas, file, rect, el);
    const tb = document.body.createDiv({ cls: "sNr-rect-toolbar" });
    const reposition = () => {
      const rb = el.getBoundingClientRect();
      const tbW = tb.offsetWidth || 280;
      const tbH = tb.offsetHeight || 38;
      const margin = 8;
      let top = rb.top - tbH - 6;
      if (top < margin) top = rb.bottom + 6;
      let left = rb.left;
      const maxLeft = window.innerWidth - tbW - margin;
      if (left > maxLeft) left = maxLeft;
      if (left < margin) left = margin;
      tb.style.top = top + "px";
      tb.style.left = left + "px";
    };
    requestAnimationFrame(reposition);
    this.scrollerEl.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    const detachReposition = () => {
      this.scrollerEl.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
    const bToggle = tb.createEl("button", { cls: "sNr-tb-icon-btn" });
    const setToggleIcon = (revealed) => {
      bToggle.empty();
      (0, import_obsidian4.setIcon)(bToggle, revealed ? "eye" : "eye-off");
      bToggle.title = revealed ? "Hide this shape (or pair)" : "Reveal this shape (or pair)";
    };
    setToggleIcon(el.classList.contains("sNr-revealed"));
    bToggle.onclick = (e) => {
      e.stopPropagation();
      const reveal = !el.classList.contains("sNr-revealed");
      this.togglePair(canvas, rect, reveal);
      setToggleIcon(reveal);
    };
    tb.createDiv({ cls: "sNr-tb-divider" });
    const bFlash = tb.createEl("button", { cls: "sNr-tb-icon-btn sNr-tb-flash" });
    const setFlashIcon = (icon) => {
      bFlash.empty();
      (0, import_obsidian4.setIcon)(bFlash, icon);
    };
    const refreshFlash = () => {
      const active = this.timers.has(rect.id);
      bFlash.classList.toggle("sNr-tb-flash-active", active);
      bFlash.title = active ? "Cancel timer (hide now)" : `Flash: reveal then auto-hide after ${rect.seconds || this.plugin.settings.defaultSeconds} sec`;
      setFlashIcon(active && bFlash.matches(":hover") ? "x" : "timer");
    };
    refreshFlash();
    bFlash.addEventListener("mouseenter", () => {
      if (this.timers.has(rect.id)) setFlashIcon("x");
    });
    bFlash.addEventListener("mouseleave", () => {
      setFlashIcon("timer");
    });
    bFlash.onclick = (e) => {
      e.stopPropagation();
      if (this.timers.has(rect.id)) {
        this.cancelFlash(canvas, rect);
        refreshFlash();
        setFlashIcon("timer");
      } else {
        this.flashPair(canvas, rect, () => {
          refreshFlash();
        });
        refreshFlash();
      }
    };
    tb.createSpan({ cls: "sNr-tb-label", text: "Sec" });
    const secWrap = tb.createDiv({ cls: "sNr-stepper" });
    const sec = secWrap.createEl("input", { type: "number" });
    sec.title = `Reveal-then-hide duration in seconds (default ${this.plugin.settings.defaultSeconds})`;
    sec.placeholder = `${this.plugin.settings.defaultSeconds} sec`;
    sec.value = rect.seconds ? String(rect.seconds) : "";
    sec.min = "0";
    sec.step = "0.5";
    this.attachStepperButtons(secWrap, sec);
    sec.onchange = async () => {
      this.snapshot();
      const v = parseFloat(sec.value);
      rect.seconds = isFinite(v) && v > 0 ? v : 0;
      await this.saveFolderData();
    };
    tb.createDiv({ cls: "sNr-tb-divider" });
    tb.createSpan({ cls: "sNr-tb-label", text: "Pair" });
    const pairWrap = tb.createDiv({ cls: "sNr-stepper" });
    const pair = pairWrap.createEl("input", { type: "number" });
    pair.value = String(rect.pair || 0);
    pair.min = "0";
    pair.step = "1";
    pair.placeholder = "Pair #";
    pair.title = "Pair number (0 = unpaired). Shapes sharing a pair number reveal/hide together.";
    this.attachStepperButtons(pairWrap, pair);
    pair.onchange = async () => {
      this.snapshot();
      const v = parseInt(pair.value, 10);
      rect.pair = isFinite(v) && v > 0 ? v : 0;
      el.dataset.pair = String(rect.pair);
      this.renderPairOverlay(canvas, rect);
      if (rect.pair > 0 && this.plugin.settings.pairColorMode !== "off") {
        const { list } = this.rectsFor(file);
        const leader = list.find((r) => r.id !== rect.id && r.pair === rect.pair);
        if (leader) {
          rect.color = leader.color;
          el.style.setProperty("--sNr-color", leader.color);
        }
      }
      await this.saveFolderData();
    };
    const insertBtn = tb.createEl("button", { cls: "sNr-tb-icon-btn" });
    (0, import_obsidian4.setIcon)(insertBtn, "list-plus");
    insertBtn.title = "Renumber higher pairs: compact every distinct pair number greater than the entered value into N+1, N+2, \u2026 (this shape and any peers \u2264 N keep their numbers).";
    insertBtn.onclick = async (e) => {
      e.stopPropagation();
      const target = parseInt(pair.value, 10);
      if (!isFinite(target) || target <= 0) {
        new import_obsidian4.Notice("Enter a positive pair number first.");
        return;
      }
      const { list } = this.rectsFor(file);
      const higher = Array.from(new Set(
        list.filter((r) => r.pair > target).map((r) => r.pair)
      )).sort((a, b) => a - b);
      const remap = /* @__PURE__ */ new Map();
      higher.forEach((p, i) => remap.set(p, target + 1 + i));
      let willChange = false;
      for (const [old, neu] of remap) if (old !== neu) {
        willChange = true;
        break;
      }
      if (!willChange) {
        new import_obsidian4.Notice("Pair numbers above " + target + " are already compact.");
        return;
      }
      this.snapshot();
      let changed = 0;
      for (const r of list) {
        const newPair = remap.get(r.pair);
        if (newPair !== void 0 && newPair !== r.pair) {
          r.pair = newPair;
          changed++;
          const otherEl = canvas.querySelector(`.sNr-rect[data-id="${r.id}"]`);
          if (otherEl) otherEl.dataset.pair = String(r.pair);
          const ov = canvas.querySelector(`.sNr-pair-overlay[data-shape-id="${r.id}"]`);
          if (ov) ov.setText("#" + r.pair);
        }
      }
      await this.saveFolderData();
      new import_obsidian4.Notice(`Renumbered ${changed} shape${changed === 1 ? "" : "s"} above pair ${target}.`);
      this.render();
    };
    tb.createDiv({ cls: "sNr-tb-divider" });
    const colorWrap = tb.createSpan({ cls: "sNr-color-wrap" });
    const colorBtn = colorWrap.createDiv({ cls: "sNr-color-btn" });
    colorBtn.style.background = rect.color || this.plugin.settings.defaultColor;
    colorBtn.title = "Pick color";
    const colorInput = colorWrap.createEl("input", { type: "color" });
    colorInput.value = rect.color || this.plugin.settings.defaultColor;
    colorBtn.onclick = (e) => {
      e.stopPropagation();
      colorInput.click();
    };
    let colorSnapshotted = false;
    colorInput.oninput = () => {
      if (!colorSnapshotted) {
        this.snapshot();
        colorSnapshotted = true;
      }
      this.applyColor(canvas, file, rect, colorInput.value);
      colorBtn.style.background = colorInput.value;
    };
    tb.createDiv({ cls: "sNr-tb-divider" });
    const tgtBtn = tb.createEl("button", { cls: "sNr-tb-icon-btn" });
    const refreshTgt = () => {
      tgtBtn.empty();
      const has = !!rect.targetRegion;
      (0, import_obsidian4.setIcon)(tgtBtn, has ? "target" : "crosshair");
      tgtBtn.classList.toggle("sNr-tb-target-active", has);
      tgtBtn.title = has ? "Remove target region (this label leaves the quiz pool)" : "Add target region: a polygon over the structure this label points to. Required for cross-diagram quiz mode.";
    };
    refreshTgt();
    tgtBtn.onclick = async (e) => {
      e.stopPropagation();
      if (rect.targetRegion) {
        const overlay = canvas.querySelector(
          `.sNr-target-region[data-cover-id="${rect.id}"]`
        );
        if (!overlay) {
          new import_obsidian4.Notice("Target region overlay missing. Re-rendering.");
          this.render();
          return;
        }
        this.selectTargetRegion(canvas, file, rect, overlay);
      } else {
        const block = canvas.closest(".sNr-block");
        if (!block) return;
        this.beginTargetRegionDraft(canvas, file, block, rect.id);
      }
    };
    tb.createDiv({ cls: "sNr-tb-divider" });
    const del = tb.createEl("button", { cls: "sNr-tb-icon-btn sNr-tb-danger" });
    (0, import_obsidian4.setIcon)(del, "trash-2");
    del.title = "Delete shape (Del / Backspace)";
    del.onclick = (e) => {
      e.stopPropagation();
      this.deleteSelectedShape();
    };
    if (this.currentOffClick) {
      document.removeEventListener("mousedown", this.currentOffClick, true);
      this.currentOffClick = null;
    }
    const offClick = (ev) => {
      const target = ev.target;
      if (!target) return;
      if (tb.contains(target) || el.contains(target)) return;
      if (target.closest && target.closest(".sNr-vertex")) return;
      tb.remove();
      el.classList.remove("sNr-selected");
      canvas.querySelectorAll(".sNr-vertex").forEach((v) => v.remove());
      detachReposition();
      this.selection = null;
      document.removeEventListener("mousedown", offClick, true);
      if (this.currentOffClick === offClick) this.currentOffClick = null;
    };
    this.currentOffClick = offClick;
    document.addEventListener("mousedown", offClick, true);
  }
  // ---------- File rename ----------
  renameFile(file) {
    new RenameModal(this.app, file.name, async (newName) => {
      const parent = file.parent ? file.parent.path : "";
      const newPath = parent ? `${parent}/${newName}` : newName;
      const oldPath = file.path;
      try {
        await this.app.fileManager.renameFile(file, newPath);
        this.recordRename(oldPath, newPath);
      } catch (e) {
        console.error(e);
        new import_obsidian4.Notice("Rename failed: " + (e instanceof Error ? e.message : String(e)));
      }
    }).open();
  }
};

// src/settings.ts
var import_obsidian5 = require("obsidian");
var SlideAndRevealSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Slide & Reveal" });
    const intro = containerEl.createEl("p");
    intro.appendText("Right-click any folder in the file explorer and choose ");
    intro.createEl("em", { text: "Open Slide & Reveal here" });
    intro.appendText(". Each folder gets its own ");
    intro.createEl("code", { text: ".slide-and-reveal.json" });
    intro.appendText(" file.");
    new import_obsidian5.Setting(containerEl).setName("Mode").setDesc("Study: scrolling inside an image steps the reveal slider. Edit: wheel scrolls normally \u2014 use this when you're drawing/arranging shapes. Toggle from the header any time.").addDropdown((d) => d.addOption("study", "Study").addOption("edit", "Edit").setValue(this.plugin.settings.mode).onChange(async (v) => {
      this.plugin.settings.mode = v;
      await this.plugin.saveSettings();
      this.app.workspace.getLeavesOfType("slide-and-reveal-view").forEach((l) => {
        const v2 = l.view;
        if (typeof v2.render === "function") v2.render();
      });
    }));
    new import_obsidian5.Setting(containerEl).setName("Default reveal time (seconds)").setDesc("Used by the \u23F1 button when a rectangle has no per-rect override.").addText((t) => t.setValue(String(this.plugin.settings.defaultSeconds)).onChange(async (v) => {
      const n = parseFloat(v);
      this.plugin.settings.defaultSeconds = isFinite(n) && n > 0 ? n : 3;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Default rectangle color").addColorPicker((c) => c.setValue(this.plugin.settings.defaultColor).onChange(async (v) => {
      this.plugin.settings.defaultColor = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Reveal slider position").setDesc("Which side of each image the reveal/hide rail sits on.").addDropdown((d) => d.addOption("left", "Left").addOption("right", "Right").setValue(this.plugin.settings.railSide).onChange(async (v) => {
      this.plugin.settings.railSide = v;
      await this.plugin.saveSettings();
      this.app.workspace.getLeavesOfType("slide-and-reveal-view").forEach((l) => {
        const v2 = l.view;
        if (typeof v2.render === "function") v2.render();
      });
    }));
    containerEl.createEl("h3", { text: "Keyboard" });
    new import_obsidian5.Setting(containerEl).setName("Left/Right arrows zoom in/out").setDesc("When the view is focused, \u2190 shrinks and \u2192 grows by the step below.").addToggle((t) => t.setValue(this.plugin.settings.arrowKeysZoom).onChange(async (v) => {
      this.plugin.settings.arrowKeysZoom = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Arrow-key zoom step (%)").setDesc("How many percentage points each \u2190/\u2192 press changes the size.").addText((t) => t.setValue(String(this.plugin.settings.arrowKeysZoomStep)).onChange(async (v) => {
      const n = parseInt(v, 10);
      this.plugin.settings.arrowKeysZoomStep = isFinite(n) && n > 0 ? n : 5;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Up/Down arrows reveal/hide on the focused image").setDesc("Independent of mode and zoom: when ON, \u2191 and \u2193 always step the reveal slider on the focused image. When OFF, \u2191/\u2193 pass through to native page scroll (so you can scroll the image list with the keyboard instead).").addToggle((t) => t.setValue(this.plugin.settings.arrowKeysReveal).onChange(async (v) => {
      this.plugin.settings.arrowKeysReveal = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Invert reveal arrow direction").setDesc("Off (default): \u2191 hides, \u2193 reveals. On: \u2191 reveals, \u2193 hides.").addToggle((t) => t.setValue(this.plugin.settings.arrowKeysRevealInverted).onChange(async (v) => {
      this.plugin.settings.arrowKeysRevealInverted = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Wheel steps reveal even when zoomed past 100%").setDesc("By default, scrolling on an image whose zoom is over 100% scrolls the page (so the wider image is reachable). Turn this on to keep the wheel locked to the reveal slider regardless of zoom. Only applies in Study mode.").addToggle((t) => t.setValue(this.plugin.settings.wheelStepPast100).onChange(async (v) => {
      this.plugin.settings.wheelStepPast100 = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Mouse-wheel sensitivity (px per step)").setDesc("Pixels of wheel-delta needed to advance the reveal slider one step. Bump this up if a single click of your mouse wheel jumps too many steps (common with gaming mice on Windows). Default 60.").addText((t) => t.setValue(String(this.plugin.settings.wheelStepThreshold)).onChange(async (v) => {
      const n = parseInt(v, 10);
      this.plugin.settings.wheelStepThreshold = isFinite(n) && n >= 10 ? n : 60;
      await this.plugin.saveSettings();
    }));
    new import_obsidian5.Setting(containerEl).setName("Pair color propagation").setDesc("How a color change on one member of a pair affects the others.").addDropdown((d) => d.addOption("off", "Off \u2014 each shape keeps its own color").addOption("first-to-rest", "First \u2192 rest (only the pair leader propagates)").addOption("all", "All \u2014 every change propagates to the whole pair").setValue(this.plugin.settings.pairColorMode).onChange(async (v) => {
      this.plugin.settings.pairColorMode = v;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "Folders using Slide & Reveal" });
    const known = this.plugin.settings.knownFolders.slice().reverse();
    if (!known.length) {
      containerEl.createEl("p", { text: "No folders yet." });
    } else {
      for (const folder of known) {
        const s = new import_obsidian5.Setting(containerEl).setName(folder);
        s.addButton((b) => b.setButtonText("Open").onClick(() => this.plugin.openForFolder(folder)));
        s.addButton((b) => b.setButtonText("Remove from list").onClick(async () => {
          await this.plugin.forgetFolder(folder);
          this.display();
        }));
        s.addButton((b) => b.setButtonText("Delete annotations file").setWarning().onClick(async () => {
          const path = joinPath(folder, ANNOT_FILE);
          try {
            if (await this.app.vault.adapter.exists(path)) {
              await this.app.vault.adapter.remove(path);
              new import_obsidian5.Notice(`Deleted ${path}`);
            }
          } catch (e) {
            console.error(e);
            new import_obsidian5.Notice("Delete failed (see console)");
          }
          await this.plugin.forgetFolder(folder);
          this.display();
        }));
      }
    }
    const discoveredHeader = containerEl.createEl("h3", { text: "Discovered folders (not in active list)" });
    discoveredHeader.title = "Folders in your vault that contain a .slide-and-reveal.json (or legacy .image-annotator.json) file but aren't currently tracked.";
    const note = containerEl.createEl("p", {
      text: "Re-add a previously removed folder. Annotations are still in the .slide-and-reveal.json file in that folder."
    });
    note.style.fontSize = "0.85em";
    note.style.color = "var(--text-muted)";
    const discoveredEl = containerEl.createDiv();
    const status = containerEl.createEl("p");
    status.style.fontSize = "0.85em";
    status.style.color = "var(--text-muted)";
    status.setText("Scanning\u2026");
    this.scanDiscovered().then((discovered) => {
      const knownSet = new Set(this.plugin.settings.knownFolders);
      const fresh = discovered.filter((f) => !knownSet.has(f));
      status.setText(fresh.length ? `Found ${fresh.length} folder(s).` : "No additional folders found.");
      for (const folder of fresh) {
        const s = new import_obsidian5.Setting(discoveredEl).setName(folder);
        s.addButton((b) => b.setButtonText("Add & open").onClick(() => {
          this.plugin.openForFolder(folder);
          this.display();
        }));
        s.addButton((b) => b.setButtonText("Add to list").onClick(async () => {
          this.plugin.rememberFolder(folder);
          this.display();
        }));
      }
    }).catch((e) => {
      console.error(e);
      status.setText("Scan failed (see console).");
    });
  }
  /** Walk the vault and collect folders that contain ANNOT_FILE. */
  async scanDiscovered() {
    const found = [];
    const seen = /* @__PURE__ */ new Set();
    const walk = async (dir) => {
      let entries;
      try {
        entries = await this.app.vault.adapter.list(dir);
      } catch {
        return;
      }
      for (const f of entries.files) {
        const slash = f.lastIndexOf("/");
        const name = slash >= 0 ? f.slice(slash + 1) : f;
        if (name === ANNOT_FILE || name === LEGACY_ANNOT_FILE) {
          const folder = slash >= 0 ? f.slice(0, slash) : "";
          if (!seen.has(folder)) {
            seen.add(folder);
            found.push(folder);
          }
        }
      }
      for (const sub of entries.folders) {
        const tail = sub.split("/").pop() || sub;
        if (tail.startsWith(".")) continue;
        await walk(sub);
      }
    };
    await walk("");
    found.sort();
    return found;
  }
};

// src/main.ts
var SlideAndRevealPlugin = class extends import_obsidian6.Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new SlideAndRevealView(leaf, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof import_obsidian6.TFolder)) return;
      menu.addItem((item) => {
        item.setTitle("Open Slide & Reveal here").setIcon("image").onClick(() => this.openForFolder(file.path));
      });
    }));
    this.addRibbonIcon("image", "Open Slide & Reveal", () => {
      const last = this.settings.knownFolders[this.settings.knownFolders.length - 1];
      if (last) this.openForFolder(last);
      else new import_obsidian6.Notice('Right-click a folder in the file explorer and choose "Open Slide & Reveal here".');
    });
    this.addCommand({
      id: "open-slide-and-reveal",
      name: "Open Last Folder",
      callback: () => {
        const last = this.settings.knownFolders[this.settings.knownFolders.length - 1];
        if (last) this.openForFolder(last);
        else new import_obsidian6.Notice("No folder yet. Right-click a folder to open it here.");
      }
    });
    this.addCommand({
      id: "pick-slide-and-reveal",
      name: "Pick Folder",
      callback: () => {
        const folders = this.settings.knownFolders.slice().reverse();
        if (!folders.length) {
          new import_obsidian6.Notice('No folders yet. Right-click a folder and choose "Open Slide & Reveal here" first.');
          return;
        }
        new FolderPickerModal(this.app, folders, (f) => this.openForFolder(f)).open();
      }
    });
    this.addRibbonIcon("crosshair", "Slide & Reveal: cross-diagram quiz", () => {
      new ScopePickerModal(this).open();
    });
    this.addCommand({
      id: "slide-and-reveal-quiz",
      name: "Cross-diagram quiz",
      callback: () => new ScopePickerModal(this).open()
    });
    this.addSettingTab(new SlideAndRevealSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.knownFolders)) this.settings.knownFolders = [];
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  rememberFolder(path) {
    if (!path) return;
    const list = this.settings.knownFolders;
    const idx = list.indexOf(path);
    if (idx >= 0) list.splice(idx, 1);
    list.push(path);
    this.saveSettings();
  }
  forgetFolder(path) {
    this.settings.knownFolders = this.settings.knownFolders.filter((p) => p !== path);
    return this.saveSettings();
  }
  async openForFolder(folderPath) {
    this.rememberFolder(folderPath);
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find((l) => l.view.folderPath === folderPath);
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { folderPath } });
    this.app.workspace.revealLeaf(leaf);
  }
};
