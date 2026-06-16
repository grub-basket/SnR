# Slide & Reveal

An Obsidian plugin for **flashcard-style study of labeled images** —
diagrams, anatomy plates, screenshots with callouts, slide exports,
maps, sheet music, anything where the question is *"what's that part
called?"* and the answer is a label on a picture.

It's the thing PowerPoint is bad at: instead of duplicating a slide
once for every label you want to reveal in sequence, you import the
image once, drop covers on the labels, and **scroll inside the image**
to progressively uncover them, one group at a time.

Version 0.5 added a second mode: a **cross-diagram quiz** that pulls
cropped fragments from across an entire folder (or several folders),
shuffles them, and asks you to identify each one out of context.

## Table of contents

- [Quick start](#quick-start)
- [Install](#install)
- [Concepts](#concepts)
- [Study mode (in-place reveal)](#study-mode-in-place-reveal)
- [Cross-diagram quiz mode](#cross-diagram-quiz-mode)
- [Keyboard reference](#keyboard-reference)
- [Settings](#settings)
- [Data files and portability](#data-files-and-portability)
- [Build from source](#build-from-source)
- [Architecture overview](#architecture-overview)
- [Authors](#authors)
- [License](#license)

## Quick start

1. Install (see [Install](#install)).
2. Right-click any folder of images in Obsidian's file explorer → **Open
   Slide & Reveal here**.
3. Click the **Rectangle** or **Polygon** button in the header, then draw
   over a label on one of the images.
4. Repeat for more labels. Use the **Pair #** input on a shape's
   toolbar to group shapes that should reveal together.
5. **Scroll** inside the image (mouse wheel or two-finger scroll) to
   progressively uncover the labels. Up/down arrow keys do the same.
6. Optional: click the crosshair (**Target region**) button on a cover
   to mark the structure that label points to. Now that cover is
   eligible for [cross-diagram quiz](#cross-diagram-quiz-mode) mode.

## Install

There is no Community Plugins store listing yet. Two install paths:

### Manual install

1. Download the three release files from the [Releases page](#) (or
   build them yourself, see [Build from source](#build-from-source)):
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. Put them inside a folder named `Slide & Reveal/` inside your vault's
   plugin directory:
   ```
   <your vault>/.obsidian/plugins/Slide & Reveal/
     manifest.json
     main.js
     styles.css
   ```
3. In Obsidian: **Settings → Community plugins** → turn off Restricted
   mode if it's on → click **Reload installed plugins** → toggle
   **Slide & Reveal** on.

### BRAT install (auto-update)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the
   Community Plugins store.
2. Open BRAT settings → **Add Beta plugin** → paste the public GitHub
   URL for this repo.
3. BRAT will fetch the latest release and keep it updated.

Either way, after enabling: right-click any folder in the file explorer
and pick **Open Slide & Reveal here**, or use the command palette:
*Slide & Reveal: Open Last Folder* / *Pick Folder*.

## Concepts

A few words you'll see throughout the plugin:

- **Cover** (or *shape*) — a rectangle or polygon you draw over a
  label. While "up" it conceals the label; once revealed it's mostly
  transparent (you can still see its outline if you want to find it
  again).
- **Pair** — a positive integer that groups covers. Covers sharing a
  pair number reveal and hide together. Unpaired covers (pair = 0) are
  each their own group.
- **Reveal rail** — the vertical slider on the side of each image.
  Each step uncovers one group, ordered by pair number ascending, with
  unpaired covers last.
- **Target region** *(quiz feature, optional per cover)* — a second
  polygon attached to a cover, drawn over the structure the label
  points to. Required if you want that label to show up in the
  cross-diagram quiz.

## Study mode (in-place reveal)

### Drawing

- Click **Rectangle** in the header, then drag on the focused image to
  draw a rectangular cover.
- Click **Polygon** in the header, then click vertices on the image to
  build a freeform shape. **Finalize** when done, or **Cancel** to
  bail. The Esc key is intentionally disabled inside this view (so it
  can't switch tabs by accident), hence the explicit Cancel button.
- Both drawing modes are sticky — you stay in draw mode until you
  click the button again, so you can keep adding shapes without
  re-engaging.

### Editing

- **Click** a cover to select it. A floating toolbar appears above with
  per-shape controls.
- **Drag** the cover body to move it. Drag the **corner handle** to
  resize. For polygons, drag any **vertex handle** to reshape, or
  right-click a vertex to delete it (minimum 3).
- The toolbar carries: reveal/hide toggle, **flash** timer (briefly
  show then auto-hide), per-shape seconds override, pair number with
  ▲/▼ steppers, an **Insert Pair** button (see below), color picker,
  target-region button, delete.

### Pair groups

Shapes with matching pair numbers reveal and hide together. Useful when
one label has multiple boxed regions, or when several labels naturally
reveal at the same step.

- **Joining** an existing pair: type that pair's number into another
  shape's pair input. The joining shape adopts the leader's color
  (unless pair color propagation is off — see Settings).
- **Insert Pair button** (the *list-plus* icon on the toolbar): types
  in a pair value and hits this button to shift *every other* shape
  with `pair ≥ that value` up by 1. Pair-mates of the shifted shapes
  stay together. The current shape keeps its number. Use it to "make
  room" for a new group at a specific position without manually
  renumbering everything above.

### Revealing

- **Reveal rail** sits next to each image (left or right, configurable):
  - Chevron-up at top: hide one step. Chevron-down at bottom: reveal one
    step. Drag the thumb to scrub.
  - **Mouse-wheel** inside the image steps the rail (in study mode).
    Outside the image, wheel scrolls the list normally.
  - Past 100% zoom, wheel passes through to vertical scroll (so you can
    pan the now-wider image). Use ↑/↓ keys for stepping at that point —
    they always step in study mode regardless of zoom level. (You can
    flip this with the `wheelStepPast100` setting if you prefer wheel
    to keep stepping.)
- **Hide/Reveal one** buttons in the header: ±1-step versions of
  Reveal/Hide all, for users who'd rather click than scroll.
- **Reveal/Hide all** buttons: instant uncover or recover everything on
  the focused image.
- Each image's last reveal position **persists** to disk, so you can
  close and reopen Obsidian and pick up where you left off.

### Per-image flash timer

Each cover can be "flashed" — revealed for N seconds, then auto-hidden
again. Useful for quick self-tests where you want a peek and then
return to the recall state. The timer button pulses while running;
hover or click again to cancel.

### Image management

- **Thumbnail sidebar** on the left. Click a thumb to jump. Drag thumbs
  vertically to reorder; the order persists in the annotation file
  (separate from filenames, so renames don't reshuffle).
- The sidebar **auto-tracks the main scroll**: as you scroll the
  content pane, the active thumb anchors to the top of the sidebar so
  you can see where you are at a glance. One-way sync — the sidebar's
  own scroll doesn't move the main pane (PowerPoint-style).
- The **focused image** (the one the header tools act on) gets an
  accent-color outline so it's clear which image your next click will
  affect.
- **Rename images inline** via the pencil next to each filename.
  Renames go through Obsidian's file manager so other tools see them,
  and they're **undoable** (Mod+Z reverses the rename and remaps
  annotations).

### Zoom

- **Slider + percentage box** in the header. Slider covers 25–200%;
  type any value past 200% directly into the box (250%, 500%,
  whatever).
- **+/−** buttons flank the slider for one-step bumps.
- **Ctrl/Cmd + scroll** (or trackpad pinch) anywhere in the view zooms
  the image. When the cursor is inside the content pane, zoom is
  **toward the cursor** — the image-point under the mouse stays
  under the mouse. Outside the pane (over the sidebar, header), zoom
  falls back to centered (no pivot).
- Left/Right arrow keys do step-zoom (configurable).

## Cross-diagram quiz mode

Out-of-context active recall. The quiz crops just the relevant region
out of the diagram and asks "what is this?", drawing from a configurable
pool of folders.

### How to enroll labels in the quiz

A cover is eligible for the quiz only when it has a **target region** —
a second polygon over the structure the label points to.

1. Click an existing cover (the one over a label) to select it.
2. Click the **crosshair** button on its toolbar.
3. Draw a polygon over the structure that label refers to. **Finalize**
   when done.

The cover and its target region get a faint dashed connector line
between them so the relationship is visible at a glance. Click the
target region to select it (it gets its own mini toolbar — delete,
vertex-edit, drag-to-move). Covers without a target region are
ignored by quiz mode but still work normally in study mode.

### Running a quiz

1. Click the **crosshair** button in the header (right of the size
   widget), or run *Slide & Reveal: Cross-diagram quiz* from the command
   palette. Or use the ribbon icon if you've enabled it.
2. Pick a **scope**:
   - **This slide** — only covers on the currently-focused image.
   - **This folder** — every cover-with-target in the open folder.
   - **Multiple folders…** — check the folders you want to pool from.
3. The quiz modal opens. Each step shows a **cropped target region**
   from a random image. Try to recall the label.
4. Click **Show answer**. The crop swaps to the **cover region** of the
   same image (so you can read the label up close).
5. Self-grade with **Got it** / **Missed it**, and the quiz advances.
6. On completion you get a session score (e.g. *Got 12 of 15 — 80%*)
   and an option to **Restart (reshuffle)**.

### Cropped vs. full image

Each step has a **view toggle** below the stage:

- **Cropped (default)** — zoomed into the target region (prompt) or the
  cover region (answer). Labels are easy to read up close.
- **Whole image** — the full source image with the relevant region
  outlined. **Every other cover stays concealed** so unrelated labels
  in the same image don't leak — you only see what you're being quizzed
  on.

Pick a preference and it sticks across steps.

### Aliases (per cover)

If a label has alternate names, they're shown on the answer screen as
*"Also called: …"*. Aliases are also reserved as a future hook for
typed-answer grading (not yet implemented).

## Keyboard reference

All shortcuts work while the Slide & Reveal view is focused (clicking
on it gives it focus). Shortcuts are skipped when you're typing into a
text/number input.

| Key                    | Action                                       |
|------------------------|----------------------------------------------|
| Mod+Z / Mod+Shift+Z    | Undo / Redo                                  |
| Mod+Y                  | Redo                                         |
| Delete / Backspace     | Delete the selected shape or target region   |
| ← / →                  | Zoom out / in (configurable, configurable step) |
| ↑ / ↓                  | Hide / Reveal one step on the focused image (always active in study mode; invertible) |
| Esc                    | **Disabled** so it can't switch tabs. Drafting has a visible Cancel button. |

Right-click on a polygon vertex deletes it (minimum 3 points).
Double-click an image canvas while polygon-drafting finalizes the
polygon.

## Settings

Open via **Settings → Community plugins → Slide & Reveal → ⚙️**.

| Setting | Default | Notes |
|---|---|---|
| **Default reveal time (seconds)** | 3 | Used by the flash button on a cover without its own per-shape override. |
| **Default rectangle color** | `#3b82f6` (blue) | Color for new covers. |
| **Image scale** | 80 % | Persisted across reloads. |
| **Sidebar width** | 200 px | Drag the divider to change. |
| **Pair color propagation** | `all` | `off` / `first-to-rest` / `all`. Controls whether editing one shape's color flows to its pair-mates. |
| **Reveal slider position** | left | Left or right side of each image. |
| **Left/right arrows zoom** | on | Toggle, with a configurable step (default 5%). |
| **Up/down arrows reveal** | on | Toggle, with an invert flag. In *study* mode this is always on regardless of the toggle (which then only governs edit mode). |
| **Mouse-wheel sensitivity** | 60 px / step | Bump up if a gaming mouse on Windows fires huge wheel deltas per click. |
| **Mode** | `study` | `study` = wheel inside the image steps the reveal rail. `edit` = wheel is hands-off (you scroll, you draw, you don't fat-finger a cover open). |
| **Wheel-step past 100%** | off | Past 100% zoom, wheel normally passes through to vertical scroll (so you can pan the wider image). Turn this on to keep wheel stepping the rail even when zoomed. |
| **Folders using Slide & Reveal** | — | List of tracked folders with one-click *open*, *remove from list*, or *delete annotation file*. |
| **Discovered folders** | — | Vault scan turns up folders that already have an annotation file (e.g. synced in from another device) but aren't tracked here yet. One-click to add. |

## Data files and portability

The plugin writes **one hidden JSON file per folder**: `<folder>/.slide-and-reveal.json`.

Contents:

- `rects` — shapes per image, keyed by relative path.
- `order` — explicit display order (so renaming doesn't reshuffle).
- `revealSteps` — last reveal slider value per image.
- `scrollTop` — last content-pane scroll position.

Plugin-wide settings live in Obsidian's standard plugin data dir
(`<vault>/.obsidian/plugins/Slide & Reveal/data.json`).

**Portability:** because annotations live next to the images and use
relative paths, you can move/share/sync the whole folder (Dropbox,
Drive, syncthing, a zip on a USB stick) and the annotations come along.
Drop the folder into a different Obsidian vault and it just works —
the plugin discovers it on next scan.

**Backward compatibility:** older `.image-annotator.json` files (this
plugin's previous name) are read on load; first save migrates them
silently to the new name.

## Build from source

Requires **Node 20+** and **pnpm 11+**.

```sh
pnpm install
pnpm run build        # typecheck + esbuild bundle + copy artifacts to PLUGIN_DIR
pnpm run dev          # esbuild watch mode (rebuild + copy on every save)
pnpm run typecheck    # tsc --noEmit
```

The build copies `main.js + manifest.json + styles.css` to
`$PLUGIN_DIR` (defaults to the hardcoded `Plugin Test` vault path in
`esbuild.config.mjs`). Override with `PLUGIN_DIR=...` to deploy
elsewhere.

The `obsidian` package and `node_modules` are externalized — the
shipped `main.js` is plain plugin code only.

## Architecture overview

```
Slide & Reveal/                 ← source repo
├── src/
│   ├── main.ts                 plugin lifecycle, ribbon, commands, file-menu hook
│   ├── view.ts                 the bulk of the UI (render, drawing, undo, rail, toolbars…)
│   ├── settings.ts             settings tab + folder discovery scan
│   ├── modals.ts               folder picker, rename
│   ├── quiz.ts                 quiz pool builder (view-agnostic)
│   ├── quiz-modals.ts          quiz UI (scope picker, multi-folder picker, quiz runner)
│   ├── types.ts                FolderData, Rect, TargetRegion, Settings, constants
│   └── util.ts                 small helpers (uid, clamp01, clampPoints, path joins)
├── styles.css                  all the CSS
├── manifest.json
├── package.json
├── pnpm-workspace.yaml         pnpm config (only-built-dependencies allowlist)
├── tsconfig.json
├── esbuild.config.mjs          bundles src/main.ts → main.js, copies to PLUGIN_DIR
├── CLAUDE.md                   per-project AI notes
├── LICENSE
└── README.md
```

A few load-bearing design choices:

- **Render strategy.** `render()` empties the root and rebuilds. Scroll
  position is captured before empty and restored on the next frame; body-
  attached overlays (toolbars, tooltips) are explicitly cleaned up at
  the top of each render so they don't orphan.
- **Persisted reveal state.** There used to be a parallel in-memory map
  of reveal positions; it drifted out of sync with the persisted state
  after undo restored a snapshot. We removed it. Don't reintroduce
  caching layers next to persisted state.
- **Undo is two flavors.** A `data` op (JSON snapshot of FolderData) and
  a `rename` op (actual vault file rename, undone via
  `app.fileManager.renameFile`). Undoing a rename also fires the vault
  rename hook, which remaps the annotation keys for free.
- **Floating per-shape toolbar.** Body-attached with `position: fixed`,
  because earlier in-canvas placement got clipped by the
  `overflow: hidden` on each shape's block.

If you want a deeper tour, `CLAUDE.md` in the repo has the running
architecture notes used during development.

## Authors

- **Human** — designed it, drove every requirement, tested every
  iteration, named it. The plugin exists because there wasn't a good
  way to do scroll-to-reveal flashcards on labeled images in Obsidian.
- **Claude Opus 4.7 (1M context)** — wrote the code under Human's
  direction. This is vibe-coded software: every feature was specified
  in plain English, implemented immediately, and shipped one commit at
  a time.

If you build something on top of it or fix a bug, send a PR or just
fork it.

## License

[MIT](./LICENSE). Do whatever you want with it.
