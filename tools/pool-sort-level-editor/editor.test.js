'use strict';
// Tests the core block of index.html (parse, serialize, edit, check) under node.
// Run: node --test tools/pool-sort-level-editor/editor.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('core script block not found');
  // This realm, not a fresh vm context: arrays from another realm fail assert.deepStrictEqual.
  vm.runInThisContext(m[1], { filename: 'index.html#core' });
  return globalThis.PSP;
}
const PSP = loadCore();

// Team data is read in place, never copied into the hub repo.
function teamLevelsDir() {
  if (process.env.PSP_LEVELS) return process.env.PSP_LEVELS;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, '01-projects', 'pool-sort', 'fish-sort-puzzle', 'Assets', '_Game', 'ToySort', 'Editor', 'Levels');
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  return null;
}
const TEAM = teamLevelsDir();

const CRLF = (s) => s.replace(/\n/g, '\r\n');

// ---------- file format ----------

test('serializeLevel writes two-space JSON with CRLF and no final newline', () => {
  const text = CRLF('[\n  {\n    "FloatieID": 1,\n    "FloatieType": 2,\n    "ToyStr": "3,3",\n    "IsFrozen": false\n  }\n]');
  assert.equal(PSP.serializeLevel(PSP.parseLevel(text)), text);
});

test('parseLevel keeps each record\'s own key order', () => {
  const lv = PSP.parseLevel('[{"FloatieType":1,"FloatieID":1,"ToyStr":"2"}]');
  assert.deepEqual(Object.keys(lv.floats[0]), ['FloatieType', 'FloatieID', 'ToyStr']);
});

test('parseLevel strips a BOM and rejects a non-array', () => {
  assert.equal(PSP.parseLevel('﻿[]').floats.length, 0);
  assert.throws(() => PSP.parseLevel('{}'));
});

test('serializeConfig keeps a decimal point on float fields only', () => {
  const text = CRLF('[\n  {\n    "LevelID": 1,\n    "LevelDataStr": "LevelData_1",\n    "LevelTime": 300.0,\n    "PointRangeStr": "0.35,0.7",\n    "NoAdWeight": 1.0,\n    "OneAdWeight": 0.35,\n    "TwoAdWeight": 0.0,\n    "ThreeAdWeight": 0.0,\n    "LevelDifficulty": 2,\n    "CountdownTargetProgress": ""\n  }\n]');
  assert.equal(PSP.serializeConfig(PSP.parseConfig(text)), text);
});

test('levelIdFromName reads LevelData_N.json only', () => {
  assert.equal(PSP.levelIdFromName('LevelData_57.json'), 57);
  assert.equal(PSP.levelIdFromName('LevelConfig.json'), null);
  assert.equal(PSP.levelIdFromName('LevelData_57.json.meta'), null);
});

test('every team level and the config round-trip byte for byte', { skip: !TEAM && 'team repo not found' }, () => {
  const names = fs.readdirSync(TEAM).filter((f) => PSP.levelIdFromName(f) !== null);
  assert.ok(names.length >= 200); // gd-leveldesign ships 200 levels, dev/main 1,000
  for (const name of names) {
    const text = fs.readFileSync(path.join(TEAM, name), 'utf8');
    assert.equal(PSP.serializeLevel(PSP.parseLevel(text)), text, name);
  }
  const cfg = fs.readFileSync(path.join(TEAM, 'LevelConfig.json'), 'utf8');
  assert.equal(PSP.serializeConfig(PSP.parseConfig(cfg)), cfg);
});

// ---------- model ----------

const rec = (o) => Object.assign({ FloatieID: 1, FloatieType: 3, ToyStr: '1,2,3', IsFrozen: false, IsUnknown: false, LockCount: 0, IsKey: false }, o);
const lvl = (...floats) => ({ floats });

test('setField sets present keys, appends missing ones only when non-default', () => {
  const r = rec();
  PSP.setField(r, 'IsFrozen', true);
  PSP.setField(r, 'IceToyStr', '');
  PSP.setField(r, 'Lock2Count', 7);
  assert.equal(r.IsFrozen, true);
  assert.ok(!('IceToyStr' in r));
  assert.deepEqual(Object.keys(r).slice(-1), ['Lock2Count']);
  PSP.setField(r, 'IsFrozen', false);
  assert.equal(r.IsFrozen, false); // stays present
});

test('floatView splits slots from Portal refills and reads stones', () => {
  const v = PSP.floatView(rec({ FloatieType: 2, ToyStr: '4,5,6,7', IsMore: true }));
  assert.deepEqual([v.items, v.extra, v.mech, v.counter], [[4, 5], [6, 7], 'portal', 2]);
  const s = PSP.floatView(rec({ FloatieType: 4, ToyStr: '', IsObstacle: true }));
  assert.deepEqual([s.stone, s.mech, s.items.length], [true, 'obstacle', 0]);
  const o2 = PSP.floatView(rec({ FloatieType: 4, ToyStr: '', Obstacle2Count: 12 }));
  assert.deepEqual([o2.mech, o2.counter], ['obstacle2', 12]);
  const bare = PSP.floatView(rec({ ToyStr: '' }));
  assert.equal(bare.mech, 'obstacle'); // no items = stone, as LevelParser does
});

test('floatView reports every set mechanic in game priority order', () => {
  const v = PSP.floatView(rec({ IsUnknown: true, IsFrozen: true, LockCount: 1 }));
  assert.deepEqual(v.mechs, ['frozen', 'hidden', 'lock']);
  assert.equal(v.mech, 'frozen');
});

test('setItem paints slots and refills, refuses out of range', () => {
  const r = rec({ FloatieType: 2, ToyStr: '4,5,6', IsMore: true });
  assert.ok(PSP.setItem(r, 0, 9));
  assert.ok(PSP.setItem(r, 2, 8));
  assert.ok(!PSP.setItem(r, 3, 1));
  assert.equal(r.ToyStr, '9,5,8');
});

test('setSize grows with the fill item, shrinks from the end, resizes slot lists', () => {
  const r = rec({ FloatieType: 3, ToyStr: '1,2,3', IceToyStr: '0,0,9', UnKnowToyStr: '1,0,0' });
  PSP.setSize(r, 2, 7);
  assert.deepEqual([r.FloatieType, r.ToyStr, r.IceToyStr, r.UnKnowToyStr], [2, '1,2', '', '1,0']);
  PSP.setSize(r, 4, 7);
  assert.deepEqual([r.ToyStr, r.UnKnowToyStr], ['1,2,7,7', '1,0,0,0']);
  PSP.setSize(r, 9, 7);
  assert.equal(r.FloatieType, 5);
});

test('setSize keeps Portal refills after the slots', () => {
  const r = rec({ FloatieType: 2, ToyStr: '4,5,6', IsMore: true });
  PSP.setSize(r, 3, 1);
  assert.equal(r.ToyStr, '4,5,1,6');
});

test('setExtra ties IsMore to having refills', () => {
  const r = rec();
  PSP.setExtra(r, [8, 8]);
  assert.deepEqual([r.ToyStr, r.IsMore], ['1,2,3,8,8', true]);
  PSP.setExtra(r, []);
  assert.deepEqual([r.ToyStr, r.IsMore], ['1,2,3', false]);
});

test('setMechanic is one choice: it clears the others', () => {
  const r = rec({ IsFrozen: true });
  PSP.setMechanic(r, 'lock', { count: 2 });
  assert.deepEqual([r.IsFrozen, r.LockCount], [false, 2]);
  PSP.setMechanic(r, 'net');
  assert.deepEqual([r.LockCount, r.Lock2Count], [0, 7]);
  PSP.setMechanic(r, 'key');
  assert.deepEqual([r.Lock2Count, r.IsKey], [0, true]);
  PSP.setMechanic(r, 'mask', { item: 5 });
  assert.deepEqual([r.IsKey, r.MaskTargetToy], [false, 5]);
  PSP.setMechanic(r, 'none');
  assert.equal(PSP.floatView(r).mech, 'none');
});

test('setMechanic to a stone empties items; leaving a stone fills the slots', () => {
  const r = rec({ IceToyStr: '0,3,0' });
  PSP.setMechanic(r, 'obstacle');
  assert.deepEqual([r.IsObstacle, r.ToyStr, r.IceToyStr], [true, '', '']);
  PSP.setMechanic(r, 'frozen', { fill: 6 });
  assert.deepEqual([r.IsObstacle, r.IsFrozen, r.ToyStr], [false, true, '6,6,6']);
  const z = rec({ FloatieType: 0, ToyStr: '', IsObstacle: true });
  PSP.setMechanic(z, 'none', { fill: 2 });
  assert.deepEqual([z.FloatieType, z.ToyStr], [3, '2,2,2']);
});

test('setMechanic portal adds a refill; other mechanics drop refills', () => {
  const r = rec();
  PSP.setMechanic(r, 'portal', { fill: 4 });
  assert.deepEqual([r.ToyStr, r.IsMore], ['1,2,3,4', true]);
  PSP.setMechanic(r, 'hidden');
  assert.deepEqual([r.ToyStr, r.IsMore, r.IsUnknown], ['1,2,3', false, true]);
});

test('setSlot pads to the float size and writes "" when all slots are 0', () => {
  const r = rec();
  PSP.setSlot(r, 'ice', 1, 8);
  assert.equal(r.IceToyStr, '0,8,0');
  PSP.setSlot(r, 'ice', 1, 0);
  assert.equal(r.IceToyStr, '');
  PSP.setSlot(r, 'unknown', 0, 1);
  assert.equal(r.UnKnowToyStr, '1,0,0');
});

test('level operations keep FloatieID in step with order', () => {
  const L = lvl(rec({ FloatieID: 1, ToyStr: '1,1,1' }), rec({ FloatieID: 2, ToyStr: '2,2,2' }));
  PSP.addFloat(L, 1, 2, 5);
  assert.deepEqual(L.floats.map((f) => [f.FloatieID, f.ToyStr]), [[1, '1,1,1'], [2, '5,5'], [3, '2,2,2']]);
  PSP.moveFloat(L, 2, 0);
  assert.deepEqual(L.floats.map((f) => f.ToyStr), ['2,2,2', '1,1,1', '5,5']);
  PSP.duplicateFloat(L, 0);
  assert.deepEqual(L.floats.map((f) => [f.FloatieID, f.ToyStr]), [[1, '2,2,2'], [2, '2,2,2'], [3, '1,1,1'], [4, '5,5']]);
  assert.notEqual(L.floats[0], L.floats[1]);
  PSP.removeFloat(L, 1);
  assert.deepEqual(L.floats.map((f) => f.FloatieID), [1, 2, 3]);
});

test('newFloat uses the commonest key set', () => {
  assert.deepEqual(Object.keys(PSP.newFloat(3, 1)), ['FloatieID', 'FloatieType', 'ToyStr', 'IsFrozen', 'IsUnknown', 'LockCount', 'IsKey']);
});

test('replaceKind and swapKinds touch items, refills and Mask targets', () => {
  const L = lvl(rec({ ToyStr: '1,2,1' }), rec({ ToyStr: '2,2,3,1', FloatieType: 3, IsMore: true }), rec({ ToyStr: '4,4,4', MaskTargetToy: 1 }));
  assert.equal(PSP.replaceKind(L, 1, 9), 4);
  assert.deepEqual(L.floats.map((f) => f.ToyStr), ['9,2,9', '2,2,3,9', '4,4,4']);
  assert.equal(L.floats[2].MaskTargetToy, 9);
  PSP.swapKinds(L, 9, 2);
  assert.deepEqual(L.floats.map((f) => f.ToyStr), ['2,9,2', '9,9,3,2', '4,4,4']);
  assert.equal(L.floats[2].MaskTargetToy, 2);
});

test('counts covers items with refills, keys, locks, mechanics and slot mechanics', () => {
  const L = lvl(rec({ ToyStr: '1,1,1' }), rec({ IsKey: true, ToyStr: '2,2,2' }), rec({ LockCount: 1, ToyStr: '3,3,3', UnKnowToyStr: '1,0,1' }),
    rec({ FloatieType: 4, ToyStr: '', IsObstacle: true }));
  const c = PSP.counts(L);
  assert.deepEqual([...c.items], [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual([c.floats, c.stones, c.keys, c.locks, c.mech.key, c.mech.lock, c.mech.obstacle, c.slot.unknown], [4, 1, 1, 1, 1, 1, 1, 2]);
});

test('editing one item of a real level changes exactly one line', { skip: !TEAM && 'team repo not found' }, () => {
  const text = fs.readFileSync(path.join(TEAM, 'LevelData_57.json'), 'utf8');
  const L = PSP.parseLevel(text);
  const r = L.floats.find((f) => !PSP.floatView(f).stone);
  const first = PSP.floatView(r).items[0];
  PSP.setItem(r, 0, first === 1 ? 2 : 1);
  const a = text.split('\r\n'), b = PSP.serializeLevel(L).split('\r\n');
  assert.equal(a.length, b.length);
  assert.equal(a.filter((line, i) => line !== b[i]).length, 1);
});

// ---------- baked art ----------

test('baked art manifest has every float size, overlay and toy', (t) => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const m = html.match(/<!--ART:BEGIN-->\s*<script>window\.ART = ([\s\S]*?);<\/script>\s*<!--ART:END-->/);
  assert.ok(m, 'ART region missing');
  const art = JSON.parse(m[1]);
  if (art === null) { t.skip('not baked yet'); return; }
  assert.deepEqual(Object.keys(art.floats).sort(), ['1', '2', '3', '4', '5']);
  for (const s of ['1', '2', '3', '4', '5']) assert.equal(art.floats[s].slots.length, Number(s));
  for (const o of ['frozen', 'hidden', 'lock', 'net', 'obstacle2', 'key', 'portal']) assert.ok(art.images[art.overlays[o].img], o);
  // every toy_N.png of the team folder, when it is there (24 until 2026-10-02, 71 since the team's "+ New toys")
  const toyDir = TEAM && path.join(TEAM, '..', '..', 'Resources', 'ToySort', 'Toy');
  if (toyDir && fs.existsSync(toyDir)) assert.equal(art.toys.length, fs.readdirSync(toyDir).filter((n) => /^toy_\d+\.png$/.test(n)).length);
  else assert.ok(art.toys.length >= 24);
  for (const id of art.toys) assert.ok(art.images['toy_' + id], 'image for toy ' + id);
  assert.equal(art.obstacleScales.length, 6);
  for (const img of Object.values(art.images)) assert.match(img.src, /^data:image\/webp;base64,/);
});

// ---------- checks and the level row ----------

const codes = (issues, sev) => issues.filter((i) => !sev || i.sev === sev).map((i) => i.code).sort();
const validate = (L, row, art) => PSP.validate(L, row, art);

test('validate passes a clean level', () => {
  const L = lvl(rec({ ToyStr: '1,1,1' }), rec({ ToyStr: '2,2,2', IsKey: true }), rec({ ToyStr: '3,3,3', LockCount: 1 }));
  assert.deepEqual(validate(L), []);
});

test('validate blocks: multiple of 3, ids, keys vs locks, refills vs IsMore, fewer items, slot lists, size', () => {
  assert.deepEqual(codes(validate(lvl(rec({ ToyStr: '1,1,2' }), rec({ ToyStr: '1,2,2' }), rec({ ToyStr: '2,2,1' }))), 'error'), ['mul3', 'mul3']);
  assert.deepEqual(codes(validate(lvl(rec({ ToyStr: '1,x,1' }))), 'error'), ['id', 'mul3']);
  assert.ok(codes(validate(lvl(rec({ ToyStr: '1,1,1', IsKey: true }))), 'error').includes('keys'));
  assert.ok(codes(validate(lvl(rec({ FloatieType: 2, ToyStr: '1,1,1' }))), 'error').includes('more'));
  assert.ok(codes(validate(lvl(rec({ ToyStr: '1,1,1', IsMore: true }))), 'error').includes('more'));
  assert.ok(codes(validate(lvl(rec({ FloatieType: 3, ToyStr: '1,1' }), rec({ FloatieType: 1, ToyStr: '1' }))), 'error').includes('fewer'));
  assert.ok(codes(validate(lvl(rec({ ToyStr: '1,1,1', IceToyStr: '0,0,0,5' }))), 'error').includes('slotlen'));
  assert.ok(codes(validate(lvl(rec({ FloatieType: 6, ToyStr: '1,1,1,1,1,1' }))), 'error').includes('size'));
  assert.ok(codes(validate(lvl()), 'error').includes('empty'));
});

test('validate warns: two mechanics, stone with items, not run by the game, no art, size 0', () => {
  const w = (L) => codes(validate(L), 'warn');
  assert.ok(w(lvl(rec({ ToyStr: '1,1,1', IsFrozen: true, IsUnknown: true }))).includes('multi'));
  assert.ok(w(lvl(rec({ ToyStr: '1,1,1', IsObstacle: true }))).includes('stoneItems'));
  assert.ok(w(lvl(rec({ FloatieType: 4, ToyStr: '', Obstacle2Count: 12 }))).includes('notRun'));
  assert.ok(w(lvl(rec({ ToyStr: '1,1,1', BindToyStr: '1,1,0' }))).includes('notRun'));
  assert.ok(w(lvl(rec({ ToyStr: '1,1,1', MaskTargetToy: 1 }))).includes('notRun'));
  assert.ok(w(lvl(rec({ ToyStr: '157,157,157' }))).includes('noArt'));
  assert.ok(w(lvl(rec({ FloatieType: 0, ToyStr: '', IsObstacle: true }))).includes('type0'));
  assert.ok(w(lvl(rec({ ToyStr: '1,1,1', IceToyStr: '0,5' }))).includes('slotshort'));
});

test('validate checks the level row: odds sum and ranges', () => {
  const L = lvl(rec({ ToyStr: '1,1,1' }));
  const row = { NoAdWeight: 0.5, OneAdWeight: 0.2, TwoAdWeight: 0, ThreeAdWeight: 0, PointRangeStr: '0.7,0.3|1.2,1.5|0,5,90',
    CountdownTargetProgress: '0.1,30' };
  assert.deepEqual(codes(validate(L, row), 'warn'), ['odds', 'range', 'range', 'range']);
});

test('every team level passes with no errors', { skip: !TEAM && 'team repo not found' }, () => {
  const cfg = PSP.parseConfig(fs.readFileSync(path.join(TEAM, 'LevelConfig.json'), 'utf8'));
  for (const name of fs.readdirSync(TEAM).filter((f) => PSP.levelIdFromName(f) !== null)) {
    const L = PSP.parseLevel(fs.readFileSync(path.join(TEAM, name), 'utf8'));
    const errors = validate(L, PSP.getRow(cfg, PSP.levelIdFromName(name))).filter((i) => i.sev === 'error');
    assert.deepEqual(errors, [], name);
  }
});

test('parseRanges is lenient like the game; formatRanges writes short numbers', () => {
  assert.deepEqual(PSP.parseRanges('0.28,0.43|0.58,0.8'), { pairs: [[0.28, 0.43], [0.58, 0.8]], bad: 0 });
  assert.deepEqual(PSP.parseRanges('0,5,90|0.1,30'), { pairs: [[0.1, 30]], bad: 1 });
  assert.deepEqual(PSP.parseRanges(''), { pairs: [], bad: 0 });
  assert.equal(PSP.formatRanges([[0.28, 0.43], [0.58000001, 0.8]]), '0.28,0.43|0.58,0.8');
  assert.equal(PSP.formatRanges([[0.1, 30], [0.55, 90]]), '0.1,30|0.55,90');
});

test('the demo level shows every size and float mechanic and has no errors', () => {
  const L = PSP.cloneLevel(PSP.DEMO.level);
  const errors = PSP.validate(L, PSP.DEMO.row).filter((i) => i.sev === 'error');
  assert.deepEqual(errors, []);
  const sizes = new Set(L.floats.map((f) => f.FloatieType));
  for (const s of [1, 2, 3, 4, 5]) assert.ok(sizes.has(s), 'size ' + s);
  const mechs = new Set(L.floats.map((f) => PSP.floatView(f).mech));
  for (const m of PSP.MECHS) assert.ok(mechs.has(m), m);
  const c = PSP.counts(L);
  for (const k of Object.keys(PSP.SLOT_FIELDS)) assert.ok(c.slot[k] > 0, k);
});

test('getRow, newRow and setRowField', () => {
  const cfg = PSP.parseConfig('[{"LevelID":1,"LevelDataStr":"LevelData_1","LevelTime":300.0},{"LevelID":3,"LevelDataStr":"LevelData_3","LevelTime":300.0}]');
  const r = PSP.newRow(cfg, 2, PSP.getRow(cfg, 1));
  assert.deepEqual(cfg.rows.map((x) => x.LevelID), [1, 2, 3]);
  assert.deepEqual([r.LevelDataStr, PSP.getRow(cfg, 2)], ['LevelData_2', r]);
  PSP.setRowField(r, 'LevelTime', 240);
  assert.match(PSP.serializeConfig(cfg), /"LevelTime": 240\.0/);
  assert.equal(PSP.getRow(cfg, 9), null);
});


// ---------- custom box targets: the object form, the list rules, the checks ----------

// The same shape as the owner's example LevelData_201.json (synthetic ids, written the way the team writes files).
const OBJ = (on, str, floats) => JSON.stringify({ UseCustomTarget: on, CustomTargetStr: str, Floaties: floats }, null, 2).replace(/\n/g, '\r\n');
const F3 = (id, toys) => ({ FloatieID: id, FloatieType: 3, ToyStr: toys });
const THREE = [F3(1, '16,16,16'), F3(2, '14,14,14'), F3(3, '1,1,1')];

test('object form: parsed with its custom targets and written back byte for byte', () => {
  const text = OBJ(true, '1,14,16', THREE);
  const L = PSP.parseLevel(text);
  assert.equal(PSP.levelForm(L), 'object');
  assert.deepEqual(L.custom, { on: true, str: '1,14,16' });
  assert.equal(L.floats.length, 3);
  assert.equal(PSP.serializeLevel(L), text);
  assert.equal(PSP.serializeLevel(PSP.cloneLevel(L)), text, 'a clone keeps the form and the targets');
  const off = PSP.parseLevel(OBJ(false, '', THREE));
  assert.equal(PSP.levelForm(off), 'object', 'an object-form file stays an object when custom targets are off');
  assert.equal(PSP.serializeLevel(off), OBJ(false, '', THREE));
});

test('object form keeps keys it does not know, in their place; a missing key goes before Floaties', () => {
  const text = JSON.stringify({ Note: 'x', UseCustomTarget: true, Floaties: THREE, Tail: 2 }, null, 2).replace(/\n/g, '\r\n');
  const L = PSP.parseLevel(text);
  PSP.setTargets(L, [16, 14, 1]);
  assert.deepEqual(Object.keys(JSON.parse(PSP.serializeLevel(L))), ['Note', 'UseCustomTarget', 'CustomTargetStr', 'Floaties', 'Tail']);
  assert.throws(() => PSP.parseLevel('{"UseCustomTarget":true}'), /Floaties/);
});

test('list form stays a list until custom targets are on; on writes the object form, off again goes back', () => {
  const text = JSON.stringify(THREE, null, 2).replace(/\n/g, '\r\n');
  const L = PSP.parseLevel(text);
  assert.equal(PSP.levelForm(L), 'list');
  assert.equal(PSP.serializeLevel(L), text);
  PSP.setCustomOn(L, true);
  PSP.setTargets(L, [16, 14, 1]);
  assert.equal(PSP.serializeLevel(L), OBJ(true, '16,14,1', THREE));
  PSP.setCustomOn(L, false);
  assert.equal(PSP.serializeLevel(L), text, 'switched off before saving: the file is unchanged');
});

test('parseTargets, autoTargets and targetStats', () => {
  assert.deepEqual(PSP.parseTargets('1, 14,16'), { ids: [1, 14, 16], bad: 0 });
  assert.deepEqual(PSP.parseTargets(''), { ids: [], bad: 0 });
  assert.deepEqual(PSP.parseTargets('1,,x,0,-2,3'), { ids: [1, 3], bad: 4 });
  // items in drop order: a kind is listed each time its running count reaches another 3
  const L = { floats: [F3(1, '5,5,7'), F3(2, '5,7,7'), F3(3, '5,5,5'), { FloatieID: 4, FloatieType: 2, ToyStr: '9,9,9', IsMore: true }] };
  assert.deepEqual(PSP.autoTargets(L), [5, 7, 5, 9]);
  PSP.setCustomOn(L, true);
  PSP.setTargets(L, [5, 5, 7, 12]);
  const t = PSP.targetStats(L);
  assert.equal(t.boxes, 4);
  assert.deepEqual(t.kinds.map((k) => [k.id, k.items, k.need, k.listed]), [[5, 6, 2, 2], [7, 3, 1, 1], [9, 3, 1, 0]]);
  assert.deepEqual(t.unknown, [12]);
});

test('validate: every rule of the custom list, and none when it is right', () => {
  const L = PSP.parseLevel(OBJ(true, '1,14,16', THREE));
  const codes = (lv) => PSP.validate(lv).map((x) => x.code);
  assert.deepEqual(codes(L), ['newForm'], 'the owner\'s example is correct; only the game-support warning');
  const set = (str) => { const c = PSP.cloneLevel(L); c.custom.str = str; return codes(c); };
  assert.ok(set('').includes('ctEmpty'));
  assert.ok(set('1,14,x').includes('ctBad'));
  assert.ok(set('1,14,99').includes('ctUnknown'));
  assert.ok(set('1,14,14').includes('ctCount'), 'kind 14 twice, kind 16 never');
  assert.ok(set('1,14,16,16').includes('ctLength'));
  assert.ok(!set('16,1,14').some((c) => c.startsWith('ct')), 'any order of the right kinds is valid');
  const off = PSP.cloneLevel(L); off.custom.on = false; off.custom.str = 'junk';
  assert.ok(!codes(off).some((c) => c.startsWith('ct')), 'a switched-off list is not checked');
  const list = PSP.parseLevel(JSON.stringify(THREE));
  assert.ok(!codes(list).includes('newForm'));
});


test('replace and swap also rewrite the box targets, so a valid list stays valid', () => {
  const L = PSP.parseLevel(OBJ(true, '1,14,16,1', [F3(1, '16,16,16'), F3(2, '14,14,14'), F3(3, '1,1,1'), F3(4, '1,1,1')]));
  assert.ok(!PSP.validate(L).some((x) => x.code.startsWith('ct')));
  PSP.swapKinds(L, 1, 16);
  assert.equal(L.custom.str, '16,14,1,16');
  assert.ok(!PSP.validate(L).some((x) => x.code.startsWith('ct')), 'still valid after a swap');
  PSP.replaceKind(L, 14, 1); // merge 14 into 1: 1 now has 6 items and 2 boxes
  assert.equal(L.custom.str, '16,1,1,16');
  assert.ok(!PSP.validate(L).some((x) => x.code.startsWith('ct')), 'still valid after a merge');
  const off = PSP.parseLevel(OBJ(false, '5,x,5', [F3(1, '5,5,5')]));
  assert.equal(PSP.replaceKind(off, 5, 9), 5, '3 items + 2 list entries changed');
  assert.equal(off.custom.str, '9,x,9', 'a switched-off list follows too; a bad token is left alone');
  const list = PSP.parseLevel(JSON.stringify([F3(1, '5,5,5')]));
  PSP.replaceKind(list, 5, 9);
  assert.equal(PSP.levelForm(list), 'list', 'a level without targets keeps the list form');
});
