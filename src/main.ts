import { Plugin, Notice, TFolder, Menu, TAbstractFile } from 'obsidian';
import { VIEW_TYPE, DEFAULT_SETTINGS, SlideAndRevealSettings } from './types';
import { SlideAndRevealView } from './view';
import { SlideAndRevealSettingTab } from './settings';
import { FolderPickerModal } from './modals';
import { ScopePickerModal } from './quiz-modals';

export default class SlideAndRevealPlugin extends Plugin {
  settings!: SlideAndRevealSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new SlideAndRevealView(leaf, this));

    this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
      if (!(file instanceof TFolder)) return;
      menu.addItem((item) => {
        item.setTitle('Open Slide and Reveal here')
          .setIcon('image')
          .onClick(() => this.openForFolder(file.path));
      });
    }));

    this.addRibbonIcon('image', 'Open Slide and Reveal', () => {
      const last = this.settings.knownFolders[this.settings.knownFolders.length - 1];
      if (last) void this.openForFolder(last);
      else new Notice('Right-click a folder in the file explorer and choose "Open Slide and Reveal here".');
    });

    this.addCommand({
      id: 'open-last-folder',
      name: 'Open Last Folder',
      callback: () => {
        const last = this.settings.knownFolders[this.settings.knownFolders.length - 1];
        if (last) void this.openForFolder(last);
        else new Notice('No folder yet. Right-click a folder to open it here.');
      }
    });

    this.addCommand({
      id: 'pick-folder',
      name: 'Pick Folder',
      callback: () => {
        const folders = this.settings.knownFolders.slice().reverse();
        if (!folders.length) {
          new Notice('No folders yet. Right-click a folder and choose "Open Slide and Reveal here" first.');
          return;
        }
        new FolderPickerModal(this.app, folders, (f) => { void this.openForFolder(f); }).open();
      }
    });

    // Cross-diagram quiz mode: ribbon button + command.
    this.addRibbonIcon('crosshair', 'Slide and Reveal: cross-diagram quiz', () => {
      new ScopePickerModal(this).open();
    });
    this.addCommand({
      id: 'cross-diagram-quiz',
      name: 'Cross-diagram quiz',
      callback: () => new ScopePickerModal(this).open(),
    });

    this.addSettingTab(new SlideAndRevealSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.knownFolders)) this.settings.knownFolders = [];
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  rememberFolder(path: string): void {
    if (!path) return;
    const list = this.settings.knownFolders;
    const idx = list.indexOf(path);
    if (idx >= 0) list.splice(idx, 1);
    list.push(path);
    void this.saveSettings();
  }

  forgetFolder(path: string): Promise<void> {
    this.settings.knownFolders = this.settings.knownFolders.filter((p) => p !== path);
    return this.saveSettings();
  }

  async openForFolder(folderPath: string): Promise<void> {
    this.rememberFolder(folderPath);
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .find((l) => (l.view as SlideAndRevealView).folderPath === folderPath);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { folderPath } });
    await this.app.workspace.revealLeaf(leaf);
  }
}
