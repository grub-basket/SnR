import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise actual view handlers with a small DOM and an in-memory vault.
class Element {
  constructor(cls = '', tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.events = {};
    const classes = new Set(cls.split(' ').filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: n => classes.has(n),
      toggle: (n, on = !classes.has(n)) => on ? classes.add(n) : classes.delete(n),
    };
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  get ownerDocument() { return doc; }
  createEl(tag, opts = {}) { const e = new Element(opts.cls, tag); Object.assign(e, opts); e.parent = this; this.children.push(e); return e; }
  createDiv(opts) { return this.createEl('div', opts); }
  createSpan(opts) { return this.createEl('span', opts); }
  addClass(n) { this.classList.add(n); }
  setText(text) { this.text = text; }
  empty() { this.children.forEach(e => e.parent = null); this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); this.parent = null; }
  matches(s) {
    if (s === ':hover') return false;
    const tag = s.match(/^[a-z]+/)?.[0];
    if (tag && this.tag !== tag) return false;
    if ([...s.matchAll(/\.([\w-]+)/g)].some(m => !this.classList.contains(m[1]))) return false;
    return [...s.matchAll(/\[data-([\w-]+)="([^"]*)"\]/g)].every(m => this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === m[2]);
  }
  querySelectorAll(s) { return this.children.flatMap(e => [...(e.matches(s) ? [e] : []), ...e.querySelectorAll(s)]); }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
  closest(s) { return this.matches(s) ? this : this.parent?.closest(s) ?? null; }
  addEventListener(n, fn) { (this.events[n] ??= []).push(fn); }
  removeEventListener(n, fn) { this.events[n] = (this.events[n] ?? []).filter(f => f !== fn); }
}
class TFile { constructor(path) { this.path = path; } }
const doc = new Element(); doc.body = new Element();
doc.defaultView = { requestAnimationFrame() {}, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} };
const obsidian = { TFile, ItemView: class { constructor(leaf) { this.app = leaf.app; } }, Scope: class { register() {} }, Notice: class {}, Modal: class {}, FuzzySuggestModal: class {}, setIcon() {} };
const cache = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    module, exports: module.exports, console, activeDocument: doc,
    window: { requestAnimationFrame() {}, addEventListener() {}, removeEventListener() {}, setTimeout() {} },
    require: id => id === 'obsidian' ? obsidian : load(path.resolve(path.dirname(filename), id + '.ts')),
  }, { filename });
  return module.exports;
}
const { SlideAndRevealView } = load('src/view.ts');
const event = { stopPropagation() {}, preventDefault() {}, deltaY: 60 };
function setup(pairs = [1, 2]) {
  doc.body.empty();
  const file = new TFile('Deck/a.png');
  const plugin = { settings: { mode: 'edit', imageScale: 100 } };
  const v = new SlideAndRevealView({ app: { vault: { getAbstractFileByPath: p => p === file.path ? file : null } } }, plugin);
  v.annotationRevision = 'test-revision';
  v.folderPath = 'Deck'; v.scheduleSave = () => {}; v.saveFolderData = async () => {};
  const list = pairs.map((pair, i) => ({ id: String(i), pair, x: 0, y: 0, w: .1, h: .1 }));
  v.folderData = { rects: { 'a.png': list }, order: [], revealSteps: {} };
  const root = new Element('sNr-view'); v.scrollerEl = root;
  const block = root.createDiv({ cls: 'sNr-block' }); block.dataset.path = file.path;
  const host = block.createDiv({ cls: 'sNr-rail-host' });
  const canvas = block.createDiv({ cls: 'sNr-canvas' });
  list.forEach(r => {
    canvas.createDiv({ cls: 'sNr-rect' }).dataset.id = r.id;
    canvas.createDiv({ cls: 'sNr-pair-overlay sNr-pair-overlay--visible' }).dataset.shapeId = r.id;
  });
  v.renderRail(host, file, canvas); v.bindRevealWheel(file, canvas);
  return { v, file, list, root, host, canvas, plugin };
}
function assertState(e, step, total, visible) {
  assert.equal(e.v.folderData.revealSteps['a.png'], step);
  assert.equal(e.host.querySelector('.sNr-rail-label').text, `${step}/${total}`);
  assert.equal(e.host.querySelector('.sNr-rail-thumb').style.top, total ? `${step / total * 100}%` : '50%');
  e.canvas.querySelectorAll('.sNr-rect').forEach((el, i) => {
    assert.equal(el.classList.contains('sNr-revealed'), visible.includes(i));
    assert.equal(e.canvas.querySelectorAll('.sNr-pair-overlay')[i].classList.contains('sNr-pair-overlay--visible'), !visible.includes(i));
  });
}
test('pair input merges and splits groups, updates dots and clamps saved progress', async () => {
  const e = setup();
  e.v.renderPairOverlay = () => {}; // Geometry is unrelated to the pair input handler.
  e.v.selectShape(e.canvas, e.file, e.list[1], e.canvas.children[2]);
  const toolbar = doc.body.querySelector('.sNr-rect-toolbar');
  const input = toolbar.querySelectorAll('input').find(i => i.title?.startsWith('Pair number'));
  e.v.setImageRevealed(e.file, e.canvas, true);
  input.value = '1'; await input.onchange();
  assert.equal(doc.body.querySelector('.sNr-rect-toolbar'), toolbar);
  assert.equal(e.host.querySelectorAll('.sNr-rail-dot').length, 2);
  assertState(e, 1, 1, [0, 1]);
  e.host.querySelectorAll('.sNr-rail-dot')[0].onclick(event);
  e.host.querySelectorAll('.sNr-rail-dot')[1].onclick(event);
  assertState(e, 1, 1, [0, 1]);
  input.value = '0'; await input.onchange();
  assert.equal(e.host.querySelectorAll('.sNr-rail-dot').length, 3);
  assertState(e, 1, 2, [0]);
});
test('bulk reveal/hide synchronizes overlays and persists endpoints for subsequent steps', () => {
  const e = setup([1, 1, 2, 0]);
  e.v.toggleAll(e.root, true); assertState(e, 3, 3, [0, 1, 2, 3]);
  e.v.bumpRevealStep(e.file, e.canvas, -1); assertState(e, 2, 3, [0, 1, 2]);
  e.v.toggleAll(e.root, false); assertState(e, 0, 3, []);
  e.v.bumpRevealStep(e.file, e.canvas, 1); assertState(e, 1, 3, [0, 1]);
  e.v.refreshRevealRail(e.file, e.canvas); assertState(e, 1, 3, [0, 1]);
});
test('rail rebuilds do not multiply wheel actions', () => {
  const e = setup([1, 2, 3]); e.plugin.settings.mode = 'study';
  for (let i = 0; i < 10; i++) e.v.refreshRevealRail(e.file, e.canvas);
  assert.equal(e.canvas.events.wheel.length, 1);
  e.canvas.events.wheel.forEach(fn => fn(event)); assertState(e, 1, 3, [0]);
});
test('empty images have a stable zero endpoint', () => {
  const e = setup([]); e.v.toggleAll(e.root, true); assertState(e, 0, 0, []);
  e.v.toggleAll(e.root, false); assertState(e, 0, 0, []);
});
test('focused header Reveal and Hide use the same progress state', () => {
  const e = setup([1, 1, 2]);
  e.v.headerToolsEl = new Element();
  e.v.currentImageContext = () => ({ file: e.file, canvas: e.canvas });
  e.v.refreshHeaderTools();
  const buttons = e.v.headerToolsEl.querySelectorAll('button');
  buttons.find(b => b.title === 'Reveal all shapes on the focused image').onclick();
  assertState(e, 2, 2, [0, 1, 2]);
  buttons.find(b => b.title === 'Hide all shapes on the focused image').onclick();
  assertState(e, 0, 2, []);
  buttons.find(b => b.title === 'Reveal the next group (one step)').onclick();
  assertState(e, 1, 2, [0, 1]);
});
test('Study editing defaults on, opt-out locks controls, Edit overrides opt-out', () => {
  const { DEFAULT_SETTINGS } = load('src/types.ts');
  assert.equal(DEFAULT_SETTINGS.allowEditsInStudyMode, true);
  const e = setup(); e.plugin.settings.mode = 'study';
  e.v.headerToolsEl = new Element();
  e.v.currentImageContext = () => ({ file: e.file, canvas: e.canvas });
  for (const [mode, allowed, expected] of [['study', undefined, true], ['study', true, true], ['study', false, false], ['edit', false, true]]) {
    Object.assign(e.plugin.settings, { mode, allowEditsInStudyMode: allowed });
    e.v.refreshHeaderTools();
    assert.equal(e.v.canEdit(), expected);
    const drawing = e.v.headerToolsEl.querySelectorAll('button').filter(b => /Rectangle|Polygon/.test(b.querySelector('.sNr-iconbtn-text')?.text ?? ''));
    assert.equal(drawing.length, 2);
    drawing.forEach(b => assert.equal(!!b.disabled, !expected));
  }
});
test('locked Study rejects drawing, deletion, recoloring and undo without losing history', async () => {
  const e = setup(); Object.assign(e.plugin.settings, { mode: 'study', allowEditsInStudyMode: false });
  const before = JSON.stringify(e.v.folderData);
  e.v.undoStack.push({ type: 'data', snap: '{}' });
  e.v.redoStack.push({ type: 'data', snap: '{}' });
  // Missing DOM arguments deliberately fail if blocked paths enter their drawing code.
  e.v.beginRectDraft(); e.v.addPolyPoint(); e.v.beginTargetRegionDraft();
  await e.v.commitRectDraft(); await e.v.commitPolyDraft();
  e.v.selection = { file: e.file, rect: e.list[0], canvas: e.canvas };
  await e.v.deleteSelectedShape(); await e.v.deleteSelectedTargetRegion();
  await e.v.removeTargetRegion(); e.v.renameFile();
  e.v.applyColor(e.canvas, e.file, e.list[0], '#ffffff');
  await e.v.undo(); await e.v.redo();
  assert.equal(JSON.stringify(e.v.folderData), before);
  assert.equal(e.v.undoStack.length, 1); assert.equal(e.v.redoStack.length, 1);
  e.canvas.events.wheel[0](event); assertState(e, 1, 2, [0]);
});
test('Study permits pair edits by default and rejects a stale toolbar after locking', async () => {
  const e = setup(); e.plugin.settings.mode = 'study'; e.v.renderPairOverlay = () => {};
  e.v.selectShape(e.canvas, e.file, e.list[1], e.canvas.children[2]);
  const input = doc.body.querySelectorAll('input').find(i => i.title?.startsWith('Pair number'));
  input.value = '1'; await input.onchange(); assert.equal(e.list[1].pair, 1);
  e.plugin.settings.allowEditsInStudyMode = false;
  input.value = '3'; await input.onchange(); assert.equal(e.list[1].pair, 1);
});
test('Study permission never bypasses annotation load or conflict protection', () => {
  const e = setup(); Object.assign(e.plugin.settings, { mode: 'study', allowEditsInStudyMode: true });
  e.v.annotationRevision = null; assert.equal(e.v.canEdit(), false);
  e.v.annotationRevision = 'loaded'; e.v.saveProblem = 'External conflict'; assert.equal(e.v.canEdit(), false);
  e.v.saveProblem = null; assert.equal(e.v.canEdit(), true);
});
