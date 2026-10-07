'use strict';
// Tests the board block (PSPBoard: the pool in planck.js, the spawner, the board facts and the tap flow) under node.
// Run: node --test tools/pool-sort-level-editor/board.test.js
// Before the blocks are inlined: PSP_BLOCK_DIR=<folder with planck.js, game.js, board.js> node --test ...
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// planck, then game, then board, each from PSP_BLOCK_DIR/<id>.js or from <script id="<id>"> in index.html.
// In a block folder the core is game.js once game.READY sits next to it, else the test stub game-stub.js.
function loadBlock(id) {
  const dir = process.env.PSP_BLOCK_DIR;
  let code, filename;
  if (dir) {
    let file = path.join(dir, id + '.js');
    if (id === 'game' && !fs.existsSync(path.join(dir, 'game.READY')) && fs.existsSync(path.join(dir, 'game-stub.js'))) {
      file = path.join(dir, 'game-stub.js');
    }
    code = fs.readFileSync(file, 'utf8');
    filename = file;
  } else {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
    if (!m) throw new Error(id + ' script block not found');
    code = m[1];
    filename = 'index.html#' + id;
  }
  // This realm, not a fresh vm context: arrays from another realm fail assert.deepStrictEqual.
  vm.runInThisContext(code, { filename });
}
loadBlock('planck');
loadBlock('game');
loadBlock('board');
const { planck, PSPGame, PSPBoard } = globalThis;
const STUB = !!PSPGame.stub;

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
const stripBom = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
const readJson = (file) => JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
const CONFIG = TEAM ? readJson(path.join(TEAM, 'LevelConfig.json')) : [];
function teamLevel(id) {
  return { records: readJson(path.join(TEAM, 'LevelData_' + id + '.json')), row: CONFIG.find((r) => r.LevelID === id) };
}
const noTeam = !TEAM && 'team repo not found';

const FRAME = 1 / 60;
const T = PSPGame.GameEventType;
const P = PSPBoard.POOL;

function makeBoard(level, extra) {
  return PSPBoard.create(Object.assign({ records: level.records, row: level.row, rng: PSPGame.SystemRandom(7) }, extra));
}

/** Steps until every float rests and nothing more is about to drop; returns the simulated seconds, or null. */
function settle(board, maxSeconds) {
  const frames = Math.ceil(maxSeconds / FRAME);
  for (let i = 0; i < frames; i++) {
    board.step(FRAME);
    if (board.floats.length > 0 && board.floats.every((f) => f.settled) && !board.isFilling) return board.time;
  }
  return null;
}

function assertInsidePool(board, label) {
  const tol = 0.05;
  for (const f of board.floats) {
    assert.ok(f.x - f.radius >= P.left - tol && f.x + f.radius <= P.right + tol, `${label}: float ${f.id} out by a wall (x ${f.x.toFixed(3)}, r ${f.radius})`);
    assert.ok(f.y - f.radius >= P.floor - tol, `${label}: float ${f.id} under the floor (y ${f.y.toFixed(3)})`);
    for (const g of board.floats) {
      if (g.id <= f.id) continue;
      const gap = Math.hypot(f.x - g.x, f.y - g.y) - f.radius - g.radius;
      assert.ok(gap >= -0.06, `${label}: floats ${f.id} and ${g.id} overlap by ${(-gap).toFixed(3)}`);
    }
  }
}

/** Item conservation: collected + queued + on the water + queue + overflow = total. */
function assertConserved(game, label) {
  let water = 0;
  for (const f of game.activeFloaties) {
    for (const t of f.slots) if (t !== 0) water++;
    water += f.extraToyCount;
  }
  let temp = 0;
  for (const t of game.tempSlots) if (t !== 0) temp++;
  const overflow = game.overflow ? game.overflow.length : 0;
  assert.equal(game.collectedToy + game.queuedToyCount + water + temp + overflow, game.totalToy, label);
}

// ---------- constants ----------

test('pool constants match the team prefabs', () => {
  assert.equal(P.left, -5.5);
  assert.equal(P.right, 5.5);
  assert.equal(P.floor, -9.2);
  assert.equal(P.gateY, 7.03);
  assert.equal(P.spawnY, 9.03);
  assert.ok(Math.abs(P.topMaskY - 4.21775) < 1e-9);
  assert.deepEqual(Object.keys(PSPBoard.FLOATS), ['1', '2', '3', '4', '5']);
  for (let n = 1; n <= 5; n++) assert.equal(PSPBoard.FLOATS[n].slots.length, n);
  assert.equal(PSPBoard.PHYSICS.fixedStep, 0.02);
});

// ---------- opening pile ----------

for (const id of [1, 20, 101, 110, 126]) {
  test(`level ${id}: the opening pile settles inside the pool`, { skip: noTeam }, () => {
    const board = makeBoard(teamLevel(id));
    const seconds = settle(board, 20);
    assert.ok(seconds !== null, 'did not settle within 20 s');
    assert.ok(board.floats.length >= 3);
    assertInsidePool(board, 'level ' + id);
    const intro = board.drainEvents().filter((e) => e.type === 'FloatieSpawned' && e.intro);
    assert.ok(intro.length > 0 && intro.every((e) => e.board === true));
  });
}

test('the opening pile falls as rows from the spawn line upward', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(110));
  board.step(FRAME);
  const intro = board.drainEvents().filter((e) => e.type === 'FloatieSpawned');
  assert.ok(intro.length >= 8);
  assert.ok(intro.every((e) => e.intro));
  const lowest = Math.min(...intro.map((e) => e.y));
  assert.ok(lowest >= P.spawnY - 2.6 && lowest <= P.spawnY + 2.6, 'first row centred on the spawn line');
  // The rows stack upward from there, one band per row.
  const ys = intro.map((e) => e.y).sort((a, b) => a - b);
  assert.ok(ys[ys.length - 1] - ys[0] > 4, 'several rows stacked upward');
});

test('the opening pile is braked onto the floor instead of hitting it at full speed', { skip: noTeam }, () => {
  for (const id of [20, 110]) {
    const board = makeBoard(teamLevel(id));
    board.step(FRAME);
    const intro = new Set(board.floats.map((f) => f.id));
    assert.ok(board.floats.every((f) => f.vy <= -PSPBoard.PHYSICS.introSpawnSpeed + 1e-6), 'launched at the intro speed');
    const lastVy = new Map();
    const impact = new Map();
    for (let i = 0; i < 6 * 60; i++) {
      board.step(FRAME);
      for (const f of board.floats) {
        if (intro.has(f.id) && !impact.has(f.id) && f.y - f.radius <= P.floor + 0.03) impact.set(f.id, -(lastVy.get(f.id) || 0));
        lastVy.set(f.id, f.vy);
      }
    }
    assert.ok(impact.size >= 2, `level ${id}: the bottom row reached the floor`);
    for (const [fid, speed] of impact) assert.ok(speed < 4, `level ${id}: float ${fid} hit the floor at ${speed.toFixed(2)} units/s`);
  }
});

// ---------- refill ----------

test('refills wait for the gate and alternate between the two drop columns', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(110));
  settle(board, 20);
  board.drainEvents();
  let refills = 0;
  for (let round = 0; round < 60 && board.result === PSPGame.GameResult.Playing; round++) {
    // take something to make room, then watch every frame
    const tap = greedyTap(board);
    if (tap) board.tap(tap.id, tap.slot);
    for (let i = 0; i < 30; i++) {
      const before = new Set(board.floats.map((f) => f.id));
      board.step(FRAME);
      for (const e of board.drainEvents()) {
        if (e.type !== 'FloatieSpawned' || e.intro) continue;
        refills++;
        const column = P.spawnColumnsX[e.spawnIndex % P.spawnColumnsX.length];
        assert.ok(Math.abs(e.x - column) <= P.spawnJitterX + 1e-9, `refill ${e.spawnIndex} at x ${e.x} is not in column ${column}`);
        assert.equal(e.y, P.spawnY);
        for (const f of board.floats) {
          if (f.id === e.floatieId || !before.has(f.id)) continue;
          if (f.kind === 'stone' && f.settled) continue;
          assert.ok(f.y <= P.gateY + 1e-9, `float ${f.id} was above the gate (y ${f.y}) when ${e.floatieId} dropped`);
        }
      }
    }
  }
  assert.ok(refills >= 4, `only ${refills} refills seen`);
});

// ---------- Hidden ----------

function hiddenRecords() {
  // A clouded float dropped on top of a plain pile: it must not clear until it rests on the floor or a stone.
  const records = [];
  for (let i = 0; i < 9; i++) records.push({ FloatieID: i + 1, FloatieType: 3, ToyStr: [1, 2, 3][i % 3] + ',' + [1, 2, 3][(i + 1) % 3] + ',' + [1, 2, 3][(i + 2) % 3] });
  records.push({ FloatieID: 10, FloatieType: 3, ToyStr: '4,4,4', IsUnknown: true });
  const row = { LevelID: 9001, LevelDataStr: 'LevelData_9001', LevelTime: 300, PointRangeStr: '', NoAdWeight: 1, OneAdWeight: 0, TwoAdWeight: 0, ThreeAdWeight: 0, LevelDifficulty: 1, CountdownTargetProgress: '' };
  return { records, row };
}

function revealWatcher(board) {
  // Call step() through it: every Hidden float revealed in that step must be at rest on the floor or a stone,
  // measured with the collider it had while clouded (the cloud's wider circle goes when it clears).
  return (label, dt) => {
    const radius = new Map(board.floats.map((f) => [f.id, f.radius]));
    board.step(dt);
    const revealed = [];
    for (const e of board.drainEvents()) {
      if (e.type !== T.MechanicChanged || e.amount !== 0) continue;
      const f = board.floats.find((x) => x.id === e.floatieId);
      if (!f || f.state.mechanicType !== PSPGame.FloatieMechanicType.Hidden) continue;
      const r = radius.get(f.id) || f.radius;
      assert.ok(f.settled, `${label}: Hidden float ${f.id} revealed while moving`);
      const onFloor = f.y - r <= P.floor + P.neighbourTouchTolerance + 0.03;
      const onStone = board.floats.some((g) => g.kind === 'stone' && g.y < f.y && Math.hypot(f.x - g.x, f.y - g.y) <= r + g.radius + P.neighbourTouchTolerance + 0.03);
      assert.ok(onFloor || onStone, `${label}: Hidden float ${f.id} revealed at y ${f.y.toFixed(2)}, not on the floor or a stone`);
      revealed.push(f.id);
    }
    return revealed.length ? revealed : null;
  };
}

test('a Hidden float stays clouded on top of the pile and clears once it rests on the floor', () => {
  const board = makeBoard(hiddenRecords());
  const watch = revealWatcher(board);
  let revealed = null;
  for (let i = 0; i < 20 * 60 && revealed === null; i++) revealed = watch('synthetic', FRAME);
  const hidden = board.game.activeFloaties.find((f) => f.mechanicType === PSPGame.FloatieMechanicType.Hidden);
  if (revealed === null) {
    // It landed on the pile, not the floor: still clouded. Empty the pile under it until it reaches the floor.
    assert.ok(hidden && hidden.mechanicCounter > 0);
    const f = board.floats.find((x) => x.id === hidden.id);
    assert.ok(f.y - f.radius > P.floor + 0.5, 'clouded although on the floor');
    for (let round = 0; round < 200 && revealed === null && board.result === PSPGame.GameResult.Playing; round++) {
      const tap = greedyTap(board);
      if (tap) board.tap(tap.id, tap.slot);
      for (let i = 0; i < 20 && revealed === null; i++) revealed = watch('synthetic', FRAME);
    }
  }
  assert.ok(revealed !== null, 'the Hidden float never cleared');
});

test('level 20: Hidden floats clear only when they rest on the floor', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(20));
  const watch = revealWatcher(board);
  let reveals = 0;
  for (let i = 0; i < 12 * 60; i++) { const ids = watch('level 20', FRAME); if (ids) reveals += ids.length; }
  // Whatever is still clouded is not resting on fixed ground.
  for (const s of board.game.activeFloaties) {
    if (s.mechanicType !== PSPGame.FloatieMechanicType.Hidden || s.mechanicCounter <= 0) continue;
    const f = board.floats.find((x) => x.id === s.id);
    assert.ok(!(f.settled && f.y - f.radius <= P.floor + 0.05), `float ${f.id} rests on the floor but is still clouded`);
  }
  assert.ok(reveals >= 1, 'the clouded float in the bottom row cleared');
});

// ---------- Frozen ----------

test('level 4: taking an item from a float touching a Frozen one thaws it; a far float does not', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(4));
  assert.ok(settle(board, 20) !== null);
  const F = PSPGame.FloatieMechanicType.Frozen;
  const frozenState = board.game.activeFloaties.find((s) => s.mechanicType === F && s.mechanicCounter > 0);
  assert.ok(frozenState, 'level 4 has a Frozen float in the opening pile');
  const frozen = board.floats.find((f) => f.id === frozenState.id);
  const tappable = (f) => f.state.slots.findIndex((t, s) => t !== 0 && board.canTap(f.id, s).ok);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const candidates = board.floats.filter((f) => f.id !== frozen.id && f.kind === 'float' && tappable(f) >= 0);
  const near = candidates.filter((f) => dist(f, frozen) <= (f.radius + frozen.radius) * 1.02).sort((a, b) => dist(a, frozen) - dist(b, frozen))[0];
  const far = candidates.filter((f) => dist(f, frozen) > (f.radius + frozen.radius) * 1.1 + 0.5)[0];
  assert.ok(near && far, 'found a touching and a far float to tap');
  board.drainEvents();

  const before = frozenState.mechanicCounter;
  const r1 = board.tap(far.id, tappable(far));
  assert.equal(r1.ok, true, r1.reason);
  assert.ok(!r1.events.some((e) => e.type === T.MechanicChanged && e.floatieId === frozen.id), 'a far float thawed the ice');
  assert.equal(frozenState.mechanicCounter, before);
  for (let i = 0; i < 6; i++) board.step(FRAME);

  // The touching float may have moved a hair; re-check it still touches before tapping.
  const nearNow = board.floats.find((f) => f.id === near.id);
  const frozenNow = board.floats.find((f) => f.id === frozen.id);
  assert.ok(dist(nearNow, frozenNow) <= (nearNow.radius + frozenNow.radius) * 1.05);
  const r2 = board.tap(near.id, tappable(nearNow));
  assert.equal(r2.ok, true, r2.reason);
  const thaw = r2.events.filter((e) => e.type === T.MechanicChanged && e.floatieId === frozen.id);
  assert.equal(thaw.length, 1, 'one item taken, one layer of ice');
  assert.equal(frozenState.mechanicCounter, before - 1);
  assert.equal(thaw[0].amount, before - 1);
});

test('a tap on a Frozen float is refused and kicks it', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(4));
  settle(board, 20);
  const frozen = board.floats.find((f) => f.state.mechanicType === PSPGame.FloatieMechanicType.Frozen);
  const slot = frozen.state.slots.findIndex((t) => t !== 0);
  board.drainEvents();
  const r = board.tap(frozen.id, slot);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'iced');
  assert.equal(r.mechanic, PSPGame.FloatieMechanicType.Frozen);
  assert.ok(board.drainEvents().some((e) => e.type === 'FloatieKicked' && e.board));
});

// ---------- tap refusals ----------

test('items behind the top mask cannot be tapped', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(110));
  settle(board, 20);
  let checked = 0;
  for (const f of board.floats) {
    f.state.slots.forEach((t, s) => {
      if (t === 0) return;
      const pos = board.slotPosition(f.id, s);
      if (pos.y <= P.topMaskY) return;
      assert.equal(board.canTap(f.id, s).reason, 'masked');
      checked++;
    });
  }
  assert.ok(checked > 0);
  assert.equal(board.tap(9999, 0).reason, 'unknown-floatie');
});

test('a tap bound for a box still playing its collect is refused as busy until the collect is over', { skip: noTeam }, () => {
  const board = makeBoard(teamLevel(4));
  settle(board, 20);
  const scratch = [];
  let found = false;
  for (let round = 0; round < 400 && !found && board.result === PSPGame.GameResult.Playing; round++) {
    const tap = greedyTap(board);
    const completed = tap ? board.tap(tap.id, tap.slot).events.filter((e) => e.type === T.TankCompleted).map((e) => e.tankIndex) : [];
    for (const f of completed.length ? board.floats : []) {
      for (let s = 0; s < f.state.slots.length && !found; s++) {
        if (f.state.slots[s] === 0) continue;
        board.game.collectTapTanks(f.id, s, scratch);
        if (!scratch.some((t) => completed.includes(t))) continue;
        const verdict = board.canTap(f.id, s);
        if (verdict.reason === 'masked') continue;
        assert.equal(verdict.reason, 'busy');
        assert.equal(verdict.wait, 'box');
        const frames = Math.ceil((PSPBoard.TIMING.collectWindow + 0.05) / FRAME);
        for (let i = 0; i < frames; i++) board.step(FRAME);
        if (board.floats.some((x) => x.id === f.id)) assert.notEqual(board.canTap(f.id, s).reason, 'busy');
        found = true;
      }
      if (found) break;
    }
    for (let i = 0; i < 21; i++) board.step(FRAME);
  }
  assert.ok(found, 'saw a tap wait for a collect');
});

// ---------- headless play ----------

/**
 * The core's AutoPlayBot preferences paced like the game's AutoPlayDriver: a tap that puts an item in a box
 * whenever the board accepts one (the float with fewest items first); while a box move waits on a collect, or
 * the pile is still filling, wait; otherwise a tap into the queue (a float's last item first, then the type
 * already queued and most exposed). Returns null to wait.
 */
function greedyTap(board) {
  const game = board.game;
  const scratch = [];
  const exposed = new Map();
  for (const s of game.activeFloaties) for (const t of s.slots) if (t !== 0) exposed.set(t, (exposed.get(t) || 0) + 1);
  let box = null, boxCount = Infinity, boxWaiting = false, queue = null, queueScore = -1, queueCount = Infinity;
  for (const f of board.floats) {
    const st = f.state;
    const count = st.slots.filter((t) => t !== 0).length + st.extraToyCount;
    for (let s = 0; s < st.slots.length; s++) {
      const toy = st.slots[s];
      if (toy === 0) continue;
      const verdict = board.canTap(f.id, s);
      if (!verdict.ok) {
        if (verdict.reason === 'busy') boxWaiting = true;
        continue;
      }
      game.collectTapTanks(f.id, s, scratch);
      if (scratch.length > 0) {
        if (count < boxCount) { box = { id: f.id, slot: s }; boxCount = count; }
        continue;
      }
      const score = (count === 1 ? 1000 : 0) + game.tempSlots.filter((t) => t === toy).length * 10 + (exposed.get(toy) || 0);
      if (score < queueScore || (score === queueScore && count >= queueCount)) continue;
      queue = { id: f.id, slot: s };
      queueScore = score;
      queueCount = count;
    }
  }
  if (box) return box;
  if (boxWaiting || board.isFilling) return null;
  return queue;
}

for (const id of [1, 4, 20, 101, 110]) {
  test(`level ${id}: a greedy player plays to a result with every item accounted for`, { skip: noTeam }, () => {
    const board = makeBoard(teamLevel(id));
    const Playing = PSPGame.GameResult.Playing;
    let taps = 0;
    assertConserved(board.game, 'start');
    while (board.result === Playing && board.time < 900) {
      const tap = greedyTap(board);
      if (tap) {
        const r = board.tap(tap.id, tap.slot);
        assert.equal(r.ok, true, r.reason);
        taps++;
        assertConserved(board.game, `after tap ${taps}`);
      }
      for (let i = 0; i < 21; i++) { // AutoPlayDriver interval 0.35 s
        board.step(FRAME);
        assertConserved(board.game, `t ${board.time.toFixed(2)}`);
      }
    }
    assert.notEqual(board.result, Playing, `still playing after ${board.time.toFixed(0)} s and ${taps} taps`);
    const ended = board.drainEvents().filter((e) => e.type === 'ResultChanged');
    assert.equal(ended.length, 1);
    assert.equal(ended[0].result, board.result);
  });
}

// ---------- difficulty ----------

test('difficulty 4 turns every pressure window on; 5 hands over the DDA table and the random', { skip: noTeam }, () => {
  const level = teamLevel(CONFIG.find((r) => (r.PointRangeStr || '').includes('|')).LevelID);
  const windows = level.row.PointRangeStr.split('|').length;
  assert.equal(makeBoard(level, { difficulty: 4 }).activeWindows, windows);
  const rng = PSPGame.SystemRandom(3);
  const ddaFile = path.join(TEAM, 'LevelDifficultyConfig.json');
  const table = PSPGame.LevelRepository.parseDda && fs.existsSync(ddaFile)
    ? PSPGame.LevelRepository.parseDda(stripBom(fs.readFileSync(ddaFile, 'utf8')))
    : { marker: true };
  const b5 = makeBoard(level, { difficulty: 5, rng, ddaTable: table });
  assert.equal(b5.game.dda, table);
  assert.equal(b5.game.ddaRandom, rng);
  if (!STUB) { // Version B picks demands through the table while the pile plays
    for (let round = 0; round < 60 && b5.result === PSPGame.GameResult.Playing; round++) {
      const tap = greedyTap(b5);
      if (tap) assert.equal(b5.tap(tap.id, tap.slot).ok, true);
      for (let i = 0; i < 21; i++) b5.step(FRAME);
      assertConserved(b5.game, 'difficulty 5');
    }
  }
  const b0 = makeBoard(level, { difficulty: 0 });
  assert.ok(b0.activeWindows >= 0 && b0.activeWindows <= windows);
  assert.equal(b0.difficulty, 0);
});

test('the board block reads planck and PSPGame at call time, not at load time', () => {
  const code = process.env.PSP_BLOCK_DIR
    ? fs.readFileSync(path.join(process.env.PSP_BLOCK_DIR, 'board.js'), 'utf8')
    : fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').match(/<script id="board">([\s\S]*?)<\/script>/)[1];
  assert.ok(!/<\/script/i.test(code));
  const saved = { planck: globalThis.planck, PSPGame: globalThis.PSPGame, PSPBoard: globalThis.PSPBoard };
  try {
    delete globalThis.planck;
    delete globalThis.PSPGame;
    vm.runInThisContext(code, { filename: 'board (no globals)' });
    assert.equal(typeof globalThis.PSPBoard.create, 'function');
    assert.throws(() => globalThis.PSPBoard.create({}), /planck/);
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.ok(planck.World);
});

// ---------- box unlock (ToySortBoard.RequestUnlock + UnlockTank) ----------

function kindsLevel(kinds, row) {
  const records = [];
  for (let k = 1; k <= kinds; k++) records.push({ FloatieID: k, FloatieType: 3, ToyStr: `${k},${k},${k}` });
  return { records, row: Object.assign({ LevelID: 9002, LevelDataStr: 'LevelData_9002', LevelTime: 300, PointRangeStr: '', NoAdWeight: 1,
    OneAdWeight: 0, TwoAdWeight: 0, ThreeAdWeight: 0, LevelDifficulty: 1, CountdownTargetProgress: '' }, row) };
}

test('unlock: a locked box opens with a demand, once, and is counted', () => {
  const board = makeBoard(kindsLevel(4));
  board.drainEvents();
  const locked = board.game.tanks.findIndex((t) => !t.isUnlocked);
  assert.ok(locked >= 0, 'the level starts with a locked box');
  const r = board.requestUnlock(locked);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(board.game.tanks[locked].isUnlocked && board.game.tanks[locked].toyType > 0, 'opened with a demanded item');
  assert.equal(board.unlockCount, 1);
  assert.ok(board.drainEvents().some((e) => e.type === T.TankUnlocked && e.tankIndex === locked), 'TankUnlocked reaches the drain');
  assert.equal(board.requestUnlock(locked).reason, 'unlocked');
  assert.equal(board.requestUnlock(9).reason, 'unknown-tank');
  assert.equal(board.unlockCount, 1);
});

test('unlock: refused when nothing is left to demand, as the game\'s "not enough targets"', () => {
  const board = makeBoard(kindsLevel(2)); // the two open boxes already ask for both kinds
  const locked = board.game.tanks.findIndex((t) => !t.isUnlocked);
  const r = board.requestUnlock(locked);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-demand');
  assert.equal(board.game.tanks[locked].isUnlocked, false);
  assert.equal(board.unlockCount, 0);
});

test('unlock: counts as help used, so pressure stops in the current window', () => {
  const board = makeBoard(kindsLevel(4, { PointRangeStr: '0,1' }), { difficulty: 4 });
  assert.equal(board.game.isPressureActive, true, 'progress 0 sits in the window 0..1, every window on');
  assert.equal(board.requestUnlock(board.game.tanks.findIndex((t) => !t.isUnlocked)).ok, true);
  assert.equal(board.game.helpUsedIn(0), 1);
  assert.equal(board.game.isPressureActive, false);
});

// ---------- item art remap (ToyArtRemapper.Apply) ----------

function remapLevel(strs) {
  const records = strs.map((s, i) => ({ FloatieID: i + 1, FloatieType: 3, ToyStr: s }));
  return { records, row: kindsLevel(0).row };
}
const idsOf = (board) => board.definition.floaties.flatMap((f) => [...f.visibleToy, ...f.extraToy]);

test('art remap: ids without art take unused ids with art, one replacement each, counts kept', () => {
  const level = remapLevel(['1,1,1', '2,2,2', '99,99,99', '150,150,150']);
  const board = makeBoard(level, { artIds: new Set([1, 2, 3, 4, 5]) });
  const map = board.artRemap;
  assert.equal(map.size, 2);
  const picks = [map.get(99), map.get(150)];
  assert.ok(picks.every((v) => [3, 4, 5].includes(v)) && picks[0] !== picks[1], JSON.stringify([...map]));
  const ids = idsOf(board);
  assert.ok(ids.every((id) => [1, 2, 3, 4, 5].includes(id)), ids.join(','));
  for (const v of picks) assert.equal(ids.filter((id) => id === v).length, 3);
});

test('art remap: with no free art left, a missing id shares a type the level has (round-robin)', () => {
  const board = makeBoard(remapLevel(['1,1,1', '2,2,2', '99,99,99', '98,98,98']), { artIds: new Set([1, 2]) });
  assert.deepEqual([...board.artRemap], [[98, 1], [99, 2]], 'C# walks the missing ids in sorted order');
  assert.ok(idsOf(board).every((id) => id === 1 || id === 2));
});

test('art remap: off without artIds, and nothing to do when every id has art', () => {
  const plain = makeBoard(remapLevel(['1,1,1', '99,99,99']));
  assert.equal(plain.artRemap.size, 0);
  assert.ok(idsOf(plain).includes(99));
  const all = makeBoard(remapLevel(['1,1,1', '2,2,2']), { artIds: new Set([1, 2, 3]) });
  assert.equal(all.artRemap.size, 0);
});


// ---------- custom box targets (the editor's definition until the team's C# ships it) ----------

test('custom targets: boxes open with the listed items in order, unlocks take the next, then nothing is left', () => {
  const level = remapLevel(['1,1,1', '2,2,2', '3,3,3', '4,4,4']);
  const board = makeBoard(level, { customTargets: [3, 1, 4, 2] });
  const g = board.game, open = () => g.tanks.filter((t) => t.isUnlocked).map((t) => t.toyType);
  assert.deepEqual(open(), [3, 1], 'the two open boxes take entries 1-2');
  assert.equal(g.customTargetsUsed, 2);
  const locked = g.tanks.findIndex((t) => !t.isUnlocked);
  assert.equal(board.requestUnlock(locked).ok, true);
  assert.equal(g.tanks[locked].toyType, 4, 'an unlocked box takes the next entry');
  const other = g.tanks.findIndex((t) => !t.isUnlocked);
  assert.equal(board.requestUnlock(other).ok, true);
  assert.equal(g.tanks[other].toyType, 2);
  assert.equal(g.canOpenTank, false, 'the list is used up');
  const auto = makeBoard(level);
  assert.equal(auto.game.customTargets, null, 'no list: the game\'s auto-pick');
});

test('custom targets: a completed box asks for the next listed item', () => {
  const board = makeBoard(remapLevel(['2,2,2', '1,1,1', '3,3,3']), { customTargets: [1, 3, 2] });
  const g = board.game;
  settle(board, 8);
  const tapAll = (kind) => {
    for (const f of board.floats) {
      for (let s = 0; s < f.state.slots.length; s++) {
        if (f.state.slots[s] !== kind) continue;
        for (let k = 0; k < 400 && !board.canTap(f.id, s).ok; k++) board.step(0.05);
        assert.equal(board.tap(f.id, s).ok, true);
      }
    }
  };
  tapAll(1);
  for (let k = 0; k < 60; k++) board.step(0.05);
  assert.ok(g.tanks.some((t) => t.isUnlocked && t.toyType === 2), 'box 1 done: the next box asks for 2');
  assert.equal(g.customTargetsUsed, 3);
});
