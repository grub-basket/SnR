# Slide & Reveal

An Obsidian plugin for **flashcard-style study of labeled images** —
diagrams, anatomy plates, screenshots with callouts, slide exports,
anything where you want to test yourself on the labels by hiding them
and uncovering them one at a time.

It's the thing PowerPoint is bad at: instead of duplicating a slide
once for every label you want to add (so each slide reveals "one more"
than the previous), you import the image once, drop covers on the
labels, and **scroll inside the image** to progressively uncover them.

## What it does

- Right-click any folder in Obsidian's file explorer → **Open Slide &
  Reveal here**. Opens a custom view that lists every image in the
  folder.
- Draw covers (rectangles or freeform polygons) over the parts of each
  image you want to test yourself on.
- Group covers into **pairs** (numbered) — paired covers reveal/hide
  together. Useful when one label has multiple boxed regions.
- A vertical **reveal rail** on the side of each image lets you scrub
  through the covers one group at a time. Wheel-scroll inside the image
  works the rail; ↑/↓ arrow keys do the same.
- Per-folder. Annotations save into a hidden `.slide-and-reveal.json`
  file in the folder, so the folder is portable — share, sync, drop into
  Drive, whatever.

## Install

There's no Community Plugins listing yet. Manual install:

1. Download / unzip the plugin folder so you have:
   ```
   Slide & Reveal/
     manifest.json
     main.js
     styles.css
   ```
2. Drop that folder into your vault's plugin directory:
   `<your vault>/.obsidian/plugins/`
3. In Obsidian: **Settings → Community plugins** → make sure Restricted
   mode is off → Reload installed plugins → toggle **Slide & Reveal** on.
4. Right-click any folder in the file explorer → **Open Slide & Reveal
   here**.

## Features

### Shapes
- **Rectangles** — drag on the image to draw.
- **Polygons** — click vertices, then Finalize (or Cancel). Drag a
  selected polygon's vertex handles to reshape; right-click a vertex
  to remove it.
- Move shapes by dragging; resize via the corner handle.
- Each new shape auto-picks the next available pair number.
- Per-shape color, custom timer duration, pair number.

### Pair groups
- Shapes sharing a pair number reveal/hide as a single unit.
- Color propagation between paired shapes is configurable: off,
  first-leader-only, or all (default).
- Joining an existing pair adopts the pair's color so groups stay
  visually consistent.

### Reveal slider (per image)
- Vertical rail with chevron-up and chevron-down step buttons, a
  draggable thumb to scrub, and dots for each group.
- Mouse-wheel inside an image steps the rail; outside the image,
  wheel scrolls the list normally.
- Past 100% zoom: wheel passes through to vertical scroll instead
  (since the image now fills the pane); use ↑/↓ keys for the rail
  in this mode.
- Step-position persists per image.
- Cover/thumb opacity fades subtly as you reveal more groups.

### Image management
- **Thumbnail sidebar** with drag-to-reorder; resizable via the divider
  between sidebar and content. Click a thumb to jump to that image.
- **Rename** any image inline via the pencil next to its filename.
- Display order is **stable across renames** (separate `order` field
  in the annotations file).

### Floating per-shape toolbar
- Click any shape to bring it up. Reveal/Hide toggle, flash timer,
  per-shape seconds + pair number with stepper buttons, color picker,
  delete.
- The flash timer button **pulses** while a timer is running; hover or
  click again to cancel and hide immediately.

### Header tools (act on the focused image)
- Add Rectangle / Add Polygon — sticky modes (stay active until you
  toggle off, so you can keep adding shapes).
- Reveal all / Hide all on the current image.
- Undo / Redo / Prev / Next.
- Refresh + Reset all reveal sliders.
- Size slider + editable percentage box (slider 25–200%, type any
  value past that).

### Keyboard
| Key                    | Action                                       |
|------------------------|----------------------------------------------|
| Mod+Z / Mod+Shift+Z    | Undo / Redo                                  |
| Mod+Y                  | Redo                                         |
| Delete / Backspace     | Delete the selected shape                    |
| ←  /  →                | Zoom out / in (configurable)                 |
| ↑  /  ↓                | Hide / Reveal one step on focused image (configurable, can invert) |
| Esc                    | Disabled (so it can't accidentally switch tabs) |

### Other
- **Undo includes file renames** — Mod+Z reverses an image rename via
  Obsidian's file manager (the data file follows automatically).
- **Discovered folders** — the settings tab scans your vault for
  folders that have a Slide & Reveal annotation file but aren't in the
  active list, with one-click "Add & open".
- **Picker command** — `Slide & Reveal: Pick Folder` opens a fuzzy
  modal over all known folders.
- **Backward compatibility** — older `.image-annotator.json` files
  (this plugin's previous name) are read on load; first save migrates
  them silently.

## Settings

- **Default reveal time (seconds)** — used by the flash button when a
  shape doesn't override it.
- **Default rectangle color** — what new shapes get.
- **Reveal slider position** — left or right side of each image.
- **Pair color propagation** — off / first-to-rest / all.
- **Left/Right arrows zoom in/out** + step.
- **Up/Down arrows reveal/hide** + invert direction.
- **Mouse-wheel sensitivity** — px per reveal step. Crank up if a
  gaming mouse on Windows fires huge deltas per click.
- **Folders using Slide & Reveal** — open / remove / delete the
  annotations file for each tracked folder.
- **Discovered folders** — re-add folders whose annotation files are
  still on disk but aren't in the active list.

## Authors / credits

- **Human** — designed it, drove the requirements, tested every
  iteration, picked the name.
- **Claude Opus 4.7 (1M context)** — wrote the code under Human's
  direction. This is a vibe-coded plugin: every feature was specified
  in plain English, implemented immediately, and shipped one commit at
  a time.

If you build something on top of it or fix a bug, send a PR or just
fork it.

## File layout

```
Slide & Reveal/                 ← source repo
├── src/
│   ├── main.ts                 plugin lifecycle, ribbon, commands, file-menu hook
│   ├── view.ts                 the bulk of the UI (render, drawing, undo, rail…)
│   ├── settings.ts             settings tab + folder discovery scan
│   ├── modals.ts               folder picker, rename
│   ├── types.ts                FolderData, Settings, constants
│   └── util.ts                 small helpers
├── styles.css                  all the CSS
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs          bundles src/main.ts → main.js, copies to PLUGIN_DIR
├── CLAUDE.md                   notes for the AI
└── README.md
```

## Build

```sh
npm install
npm run build       # typecheck + bundle + copy to PLUGIN_DIR
npm run dev         # esbuild watch mode (rebuild + copy on every save)
```

`PLUGIN_DIR` env var overrides the deployment destination.

## License

MIT (do whatever).
