# Release notes

## 0.5.19 — 2026-10-02

UI glitch fixes from a sweep of every screen in edit and study mode, light and dark themes, narrow panes and phone layout.

- Narrow panes and phones: the header buttons wrap instead of being cut off at the edge, and the thumbnail sidebar shrinks (to at most 40% of the pane) so the image no longer gets squeezed to a sliver.
- The floating cover toolbar wraps to fit phone screens, sits under dialogs and the command palette instead of on top of them, and goes away when you switch tabs.
- The reveal-rail thumb returns to full brightness on hover, as intended.
- Header buttons stay put while you scroll, so a click during scrolling is no longer lost.
- With edits locked in Study mode, a target region no longer blocks double-clicking the cover underneath it.
- The "saving is paused" warning is now styled as an error so it stands out.
- Thumbnail tooltips flip correctly in narrower popout windows.
- Quiz: in "Show whole image" mode the labels no longer flash before they are covered; images that fail to load show a message instead of a blank space; the quiz window is wide enough for its images.

AI assistance: Claude (model: Claude Opus 5.5).

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
