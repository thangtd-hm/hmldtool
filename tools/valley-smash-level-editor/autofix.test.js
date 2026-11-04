'use strict';
// Tests the auto-fix block (VSAutoFix: rounds jammed blocks, separates them, flags the rest) under node.
// Run: node --test tools/valley-smash-level-editor/autofix.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function loadBlock() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const m = html.match(/<script id="autofix">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('autofix script block not found');
  const scope = {};
  new Function('window', m[1])(scope);
  return scope.VSAutoFix;
}
const AF = loadBlock();

const yaw = (deg) => { const r = deg * Math.PI / 360; return { x: 0, y: Math.sin(r), z: 0, w: Math.cos(r) }; };
const IDENT = { x: 0, y: 0, z: 0, w: 1 };
const YAW45 = { x: 0, y: 0.3826834, z: 0, w: 0.9238795 }; // already rounded to 7 decimals
const cube = (x, y, z, extra) => Object.assign({ pos: { x, y, z }, half: { x: 0.5, y: 0.5, z: 0.5 }, rot: IDENT }, extra);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' ' + a + ' vs ' + b);

test('float noise on position and rotation is rounded away', () => {
  const r = AF.fixTable([cube(0.50000024, 0.49999988, -1.0000002, { rot: { x: 1e-5, y: -2e-5, z: 0, w: 1 } })]);
  assert.deepEqual(r.items[0].pos, { x: 0.5, y: 0.5, z: -1 });
  assert.deepEqual(r.items[0].rot, IDENT);
  assert.equal(r.rounded, 1);
});

test('a block already on the grid is left alone and not counted', () => {
  const r = AF.fixTable([cube(0.5, 0.5, 0)]);
  assert.equal(r.rounded, 0);
  assert.equal(r.moved, 0);
  assert.equal(r.items[0].changed, false);
});

test('position that sits between grid lines goes to the nearest 0.5', () => {
  const r = AF.fixTable([cube(1.3, 0.6, -0.8)]);
  assert.deepEqual(r.items[0].pos, { x: 1.5, y: 0.5, z: -1 });
});

test('a small tilt snaps to the nearest 90 degree rotation', () => {
  const r = AF.fixTable([cube(0, 0.5, 0, { rot: yaw(92.5) })]);
  near(r.items[0].rot.y, Math.SQRT1_2);
  near(r.items[0].rot.w, Math.SQRT1_2);
  assert.equal(r.items[0].rot.x, 0);
  assert.equal(r.items[0].rot.z, 0);
});

test('a designed tilt keeps its angle, rounded to 5 degrees, position to 0.05', () => {
  const r = AF.fixTable([cube(0.123, 2.02, 0, { rot: yaw(31.1) })]);
  const q = r.items[0].rot, target = yaw(30);
  near(q.y, target.y, 'y');
  near(q.w, target.w, 'w');
  assert.deepEqual(r.items[0].pos, { x: 0.1, y: 2, z: 0 });
});

test('a jammed block moves to a free spot and the lower one stays', () => {
  const r = AF.fixTable([cube(0, 0.5, 0), cube(0.5, 0.5, 0)]);
  assert.deepEqual(r.items[0].pos, { x: 0, y: 0.5, z: 0 });
  assert.equal(r.items[0].moved, false);
  assert.equal(r.items[1].moved, true);
  assert.equal(r.moved, 1);
  assert.deepEqual(r.flagged, []);
  assert.equal(AF.countHits(r.items), 0);
});

test('a move never goes down', () => {
  const r = AF.fixTable([cube(0, 1.5, 0), cube(0, 2, 0), cube(0, 0.5, 0)]);
  assert.ok(r.items[1].pos.y >= 2, 'y ' + r.items[1].pos.y);
  assert.equal(AF.countHits(r.items), 0);
});

test('a moved block ends up resting on the table or on another block', () => {
  const blocks = [cube(0, 1.5, 0), cube(0, 0.5, 0), cube(0, 2, 0)];
  const r = AF.fixTable(blocks);
  const m = r.items[2];
  assert.equal(m.moved, true);
  assert.ok(m.pos.y === 0.5 || m.pos.y === 2.5, 'rests on the table or on top, y ' + m.pos.y);
});

test('a move is limited to 1 unit and otherwise the block is flagged', () => {
  const walls = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 3; y++) walls.push(cube(x, y + 0.5, z));
  walls.push(cube(0.5, 0.5, 0));
  const r = AF.fixTable(walls);
  const last = r.items[r.items.length - 1];
  assert.equal(last.moved, false);
  assert.deepEqual(last.pos, { x: 0.5, y: 0.5, z: 0 });
  assert.ok(r.flagged.includes(walls.length - 1));
});

test('a designed tilt block is never moved beyond rounding, a grid block moves away from it', () => {
  const r = AF.fixTable([cube(0, 0.5, 0), cube(0, 0.5, 0, { rot: yaw(45) })]);
  assert.deepEqual(r.items[1].pos, { x: 0, y: 0.5, z: 0 });
  assert.equal(r.items[1].moved, false);
  assert.equal(r.items[0].moved, true);
  assert.equal(AF.countHits(r.items), 0);
});

test('two designed tilts that hit are both flagged', () => {
  const r = AF.fixTable([cube(0, 0.5, 0, { rot: yaw(45) }), cube(0.5, 0.5, 0, { rot: yaw(45) })]);
  assert.deepEqual(r.flagged, [0, 1]);
  assert.equal(r.moved, 0);
});

test('a designed tilt that rounding would push into its neighbour keeps its original pose', () => {
  // Corners 0.01 apart along the diagonal; rounding x to 1.4 makes the two overlap.
  const r = AF.fixTable([cube(0, 0.5, 0, { rot: YAW45 }), cube(1.424, 0.5, 0, { rot: YAW45 })]);
  assert.equal(r.items[1].pos.x, 1.424);
  assert.deepEqual(r.flagged, []);
  assert.equal(r.kept, 1);
  assert.equal(r.rounded, 0);
});

test('a designed tilt keeps the rounded pose when rounding makes it no worse', () => {
  const r = AF.fixTable([cube(0, 0.5, 0, { rot: YAW45 }), cube(5.03, 0.5, 0, { rot: YAW45 })]);
  assert.equal(r.items[1].pos.x, 5.05);
  assert.equal(r.kept, 0);
  assert.equal(r.rounded, 1);
});

test('a pinned block keeps every number, and other blocks move away from it', () => {
  const pin = cube(0.1234, 0.5, 0, { pinned: true, rot: yaw(33.3) });
  const r = AF.fixTable([pin, cube(0, 0.5, 0)]);
  assert.deepEqual(r.items[0].pos, pin.pos);
  assert.deepEqual(r.items[0].rot, pin.rot);
  assert.equal(r.items[0].changed, false);
  assert.equal(r.items[1].moved, true);
});

test('an exempt pair does not count as a hit', () => {
  const blocks = [cube(0, 0.5, 0, { pinned: true }), cube(0, 0.5, 0, { pinned: true })];
  const r = AF.fixTable(blocks, { exempt: () => true });
  assert.deepEqual(r.flagged, []);
});

test('rotated pairs are measured on their true shape, not their bounding box', () => {
  // Bounding boxes overlap, but the 45 degree corners do not reach the neighbour's corner.
  const a = cube(0, 0.5, 0, { rot: yaw(45) }), b = cube(1.2, 0.5, 1.2, { rot: yaw(45) });
  assert.equal(AF.countHits([a, b]), 0);
});

test('touching faces do not count as a hit', () => {
  assert.equal(AF.countHits([cube(0, 0.5, 0), cube(1, 0.5, 0), cube(0, 1.5, 0)]), 0);
});

test('off moves the box without moving the stored position', () => {
  assert.equal(AF.countHits([cube(0, 0.5, 0, { off: { x: 5, y: 0, z: 0 } }), cube(0, 0.5, 0)]), 0);
});

test('a second run changes nothing', () => {
  const messy = [cube(0.0000002, 0.5000002, 0), cube(0.52, 0.4999, 0.03), cube(0, 1.47, 0, { rot: yaw(3) }),
    cube(3.33, 2.21, 0, { rot: yaw(27.4) }), cube(3.7, 2.2, 0, { rot: { x: 0.2, y: 0.3, z: 0.1, w: 0.9 } })];
  const first = AF.fixTable(messy);
  const again = first.items.map((it, i) => Object.assign({}, messy[i], { pos: it.pos, rot: it.rot }));
  const second = AF.fixTable(again);
  assert.equal(second.rounded, 0);
  assert.equal(second.moved, 0);
  second.items.forEach((it, i) => {
    assert.deepEqual(it.pos, first.items[i].pos);
    assert.deepEqual(it.rot, first.items[i].rot);
  });
});

test('isClean tells rounded data from noise', () => {
  assert.equal(AF.isClean(cube(0.5, 0.5, 0)), true);
  assert.equal(AF.isClean(cube(0.50000024, 0.5, 0)), false);
  assert.equal(AF.isClean(cube(0.5, 0.5, 0, { rot: { x: 0, y: 1e-4, z: 0, w: 1 } })), false);
  assert.equal(AF.isClean(cube(0.5, 0.5, 0, { pinned: true, rot: yaw(33.3) })), true);
});

test('the input blocks are not changed', () => {
  const b = cube(0.52, 0.5, 0);
  AF.fixTable([b]);
  assert.equal(b.pos.x, 0.52);
});
