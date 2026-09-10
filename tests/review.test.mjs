import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Run the source against an in-memory vault. No real notes or annotation files are touched.
class TFile { constructor(path) { this.path = path; } }
class TFolder { constructor(path) { this.path = path; this.children = []; } }
class ItemView {
  constructor(leaf) { this.app = leaf.app; this.containerEl = {}; }
  registerEvent() {}
  registerDomEvent() {}
}
const obsidian = {
  TFile, TFolder, ItemView, Scope: class { register() {} }, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, FuzzySuggestModal: class {},
};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Error, console: { error() {} },
    window: { setTimeout, clearTimeout }, document: {},
    require: id => id === 'obsidian' ? obsidian : load(path.resolve(path.dirname(filename), id + '.ts')),
  }, { filename });
  return module.exports;
}
const { AnnotationStore, parseAnnotations } = load('src/annotations.ts');
const { SlideAndRevealView } = load('src/view.ts');
const { default: Plugin } = load('src/main.ts');
const { buildQuizPool } = load('src/quiz.ts');
const { safeColor } = load('src/util.ts');
const cover = (id = 'cover') => ({ id, x: .1, y: .1, w: .2, h: .2, pair: 1, seconds: 0, color: '#abcdef' });
const documentText = () => JSON.stringify({ rects: { 'a.png': [cover()] }, order: ['a.png'], revealSteps: {} });
const filename = 'Deck/.slide-and-reveal.json';
function setup(raw = documentText()) {
  const files = new Map(raw === null ? [] : [[filename, raw]]);
  const events = {};
  const adapter = {
    exists: async p => files.has(p),
    read: async p => { if (!files.has(p)) throw Error('Missing file'); return files.get(p); },
    write: async (p, text) => { files.set(p, text); },
    rename: async (from, to) => { if (!files.has(from) || files.has(to)) throw Error('Invalid rename'); files.set(to, files.get(from)); files.delete(from); },
  };
  const app = { scope: {}, keymap: {}, vault: { adapter, on: (name, callback) => { events[name] = callback; } },
    workspace: { on() {}, requestSaveLayout() {}, getActiveViewOfType() { return null; }, getLeavesOfType: () => views.map(view => ({ view })) } };
  const plugin = Object.assign(Object.create(Plugin.prototype), {
    app, annotations: new AnnotationStore(adapter), settings: { mode: 'edit', knownFolders: ['Deck'] }, saveSettings: async () => {},
  });
  const views = [];
  function view() {
    const v = new SlideAndRevealView({ app }, plugin);
    v.folderPath = 'Deck'; v.render = () => {}; views.push(v); return v;
  }
  return { files, adapter, app, plugin, events, view };
}

test('a failed read cannot overwrite original annotations, including scheduled saves', async () => {
  const env = setup(); const v = env.view(); const original = env.files.get(filename);
  env.adapter.read = async () => { throw Error('Read failure'); };
  await v.loadFolderData(); v.scheduleSave(); await v.saveFolderData();
  assert.equal(env.files.get(filename), original); assert.equal(v.saveQueued, false);
  assert.match(v.saveProblem, /paused/);
});

test('malformed documents remain untouched and cannot be edited', async () => {
  for (const raw of ['{broken', '{"rects":{"a.png":[null]},"order":[]}']) {
    const env = setup(raw); const v = env.view(); await v.loadFolderData();
    await v.saveFolderData(); assert.equal(env.files.get(filename), raw); assert.equal(v.canEdit(), false);
  }
});

test('reload after a read failure restores normal saving', async () => {
  const env = setup('{broken'); const v = env.view(); await v.loadFolderData();
  env.files.set(filename, documentText()); await v.loadFolderData();
  v.folderData.rects['a.png'].push(cover('second')); await v.saveFolderData();
  assert.equal(JSON.parse(env.files.get(filename)).rects['a.png'].length, 2);
});

test('a stale view cannot erase another view’s saved cover', async () => {
  const env = setup(); const first = env.view(), stale = env.view();
  await Promise.all([first.loadFolderData(), stale.loadFolderData()]);
  first.folderData.rects['a.png'].push(cover('new')); await first.saveFolderData();
  stale.folderData.scrollTop = 200; await stale.saveFolderData();
  assert.equal(JSON.parse(env.files.get(filename)).rects['a.png'].length, 2);
  assert.match(stale.saveProblem, /changed/);
});

test('external changes and file removal are detected before writing', async () => {
  for (const remove of [false, true]) {
    const env = setup(); const v = env.view(); await v.loadFolderData();
    if (remove) env.files.delete(filename); else env.files.set(filename, '{"external":true}');
    const expected = env.files.get(filename); await v.saveFolderData();
    assert.equal(env.files.get(filename), expected); assert.match(v.saveProblem, /changed/);
  }
});

test('two queued saves from the same view finish in order without a false conflict', async () => {
  const env = setup(); const v = env.view(); await v.loadFolderData();
  v.folderData.scrollTop = 100; const first = v.saveFolderData();
  v.folderData.scrollTop = 200; await Promise.all([first, v.saveFolderData()]);
  assert.equal(JSON.parse(env.files.get(filename)).scrollTop, 200); assert.equal(v.saveProblem, '');
});

test('simultaneous stale store writes cannot both replace the same revision', async () => {
  const env = setup(); const { revision } = await env.plugin.annotations.load('Deck');
  const outcomes = await Promise.allSettled([
    env.plugin.annotations.save('Deck', revision, 'first'), env.plugin.annotations.save('Deck', revision, 'second'),
  ]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(env.files.get(filename), 'first');
});

test('legacy annotation maps migrate on save without removing the original', async () => {
  const env = setup(null); const legacy = 'Deck/.image-annotator.json';
  const raw = JSON.stringify({ 'a.png': [cover()] }); env.files.set(legacy, raw);
  const v = env.view(); await v.loadFolderData(); await v.saveFolderData();
  assert.equal(env.files.get(legacy), raw); assert.equal(JSON.parse(env.files.get(filename)).rects['a.png'][0].id, 'cover');
});

test('archive preserves modern and legacy files and blocks delayed resurrection', async () => {
  const env = setup(); const legacy = 'Deck/.image-annotator.json'; env.files.set(legacy, 'legacy original');
  const original = env.files.get(filename); const v = env.view(); await v.loadFolderData(); v.scheduleSave();
  await env.plugin.archiveAnnotations('Deck'); await v.saveFolderData(); v.scheduleSave();
  assert.equal(env.files.has(filename), false); assert.equal(env.files.has(legacy), false);
  assert.equal(v.saveQueued, false); assert.equal(v.undoStack.length, 0);
  assert.ok([...env.files.values()].includes(original)); assert.ok([...env.files.values()].includes('legacy original'));
  assert.equal(env.plugin.settings.knownFolders.length, 0);
});

test('quiz validation skips invalid covers and retains valid targets', async () => {
  const good = { ...cover(), targetRegion: { x: .4, y: .4, w: .2, h: .2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } };
  const env = setup(JSON.stringify({ rects: { 'a.png': [null, good], 'b.png': {} }, order: ['a.png'] }));
  const pool = await buildQuizPool(env.app, { kind: 'folder', folder: 'Deck' });
  assert.equal(pool.length, 1); assert.equal(pool[0].coverId, good.id);
});

test('colors cannot carry image URLs, variables, or transparent concealers', () => {
  for (const color of ['url(https://example.invalid/pixel)', 'var(--image)', 'transparent', '#abcdef00', null]) {
    assert.equal(safeColor(color), '#3b82f6');
    const parsed = parseAnnotations(JSON.stringify({ rects: { 'a.png': [{ ...cover(), color }] }, order: ['a.png'] }));
    assert.equal(parsed.data.rects['a.png'][0].color, '#3b82f6');
  }
  assert.equal(safeColor('#AbC'), '#AbC'); assert.equal(safeColor('#ABCDEF'), '#ABCDEF');
});

test('folder rename preserves pending edits and saves at the new annotation path', async () => {
  const env = setup(); const v = env.view(); await v.loadFolderData(); await v.onOpen();
  v.folderData.rects['a.png'].push(cover('unsaved')); v.scheduleSave();
  const moved = 'Renamed/.slide-and-reveal.json';
  await env.adapter.rename(filename, moved);
  env.events.rename(new TFolder('Renamed'), 'Deck');
  await v.saveFolderData();
  assert.equal(v.folderPath, 'Renamed'); assert.equal(env.files.has(filename), false);
  assert.equal(JSON.parse(env.files.get(moved)).rects['a.png'].length, 2);
  assert.equal(env.plugin.settings.knownFolders[0], 'Renamed');
  await v.onClose();
});

test('nested-folder rename remaps covers, reveal progress and undo snapshots', async () => {
  const env = setup(JSON.stringify({ rects: { 'Part/a.png': [cover()] }, order: ['Part/a.png'], revealSteps: { 'Part/a.png': 1 } }));
  const v = env.view(); await v.loadFolderData(); await v.onOpen(); v.snapshot();
  env.events.rename(new TFolder('Deck/Renamed'), 'Deck/Part'); await v.saveFolderData();
  assert.equal(v.folderData.rects['Renamed/a.png'][0].id, 'cover');
  assert.equal(v.folderData.revealSteps['Renamed/a.png'], 1);
  await v.undo(); assert.equal(v.folderData.rects['Renamed/a.png'][0].id, 'cover'); await v.onClose();
});

test('unrelated image events do not render and local event bursts coalesce', async () => {
  const env = setup(); const v = env.view(); await v.loadFolderData(); await v.onOpen();
  let renders = 0; v.render = () => { renders++; };
  env.events.create(new TFile('Other/a.png')); env.events.delete(new TFile('Deck2/a.png'));
  await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(renders, 0);
  for (let i = 0; i < 10; i++) env.events.create(new TFile(`Deck/${i}.png`));
  await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(renders, 1);
  await v.onClose();
});

test('closing flushes pending work but late scroll callbacks cannot save again', async () => {
  const env = setup(); const v = env.view(); await v.loadFolderData();
  v.folderData.scrollTop = 100; v.scheduleSave(); await v.onClose();
  const flushed = env.files.get(filename); assert.equal(JSON.parse(flushed).scrollTop, 100);
  v.folderData.scrollTop = 200; v.scheduleSave(); await v.saveFolderData();
  assert.equal(v.saveQueued, false); assert.equal(env.files.get(filename), flushed);
});
