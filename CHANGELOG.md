# Release notes

## 0.5.18 — 2026-10-02

- Hold the middle mouse button and drag to pan the image list, like the hand tool in a PDF viewer. Handy when zoomed past 100%.
- New covers can start or finish on top of existing covers: while Rectangle or Polygon mode is on, existing covers are click-through.
- Press Enter to finish the rectangle (at the mouse position) or polygon you are drawing.
- Right-click or press Esc to throw away the shape you are drawing. You stay in draw mode. Esc previously did nothing in this view.
- Polygon points are placed by the left mouse button only, so right- and middle-clicks no longer add stray points.
- README and button tooltips describe the new controls.

AI assistance: Claude (model: Claude Opus 5.5).

## 0.5.17 — 2026-09-09

- Allow edits in Study mode by default, with a setting to lock annotation edits while preserving reveal controls and saved progress.
- Keep reveal rails, covers and pair-number labels synchronized after pair changes and Reveal/Hide actions.
- Pause unsafe annotation saves after load failures or conflicting changes; validate annotation data and colors.
- Keep folder paths current after renames, archive annotations with backups, and avoid unrelated image refreshes.
- Repair polygon controls and draft cleanup, and clean up selection listeners.
- Conceal labels in cropped quiz questions and skip malformed quiz entries.

AI assistance: Codex (model: GPT-6).
