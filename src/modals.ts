import { App, FuzzySuggestModal, Modal } from 'obsidian';

export class FolderPickerModal extends FuzzySuggestModal<string> {
  private folders: string[];
  private onPick: (folder: string) => void;
  constructor(app: App, folders: string[], onPick: (folder: string) => void) {
    super(app);
    this.folders = folders;
    this.onPick = onPick;
    this.setPlaceholder('Pick a Slide & Reveal folder…');
  }
  getItems(): string[] { return this.folders; }
  getItemText(item: string): string { return item; }
  onChooseItem(item: string): void { this.onPick(item); }
}

export class RenameModal extends Modal {
  private current: string;
  private onSubmit: (next: string) => void;
  private inputEl!: HTMLInputElement;
  constructor(app: App, current: string, onSubmit: (next: string) => void) {
    super(app);
    this.current = current;
    this.onSubmit = onSubmit;
  }
  onOpen(): void {
    this.titleEl.setText('Rename file');
    this.contentEl.createEl('p', { text: 'Enter a new file name (extension included):' });
    this.inputEl = this.contentEl.createEl('input', { type: 'text' });
    this.inputEl.value = this.current;
    this.inputEl.style.width = '100%';
    this.inputEl.focus();
    const dot = this.current.lastIndexOf('.');
    if (dot > 0) this.inputEl.setSelectionRange(0, dot); else this.inputEl.select();
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    const row = this.contentEl.createDiv();
    row.style.marginTop = '10px';
    row.style.textAlign = 'right';
    row.style.gap = '6px';
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const ok = row.createEl('button', { text: 'Rename' });
    ok.style.marginLeft = '6px';
    ok.onclick = () => this.submit();
  }
  private submit(): void {
    const v = this.inputEl.value.trim();
    if (v && v !== this.current) this.onSubmit(v);
    this.close();
  }
}
