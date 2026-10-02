'use strict';
// Tests the game block of index.html (PSPGame: the engine-free core loop of Pool Sort, ported one to one from
// the team's C# ToySort.Core) under node. The NUnit suites of Assets/_Game/ToySort/Tests/Editor are ported
// with the same test names and asserted values; helpers (Net / Shuffle), prefabs, water, cipher and the Unity
// view are not. A bot sweep plays every team level and checks the item count after every step.
// Run: node --test tools/pool-sort-level-editor/game.test.js
// Before the block is inlined: PSP_BLOCK_DIR=<folder holding game.js> node --test ...
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBlock(id) {
  let code;
  let filename;
  if (process.env.PSP_BLOCK_DIR) {
    filename = path.join(process.env.PSP_BLOCK_DIR, id + '.js');
    code = fs.readFileSync(filename, 'utf8');
  } else {
    filename = path.join(__dirname, 'index.html') + '#' + id;
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
    if (!m) throw new Error(id + ' script block not found');
    code = m[1];
  }
  // This realm, not a fresh vm context: arrays from another realm fail assert.deepStrictEqual.
  vm.runInThisContext(code, { filename });
}
loadBlock('game');
const G = globalThis.PSPGame;

// Team data is read in place, never copied into the hub repo.
function teamLevelsDir() {
  if (process.env.PSP_LEVELS) return fs.existsSync(process.env.PSP_LEVELS) ? process.env.PSP_LEVELS : null;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '01-projects'))) {
      const p = path.join(dir, '01-projects', 'pool-sort', 'fish-sort-puzzle', 'Assets', '_Game', 'ToySort', 'Editor', 'Levels');
      return fs.existsSync(p) ? p : null;
    }
    dir = path.dirname(dir);
  }
  return null;
}
const TEAM = teamLevelsDir();
const NO_TEAM = !TEAM && 'team levels folder not found (set PSP_LEVELS)';
// Two lines of level data live in the team repo, and the C# tests on each branch assert their own: gd-leveldesign
// ships levels 1-200 with toy ids 1-24 (level 1 opens with 16,16,16); dev/main has the original 1,000 (1,1,1).
const LINE = !TEAM ? null : fs.readdirSync(TEAM).filter((n) => /^LevelData_\d+\.json$/.test(n)).length === 200
  ? { name: 'gd-leveldesign', levels: 200, level1: [16, 16, 16] } : { name: 'dev/main', levels: 1000, level1: [1, 1, 1] };

const E = G.GameEventType;
const R = G.GameResult;
const M = G.FloatieMechanicType;
const f32 = Math.fround;

const types = (events) => events.map((e) => e.type);
const countOf = (list, pred) => list.filter(pred).length;
const moved = (events) => countOf(events, (e) => e.type === E.ToyToTank || e.type === E.ToyToTemp);
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, (msg ? msg + ': ' : '') + actual + ' is not within ' + tol + ' of ' + expected);
const single = (list) => { assert.equal(list.length, 1, 'expected exactly one element'); return list[0]; };
const last = (list) => list[list.length - 1];
const sortedNums = (list) => Array.from(list).sort((a, b) => a - b);

// ---------- LevelJsonTestUtil.cs ----------

const LevelJsonTestUtil = {
  _configs: null,
  _dda: null,
  get configs() {
    if (!this._configs) this._configs = G.LevelParser.parseLevelConfigs(fs.readFileSync(path.join(TEAM, 'LevelConfig.json'), 'utf8'));
    return this._configs;
  },
  /** The shipped Version B table (LevelDifficultyConfig.json). */
  get dda() {
    if (!this._dda) this._dda = G.DdaTable.parse(fs.readFileSync(path.join(TEAM, 'LevelDifficultyConfig.json'), 'utf8'));
    return this._dda;
  },
  load(levelId) {
    const entry = this.configs.find((c) => c.levelID === levelId);
    const json = fs.readFileSync(path.join(TEAM, entry.levelDataStr + '.json'), 'utf8');
    return G.LevelParser.parseLevel(entry, json);
  },
  /** Synthetic level: each array is one plain floatie (size = toy count). */
  synthetic(...floaties) {
    return new G.LevelDefinition(0, 300, floaties.map((b) => new G.FloatieDefinition(b.length, b, null)));
  },
  /** Starts the game and spawns every queued floatie (ids 1..N in order). */
  startAndSpawnAll(level) {
    const game = new G.ToySortGame(level);
    game.start();
    while (game.spawnNextFloatie() !== null) { /* spawn all */ }
    return game;
  },
};
const Synthetic = (...f) => LevelJsonTestUtil.synthetic(...f);
const StartAndSpawnAll = (level) => LevelJsonTestUtil.startAndSpawnAll(level);
const Load = (id) => LevelJsonTestUtil.load(id);

// ---------- BotHarness.cs ----------

/** collected + queued + on the water + temp + overflow must always add up to totalToy. */
function toysAccounted(game) {
  let onWater = 0;
  for (const floatie of game.activeFloaties) onWater += floatie.toyCount;
  let inTemp = 0;
  for (const toy of game.tempSlots) if (toy !== 0) inTemp++;
  return game.collectedToy + game.queuedToyCount + onWater + inTemp + game.overflow.length === game.totalToy;
}

/** No physics here: a floatie in play has already landed, so a clouded one is revealed at once. */
function revealHidden(game) {
  for (const floatie of game.activeFloaties)
    if (floatie.mechanicType === M.Hidden && floatie.mechanicCounter > 0) game.revealFloatie(floatie.id);
}

/** No positions here: every floatie in play is beside every other, so a taken toy thins every Frozen one. */
function thawFrozen(game, tapEvents) {
  let banked = 0;
  for (const change of tapEvents) if (change.type === E.ToyToTank || change.type === E.ToyToTemp) banked++;
  for (let toy = 0; toy < banked; toy++)
    for (const floatie of game.activeFloaties)
      if (floatie.mechanicType === M.Frozen && floatie.mechanicCounter > 0) game.thawFrozen(floatie.id);
}

/**
 * Physics-free simulation: keeps up to maxActiveFloaties floaties in play and lets AutoPlayBot play until the
 * level ends; unlocks a locked tank when about to fill temp; optionally revives after LostFull. Extra over
 * C#: checkEveryStep rechecks the item ledger after every action (C# checks at the end and after helpers),
 * and the run records taps, stalls (no legal move while playing) and hitting the step cap.
 */
const BotHarness = {
  run(level, opts = {}) {
    const maxActiveFloaties = opts.maxActiveFloaties == null ? 12 : opts.maxActiveFloaties;
    const maxSteps = opts.maxSteps == null ? 5000 : opts.maxSteps;
    const reviveOnFull = !!opts.reviveOnFull;
    const run = { result: null, unlocks: 0, revives: 0, ledgerBroken: false, steps: 0, taps: 0, stalled: false, capped: false };
    const game = new G.ToySortGame(level);
    game.dda = opts.dda || null; // null = Version A; B rolls seeded by level id
    game.start();
    const check = () => { if (opts.checkEveryStep && !toysAccounted(game)) run.ledgerBroken = true; };
    let step = 0;
    for (; step < maxSteps; step++) {
      if (game.result === R.Won) break;
      if (game.result === R.LostFull) {
        if (!reviveOnFull) break;
        game.reviveFull();
        run.revives++;
        check();
      }
      while (game.activeFloaties.length < maxActiveFloaties && game.spawnNextFloatie() !== null) { /* fill */ }
      revealHidden(game);
      // C# fires a random helper here when helperChance > 0; Net and Shuffle are not ported.
      if (game.result !== R.Playing) continue;
      const unlock = G.AutoPlayBot.shouldUnlock(game);
      if (unlock.ok) {
        game.unlockTank(unlock.tankIndex);
        run.unlocks++;
        check();
        continue;
      }
      const move = G.AutoPlayBot.tryChooseMove(game);
      if (!move.ok) { run.stalled = true; break; }
      thawFrozen(game, game.tap(move.floatieId, move.slot));
      run.taps++;
      check();
    }
    run.steps = step;
    run.capped = step >= maxSteps;
    if (!toysAccounted(game)) run.ledgerBroken = true;
    run.result = game.result;
    return run;
  },
  simulateLevel(level, maxActiveFloaties = 12, maxSteps = 5000, reviveOnFull = false) {
    return BotHarness.run(level, { maxActiveFloaties, maxSteps, reviveOnFull }).result;
  },
  /** Same level without PointRanges, i.e. pressure demand disabled. */
  withoutPressure(level) { return new G.LevelDefinition(level.levelId, level.timeSeconds, level.floaties); },
};

// =====================================================================================================
// Port checks (not in the C# suite)
// =====================================================================================================

describe('PortChecks', () => {
  test('SystemRandom reproduces .NET System.Random sequences', () => {
    // Expected values printed by Windows PowerShell 5.1 (.NET Framework) with New-Object System.Random <seed>.
    let r = G.SystemRandom(0);
    assert.equal(r.nextDouble(), 0.72624326996795985);
    assert.equal(r.next(), 1755192844);
    assert.equal(r.next(100), 76);
    assert.equal(r.next(-50, 50), 5);
    r = new G.SystemRandom(42);
    assert.equal(r.next(), 1434747710);
    assert.equal(r.nextDouble(), 0.14090729837348093);
    assert.equal(r.next(7), 0);
    assert.equal(r.next(-2147483648, 2147483647), -1122627736);
    assert.equal(G.SystemRandom(1).nextDouble(), 0.24866858415709278);
    r = G.SystemRandom(7);
    assert.deepEqual(Array.from({ length: 8 }, () => r.next(10)), [3, 8, 6, 0, 3, 6, 0, 9]);
    assert.equal(G.SystemRandom(123456).next(5, 1000), 269);
    const seq = (seed) => { const x = G.SystemRandom(seed); return Array.from({ length: 60 }, () => x.next()).slice(50); };
    assert.deepEqual(seq(-2147483648), [880625680, 1543454120, 1331075398, 1047903443, 418573420, 1885901857, 1772582790, 1579254100, 1843011714, 1459749886]);
    assert.deepEqual(seq(0), [880625662, 1543454120, 1331075398, 1047903413, 418573418, 1885901857, 1772582790, 1579254086, 1843011714, 1459749886]);
  });

  test('mathRandom has the same interface', () => {
    const r = G.mathRandom();
    for (let i = 0; i < 200; i++) {
      const a = r.next(10);
      const b = r.next(-3, 4);
      const d = r.nextDouble();
      assert.ok(Number.isInteger(a) && a >= 0 && a < 10);
      assert.ok(Number.isInteger(b) && b >= -3 && b < 4);
      assert.ok(d >= 0 && d < 1);
    }
  });

  test('enums are frozen name strings with C# numeric values on the side', () => {
    assert.equal(G.GameEventType.ToyToTank, 'ToyToTank');
    assert.ok(Object.isFrozen(G.GameEventType));
    assert.equal(G.EnumValues.GameEventType.KeyDelivered, 22);
    assert.equal(G.EnumValues.FloatieMechanicType.Barrier, 8);
    assert.equal(G.enumFromValue('MechanicId', 12), 'IceItem');
  });

  test('events carry every GameEvent field with -1 for unused indices', () => {
    const e = G.GameEvent.toyToTemp(3, 1, 2, 40);
    assert.deepEqual(e, { type: 'ToyToTemp', floatieId: 3, floatieSlot: 1, tankIndex: -1, tankSlot: -1, tempIndex: 2,
      tempTarget: -1, overflowIndex: -1, toyType: 40, amount: 0, sourceFloatieId: -1 });
    const k = G.GameEvent.keyDelivered(5, 9, 0);
    assert.equal(k.floatieId, 9);
    assert.equal(k.sourceFloatieId, 5);
  });

  test('JSON records map like Newtonsoft: missing keys default, names case-insensitive', () => {
    const a = new G.FloatieConfigEntry({ floatietype: 2, TOYSTR: '4,5', IsKey: true });
    assert.equal(a.floatieType, 2);
    assert.equal(a.toyStr, '4,5');
    assert.equal(a.isKey, true);
    assert.equal(a.lockCount, 0);
    assert.equal(a.iceToyStr, null);
    const row = new G.LevelConfigEntry({ LevelID: 3, PointRangeStr: '0.35,0.7', NoAdWeight: 0.35 });
    assert.equal(row.noAdWeight, f32(0.35));
    assert.equal(row.levelDifficulty, 0);
  });

  test('LevelRepository.build on parsed records equals LevelParser.parseLevel on the file text', { skip: NO_TEAM }, () => {
    const rows = JSON.parse(fs.readFileSync(path.join(TEAM, 'LevelConfig.json'), 'utf8'));
    for (const row of rows) {
      const text = fs.readFileSync(path.join(TEAM, row.LevelDataStr + '.json'), 'utf8');
      const a = G.LevelRepository.build(JSON.parse(text), row, G.ToySortRuleSet.Default);
      const b = G.LevelParser.parseLevel(G.LevelParser.parseLevelConfigs([row])[0], text);
      assert.deepEqual(a, b, 'level ' + row.LevelID);
      assert.deepEqual(G.LevelParser.parse(JSON.parse(text), row), b);
    }
  });

  test('LevelRepository.load wraps the level like WrapLevel and reads the file through the callback', { skip: NO_TEAM }, () => {
    const configs = G.LevelRepository.parseConfigs(fs.readFileSync(path.join(TEAM, 'LevelConfig.json'), 'utf8'));
    const read = (name) => fs.readFileSync(path.join(TEAM, name + '.json'), 'utf8');
    const n = configs.length; // 200 on gd-leveldesign, 1,000 on dev/main
    assert.equal(G.LevelRepository.wrapLevel(n + 1, n), 1);
    assert.equal(G.LevelRepository.wrapLevel(0, n), 1);
    assert.equal(G.LevelRepository.wrapLevel(2 * n + 50, n), 50);
    assert.equal(G.LevelRepository.wrapLevel(7, 0), 1);
    assert.equal(G.LevelRepository.load(n + 3, configs, read).levelId, 3);
    assert.equal(G.LevelRepository.getTier(3, configs), 2);
    assert.equal(G.LevelRepository.load(5, configs, () => null), null);
    const errors = [];
    assert.equal(G.LevelRepository.load(5, configs, () => '[{"ToyStr":"1,x"}]', null, (e) => errors.push(e)), null);
    assert.equal(errors.length, 1);
    assert.equal(G.LevelRepository.parseDda(fs.readFileSync(path.join(TEAM, 'LevelDifficultyConfig.json'), 'utf8')).rows.length, 60);
  });

  test('LevelMechanics names what a level holds', () => {
    const level = G.LevelParser.parseLevel({ LevelID: 1, LevelTime: 300, CountdownTargetProgress: '0.1,30' },
      '[{"FloatieType":2,"ToyStr":"1,1,1","IsFrozen":true},{"FloatieType":3,"ToyStr":"2,2,2","IceToyStr":"1,0,0"},{"FloatieType":3,"ToyStr":""}]');
    const found = G.LevelMechanics.of(level);
    assert.deepEqual(Array.from(found).sort(), ['Countdown', 'Frozen', 'IceItem', 'Obstacle', 'Portal']);
    assert.equal(G.LevelMechanics.contains(level, G.MechanicId.Frozen), true);
    assert.equal(G.LevelMechanics.contains(level, G.MechanicId.Lock), false);
  });
});

// =====================================================================================================
// ToySortGameTests.cs
// =====================================================================================================

describe('ToySortGameTests', () => {
  function LoseByFullTemp() {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4], [5, 6, 7], [5, 6, 7], [5, 6, 7]));
    game.tap(5, 0);
    game.tap(5, 1);
    game.tap(5, 2);
    game.tap(6, 0);
    const lastTap = game.tap(6, 1);
    assert.equal(last(lastTap).type, E.LostFull);
    return game;
  }

  test('Start_LocksRightTanks_AndOpensLeftTanksFromInitialWindow', () => {
    const game = new G.ToySortGame(Synthetic([1, 1, 1], [2, 2, 2]));
    const events = game.start();
    assert.deepEqual(types(events), [E.TankLocked, E.TankLocked, E.TankSpawned, E.TankSpawned]);
    assert.equal(game.tanks[0].toyType, 1);
    assert.equal(game.tanks[1].toyType, 2);
    assert.equal(game.tanks[2].isUnlocked, false);
    assert.equal(game.tanks[3].isUnlocked, false);
  });

  test('Tap_MatchingToy_GoesToTank', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2]));
    const e = single(game.tap(1, 0));
    assert.equal(e.type, E.ToyToTank);
    assert.equal(e.tankIndex, 0);
    assert.equal(e.tankSlot, 0);
    assert.equal(game.collectedToy, 1);
  });

  test('Tap_UnmatchedToy_GoesToFirstTempSlot', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2], [5, 5, 5]));
    const e = single(game.tap(3, 0));
    assert.equal(e.type, E.ToyToTemp);
    assert.equal(e.tempIndex, 0);
    assert.equal(game.tempSlots[0], 5);
  });

  test('CompletingTank_PicksLargestAvailableUndemandedType_AndAutoFliesTemp', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [1, 1, 1], [2, 2, 2], [2, 2, 2], [5, 5, 5], [5, 5, 5]));
    game.tap(5, 0);
    game.tap(5, 1);
    game.tap(1, 0);
    game.tap(1, 1);
    const events = game.tap(1, 2);
    assert.deepEqual(types(events), [E.ToyToTank, E.FloatiePopped, E.TankCompleted, E.TankSpawned, E.TempToTank, E.TempToTank]);
    assert.equal(game.tanks[0].toyType, 5);
    assert.equal(game.tanks[0].filled, 2);
    assert.ok(game.tempSlots.every((f) => f === 0));
  });

  test('TempToTank_ClosesGapsInTempRow', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]));
    game.tap(3, 0);
    game.tap(4, 0);
    game.tap(3, 1);
    assert.deepEqual(game.tempSlots, [3, 4, 3, 0, 0]);

    // Whichever of 3 or 4 the new tank asks for, pulling it out leaves a gap to close.
    const events = game.unlockTank(2);
    const shifts = events.filter((e) => e.type === E.TempShifted);
    assert.notEqual(shifts.length, 0);
    for (const shift of shifts) assert.ok(shift.tempTarget < shift.tempIndex, 'toys only ever slide left');

    const firstEmpty = game.tempSlots.indexOf(0);
    assert.ok(game.tempSlots.slice(firstEmpty).every((t) => t === 0), 'no toy after the first empty slot');
    assert.ok(firstEmpty > 0);
  });

  test('MoreFloatie_RefillsSlotFromQueue', () => {
    const level = new G.LevelDefinition(0, 60, [new G.FloatieDefinition(1, [1], [1, 1])]);
    const game = StartAndSpawnAll(level);
    assert.deepEqual(types(game.tap(1, 0)), [E.ToyToTank, E.FloatieRefilled]);
    game.tap(1, 0);
    const lastTypes = types(game.tap(1, 0));
    assert.ok(lastTypes.includes(E.FloatiePopped));
    assert.equal(last(lastTypes), E.Won);
  });

  test('CollectingAllToy_Wins_AndIgnoresFurtherTaps', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2]));
    for (let floatie = 1; floatie <= 2; floatie++)
      for (let slot = 0; slot < 3; slot++) game.tap(floatie, slot);
    assert.equal(game.result, R.Won);
    assert.equal(game.tap(1, 0).length, 0);
  });

  test('TempFull_LosesFull_ThenReviveSweepsTempIntoTray', () => {
    const game = LoseByFullTemp();
    assert.equal(game.result, R.LostFull);
    assert.equal(game.tap(7, 0).length, 0, 'No taps accepted after losing');
    const lockedBefore = countOf(game.tanks, (t) => !t.isUnlocked);
    const collectedBefore = game.collectedToy;

    const revive = game.reviveFull();
    assert.equal(countOf(revive, (e) => e.type === E.TempToOverflow), 5, 'Revive must sweep the whole temp row into the tray');
    assert.equal(countOf(revive, (e) => e.type === E.TankUnlocked), 1, 'Revive also opens one locked tank for free');
    assert.ok(!types(revive).includes(E.TempToyReturned), 'Nothing goes back to the queue');
    assert.equal(countOf(game.tanks, (t) => !t.isUnlocked), lockedBefore - 1);
    assert.equal(game.result, R.Playing);
    assert.ok(game.tempSlots.every((f) => f === 0));
    // The new tank's demand pulls its toys back out of the tray, so the tray no longer holds all 5.
    assert.equal(game.overflow.length + game.collectedToy - collectedBefore, 5);
    assert.notEqual(game.tap(7, 0).length, 0);
  });

  test('Obstacle_And_InvalidTaps_AreIgnored', () => {
    const level = new G.LevelDefinition(0, 60, [
      new G.FloatieDefinition(3, null, null, new G.FloatieMechanicData(M.Obstacle)), new G.FloatieDefinition(3, [1, 1, 1], null),
    ]);
    const game = StartAndSpawnAll(level);
    assert.equal(game.tap(1, 0).length, 0);
    assert.equal(game.tap(2, 9).length, 0);
    assert.equal(game.tap(99, 0).length, 0);
  });
});

// =====================================================================================================
// FloatieQueueTests.cs
// =====================================================================================================

describe('FloatieQueueTests', () => {
  /** Counts how many times the queue actually consulted the policy. */
  class CountingPolicy {
    constructor(index = 0) { this.calls = 0; this._index = index; }
    selectNext(queue) {
      this.calls++;
      return queue.count === 0 ? -1 : Math.min(this._index, queue.count - 1);
    }
  }
  class BrokenPolicy { selectNext() { return 999; } }
  const Defs = (...markers) => markers.map((m) => new G.FloatieDefinition(1, [m], null));

  test('PeekIsStable_AndAsksThePolicyOnlyOnce', () => {
    const policy = new CountingPolicy();
    const queue = new G.FloatieQueue(Defs(1, 2, 3), policy);
    const first = queue.peek(null);
    const second = queue.peek(null);
    assert.equal(first, second, 'repeated peeks must return the same floatie');
    assert.equal(policy.calls, 1, 'the policy must be consulted once, then cached');
  });

  test('TakeReturnsExactlyWhatPeekPromised', () => {
    const queue = new G.FloatieQueue(Defs(1, 2, 3), new CountingPolicy(2));
    const peeked = queue.peek(null);
    const taken = queue.take(null);
    assert.equal(peeked, taken, 'commit must spawn the floatie the host measured');
    assert.equal(queue.count, 2);
  });

  test('Invalidate_MakesTheNextPeekAskAgain', () => {
    const policy = new CountingPolicy();
    const queue = new G.FloatieQueue(Defs(1, 2, 3), policy);
    queue.peek(null);
    queue.invalidate();
    queue.peek(null);
    assert.equal(policy.calls, 2, 'state moved, so the policy must get a fresh say');
  });

  test('InsertFront_AddsToTheFrontAndDropsTheCachedChoice', () => {
    const policy = new CountingPolicy();
    const queue = new G.FloatieQueue(Defs(1, 2), policy);
    queue.peek(null);
    const added = new G.FloatieDefinition(1, [9], null);
    queue.insertFront(added);
    assert.equal(queue.count, 3);
    assert.equal(queue.at(0), added);
    assert.equal(queue.peek(null), added, 'a stale cached index must not survive an insert');
    assert.equal(policy.calls, 2);
  });

  test('EmptyQueue_PeekAndTakeReturnNull', () => {
    const queue = new G.FloatieQueue(Defs(), new CountingPolicy());
    assert.equal(queue.peek(null), null);
    assert.equal(queue.take(null), null);
  });

  test('OutOfRangePolicyAnswer_IsTreatedAsNothingRatherThanThrowing', () => {
    const queue = new G.FloatieQueue(Defs(1, 2), new CountingPolicy(99));
    const broken = new G.FloatieQueue(Defs(1, 2), new BrokenPolicy());
    assert.notEqual(queue.peek(null), null);
    assert.equal(broken.peek(null), null, 'a buggy policy must not crash the game');
  });
});

// =====================================================================================================
// SpawnPolicyTests.cs
// =====================================================================================================

describe('SpawnPolicyTests', () => {
  /** A policy that exists only in this test file - nothing in the core knows about it. */
  class ReverseSpawnPolicy { selectNext(queue) { return queue.count - 1; } }
  const ThreeFloaties = () => Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3]);
  function SpawnOrder(game) {
    const order = [];
    let state;
    while ((state = game.spawnNextFloatie()) !== null) order.push(state.slots.find((s) => s !== 0));
    return order;
  }

  test('DefaultPolicy_KeepsTheAuthoredOrder', () => {
    const game = new G.ToySortGame(ThreeFloaties());
    game.start();
    assert.deepEqual(SpawnOrder(game), [1, 2, 3]);
  });

  test('CustomPolicy_ChangesTheOrder_WithoutTouchingCore', () => {
    const game = new G.ToySortGame(ThreeFloaties(), null, new ReverseSpawnPolicy());
    game.start();
    assert.deepEqual(SpawnOrder(game), [3, 2, 1], 'a policy defined outside Core must be able to reorder spawning');
  });

  test('PolicyOnlyReorders_TotalToyCountIsUnchanged', () => {
    const sequential = new G.ToySortGame(ThreeFloaties());
    const reversed = new G.ToySortGame(ThreeFloaties(), null, new ReverseSpawnPolicy());
    assert.equal(reversed.totalToy, sequential.totalToy);
    sequential.start();
    reversed.start();
    const a = SpawnOrder(sequential);
    const b = SpawnOrder(reversed);
    assert.deepEqual(sortedNums(a), sortedNums(b), 'same multiset of floaties, different order');
    assert.notDeepEqual(a, b, 'but the order really did change');
  });

  test('MercyPolicy_KeepsAuthoredOrderWhileTempHasRoom', () => {
    const game = new G.ToySortGame(ThreeFloaties(), null, new G.MercySpawnPolicy());
    game.start();
    assert.deepEqual(SpawnOrder(game), [1, 2, 3]);
  });

  test('EveryPolicy_StillLetsTheBotFinishALevel', { skip: NO_TEAM }, () => {
    for (const policy of [G.SequentialSpawnPolicy.Instance, new G.MercySpawnPolicy(), new ReverseSpawnPolicy()]) {
      const game = new G.ToySortGame(Load(1), null, policy);
      game.start();
      while (game.spawnNextFloatie() !== null) { /* spawn all */ }
      let guard = 0;
      while (game.result === R.Playing && guard++ < 5000) {
        const move = G.AutoPlayBot.tryChooseMove(game);
        if (move.ok) {
          game.tap(move.floatieId, move.slot);
          continue;
        }
        const unlock = G.AutoPlayBot.shouldUnlock(game);
        if (unlock.ok) { game.unlockTank(unlock.tankIndex); continue; }
        break;
      }
      assert.notEqual(game.result, R.Playing, policy.constructor.name + ': the bot must reach a result, not get stuck');
    }
  });
});

// =====================================================================================================
// TankSelectorTests.cs
// =====================================================================================================

describe('TankSelectorTests', () => {
  const Cap = 3; // ToySortRuleSet.Default.tankCapacity
  const None = new Set();
  function Counts(...typeCountPairs) {
    const counts = new G.OrderedCounts();
    for (let i = 0; i < typeCountPairs.length; i += 2) counts.add(typeCountPairs[i], typeCountPairs[i + 1]);
    return counts;
  }
  const pick = G.TankSelector.pick;

  test('PicksLargest_FirstInsertedWinsTies', () => {
    assert.equal(pick(Counts(3, 3, 2, 3), Counts(), None, false, Cap), 3);
    assert.equal(pick(Counts(3, 3, 2, 6), Counts(), None, false, Cap), 2);
  });

  test('ExcludesDemandedTypes_UnlessNoOtherChoice', () => {
    const demanded = new Set([1]);
    assert.equal(pick(Counts(1, 9, 2, 3), Counts(), demanded, false, Cap), 2);
    assert.equal(pick(Counts(1, 3), Counts(), demanded, false, Cap), 1);
  });

  test('ReturnsZeroWhenNothingAvailable', () => {
    assert.equal(pick(Counts(), Counts(4, 3), None, true, Cap), 0);
  });

  test('Pressure_P1_PicksScarceUndemandedType', () => {
    assert.equal(pick(Counts(1, 5, 3, 1, 2, 2), Counts(), new Set([3]), true, Cap), 2);
  });

  test('Pressure_P2_PicksScarceTypeEvenIfDemanded', () => {
    assert.equal(pick(Counts(1, 5, 2, 2), Counts(), new Set([2]), true, Cap), 2);
  });

  test('Pressure_P3_PicksTypeOnlyInFuture', () => {
    assert.equal(pick(Counts(1, 3, 2, 6), Counts(1, 1, 9, 3), None, true, Cap), 9);
    assert.equal(pick(Counts(1, 3, 2, 6), Counts(1, 1, 9, 3), None, true, Cap, false), 2,
      'Without P3 (LevelTest 3/4) P4 finds no non-multiple of 3 and falls back to the normal pick');
  });

  test('Pressure_P4_PicksSmallestNonMultipleOfThree_ElseNormalPick', () => {
    assert.equal(pick(Counts(3, 3, 1, 4, 2, 5), Counts(), None, true, Cap), 1);
    assert.equal(pick(Counts(1, 3, 2, 6), Counts(), None, true, Cap), 2);
  });

  test('OrderedCounts_ConsumeReturnsShortfall_AndRemovesEmptyKeys', () => {
    const counts = Counts(5, 2, 6, 4);
    assert.equal(counts.consume(5, 3), 1);
    assert.equal(counts.contains(5), false);
    assert.equal(counts.consume(6, 3), 0);
    assert.equal(counts.get(6), 1);
  });
});

// =====================================================================================================
// PressureWindowRollTests.cs
// =====================================================================================================

describe('PressureWindowRollTests', () => {
  const Medium = [0.15, 0.25, 0.25, 0.35].map(f32);
  for (const [roll, expected] of [[0.00, 0], [0.14, 0], [0.16, 1], [0.39, 1], [0.41, 2], [0.64, 2], [0.66, 3], [0.99, 3]]) {
    test('Roll_PicksBucketByCumulativeWeight(' + roll + ', ' + expected + ')', () => {
      assert.equal(G.PressureWindowRoll.roll(Medium, 3, roll), expected);
    });
  }

  test('Roll_IsCappedByWindowCount', () => {
    assert.equal(G.PressureWindowRoll.roll(Medium, 2, 0.99), 2);
    assert.equal(G.PressureWindowRoll.roll(Medium, 0, 0.99), 0);
  });

  test('Roll_LeftoverAboveThreeWeightsLandsInBucketThree', () => {
    assert.equal(G.PressureWindowRoll.roll([0.1, 0.1, 0.1, 0].map(f32), 3, 0.5), 3);
  });

  test('Roll_NoWeights_KeepsEveryWindow', () => {
    assert.equal(G.PressureWindowRoll.roll([0, 0, 0, 0], 2, 0.0), 2);
    assert.equal(G.PressureWindowRoll.roll(null, 2, 0.0), 2);
  });

  test('Level51_ParsesRollWeights', { skip: NO_TEAM }, () => {
    assert.deepEqual(Array.from(Load(51).windowRollWeights), [0.25, 0.35, 0.4, 0].map(f32));
  });

  test('ActivePressureWindows_Zero_DisablesPressure', () => {
    const level = new G.LevelDefinition(0, 60, [new G.FloatieDefinition(3, [1, 1, 1], [])], [[0, 1]]);
    const game = new G.ToySortGame(level);
    assert.equal(game.isPressureActive, true, 'All windows are active by default');
    game.activePressureWindows = 0;
    assert.equal(game.isPressureActive, false);
    game.activePressureWindows = 99;
    assert.equal(game.activePressureWindows, 1, "Clamped to the level's window count");
  });
});

// =====================================================================================================
// DdaTableValidatorTests.cs (validator from Editor/DdaTableValidator.cs)
// =====================================================================================================

describe('DdaTableValidatorTests', () => {
  const Row = (tier, progress, temp, ...w) => new G.DdaTable.Row({
    Difficulty: tier, LevelProgress: progress, TempCount: temp,
    Order1: w[0], Order2: w[1], Order3: w[2], Order4: w[3], Order5: w[4],
  });
  /** One tier with a progress-1 row for every temp count, all weights on Easy. */
  const CompleteTier = (tier) => Array.from({ length: G.DdaTable.MaxTempCount + 1 }, (_, t) => Row(tier, 1, t, 0, 1, 0, 0, 0));

  test('ShippedTable_HasNoIssues', { skip: NO_TEAM }, () => {
    const issues = G.DdaTableValidator.validate(LevelJsonTestUtil.dda.rows);
    assert.equal(issues.length, 0, issues.map((i) => i.message).join('\n'));
  });

  test('WeightsNotSummingToOne_IsError', () => {
    const rows = CompleteTier(1);
    rows[2].order2 = f32(0.8);
    const issues = G.DdaTableValidator.validate(rows);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].isError, true);
  });

  test('MissingProgressOneRow_IsError', () => {
    const rows = CompleteTier(1);
    rows[3].levelProgress = f32(0.85);
    const issues = G.DdaTableValidator.validate(rows);
    assert.ok(issues.some((i) => i.isError && i.message.includes('temp 3')));
  });

  test('RowBehindAHigherEarlierBound_IsWarning', () => {
    const rows = CompleteTier(1);
    rows.push(Row(1, 0.4, 0, 1, 0, 0, 0, 0)); // after the progress-1 row, so never reached
    const issues = G.DdaTableValidator.validate(rows);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].isError, false);
  });
});

// =====================================================================================================
// DdaSmartHelperTests.cs
// =====================================================================================================

describe('DdaSmartHelperTests', () => {
  const Table = () => LevelJsonTestUtil.dda;

  test('Table_Has60Rows_3Tiers_4ProgressRows_5TrayStates', { skip: NO_TEAM }, () => {
    const table = Table();
    assert.equal(table.rows.length, 60);
    assert.deepEqual(sortedNums(new Set(table.rows.map((r) => r.difficulty))), [1, 2, 3]);
    assert.deepEqual(sortedNums(new Set(table.rows.map((r) => r.levelProgress))), [0.4, 0.65, 0.85, 1].map(f32));
    for (const row of table.rows) near(row.weights.reduce((a, b) => a + b, 0), 1, 1e-4, 'Order1..5 must sum to 1');
  });

  test('Find_ProgressIsAnUpperBound_TierAndTrayExact', { skip: NO_TEAM }, () => {
    const row = Table().find(1, 0.5, 2);
    assert.equal(row.levelProgress, f32(0.65));
    assert.equal(row.tempCount, 2);
    assert.deepEqual(row.weights, [0.3, 0.4, 0.2, 0.1, 0].map(f32));
    assert.equal(Table().find(1, 0.4, 0).levelProgress, f32(0.4), 'Exactly on a threshold stays in that row');
  });

  test('Find_ClampsProgressAndTray_UnknownTierIsNull', { skip: NO_TEAM }, () => {
    const late = Table().find(2, 1.5, 9);
    assert.equal(late.levelProgress, 1);
    assert.equal(late.tempCount, G.DdaTable.MaxTempCount);
    assert.equal(Table().find(2, -1, 0).levelProgress, f32(0.4));
    assert.equal(Table().find(0, 0.5, 0), null);
  });

  test('Promise_NeverTightOrHarshInTheOpening', { skip: NO_TEAM }, () => {
    for (const row of Table().rows.filter((r) => r.levelProgress <= f32(0.4)))
      assert.equal(f32(row.order4 + row.order5), 0, 'Tier ' + row.difficulty + ' tray ' + row.tempCount);
  });

  test('Promise_FullerTrayMeansMoreRescueInTheOpening', { skip: NO_TEAM }, () => {
    for (let tier = 1; tier <= 3; tier++) {
      const rescue = [0, 1, 2, 3, 4].map((t) => Table().find(tier, 0.1, t).order1);
      for (let i = 1; i < rescue.length; i++) assert.ok(rescue[i - 1] <= rescue[i], 'Tier ' + tier + ': ' + rescue.join(','));
    }
  });

  for (const [roll, expected] of [[0.05, 'Rescue'], [0.15, 'Easy'], [0.50, 'Moderate'], [0.70, 'Tight'], [0.95, 'Harsh']]) {
    test('Roll_IsCumulativeOverOrder1To5(' + roll + ', ' + expected + ')', () => {
      const row = new G.DdaTable.Row({ Order1: 0.1, Order2: 0.2, Order3: 0.3, Order4: 0.2, Order5: 0.2 });
      assert.equal(G.DdaTable.roll(row, roll), G.DemandStrategy[expected]);
    });
  }

  test('Cost_TakesCheapestToysFirst', () => {
    const cost = G.SmartDemandPicker.cost;
    assert.equal(cost(2, 5, 0, 0, 3), -2, '2 in temp + 1 reachable');
    assert.equal(cost(0, 3, 4, 0, 3), 0);
    assert.equal(cost(0, 1, 2, 0, 3), 2);
    assert.equal(cost(0, 0, 1, 5, 3), 7, '1 blocked + 2 queued');
    assert.equal(cost(0, 1, 0, 1, 3), null, 'Not enough toys for a tank');
  });

  test('Matches_UsesFreeSlotBands', () => {
    const free = 3;
    const m = G.SmartDemandPicker.matches;
    const S = G.DemandStrategy;
    assert.equal(m(S.Rescue, -1, free), true);
    assert.equal(m(S.Easy, 0, free), true);
    assert.equal(m(S.Moderate, 1, free), true);
    assert.equal(m(S.Moderate, 2, free), false);
    assert.equal(m(S.Tight, 2, free), true);
    assert.equal(m(S.Harsh, 3, free), true);
    assert.equal(m(S.Harsh, 4, free), true);
    assert.equal(m(S.Harsh, 5, free), false, 'Never above E+1');
  });

  test('Pick_FallsBackTowardEasier', () => {
    const candidates = [new G.DemandCandidate(7, 0, 3), new G.DemandCandidate(8, 1, 1)];
    assert.equal(G.SmartDemandPicker.pick(candidates, G.DemandStrategy.Harsh, 3, f32(0.9)), 8,
      'Harsh (3-4) and Tight (2) find nothing, Moderate (1) does');
  });

  test('Pick_EasyEarly_FallsToRescueNotModerate', () => {
    const onlyModerate = [new G.DemandCandidate(8, 1, 1)];
    assert.equal(G.SmartDemandPicker.pick(onlyModerate, G.DemandStrategy.Easy, 5, f32(0.3)), 0);
    assert.equal(G.SmartDemandPicker.pick(onlyModerate, G.DemandStrategy.Easy, 5, f32(0.5)), 8);
  });

  test('Pick_MostAvailableWins_FirstOnTies', () => {
    const candidates = [new G.DemandCandidate(1, 0, 3), new G.DemandCandidate(2, 0, 5), new G.DemandCandidate(3, 0, 5)];
    assert.equal(G.SmartDemandPicker.pick(candidates, G.DemandStrategy.Easy, 5, f32(0.5)), 2);
  });

  test('Game_VersionB_TurnsPressureWindowsOff', { skip: NO_TEAM }, () => {
    const level = new G.LevelDefinition(0, 60, [new G.FloatieDefinition(3, [1, 1, 1], [])], [[0, 1]], null, null, 1);
    const game = new G.ToySortGame(level);
    assert.equal(game.isPressureActive, true);
    game.dda = Table();
    assert.equal(game.isPressureActive, false);
  });

  test('Game_VersionB_RollsAStrategyWhenATankOpens', { skip: NO_TEAM }, () => {
    const level = Load(1);
    assert.equal(level.tier, 1, 'Level 1 is Easy in LevelConfig.json');
    const game = new G.ToySortGame(level);
    game.dda = Table();
    game.start();
    for (let step = 0; step < 500 && game.lastStrategy === null && game.result === R.Playing; step++) {
      while (game.spawnNextFloatie() !== null) { /* spawn all */ }
      const move = G.AutoPlayBot.tryChooseMove(game);
      if (!move.ok) break;
      game.tap(move.floatieId, move.slot);
    }
    assert.notEqual(game.lastStrategy, null, 'A tank opened after the start should go through Version B');
  });

  /** Version B must never strand a level: every level finishable with revives, toys conserved. */
  test('Bot_FinishesLevels_1To100_VersionB_UsingRevives', { skip: NO_TEAM }, (t) => {
    const failed = [];
    let winsA = 0;
    let winsB = 0;
    for (let id = 1; id <= 100; id++) {
      const level = Load(id);
      const run = BotHarness.run(level, { reviveOnFull: true, dda: Table() });
      if (run.result !== R.Won || run.ledgerBroken) failed.push(id + ':' + run.result);
      if (BotHarness.run(level).result === R.Won) winsA++;
      if (BotHarness.run(level, { dda: Table() }).result === R.Won) winsB++;
    }
    t.diagnostic('Wins without revive, levels 1..100: A=' + winsA + ' B=' + winsB);
    assert.equal(failed.length, 0, 'Version B did not finish: ' + failed.join(', '));
  });
});

// =====================================================================================================
// LevelParserTests.cs
// =====================================================================================================

describe('LevelParserTests', () => {
  const Entry = new G.LevelConfigEntry({ LevelID: 7, LevelTime: 120 });

  test('Level1_ParsesOriginalData', { skip: NO_TEAM }, () => {
    const level = Load(1);
    assert.equal(level.levelId, 1);
    assert.equal(level.timeSeconds, 300);
    assert.equal(level.floaties.length, 3);
    assert.deepEqual(level.floaties[0].visibleToy, LINE.level1, LINE.name);
  });

  test('MissingFields_UseDefaults', () => {
    const level = G.LevelParser.parseLevel(Entry, '[{"FloatieType":2,"ToyStr":"4,5"}]');
    const floatie = single(level.floaties);
    assert.equal(floatie.isObstacle, false);
    assert.deepEqual(floatie.visibleToy, [4, 5]);
    assert.equal(floatie.extraToy.length, 0);
  });

  test('IsMore_SplitsVisibleAndRefillQueue', () => {
    const level = G.LevelParser.parseLevel(Entry, '[{"FloatieType":3,"ToyStr":"1,2,3,4,5","IsMore":true}]');
    const floatie = single(level.floaties);
    assert.deepEqual(floatie.visibleToy, [1, 2, 3]);
    assert.deepEqual(floatie.extraToy, [4, 5]);
  });

  for (const json of ['[{"FloatieType":3,"ToyStr":"","IsObstacle":true}]', '[{"FloatieType":3,"ToyStr":""}]']) {
    test('Obstacles_HaveNoToy(' + json + ')', () => {
      const floatie = single(G.LevelParser.parseLevel(Entry, json).floaties);
      assert.equal(floatie.isObstacle, true);
      assert.equal(floatie.totalToy, 0);
    });
  }

  test('Obstacle2_IsBreakableStone_WithNoToy', { skip: 'Ignored in C#: Obstacle2 is switched off in LevelParser.ParseLevel until it has art' }, () => {
    const floatie = single(G.LevelParser.parseLevel(Entry, '[{"FloatieType":3,"ToyStr":"1,1,1","Obstacle2Count":4}]').floaties);
    assert.equal(floatie.isStone, true, 'Obstacle2 uses the obstacle prefab and skips the pile height gate');
    assert.equal(floatie.isObstacle, false, 'Obstacle2 breaks, so it is not the permanent stone');
    assert.equal(floatie.mechanic.type, M.Obstacle2);
    assert.equal(floatie.mechanic.counter, 4, 'Obstacle2Count is the starting durability');
    assert.equal(floatie.totalToy, 0, 'Stones hold no toy whatever ToyStr says');
  });

  test('PointRanges_ParsePairs_AndSkipMalformed', { skip: NO_TEAM }, () => {
    const ranges = G.LevelParser.parsePointRanges('0.28,0.43|0,5,90|0.58,0.8');
    assert.equal(ranges.length, 2);
    assert.deepEqual(ranges[0], { min: f32(0.28), max: f32(0.43) });
    assert.deepEqual(ranges[1], { min: f32(0.58), max: f32(0.8) });
    assert.equal(G.LevelParser.parsePointRanges('').length, 0);
    assert.equal(Load(3).pointRanges.length, 1, 'Level 3 has PointRangeStr 0.35,0.7');
  });

  test('InvalidToyToken_ThrowsWithLevelId', () => {
    assert.throws(() => G.LevelParser.parseLevel(Entry, '[{"FloatieType":2,"ToyStr":"1,x"}]'),
      (ex) => ex instanceof G.FormatException && ex.message.includes('Level 7'));
  });

  test('AllOriginalLevels_ParseWithPerTypeCountsDivisibleByThree', { skip: NO_TEAM }, () => {
    const bad = [];
    for (const entry of LevelJsonTestUtil.configs) {
      const level = Load(entry.levelID);
      const counts = new Map();
      for (const b of level.floaties) for (const f of b.visibleToy.concat(b.extraToy)) counts.set(f, (counts.get(f) || 0) + 1);
      if (Array.from(counts.values()).some((c) => c % G.ToySortRuleSet.Default.tankCapacity !== 0)) bad.push(entry.levelID);
    }
    assert.equal(LevelJsonTestUtil.configs.length, LINE.levels, LINE.name);
    assert.equal(bad.length, 0, 'Levels with per-type count not divisible by 3: ' + bad.join(','));
  });
});

// =====================================================================================================
// ToySortRuleSetTests.cs
// =====================================================================================================

describe('ToySortRuleSetTests', () => {
  test('Default_MatchesTheOriginalConstants', () => {
    const rules = G.ToySortRuleSet.Default;
    assert.equal(rules.tankCount, 4);
    assert.equal(rules.tankCapacity, 3);
    assert.equal(rules.tempCapacity, 5);
    assert.equal(rules.maxToyPerFloatie, 5);
    assert.equal(rules.initialUnlockedTanks, 2);
    assert.equal(rules.initialDemandWindow, 10);
  });

  test('CustomRules_ChangeTankAndTempCounts', () => {
    const rules = new G.ToySortRuleSet({ tankCount: 5, tempCapacity: 7, initialUnlockedTanks: 3 });
    const level = Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]);
    const game = new G.ToySortGame(level, rules);
    game.start();
    assert.equal(game.tanks.length, 5, 'tank count comes from the rule set');
    assert.equal(game.tempSlots.length, 7, 'temp capacity comes from the rule set');
    assert.equal(countOf(game.tanks, (t) => t.isUnlocked), 3, 'three tanks start unlocked');
    assert.equal(countOf(game.tanks, (t) => !t.isUnlocked), 2, 'the rest start locked');
  });

  test('TankCapacity_DrivesWhenATankCompletes', () => {
    // Capacity 2: a tank fills after two toys instead of three.
    const rules = new G.ToySortRuleSet({ tankCapacity: 2 });
    const level = Synthetic([1, 1], [2, 2]);
    const game = new G.ToySortGame(level, rules);
    game.start();
    while (game.spawnNextFloatie() !== null) { /* spawn all */ }
    assert.ok(game.tanks.every((t) => !t.isActive || t.capacity === 2), 'tanks carry the rule capacity');

    const demanded = game.tanks.find((t) => t.isActive).toyType;
    const floatie = game.activeFloaties.find((b) => b.slots.includes(demanded));
    let events = game.tap(floatie.id, floatie.slots.indexOf(demanded));
    assert.notEqual(events.length, 0);

    const floatie2 = game.activeFloaties.find((b) => b.slots.includes(demanded));
    if (floatie2 != null) {
      events = game.tap(floatie2.id, floatie2.slots.indexOf(demanded));
      assert.ok(events.some((e) => e.type === E.TankCompleted), 'two toys must complete a capacity-2 tank');
    }
  });

  test('Constructor_ClampsOutOfRangeValues', () => {
    const rules = new G.ToySortRuleSet({ tankCount: -5, tankCapacity: 0, tempCapacity: 9999 });
    assert.ok(rules.tankCount >= 1);
    assert.ok(rules.tankCapacity >= 1);
    assert.ok(rules.tempCapacity <= 12);
    assert.ok(rules.initialUnlockedTanks <= rules.tankCount);
  });
});

// =====================================================================================================
// FloatieSpawningHookTests.cs
// =====================================================================================================

describe('FloatieSpawningHookTests', () => {
  const ThreeFloaties = () => Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3]);

  test('NoHook_SpawnsWhatTheLevelAuthored', () => {
    const game = new G.ToySortGame(ThreeFloaties());
    game.start();
    assert.equal(game.spawnNextFloatie().mechanicType, M.None);
  });

  test('HookReturningNull_LeavesTheFloatieAlone', () => {
    const game = new G.ToySortGame(ThreeFloaties());
    game.floatieSpawning = () => null;
    game.start();
    assert.equal(game.spawnNextFloatie().mechanicType, M.None);
  });

  test('SwappingTheMechanic_KeepsEveryToy_AndTheWinCondition', () => {
    const level = ThreeFloaties();
    const expectedTotal = new G.ToySortGame(level).totalToy;
    const game = new G.ToySortGame(level);
    game.floatieSpawning = (d) => new G.FloatieDefinition(d.sizeType, d.visibleToy, d.extraToy,
      new G.FloatieMechanicData(M.Frozen, 2), d.toyMechanics, d.carriesKey);
    game.start();
    assert.equal(game.totalToy, expectedTotal, 'the hook must not move the win condition');
    const floatie = game.spawnNextFloatie();
    assert.equal(floatie.mechanicType, M.Frozen);
    assert.equal(floatie.mechanicCounter, 2);
    assert.equal(floatie.toyCount, 3, 'a guarded floatie still holds all of its toys');
    assert.equal(floatie.blocksTap(0), true, 'and is shut until the ice thaws');
  });

  test('DroppingToys_LeavesTotalToyStale_AndTheLevelUnwinnable', () => {
    const game = new G.ToySortGame(ThreeFloaties());
    game.floatieSpawning = (d) => new G.FloatieDefinition(d.sizeType, null, null, d.mechanic);
    game.start();
    assert.equal(game.totalToy, 9, 'TotalToy is fixed at construction, before any hook runs');
    while (game.spawnNextFloatie() !== null) { /* spawn all */ }
    assert.equal(game.activeFloaties.reduce((s, f) => s + f.toyCount, 0), 0, 'but no toy actually spawned');
    assert.notEqual(game.result, R.Won, 'so the win condition can never be reached');
  });

  test('AddingLinkedSlots_KeepsTheToyCount', () => {
    const game = new G.ToySortGame(ThreeFloaties());
    game.floatieSpawning = (d) => new G.FloatieDefinition(d.sizeType, d.visibleToy, d.extraToy, d.mechanic,
      d.visibleToy.map((_, slot) => new G.ToyMechanicData(0, slot < 2 ? 1 : 0)), d.carriesKey);
    game.start();
    const floatie = game.spawnNextFloatie();
    assert.equal(floatie.toyCount, 3);
    assert.equal(floatie.definition.toyMechanicAt(0).linkGroup, 1);
    assert.equal(floatie.definition.toyMechanicAt(1).linkGroup, 1);
    assert.equal(floatie.definition.toyMechanicAt(2).linkGroup, 0);
    assert.equal(moved(game.tap(floatie.id, 0)), 2, 'the forced link really does take both slots in one tap');
  });
});

// =====================================================================================================
// FrozenMechanicTests.cs
// =====================================================================================================

describe('FrozenMechanicTests', () => {
  const Entry = new G.LevelConfigEntry({ LevelID: 4, LevelTime: 300 });
  const Parse = (json) => G.LevelParser.parseLevel(Entry, json);
  const OneFrozen =
    '[{"FloatieType":3,"ToyStr":"7,8,9","IsFrozen":true},' +
    '{"FloatieType":3,"ToyStr":"5,5,5"},' +
    '{"FloatieType":3,"ToyStr":"6,6,6"}]';
  const Frozen = (game) => game.activeFloaties.find((f) => f.mechanicType === M.Frozen);

  test('IsFrozen_ParsesToTheMechanic_AndSealsEverySlot', () => {
    const frozen = Frozen(StartAndSpawnAll(Parse(OneFrozen)));
    assert.ok(frozen.mechanicCounter > 0, 'durability comes from the rule set');
    assert.equal(frozen.blocksAllTaps, true, 'one counter shuts the WHOLE floatie, unlike spec #12 Ice Item');
    for (let slot = 0; slot < 3; slot++) assert.equal(frozen.blocksTap(slot), true);
    assert.equal(frozen.countsAsProgress, true, 'unlike a stone, this is real level content');
  });

  test('ThawFrozen_TakesOneLayer_AndReportsIt', () => {
    const game = StartAndSpawnAll(Parse(OneFrozen));
    const frozen = Frozen(game);
    const thickness = frozen.mechanicCounter;
    const events = game.thawFrozen(frozen.id);
    assert.equal(frozen.mechanicCounter, thickness - 1, 'exactly one layer per call');
    assert.equal(countOf(events, (e) => e.type === E.MechanicChanged && e.floatieId === frozen.id && e.amount === frozen.mechanicCounter), 1,
      'the view is told, because a counter that moves in silence reads as broken');
  });

  test('ThawingRightDown_OpensTheFloatie', () => {
    const game = StartAndSpawnAll(Parse(OneFrozen));
    const frozen = Frozen(game);
    while (frozen.mechanicCounter > 0) game.thawFrozen(frozen.id);
    assert.equal(frozen.blocksAllTaps, false, 'the ice is gone');
    assert.equal(game.canTap(frozen.id, 0), true, 'and it taps like any other floatie');
  });

  test('ThawingAnOpenFloatie_DoesNothingAndSaysNothing', () => {
    const game = StartAndSpawnAll(Parse(OneFrozen));
    const frozen = Frozen(game);
    while (frozen.mechanicCounter > 0) game.thawFrozen(frozen.id);
    assert.equal(game.thawFrozen(frozen.id).length, 0, 'a spent mechanic stops talking');
    assert.equal(frozen.mechanicCounter, 0, 'must not go negative');
  });

  test('ThawFrozen_DoesNotTouchOtherMechanics', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","Lock2Count":3},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"}]');
    const game = StartAndSpawnAll(level);
    const barrier = game.activeFloaties.find((f) => f.mechanicType === M.Barrier);
    assert.equal(game.thawFrozen(barrier.id).length, 0);
    assert.equal(barrier.mechanicCounter, 3, 'a Barrier is not ice and does not thaw');
  });

  test('CompletingATank_MovesBarrier_ButNeverThawsIce', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","IsFrozen":true},' +
      '{"FloatieType":3,"ToyStr":"10,11,12","Lock2Count":3},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":3,"ToyStr":"6,6,6"}]');
    const game = StartAndSpawnAll(level);
    const frozen = Frozen(game);
    const barrier = game.activeFloaties.find((f) => f.mechanicType === M.Barrier);
    const thickness = frozen.mechanicCounter;
    const events = [];
    for (let slot = 0; slot < 3; slot++) events.push(...game.tap(3, slot));
    assert.equal(countOf(events, (e) => e.type === E.TankCompleted), 1, 'a tank really did complete, so the comparison below is meaningful');
    assert.equal(barrier.mechanicCounter, 2, 'Barrier opens on merges, and this was one');
    assert.equal(frozen.mechanicCounter, thickness, 'ice does NOT open on merges - only a tap on a touching floatie thaws it');
    assert.equal(frozen.blocksAllTaps, true, 'so it is still sealed');
  });

  test('FrozenAndIceItem_AreIndependent', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","IsFrozen":true,"IceToyStr":"2,0,0"},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"}]');
    const game = StartAndSpawnAll(level);
    const frozen = Frozen(game);
    const thickness = frozen.mechanicCounter;
    game.thawFrozen(frozen.id);
    assert.equal(frozen.mechanicCounter, thickness - 1, 'the sheet thinned');
    assert.equal(frozen.iceAt(0), 2, 'the frozen SLOT underneath is untouched');
  });
});

// =====================================================================================================
// HiddenMechanicTests.cs
// =====================================================================================================

describe('HiddenMechanicTests', () => {
  const Entry = new G.LevelConfigEntry({ LevelID: 20, LevelTime: 300 });
  const Parse = (json) => G.LevelParser.parseLevel(Entry, json);
  const OneHidden =
    '[{"FloatieType":3,"ToyStr":"1,2,3","IsUnknown":true},' +
    '{"FloatieType":3,"ToyStr":"5,5,5"}]';

  test('IsUnknown_BecomesHidden_NotUnknownItem', () => {
    const level = Parse(OneHidden);
    assert.equal(level.floaties[0].mechanic.type, M.Hidden);
    assert.equal(level.floaties[0].mechanic.counter, G.HiddenFloatieMechanic.Clouded);
    assert.equal(level.floaties[0].totalToy, 3, 'a clouded floatie still holds its toys');
    for (let slot = 0; slot < 3; slot++)
      assert.equal(level.floaties[0].toyMechanicAt(slot).isUnknown, false, 'IsUnknown is the floatie-level cloud, not the per-slot "?" toy');
  });

  test('CloudedFloatie_BlocksTap', () => {
    const game = StartAndSpawnAll(Parse(OneHidden));
    const clouded = game.activeFloaties[0];
    assert.equal(clouded.blocksTap(0), true);
    assert.equal(game.canTap(clouded.id, 0), false);
    assert.equal(game.tap(clouded.id, 0).length, 0, 'a tap on a clouded floatie must change nothing');
    assert.equal(clouded.toyCount, 3);
  });

  test('RevealFloatie_OpensIt_AndReportsTheChange', () => {
    const game = StartAndSpawnAll(Parse(OneHidden));
    const clouded = game.activeFloaties[0];
    const events = game.revealFloatie(clouded.id);
    assert.equal(countOf(events, (e) => e.type === E.MechanicChanged && e.floatieId === clouded.id && e.amount === 0), 1,
      'the view needs to be told so it can clear the cloud');
    assert.equal(clouded.blocksTap(0), false);
    assert.equal(game.canTap(clouded.id, 0), true);
  });

  test('RevealingTwice_OrRevealingNothing_IsHarmless', () => {
    const game = StartAndSpawnAll(Parse(OneHidden));
    const clouded = game.activeFloaties[0];
    assert.notEqual(game.revealFloatie(clouded.id).length, 0);
    assert.equal(game.revealFloatie(clouded.id).length, 0, 'already revealed: nothing more to say');
    assert.equal(game.revealFloatie(9999).length, 0, 'no such floatie: no events, no exception');
    const plain = last(game.activeFloaties);
    assert.equal(game.revealFloatie(plain.id).length, 0, 'a floatie with no cloud has nothing to reveal');
  });

  test('MergesAndKeys_DoNotLiftTheCloud', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"1,2,3","IsUnknown":true},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":1,"ToyStr":"4","IsKey":true}]');
    const game = StartAndSpawnAll(level);
    const clouded = game.activeFloaties[0];
    for (let slot = 0; slot < 3; slot++) game.tap(2, slot); // completes a tank of type 5
    assert.equal(clouded.blocksTap(0), true, 'a completed tank must not lift a cloud');
    game.tap(3, 0); // empties the key floatie
    assert.equal(clouded.blocksTap(0), true, 'a key opens chains, not clouds');
    assert.equal(clouded.mechanicCounter, G.HiddenFloatieMechanic.Clouded);
  });

  test('ToysInsideACloud_AreNotOfferedAsDemand', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":3,"ToyStr":"6,6,6"},' +
      '{"FloatieType":3,"ToyStr":"8,8,8"},' +
      '{"FloatieType":3,"ToyStr":"9,9,9"},' +
      '{"FloatieType":3,"ToyStr":"10,10,10"},' +
      '{"FloatieType":3,"ToyStr":"11,11,11"},' +
      '{"FloatieType":3,"ToyStr":"7,7,7","IsUnknown":true}]');
    const game = StartAndSpawnAll(level);
    assert.ok(game.activeFloaties.some((f) => f.mechanicType === M.Hidden && f.mechanicCounter > 0), 'the cloud is still up');
    for (let tank = 0; tank < game.tanks.length; tank++) if (!game.tanks[tank].isUnlocked) game.unlockTank(tank);
    for (const tank of game.tanks) assert.notEqual(tank.toyType, 7, 'type 7 is sealed inside a cloud, so a tank opened now must not demand it');
  });

  test('OnceRevealed_ItPlaysLikeAnyOtherFloatie', () => {
    const game = StartAndSpawnAll(Parse(OneHidden));
    const clouded = game.activeFloaties[0];
    game.revealFloatie(clouded.id);
    assert.equal(moved(game.tap(clouded.id, 0)), 1);
    assert.equal(clouded.toyCount, 2);
  });
});

// =====================================================================================================
// IceItemMechanicTests.cs
// =====================================================================================================

describe('IceItemMechanicTests', () => {
  const Entry = new G.LevelConfigEntry({ LevelID: 251, LevelTime: 300 });
  const Parse = (json) => G.LevelParser.parseLevel(Entry, json);
  const OneIced =
    '[{"FloatieType":3,"ToyStr":"7,8,9","IceToyStr":"2,0,0"},' +
    '{"FloatieType":3,"ToyStr":"5,5,5"},' +
    '{"FloatieType":3,"ToyStr":"6,6,6"}]';

  test('IceToyStr_ParsesPerSlot', () => {
    const floatie = Parse(OneIced).floaties[0];
    assert.equal(floatie.toyMechanicAt(0).iceCounter, 2);
    assert.equal(floatie.toyMechanicAt(1).iceCounter, 0);
    assert.equal(floatie.toyMechanicAt(2).iceCounter, 0);
  });

  test('OnlyTheIcedSlot_IsBlocked', () => {
    const floatie = StartAndSpawnAll(Parse(OneIced)).activeFloaties[0];
    assert.equal(floatie.blocksTap(0), true, 'slot 0 is iced');
    assert.equal(floatie.blocksTap(1), false, 'slot 1 is not, and must stay tappable');
    assert.equal(floatie.blocksTap(2), false);
    assert.equal(floatie.blocksAllTaps, false, 'no floatie-level mechanic here, only one cold slot');
  });

  test('TappingAnIcedSlot_DoesNothing', () => {
    const game = StartAndSpawnAll(Parse(OneIced));
    const floatie = game.activeFloaties[0];
    assert.equal(game.canTap(floatie.id, 0), false);
    assert.equal(game.tap(floatie.id, 0).length, 0);
    assert.equal(floatie.slots[0], 7, 'the toy is still in there');
    assert.equal(game.canTap(floatie.id, 1), true, 'its neighbour is unaffected');
  });

  test('EachToyBanked_ThinsTheIce_AndReportsIt', () => {
    const game = StartAndSpawnAll(Parse(OneIced));
    const iced = game.activeFloaties[0];
    const first = game.tap(2, 0); // a single toy, nowhere near filling a tank
    assert.ok(first.some((e) => e.type === E.ToyToTank), 'the toy reached a tank');
    assert.ok(!first.some((e) => e.type === E.TankCompleted), 'one toy is not a merge');
    assert.equal(iced.iceAt(0), 1, 'one toy banked, one layer');
    assert.equal(countOf(first, (e) => e.type === E.ToyMechanicChanged && e.floatieId === iced.id && e.floatieSlot === 0 && e.amount === 1), 1,
      'the view is told which SLOT changed, not just which floatie');
    assert.equal(iced.blocksTap(0), true, 'still cold');
    game.tap(2, 1); // second toy
    assert.equal(iced.iceAt(0), 0);
    assert.equal(iced.blocksTap(0), false, 'thawed, and tappable like any other toy');
  });

  test('BankingDoesNotReportSlotsThatWereNeverIced', () => {
    const game = StartAndSpawnAll(Parse(OneIced));
    const iced = game.activeFloaties[0];
    const events = game.tap(2, 0);
    assert.ok(!events.some((e) => e.type === E.ToyMechanicChanged && e.floatieId === iced.id && e.floatieSlot !== 0));
  });

  test('IceTicksPerToy_WhileBarrierTicksPerTank', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","IceToyStr":"3,0,0"},' +
      '{"FloatieType":3,"ToyStr":"10,11,12","Lock2Count":3},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":3,"ToyStr":"6,6,6"}]');
    const game = StartAndSpawnAll(level);
    const iced = game.activeFloaties.find((f) => f.hasIce);
    const barrier = game.activeFloaties.find((f) => f.mechanicType === M.Barrier);
    const events = [];
    for (let slot = 0; slot < 3; slot++) events.push(...game.tap(3, slot)); // 3 toys -> 1 tank
    assert.equal(countOf(events, (e) => e.type === E.TankCompleted), 1,
      'exactly one tank completed, so the two rates are being compared over the same event');
    assert.equal(barrier.mechanicCounter, 2, 'one tank completed, so Barrier drops by one');
    assert.equal(iced.iceAt(0), 0, 'three toys banked, so Ice drops by three');
  });

  test('AToyThatLandsInTemp_ThinsTheIceToo', () => {
    const game = StartAndSpawnAll(Parse(OneIced));
    const iced = game.activeFloaties[0];
    const events = game.tap(iced.id, 1); // type 8 is a singleton, so no tank can want it
    assert.ok(events.some((e) => e.type === E.ToyToTemp), 'it went to temp, not a tank');
    assert.equal(iced.iceAt(0), 1, 'one toy taken, one layer - wherever it landed');
    assert.equal(countOf(events, (e) => e.type === E.ToyMechanicChanged && e.floatieId === iced.id && e.floatieSlot === 0 && e.amount === 1), 1);
  });

  test('ATempToyMovingIntoATank_DoesNotThinTheIceAgain', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","IceToyStr":"3,0,0"},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":3,"ToyStr":"6,6,6"}]');
    const game = StartAndSpawnAll(level);
    const iced = game.activeFloaties.find((f) => f.hasIce);
    const events = [];
    for (const floatie of game.activeFloaties.slice()) {
      if (floatie.hasIce) continue;
      for (let slot = 0; slot < 3; slot++)
        if (game.canTap(floatie.id, slot)) events.push(...game.tap(floatie.id, slot));
    }
    const taken = moved(events);
    const ticks = countOf(events, (e) => e.type === E.ToyMechanicChanged && e.floatieId === iced.id);
    assert.equal(ticks, Math.min(taken, 3), 'one tick per toy taken off a floatie; TempToTank moves add none');
  });

  test('FloatieMechanicAndIce_AreIndependent', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"7,8,9","IceToyStr":"2,0,0","IsUnknown":true},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"}]');
    const game = StartAndSpawnAll(level);
    const floatie = game.activeFloaties[0];
    assert.equal(floatie.blocksAllTaps, true, 'the cloud shuts the whole floatie');
    assert.equal(floatie.blocksTap(1), true, 'including slots with no ice on them');
    game.revealFloatie(floatie.id);
    assert.equal(floatie.blocksAllTaps, false, 'cloud gone');
    assert.equal(floatie.blocksTap(1), false, 'the free slot opens with it');
    assert.equal(floatie.blocksTap(0), true, 'but the ice is a separate mechanic and is still there');
    assert.equal(floatie.iceAt(0), 2);
  });

  test('IceInsideAFloatie_IsNotOfferedAsDemand', () => {
    const level = Parse('[{"FloatieType":3,"ToyStr":"5,5,5"},' +
      '{"FloatieType":3,"ToyStr":"6,6,6"},' +
      '{"FloatieType":3,"ToyStr":"8,8,8"},' +
      '{"FloatieType":3,"ToyStr":"9,9,9"},' +
      '{"FloatieType":3,"ToyStr":"10,10,10"},' +
      '{"FloatieType":3,"ToyStr":"7,7,7","IceToyStr":"3,3,3"}]');
    const game = StartAndSpawnAll(level);
    for (let tank = 0; tank < game.tanks.length; tank++) if (!game.tanks[tank].isUnlocked) game.unlockTank(tank);
    for (const tank of game.tanks) assert.notEqual(tank.toyType, 7, 'every 7 is frozen, so no tank may open demanding it');
  });
});

// =====================================================================================================
// LockAndLinkedMechanicTests.cs
// =====================================================================================================

describe('LockAndLinkedMechanicTests', () => {
  const Entry = new G.LevelConfigEntry({ LevelID: 7, LevelTime: 300 });
  const Parse = (json) => G.LevelParser.parseLevel(Entry, json);
  const Record = (toys, extra = '') => '{"FloatieType":' + toys.split(',').length + ',"ToyStr":"' + toys + '"' + extra + '}';
  const LINK_OFF = 'Ignored in C#: Linked Item is switched off in LevelParser.ReadToyMechanics until levels above 200 ship';

  test('LockCount_BecomesLockMechanic_AndIsKeyBecomesCarriesKey', () => {
    const level = Parse('[' +
      '{"FloatieType":2,"ToyStr":"2,1","LockCount":1},' +
      '{"FloatieType":2,"ToyStr":"2,1","IsKey":true}]');
    assert.equal(level.floaties[0].mechanic.type, M.Lock);
    assert.equal(level.floaties[0].mechanic.counter, 1, 'LockCount is how many keys the chain needs');
    assert.equal(level.floaties[0].carriesKey, false);
    assert.equal(level.floaties[1].mechanic.type, M.None, 'a key floatie is otherwise plain');
    assert.equal(level.floaties[1].carriesKey, true);
  });

  test('LockMechanic_CarriesNoGroupId', () => {
    const level = Parse('[{"FloatieType":2,"ToyStr":"2,1","LockCount":1,"LockToyStr":"3,0"}]');
    assert.equal(level.floaties[0].mechanic.groupId, '', 'keys are a level-wide pool, not matched by id');
  });

  test('BindToyStr_FlagsTheLinkedSlots', { skip: LINK_OFF }, () => {
    const floatie = single(Parse('[' + Record('174,4,170,173', ',"BindToyStr":"1,1,0,0"') + ']').floaties);
    assert.notEqual(floatie.toyMechanicAt(0).linkGroup, 0);
    assert.equal(floatie.toyMechanicAt(1).linkGroup, floatie.toyMechanicAt(0).linkGroup);
    assert.equal(floatie.toyMechanicAt(2).linkGroup, 0);
    assert.equal(floatie.toyMechanicAt(3).linkGroup, 0);
  });

  test('ChainedFloatie_BlocksTap_UntilAKeyFloatieEmpties', () => {
    const level = Parse('[' +
      '{"FloatieType":2,"ToyStr":"2,2","LockCount":1},' +
      '{"FloatieType":1,"ToyStr":"5","IsKey":true}]');
    const game = StartAndSpawnAll(level);
    const locked = game.activeFloaties[0];
    assert.equal(locked.blocksTap(0), true, 'chained while the key has not arrived');
    assert.equal(game.tap(locked.id, 0).length, 0, 'a tap on a chained floatie does nothing at all');
    const events = game.tap(2, 0); // empties the key floatie
    assert.ok(events.some((e) => e.type === E.FloatiePopped && e.floatieId === 2));
    assert.ok(events.some((e) => e.type === E.MechanicChanged && e.floatieId === locked.id && e.amount === 0),
      'the key takes the last notch off the chain');
    assert.equal(locked.blocksTap(0), false, 'the chain is open, the floatie plays normally now');
  });

  test('EmptyingAKeyFloatie_NamesBothEndsOfTheKeyFlight_BeforeItPops', () => {
    const level = Parse('[' +
      '{"FloatieType":2,"ToyStr":"2,2","LockCount":1},' +
      '{"FloatieType":1,"ToyStr":"5","IsKey":true}]');
    const game = StartAndSpawnAll(level);
    const locked = game.activeFloaties[0];
    const events = game.tap(2, 0);
    const key = events.findIndex((e) => e.type === E.KeyDelivered);
    const popped = events.findIndex((e) => e.type === E.FloatiePopped && e.floatieId === 2);
    assert.ok(key >= 0, 'the key delivery is announced');
    assert.equal(events[key].sourceFloatieId, 2, 'flies FROM the emptied key floatie');
    assert.equal(events[key].floatieId, locked.id, 'flies TO the chain');
    assert.equal(events[key].amount, 0, "carrying the chain's counter after the key");
    assert.ok(key < popped, 'announced while the key floatie is still on the board');
  });

  test('ChainedFloatie_DoesNotOpenOnMerge', () => {
    const level = Parse('[' +
      '{"FloatieType":2,"ToyStr":"2,2","LockCount":2},' +
      '{"FloatieType":3,"ToyStr":"5,5,5"}]');
    const game = StartAndSpawnAll(level);
    const locked = game.activeFloaties[0];
    const events = [];
    for (let slot = 0; slot < 3; slot++) events.push(...game.tap(2, slot));
    assert.ok(events.some((e) => e.type === E.TankCompleted), 'a tank did complete');
    assert.equal(locked.mechanicCounter, 2, 'a merge must not take a notch off a chain');
    assert.equal(locked.blocksTap(0), true);
  });

  test('KeyCollectedBeforeTheLockSpawns_IsBanked_NotLost', () => {
    const level = Parse('[' +
      '{"FloatieType":1,"ToyStr":"5","IsKey":true},' +
      '{"FloatieType":2,"ToyStr":"2,2","LockCount":1}]');
    const game = new G.ToySortGame(level);
    game.start();
    const key = game.spawnNextFloatie();
    game.tap(key.id, 0); // key freed, no chained floatie on the board yet
    assert.equal(game.activeFloaties.length, 0);
    const locked = game.spawnNextFloatie();
    assert.equal(locked.mechanicCounter, 0, 'the banked key opened the chain on arrival');
    assert.equal(locked.blocksTap(0), false);
  });

  test('TwoNotchChain_NeedsTwoKeys', () => {
    const level = Parse('[' +
      '{"FloatieType":2,"ToyStr":"2,2","LockCount":2},' +
      '{"FloatieType":1,"ToyStr":"5","IsKey":true},' +
      '{"FloatieType":1,"ToyStr":"6","IsKey":true}]');
    const game = StartAndSpawnAll(level);
    const locked = game.activeFloaties[0];
    game.tap(2, 0);
    assert.equal(locked.mechanicCounter, 1);
    assert.equal(locked.blocksTap(0), true, 'one key is not enough for a two-notch chain');
    game.tap(3, 0);
    assert.equal(locked.mechanicCounter, 0);
    assert.equal(locked.blocksTap(0), false);
  });

  test('TappingALinkedSlot_TakesTheWholePair_InOneTap', { skip: LINK_OFF }, () => {
    const game = StartAndSpawnAll(Parse('[' + Record('7,8,9', ',"BindToyStr":"1,1,0"') + ']'));
    const floatie = single(game.activeFloaties);
    const events = game.tap(floatie.id, 0);
    assert.equal(moved(events), 2, 'one tap moves both linked toys');
    assert.equal(floatie.slots[0], 0);
    assert.equal(floatie.slots[1], 0);
    assert.equal(floatie.slots[2], 9, 'the unlinked slot stays put');
  });

  test('TappingAnUnlinkedSlot_TakesOnlyThatToy', () => {
    const game = StartAndSpawnAll(Parse('[' + Record('7,8,9', ',"BindToyStr":"1,1,0"') + ']'));
    const floatie = single(game.activeFloaties);
    const events = game.tap(floatie.id, 2);
    assert.equal(moved(events), 1);
    assert.equal(floatie.slots[0], 7, 'the linked pair is untouched');
  });

  test('LinkedPair_IsRefused_WhenOnlyOneSpotIsFree', { skip: LINK_OFF }, () => {
    const level = Parse('[' + Record('101,102,103,104') + ',' + Record('105,106', ',"BindToyStr":"1,1"') + ']');
    const game = StartAndSpawnAll(level);
    const filler = game.activeFloaties[0];
    const linked = last(game.activeFloaties);
    for (let slot = 0; slot < 4; slot++) game.tap(filler.id, slot);
    assert.equal(countOf(game.tempSlots, (t) => t === 0), 1, 'exactly one temp slot left');
    assert.equal(game.canTap(linked.id, 0), false, 'a pair needs room for both toys');
    assert.equal(game.tap(linked.id, 0).length, 0, 'and the tap must change nothing at all');
    assert.equal(linked.slots[0], 105, 'not even half the pair moved');
    assert.equal(linked.slots[1], 106);
  });

  test('LinkFlagWithNoPartner_BehavesLikeAPlainToy', () => {
    const game = StartAndSpawnAll(Parse('[' + Record('3,3,1', ',"BindToyStr":"0,0,1"') + ']'));
    const floatie = single(game.activeFloaties);
    assert.equal(game.canTap(floatie.id, 2), true);
    assert.equal(moved(game.tap(floatie.id, 2)), 1);
  });

  test('LinkedSlotWhosePartnerIsGone_TapsAlone', { skip: LINK_OFF }, () => {
    const game = StartAndSpawnAll(Parse('[' + Record('7,8,9', ',"BindToyStr":"1,0,1"') + ']'));
    const floatie = single(game.activeFloaties);
    game.tap(floatie.id, 0); // takes slots 0 and 2 together
    assert.equal(floatie.slots[2], 0);
    assert.equal(game.canTap(floatie.id, 1), true, 'the plain middle toy is unaffected');
  });

  test('UnknownToy_IsFlaggedForTheView_ButChangesNoRule', () => {
    const level = Parse('[' + Record('2,60,63', ',"UnKnowToyStr":"0,1,1"') + ']');
    const floatie = single(level.floaties);
    assert.equal(floatie.toyMechanicAt(0).isUnknown, false);
    assert.equal(floatie.toyMechanicAt(1).isUnknown, true);
    assert.equal(floatie.toyMechanicAt(2).isUnknown, true);
    const game = StartAndSpawnAll(level);
    const state = single(game.activeFloaties);
    assert.equal(game.canTap(state.id, 1), true, 'a hidden toy is taken exactly like any other');
    assert.equal(moved(game.tap(state.id, 1)), 1);
  });
});

// =====================================================================================================
// CountdownMechanicTests.cs
// =====================================================================================================

describe('CountdownMechanicTests', () => {
  const Entry = (countdown) => new G.LevelConfigEntry({ LevelID: 29, LevelTime: 300, CountdownTargetProgress: countdown });
  const Floaties =
    '[{"FloatieType":3,"ToyStr":"1,1,1"},' +
    '{"FloatieType":3,"ToyStr":"2,2,2"},' +
    '{"FloatieType":3,"ToyStr":"3,3,3"},' +
    '{"FloatieType":3,"ToyStr":"4,4,4"}]';
  const Parse = (countdown) => G.LevelParser.parseLevel(Entry(countdown), Floaties);

  test('CountdownTargetProgress_ParsesIntoMarks', () => {
    const level = Parse('0.1,30|0.3,60|0.55,90');
    assert.equal(level.countdownTargets.length, 3);
    near(level.countdownTargets[0].progress, 0.1, 1e-4);
    near(level.countdownTargets[0].seconds, 30, 1e-4);
    near(level.countdownTargets[2].progress, 0.55, 1e-4);
    near(level.countdownTargets[2].seconds, 90, 1e-4);
  });

  test('MalformedPair_IsSkipped_NotThrown', () => {
    const level = Parse('0.1,30|0.25,30|0,5,90');
    assert.equal(level.countdownTargets.length, 2, 'the three-token pair is dropped');
    near(level.countdownTargets[1].progress, 0.25, 1e-4);
  });

  test('NoCountdownField_MeansNoMarks', () => {
    assert.equal(Parse(null).countdownTargets.length, 0);
    assert.equal(Parse('').countdownTargets.length, 0);
  });

  test('WithoutMarks_NoTankEverGetsAClock', () => {
    const game = StartAndSpawnAll(Parse(''));
    assert.ok(!game.tanks.some((t) => t.isCountdown));
    assert.equal(game.tick(1000).length, 0, 'a level with no marks cannot lose to a clock');
    assert.equal(game.result, R.Playing);
  });

  test('MarksDoNotFire_OnTheTanksOpenedAtStart', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    assert.ok(!game.tanks.some((t) => t.isCountdown), 'the opening tanks are dealt before any progress exists');
  });

  test('ClockRunsOut_LosesTheLevel_WithItsOwnResult', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    game.tanks[0].startCountdown(10); // put a clock on directly: this test is about the clock
    assert.equal(game.tick(4).length, 0, 'still ticking, nothing to report');
    assert.equal(game.result, R.Playing);
    near(game.tanks[0].secondsLeft, 6, 1e-3);
    const events = game.tick(6);
    assert.equal(game.result, R.LostCountdown, 'a clock loss is NOT LostFull');
    assert.equal(countOf(events, (e) => e.type === E.LostCountdown && e.tankIndex === 0), 1);
  });

  test('CompletingATank_TakesItsClockAway', () => {
    const game = StartAndSpawnAll(Parse(''));
    const tank = game.tanks.find((t) => t.isActive);
    const type = tank.toyType;
    tank.startCountdown(5);
    const floatie = game.activeFloaties.find((f) => f.slots.includes(type));
    for (let slot = 0; slot < floatie.slots.length; slot++) if (floatie.slots[slot] === type) game.tap(floatie.id, slot);
    assert.equal(tank.isCountdown, false, 'the clock must die with the tank it was measuring');
    game.tick(1000);
    assert.notEqual(game.result, R.LostCountdown);
  });

  test('OneMarkArmsOneTank', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    let started = 0;
    for (let i = 0; i < game.tanks.length; i++)
      if (!game.tanks[i].isUnlocked) started += countOf(game.unlockTank(i), (e) => e.type === E.TankCountdownStarted);
    assert.ok(started <= 1, 'a single mark cannot arm two tanks');
  });

  test('TickIsIgnored_OnceTheLevelIsOver', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    game.tanks[0].startCountdown(1);
    game.tick(5);
    assert.equal(game.result, R.LostCountdown);
    assert.equal(game.tick(5).length, 0, 'a finished level does not keep losing');
  });

  test('ZeroOrNegativeDelta_DoesNothing', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    game.tanks[0].startCountdown(5);
    game.tick(0);
    game.tick(-10);
    near(game.tanks[0].secondsLeft, 5, 1e-3);
  });

  test('ReviveCountdown_ClearsEveryClock_AndLeavesTempAlone', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    game.tanks[0].startCountdown(1);
    game.tanks[1].startCountdown(50);
    game.tick(2);
    assert.equal(game.result, R.LostCountdown);
    const tempBefore = countOf(game.tempSlots, (t) => t !== 0);
    game.reviveCountdown();
    assert.equal(game.result, R.Playing);
    assert.ok(!game.tanks.some((t) => t.isCountdown), 'a second chance that dies to the next clock is not a second chance');
    assert.equal(countOf(game.tempSlots, (t) => t !== 0), tempBefore, 'temp is untouched');
  });

  test('ReviveCountdown_DoesNothing_AfterAnyOtherResult', () => {
    const game = StartAndSpawnAll(Parse('0,30'));
    assert.equal(game.reviveCountdown().length, 0, 'nothing to revive from while still playing');
    assert.equal(game.result, R.Playing);
  });

  test('Level29_CarriesTheMarksTheOriginalShipped', { skip: NO_TEAM }, () => {
    const level = Load(29);
    assert.equal(level.countdownTargets.length, 3, 'level 29 ships "0.1,30|0.3,60|0.55,90"');
    near(level.countdownTargets[0].seconds, 30, 1e-3);
    near(level.countdownTargets[2].seconds, 90, 1e-3);
  });

  test('Level1_HasNoCountdown', { skip: NO_TEAM }, () => {
    assert.equal(Load(1).countdownTargets.length, 0);
  });
});

// =====================================================================================================
// FloatieMechanicTests.cs
// =====================================================================================================

describe('FloatieMechanicTests', () => {
  const Def = (toys, type = M.None, counter = 0) =>
    new G.FloatieDefinition(toys == null ? 3 : toys.length, toys, null, new G.FloatieMechanicData(type, counter));
  const State = (def) => new G.FloatieState(1, def);

  test('Obstacle_BlocksTap_NeverPops_AndStaysOutOfProgress', () => {
    const stone = State(Def(null, M.Obstacle));
    assert.equal(stone.blocksTap(0), true);
    assert.equal(stone.isEmpty, false, 'a stone holds no toy but must never pop');
    assert.equal(stone.countsAsProgress, false);
  });

  test('Obstacle2_BreaksOnlyAfterItsCounterRunsOut', () => {
    const stone = State(Def(null, M.Obstacle2, 3));
    const events = [];
    assert.equal(stone.blocksTap(0), true);
    assert.equal(stone.isEmpty, false, 'still solid at 3');
    stone.onMerge(events);
    stone.onMerge(events);
    assert.equal(stone.isEmpty, false, 'still solid at 1');
    assert.equal(stone.mechanicCounter, 1);
    stone.onMerge(events);
    assert.equal(stone.mechanicCounter, 0);
    assert.equal(stone.isEmpty, true, 'chipped away, so it may now pop');
    assert.equal(stone.countsAsProgress, false, 'a stone is never level content');
    assert.equal(countOf(events, (e) => e.type === E.MechanicChanged), 3);
  });

  test('Obstacle2_CounterStopsAtZero_AndStopsEmittingEvents', () => {
    const stone = State(Def(null, M.Obstacle2, 1));
    const events = [];
    stone.onMerge(events);
    stone.onMerge(events);
    stone.onMerge(events);
    assert.equal(stone.mechanicCounter, 0, 'must not go negative');
    assert.equal(events.length, 1, 'a spent mechanic stops talking');
  });

  test('Countdown_BlocksTapUntilSpent_ThenBehavesNormally(Barrier)', () => {
    const floatie = State(Def([1, 1, 1], M.Barrier, 2));
    const events = [];
    assert.equal(floatie.blocksTap(0), true, 'locked at 2');
    floatie.onMerge(events);
    assert.equal(floatie.blocksTap(0), true, 'still locked at 1');
    floatie.onMerge(events);
    assert.equal(floatie.mechanicCounter, 0);
    assert.equal(floatie.blocksTap(0), false, 'open once the counter is spent');
    assert.equal(floatie.countsAsProgress, true, 'unlike a stone, this is real level content');
  });

  test('Frozen_DurabilityComesFromTheRuleSet_NotTheLevelFile', () => {
    const json = '[{"FloatieType":3,"ToyStr":"1,1,1","IsFrozen":true}]';
    const entry = new G.LevelConfigEntry({ LevelID: 1 });
    const soft = G.LevelParser.parseLevel(entry, json, new G.ToySortRuleSet({ frozenMergeRequire: 1 }));
    const tough = G.LevelParser.parseLevel(entry, json, new G.ToySortRuleSet({ frozenMergeRequire: 7 }));
    assert.equal(soft.floaties[0].mechanic.type, M.Frozen);
    assert.equal(soft.floaties[0].mechanic.counter, 1);
    assert.equal(tough.floaties[0].mechanic.counter, 7);
  });

  /** A mechanic that lives only in this test file. The core has never heard of it. */
  class AlwaysOpenMechanic {
    get type() { return M.Lock; }
    blocksTap() { return false; }
    canPop() { return true; }
    get countsAsProgress() { return true; }
    onMerge() { }
    tryConsumeKey() { return false; }
  }

  test('SwappingTheRegistry_ChangesBehaviour_WithoutTouchingCore', () => {
    const def = Def([1, 1, 1], M.Lock, 5);
    const withDefault = new G.FloatieState(1, def);
    assert.equal(withDefault.blocksTap(0), true, 'the shipped Lock mechanic keeps a chained floatie shut');
    const custom = new G.MechanicRegistry(new AlwaysOpenMechanic());
    const withCustom = new G.FloatieState(1, def, custom);
    assert.equal(withCustom.blocksTap(0), false, "the caller's strategy wins over the shipped one");
    assert.equal(withCustom.mechanicType, M.Lock);
  });

  test('UnknownMechanicType_FallsBackToPlainFloatie', () => {
    const registry = new G.MechanicRegistry(G.NoFloatieMechanic.Instance);
    const floatie = new G.FloatieState(1, Def([1], M.Obstacle2, 3), registry);
    assert.equal(floatie.blocksTap(0), false, 'missing strategy degrades to permissive, never throws');
  });
});

// =====================================================================================================
// ConvexHullTests.cs
// =====================================================================================================

describe('ConvexHullTests', () => {
  const P = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

  test('Square_DropsInteriorAndCollinearPoints_CounterClockwise', () => {
    const hull = G.ConvexHull.compute([[0, 0], [2, 0], [1, 0], [2, 2], [0, 2], [1, 1], [0, 1]]);
    assert.deepEqual(hull, P([0, 0], [2, 0], [2, 2], [0, 2]));
  });

  test('DuplicatePoints_AreRemoved', () => {
    const hull = G.ConvexHull.compute([[0, 0], [0, 0], [4, 0], [0, 3], [4, 0]]);
    assert.deepEqual(hull, P([0, 0], [4, 0], [0, 3]));
  });

  test('AllCollinear_ReturnsEndpointsOnly', () => {
    const hull = G.ConvexHull.compute([[2, 2], [0, 0], [3, 3], [1, 1]]);
    assert.deepEqual(hull, P([0, 0], [3, 3]));
  });

  test('FewerThanThreePoints_ReturnedSorted', () => {
    assert.deepEqual(G.ConvexHull.compute([[1, 0], [0, 0]]), P([0, 0], [1, 0]));
    assert.equal(G.ConvexHull.compute([]).length, 0);
  });
});

// =====================================================================================================
// ToySortUnlockTests.cs (UnlockTank is in the Resolution partial; the bot needs it)
// =====================================================================================================

describe('ToySortUnlockTests', () => {
  test('UnlockTank_PicksDemandType_AndAutoFliesMatchingTemp', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2], [3, 3, 3]));
    game.tap(3, 0);
    game.tap(3, 1);
    const events = game.unlockTank(2);
    assert.deepEqual(types(events), [E.TankUnlocked, E.TankSpawned, E.TempToTank, E.TempToTank]);
    assert.equal(game.tanks[2].toyType, 3);
    assert.equal(game.unlockTank(2).length, 0, 'Already unlocked');
    assert.equal(game.unlockTank(0).length, 0, 'Initially open tank');
  });

  test('UnlockTank_Ignored_WhenNothingLeftToDemand', () => {
    const game = StartAndSpawnAll(Synthetic([1, 1, 1], [2, 2, 2]));
    assert.equal(game.canOpenTank, false, 'All remaining toys are reserved by the two open tanks');
    assert.equal(game.unlockTank(2).length, 0);
    assert.equal(game.tanks[2].isUnlocked, false);
  });

  test('InitialDemand_OnlyCountsFirstTenQueuedFloaties', () => {
    const ones = [1, 1, 1];
    const nines = [9, 9, 9];
    const floaties = Array(10).fill(ones).concat(Array(20).fill(nines));
    const game = new G.ToySortGame(Synthetic(...floaties));
    game.start();
    assert.equal(game.tanks[0].toyType, 1);
    assert.equal(game.tanks[1].toyType, 1, 'Type 9 is outside the 10-floatie window, so tank 1 repeats type 1');
  });

  for (const [hideLastFloaties, expectedType] of [[false, 4], [true, 1]]) {
    test('Demand_TreatsHiddenToysAsFuture(' + hideLastFloaties + ', ' + expectedType + ')', () => {
      const game = StartAndSpawnAll(Synthetic([1, 1, 1], [1, 1, 1], [2, 2, 2], [2, 2, 2], [4, 4, 4], [4, 4, 4]));
      if (hideLastFloaties) game.isSlotVisible = (floatieId) => floatieId < 5;
      for (let slot = 0; slot < 3; slot++) game.tap(1, slot);
      assert.equal(game.tanks[0].toyType, expectedType);
    });
  }

  for (const [helpUsed, expectedType] of [[false, 3], [true, 1]]) {
    test('Pressure_PicksScarceType_UntilHelpUsedInWindow(' + helpUsed + ', ' + expectedType + ')', () => {
      const level = new G.LevelDefinition(0, 60, [
        new G.FloatieDefinition(3, [1, 1, 1], null), new G.FloatieDefinition(3, [1, 1, 1], null),
        new G.FloatieDefinition(3, [2, 2, 2], null), new G.FloatieDefinition(3, [2, 2, 2], null),
        new G.FloatieDefinition(3, [3, 3, 5], null), new G.FloatieDefinition(3, [5, 5, 3], null),
      ], [[0, 1]]);
      const game = StartAndSpawnAll(level);
      game.isSlotVisible = (floatieId) => floatieId !== 6;
      assert.equal(game.isPressureActive, true);
      if (helpUsed) game.registerHelpUsed();
      for (let slot = 0; slot < 3; slot++) game.tap(1, slot);
      assert.equal(game.tanks[0].toyType, expectedType);
    });
  }
});

// =====================================================================================================
// AutoPlayBotLevelTests.cs + the item-count sweep over every team level
// =====================================================================================================

describe('AutoPlayBotLevelTests', () => {
  /** Explicit in C# (a report, not a gate): its doc says level 158 is the one level that does not finish. */
  test('Bot_FinishesLevels_1To200_WithPressure_UsingRevives', { skip: NO_TEAM }, (t) => {
    const failed = [];
    for (let id = 1; id <= 200; id++) {
      const run = BotHarness.run(Load(id), { reviveOnFull: true });
      if (run.result !== R.Won) failed.push(id + ':' + run.result);
    }
    t.diagnostic('Unfinished in 1..200 (' + failed.length + '): ' + failed.join(', '));
  });

  /** Solvability: 2 open tanks + ad unlocks, original demand order, no pressure windows. */
  test('Bot_WinsLevels_1To100_WithoutPressure', { skip: NO_TEAM }, () => {
    const failed = [];
    for (let id = 1; id <= 100; id++) {
      const run = BotHarness.run(BotHarness.withoutPressure(Load(id)));
      if (run.result !== R.Won) failed.push(id + ':' + run.result);
    }
    assert.equal(failed.length, 0, 'Bot did not win: ' + failed.join(', '));
  });

  /** Pressure windows pick hard types until help is used, so some levels need a revive; all must finish. */
  test('Bot_FinishesLevels_1To100_WithPressure_UsingRevives', { skip: NO_TEAM }, (t) => {
    const failed = [];
    const needRevive = [];
    for (let id = 1; id <= 100; id++) {
      const run = BotHarness.run(Load(id), { reviveOnFull: true });
      if (run.result !== R.Won) failed.push(id + ':' + run.result);
      else if (run.revives > 0) needRevive.push(id + '(r' + run.revives + ',u' + run.unlocks + ')');
    }
    t.diagnostic('Levels needing revives with pressure: ' + needRevive.length + '/100: ' + needRevive.join(' '));
    assert.equal(failed.length, 0, 'Bot could not finish even with revives: ' + failed.join(', '));
  });

  test('Bot_WinsLevels_1To100_WhileFiringHelpersAtRandom', { skip: 'helpers Net and Shuffle are not ported (the playtest has no boosters)' }, () => { });

  /** Explicit in C#: win-rate report for every level, without revive. */
  test('Bot_WinRateReport_AllLevels', { skip: NO_TEAM }, (t) => {
    for (const pressure of [false, true]) {
      let won = 0;
      const failed = [];
      for (const entry of LevelJsonTestUtil.configs) {
        const level = Load(entry.levelID);
        const run = BotHarness.run(pressure ? level : BotHarness.withoutPressure(level));
        if (run.result === R.Won) won++;
        else failed.push(entry.levelID);
      }
      t.diagnostic('pressure=' + pressure + ': won ' + won + '/' + LevelJsonTestUtil.configs.length +
        ' without revive; first failures: ' + failed.slice(0, 40).join(','));
    }
  });

  /**
   * The playtest's own gate: every team level under the Default rules, the sequential policy and no top mask
   * (isSlotVisible null), item count conserved after every step, and every run ends well inside the step cap.
   */
  test('Bot sweep: every team level ends and conserves the item count after every step', { skip: NO_TEAM }, (t) => {
    const files = fs.readdirSync(TEAM).filter((f) => /^LevelData_\d+\.json$/.test(f));
    const rows = new Map(LevelJsonTestUtil.configs.map((c) => [c.levelDataStr + '.json', c]));
    for (const variant of [
      { name: 'pressure on, no revive', opts: {} },
      { name: 'pressure on, revives', opts: { reviveOnFull: true } },
      { name: 'no pressure, no revive', opts: {}, flat: true },
    ]) {
      const tally = { Won: 0, LostFull: 0, LostCountdown: 0, Playing: 0 };
      const stalled = [];
      const broken = [];
      let taps = 0;
      const t0 = Date.now();
      for (const file of files) {
        const row = rows.get(file);
        assert.ok(row, file + ' has no LevelConfig.json row');
        const level = G.LevelRepository.build(JSON.parse(fs.readFileSync(path.join(TEAM, file), 'utf8')), row);
        const run = BotHarness.run(variant.flat ? BotHarness.withoutPressure(level) : level, Object.assign({ checkEveryStep: true }, variant.opts));
        tally[run.result]++;
        taps += run.taps;
        if (run.ledgerBroken) broken.push(row.levelID);
        if (run.stalled && run.result === R.Playing) stalled.push(row.levelID);
        assert.equal(run.capped, false, 'level ' + row.levelID + ' hit the step cap');
      }
      t.diagnostic(variant.name + ': ' + files.length + ' levels, won ' + tally.Won + ', lost (queue full) ' + tally.LostFull +
        ', stalled (no legal move) ' + stalled.length + (stalled.length ? ' [' + stalled.join(',') + ']' : '') +
        ', taps ' + taps + ', ' + (Date.now() - t0) + ' ms');
      assert.equal(broken.length, 0, 'item count not conserved on levels ' + broken.join(','));
      assert.equal(tally.Won + tally.LostFull + stalled.length, files.length, 'every run ends');
    }
  });
});
