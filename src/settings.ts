import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SlideAndRevealPlugin from './main';
import { ANNOT_FILE, LEGACY_ANNOT_FILE } from './types';
import { joinPath } from './util';

export class SlideAndRevealSettingTab extends PluginSettingTab {
  plugin: SlideAndRevealPlugin;
  constructor(app: App, plugin: SlideAndRevealPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Slide and Reveal').setHeading();
    const intro = containerEl.createEl('p');
    intro.appendText('Right-click any folder in the file explorer and choose ');
    intro.createEl('em', { text: 'Open Slide and Reveal here' });
    intro.appendText('. Each folder gets its own ');
    intro.createEl('code', { text: '.slide-and-reveal.json' });
    intro.appendText(' file.');

    new Setting(containerEl)
      .setName('Mode')
      .setDesc('Study: scrolling inside an image steps the reveal slider. Edit: wheel scrolls normally — use this when you\'re drawing/arranging shapes. Toggle from the header any time.')
      .addDropdown((d) => d
        .addOption('study', 'Study')
        .addOption('edit', 'Edit')
        .setValue(this.plugin.settings.mode)
        .onChange(async (v) => {
          this.plugin.settings.mode = v as 'study' | 'edit';
          await this.plugin.saveSettings();
          this.app.workspace.getLeavesOfType('slide-and-reveal-view').forEach((l) => {
            const v2 = l.view as { render?: () => void };
            if (typeof v2.render === 'function') v2.render();
          });
        }));

    new Setting(containerEl)
      .setName('Default reveal time (seconds)')
      .setDesc('Used by the ⏱ button when a rectangle has no per-rect override.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.defaultSeconds))
        .onChange(async (v) => {
          const n = parseFloat(v);
          this.plugin.settings.defaultSeconds = isFinite(n) && n > 0 ? n : 3;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default rectangle color')
      .addColorPicker((c) => c
        .setValue(this.plugin.settings.defaultColor)
        .onChange(async (v) => { this.plugin.settings.defaultColor = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reveal slider position')
      .setDesc('Which side of each image the reveal/hide rail sits on.')
      .addDropdown((d) => d
        .addOption('left', 'Left')
        .addOption('right', 'Right')
        .setValue(this.plugin.settings.railSide)
        .onChange(async (v) => {
          this.plugin.settings.railSide = v as 'left' | 'right';
          await this.plugin.saveSettings();
          // Re-render any open Slide and Reveal views so the change shows
          // up immediately without needing to reopen them.
          this.app.workspace.getLeavesOfType('slide-and-reveal-view').forEach((l) => {
            const v2 = l.view as { render?: () => void };
            if (typeof v2.render === 'function') v2.render();
          });
        }));

    new Setting(containerEl).setName('Keyboard').setHeading();

    new Setting(containerEl)
      .setName('Left/Right arrows zoom in/out')
      .setDesc('When the view is focused, ← shrinks and → grows by the step below.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.arrowKeysZoom)
        .onChange(async (v) => { this.plugin.settings.arrowKeysZoom = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Arrow-key zoom step (%)')
      .setDesc('How many percentage points each ←/→ press changes the size.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.arrowKeysZoomStep))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.arrowKeysZoomStep = isFinite(n) && n > 0 ? n : 5;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Up/Down arrows reveal/hide on the focused image')
      .setDesc('Independent of mode and zoom: when ON, ↑ and ↓ always step the reveal slider on the focused image. When OFF, ↑/↓ pass through to native page scroll (so you can scroll the image list with the keyboard instead).')
      .addToggle((t) => t
        .setValue(this.plugin.settings.arrowKeysReveal)
        .onChange(async (v) => { this.plugin.settings.arrowKeysReveal = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Invert reveal arrow direction')
      .setDesc('Off (default): ↑ hides, ↓ reveals. On: ↑ reveals, ↓ hides.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.arrowKeysRevealInverted)
        .onChange(async (v) => { this.plugin.settings.arrowKeysRevealInverted = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Wheel steps reveal even when zoomed past 100%')
      .setDesc('By default, scrolling on an image whose zoom is over 100% scrolls the page (so the wider image is reachable). Turn this on to keep the wheel locked to the reveal slider regardless of zoom. Only applies in Study mode.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.wheelStepPast100)
        .onChange(async (v) => { this.plugin.settings.wheelStepPast100 = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Mouse-wheel sensitivity (px per step)')
      .setDesc('Pixels of wheel-delta needed to advance the reveal slider one step. Bump this up if a single click of your mouse wheel jumps too many steps (common with gaming mice on Windows). Default 60.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.wheelStepThreshold))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.wheelStepThreshold = isFinite(n) && n >= 10 ? n : 60;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pair color propagation')
      .setDesc('How a color change on one member of a pair affects the others.')
      .addDropdown((d) => d
        .addOption('off', 'Off — each shape keeps its own color')
        .addOption('first-to-rest', 'First → rest (only the pair leader propagates)')
        .addOption('all', 'All — every change propagates to the whole pair')
        .setValue(this.plugin.settings.pairColorMode)
        .onChange(async (v) => {
          this.plugin.settings.pairColorMode = v as 'off' | 'first-to-rest' | 'all';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Folders using Slide and Reveal').setHeading();
    const known = this.plugin.settings.knownFolders.slice().reverse();
    if (!known.length) {
      containerEl.createEl('p', { text: 'No folders yet.' });
    } else {
      for (const folder of known) {
        const s = new Setting(containerEl).setName(folder);
        s.addButton((b) => b.setButtonText('Open').onClick(() => this.plugin.openForFolder(folder)));
        s.addButton((b) => b.setButtonText('Remove from list').onClick(async () => {
          await this.plugin.forgetFolder(folder);
          this.display();
        }));
        s.addButton((b) => b.setButtonText('Delete annotations file').setDestructive().onClick(async () => {
          const path = joinPath(folder, ANNOT_FILE);
          try {
            if (await this.app.vault.adapter.exists(path)) {
              await this.app.vault.adapter.remove(path);
              new Notice(`Deleted ${path}`);
            }
          } catch (e) {
            console.error(e);
            new Notice('Delete failed (see console)');
          }
          await this.plugin.forgetFolder(folder);
          this.display();
        }));
      }
    }

    // ---- Discovered folders (folders with annotation files but not in the active list) ----
    new Setting(containerEl)
      .setName('Discovered folders (not in active list)')
      .setDesc('Folders in your vault that contain a .slide-and-reveal.json (or legacy .image-annotator.json) file but aren\'t currently tracked.')
      .setHeading();
    containerEl.createEl('p', {
      cls: 'sNr-settings-muted',
      text: 'Re-add a previously removed folder. Annotations are still in the .slide-and-reveal.json file in that folder.'
    });

    const discoveredEl = containerEl.createDiv();
    const status = containerEl.createEl('p', { cls: 'sNr-settings-muted' });
    status.setText('Scanning…');

    this.scanDiscovered().then((discovered) => {
      const knownSet = new Set(this.plugin.settings.knownFolders);
      const fresh = discovered.filter((f) => !knownSet.has(f));
      status.setText(fresh.length ? `Found ${fresh.length} folder(s).` : 'No additional folders found.');
      for (const folder of fresh) {
        const s = new Setting(discoveredEl).setName(folder);
        s.addButton((b) => b.setButtonText('Add & open').onClick(() => {
          this.plugin.openForFolder(folder);
          this.display();
        }));
        s.addButton((b) => b.setButtonText('Add to list').onClick(async () => {
          this.plugin.rememberFolder(folder);
          this.display();
        }));
      }
    }).catch((e) => {
      console.error(e);
      status.setText('Scan failed (see console).');
    });
  }

  /** Walk the vault and collect folders that contain ANNOT_FILE. */
  private async scanDiscovered(): Promise<string[]> {
    const found: string[] = [];
    const seen = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      let entries: { files: string[]; folders: string[] };
      try {
        entries = await this.app.vault.adapter.list(dir);
      } catch { return; }
      for (const f of entries.files) {
        const slash = f.lastIndexOf('/');
        const name = slash >= 0 ? f.slice(slash + 1) : f;
        if (name === ANNOT_FILE || name === LEGACY_ANNOT_FILE) {
          const folder = slash >= 0 ? f.slice(0, slash) : '';
          if (!seen.has(folder)) { seen.add(folder); found.push(folder); }
        }
      }
      for (const sub of entries.folders) {
        const tail = sub.split('/').pop() || sub;
        if (tail.startsWith('.')) continue; // skip .obsidian, .trash, etc.
        await walk(sub);
      }
    };
    await walk('');
    found.sort();
    return found;
  }
}
