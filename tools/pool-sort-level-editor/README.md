# Pool Sort level editor

Edit Pool Sort levels as the game draws them. Every float has its real body at its size, items sit on the
prefab's slots, and each mechanic shows the game's own overlay. The cards sit on the game's pool floor: its static background layer
(`BG_gachthang`), one copy scaled to cover the area as `FitBackground` does, without the water's ripples or caustics. Every field of `LevelData_N.json` and the
level's row in `LevelConfig.json` can be edited on screen. The page is a single self-contained `index.html`:
open it by double-clicking, or from the hub site
(`https://thangtd-hm.github.io/hmldtool/tools/pool-sort-level-editor/`). Nothing to install. The UI is in
Vietnamese.

Design and plan: the brain's `01-projects/hm-leveldesign-tool/docs/2026-10-01-pool-sort-level-editor-design.md`
and `…-plan.md`.

## Use

1. **📂 Nạp thư mục** (open folder) and pick the team project's levels folder:
   `fish-sort-puzzle/Assets/_Game/ToySort/Editor/Levels`. The editor reads `LevelConfig.json` and lists every
   `LevelData_N.json`. **👀 Xem thử level mẫu** opens a made-up level with every float size and mechanic. The 📋 next to the
   path copies it, ready to paste into the folder picker's name box from the folder that holds `fish-sort-puzzle`.
   - The page remembers the last folder in the browser (IndexedDB; Chrome and Edge only). Next time the start screen
     shows **📂 Mở lại: Levels** (reopen), which opens it in one press with save-in-place. Chrome may show one Allow
     prompt per visit. **📂 Chọn thư mục khác** (choose another folder) picks a different one, for example another
     branch's checkout; the picker starts in the last folder. A folder that has moved is forgotten with a message.
2. Two modes, toggled in the toolbar and remembered:
   - **🖱 Chọn** (select, key V; the first mode on a new browser): a click on a float, an item or a Portal refill item
     only selects it. The right panel then shows the float's raw record (every field, in file order) and the item's
     data: picture, id, slot or refill number, that slot's raw value in each per-slot list, how many of that item the
     level holds, and on which floats (click one to jump to it).
   - **🖌 Vẽ** (draw, key B): a click on a slot paints the brush item, or applies the chosen stamp.
   Picking an item or a stamp in the palette switches to draw. Right-click a slot to pick up its item as the brush,
   in either mode.
3. Click a float to edit it in the inspector: its size, its mechanic (one choice, as in the data), counters, and
   the Mask target. Click a slot to edit its slot mechanics: Frozen Item, Mystery Item, Linked Item, Caged Item and
   Key Item. The inspector edits in both modes.
4. Stamps in the palette apply a mechanic with one click per float or slot. Esc goes back to painting.
5. Drag cards to reorder floats. Keys: Delete removes a float, Ctrl+D duplicates it, 1–5 resize it. Ctrl+Z / Ctrl+Y
   undo and redo, Ctrl+S saves, PageUp / PageDown change level.
6. The level panel edits the `LevelConfig.json` row:
   - tier (Normal, Hard, Super Hard skulls);
   - time (stored but not used by the game);
   - pressure windows and Countdown marks, both drawn on one level-progress bar (drag them, or type exact numbers);
   - the odds of 0–3 windows being active.
7. The bottom strip counts every item kind (red when a count is not a multiple of 3), keys against locks, and
   each mechanic. It can also replace one item kind with another, or swap two. A and B are picked from grids of
   item pictures with their ids: A from the kinds in the level (with counts), B from every id with art.
   Both also rewrite the box targets (item 8), so a valid list stays valid.
8. **Hộp đòi đồ chơi** (box targets, top of the level panel) chooses which item each box asks for, in place of the
   game's auto-pick (`UseCustomTarget`, `CustomTargetStr`):
   - Switch it on, and the list fills itself with a valid order: each kind is listed when its third item has dropped.
   - Each chip is one box, in the order boxes open. Chips 1–2 (blue number) are the two boxes open from the start;
     every box opened later (after a box is done, or when one is unlocked) takes the next chip.
   - Click a chip to change its item from a grid of the level's kinds (each shows listed / needed boxes). Drag a
     chip to reorder it, × removes it, ＋ adds one at the end. **↺ Tự điền** (auto-fill) restores a valid order,
     and the `CustomTargetStr` field edits the raw list.
   - The tally under the chips shows, per kind, the boxes listed against the boxes needed (items ÷ 3). Red means
     wrong, and saving stays blocked until every kind is right.
   - **▶ Kiểm tra chơi được** (playable check) lets the game's bot play this order on Playtest's engine, first
     without unlocking boxes, then unlocking when stuck. It says whether the bot wins, needs unlocks, or loses. The
     bot is greedy rather than perfect, so a loss means "probably stuck", not proof.

## Playtest ("▶ Chơi thử", key P)

Plays a copy of the open level, unsaved edits included, with the game's rules, spawn and physics. Closing it (✕
or Esc) leaves the editor untouched. It opens only when the level passes the blocking checks.

- **Same rules:** the game's engine-free core (`Scripts/Core/**`) ported one to one to JS (`<script id="game">`,
  `window.PSPGame`). It covers boxes and their demand, the queue, every float and item mechanic the game runs, the
  pressure windows, Countdown, and the DDA table. The level is read by the ported `LevelParser`, as the game reads
  the JSON.
- **Same pool and spawn:** `ToySortBoard` and `FloatieSpawner` ported (`<script id="board">`, `window.PSPBoard`) on
  planck.js 1.5.0 (Box2D, MIT, inlined as `<script id="planck">`). Values come from the current prefabs:
  - walls ±5.5, floor −9.2, refill gate 7.03, spawn 9.03, top mask 4.22;
  - floats are circles free to rotate with a lowered centre of mass: mass 1, no damping, friction 0.01, bounce 0.2;
  - the opening pile falls in rows with the soft landing, then refills alternate x ±2 with the game's seeded jitter.
- **Board facts as in the game:**
  - a Frozen float thaws from taps on floats touching it (the game's circle-cast rule);
  - a Hidden float clears once it rests on the floor or a stone;
  - items behind the top mask are not counted as seen and cannot be tapped;
  - Countdown clocks run in real time.
- **Difficulty switch** (remote `PSP_LevelDifficult`):
  - 0 rolls how many windows are on from the level's odds;
  - 4 turns every window on;
  - 5 uses the DDA table. It needs `LevelDifficultyConfig.json`, which the editor reads when you open the Levels
    folder; otherwise the option is greyed out.
- **On screen:** the game's own scene, in its camera frame (10.8 × 22.8 units, a 9:19 phone), so you can check
  colours. Layers, back to front, placed as in `ToySortBoardView.prefab`:
  - the pool tiles, scaled to the camera as `FitBackground` does;
  - the floats;
  - the tiles again over the floats above the shelf line;
  - the soft top bands and the yellow shelf;
  - the 4 boxes (the locked art when locked), each with its bubble showing the item it wants and the count;
  - the 5 queue slots and the "Items x/y" counter.

  Beside it: a progress bar with the windows and Countdown marks, the stats, and a win or lose banner with the
  reason. A refused tap shakes the float
  and says why. R restarts.
- **Level selector:** ◀ / ▶, a level number box, or PageUp / PageDown play another level without closing.
  - The level open in the editor plays with its unsaved edits; any other level is read from the opened folder, with
    its LevelConfig row.
  - The editor itself stays on its level.
  - A level with blocking errors, or not in the folder, is refused with the reason.
  - After a win, the banner offers the next level.
- **Box unlock:** press a locked box ("Mở khoá") to open it at once; the game asks for a rewarded ad or coins first.
  As in the game (`ToySortBoard.RequestUnlock` → `ToySortGame.UnlockTank`):
  - it counts as help used, so pressure stops in the window the level is in;
  - the new box picks a demand, and matching items fly in from the queue;
  - it is refused when no item kind is left to demand (the game's "not enough targets").
  The stats and the end banner count the unlocks.
- **Box targets:** a level with custom box targets plays them: every box that opens asks for the next listed item,
  and the panel shows how many boxes have opened. The team's game does not have this yet, so this behaviour is the
  editor's own reading of the owner's rule (2026-10-07).
- **Known gaps:**
  - no boosters, revive or tutorial; box unlock is free;
  - ids without art are swapped as the game does (`ToyArtRemapper.Apply`: a random unused id with art), and the
    panel lists the swaps; the game's per-entry art shuffle is off, so the art you placed stays recognisable;
  - planck.js and Unity's Box2D differ slightly, so float positions do not match the game frame for frame;
  - the tap timing gates (a box still collecting, a queue slot still seating) are a model of the game's animation
    times;
  - the water's moving light (caustics, ripple refraction and glints) is not drawn. The water shader keeps the
    tiles' colours (its tint is white), so the colours on screen are the game's.

## Saving

- **💾 Lưu đè** writes `LevelData_N.json` back into the folder. `LevelConfig.json` is written only when the row
  changed. This uses the File System Access API (Chrome, Edge), and the browser asks once for write permission.
  Shift+click, or a browser without the API, downloads the files instead. Single-file opens and the demo
  always download.
- **Saved bytes match the team's files exactly.** Two-space JSON, CRLF line ends, no BOM, no final newline. Each
  record keeps its own keys in their order, and a field it did not have is added only when set. Saving an
  unedited level gives a byte-identical file, and an edit changes only the lines it touched. `LevelConfig.json`
  keeps `300.0`-style floats on `LevelTime` and the four weights.
- **＋ Mới** (new) creates a level, and **⧉ Nhân bản** (duplicate) copies one to a new number. Each also gets a
  `LevelConfig` row; the file is created on save, and Unity adds the `.meta` on import. To rename or delete a
  level, use Unity or Explorer.
- `FloatieID` is renumbered 1…n after a reorder. The game never reads it.
- **Two file forms.** The list form (a bare array of floats, every level before 2026-10) and the object form
  `{ "UseCustomTarget": …, "CustomTargetStr": "…", "Floaties": [ … ] }`, which carries custom box targets. A level
  keeps the form it was read in, with its own key order. A list-form level is written in the object form only when
  box targets are switched on; switched off again before saving, it is written unchanged. **The game's
  `LevelParser` (dev/main `e6e9c7e1e`) still reads only the list form**, so object-form files need the team's
  updated parser before they can ship. The checks warn about this on every object-form level.

## Checks ("Soát lỗi")

These block saving:

- an item kind whose count is not a multiple of 3;
- an invalid item id;
- keys that don't equal locks;
- items beyond the slots without Portal (`IsMore`), or Portal without refill items;
- a float with fewer items than slots;
- a per-slot list longer than the float;
- a float size above 5;
- an empty level;
- with box targets on: an entry that is not an id, an empty list, an item the level does not hold, a kind listed
  more or fewer times than its items ÷ 3, or a list length other than all items ÷ 3.

These warn but still save:

- a float with two mechanics (only the first acts in the game);
- a stone holding items;
- mechanics the game does not run yet: Obstacle2 floats are dropped, Linked Item is switched off, and Mask, Caged
  Item and Key Item are not built;
- item ids without art;
- window odds that don't add up to 1;
- window or Countdown values out of range, or malformed pairs;
- float size 0;
- the object file form, which today's game cannot read yet.

No shipped level has an error, on either line of level data. `dev/main` (checked at `d6f5067f8`) has 1,000 levels;
`gd-leveldesign` has 200 levels that use only ids 1–24. The warnings that matter, on both lines: level 12's odds add
up to 0.9, and level 136's Countdown has a malformed pair (`0,5,90`).

## Item ids and art

Ids 1–79 have art (`Resources/ToySort/Toy/toy_N.png`; 1–24 until the team's "+ New toys" on 2026-10-02, 1–71 until
"+ New items 6/10"); the data
uses ids up to 403. The editor draws other ids as numbered chips. In play, the game first swaps every id without
art for a **random** id with art that the level does not use yet; when none is left, it shares a type the level
already has. It then **shuffles the art on every level entry** (`ToySortBoard.Build` → `ToyArtRemapper.Apply` /
`Shuffle`). An id says which items belong together, never which picture a player sees.

## Refresh the art

```bash
python bake_art.py            # needs Pillow; reads ../../../../pool-sort/fish-sort-puzzle by walking up to the brain
python bake_art.py --check    # print the manifest, write nothing
python bake_art.py --repo <path to fish-sort-puzzle>
# bake a newer commit without touching the team folder: export it, then label the bake with it
git -C <fish-sort-puzzle> archive origin/dev/main Assets/_Game/ToySort Assets/_BaseCode/Image/_FSP Assets/Material | tar -x -C <dir>
python bake_art.py --repo <dir> --commit <sha>
```

`bake_art.py` reads the Unity YAML and sprites straight from disk (no Unity) and rewrites only the region between
`<!--ART:BEGIN-->` and `<!--ART:END-->` in `index.html`. It takes:

- **Floats**: from `Prefabs/Floatie_1…5.prefab`, the body sprite and scale, slot positions and collider radius;
  stones from `Floatie_Obstacle.prefab`, sized by `ToySortLayout.ObstacleScales`.
- **Overlays**: through `Configs/MechanicVisualCatalog.asset` → each overlay prefab's `Skin` sprite, position and
  scale. The page scales each overlay by `radius / FloatieArtRadius`, as `FloatieMechanicOverlay.Spawn` does.
- **Items**: `toy_N.png`, drawn at native size × `floatieToy.Scale` from `ToySortBoardView.prefab` (0.92). The
  0.675 on `Toy.prefab` sits on the root transform, which `FloatieView` overwrites with that toy scale, so it is
  not applied.
- **UI art**: the box, clock and tier skulls from `_BaseCode/Image/_FSP/`.
- **Scene** (`ART.scene`, for Playtest), from `ToySortBoardView.prefab`, `Tank.prefab` and `Slot.prefab`:
  - the camera frame from `ToySortLayout` (`BaseOrthoSize`, `DesignAspect`);
  - the background tiles with the `FitBackground` scale;
  - the `TopCoverMask` edge, the `TopMask` bands, the `Table` shelf, the lane ropes and the items counter;
  - the `Tank_0…3` positions with each box's dock slots, bubble (`InfoFrame`) and countdown badge;
  - the queue slot positions and art.

Every sprite renderer involved uses simple draw mode, so an image's world size is its pixels ÷ 100
(`spritePixelsToUnits`). Last bake: team commit `dbb0183b9` (`dev/main`, 2026-10-07, 79 items), 104 images, about 1 MB.

The page also works without art (`window.ART = null`): floats and items fall back to plain circles and numbered
chips.

## Tests

```bash
node --test tools/pool-sort-level-editor/editor.test.js   # 36: the editor core
node --test tools/pool-sort-level-editor/game.test.js     # 159 (+6 skipped, as in C#): the Playtest core
node --test tools/pool-sort-level-editor/board.test.js    # 30: the Playtest pool
```

Each test file loads its script blocks out of `index.html`.

- **`editor.test.js`** covers:
  - parse and serialize, with a byte-exact round trip of every team level and the config, read in place from the
    brain;
  - every edit, with a one-line diff on a real level;
  - every check, with no errors on any team level;
  - the level-row helpers, the demo level and the baked manifest.
- **`game.test.js`** holds the team's NUnit tests for the core, ported with the same names and values:
  - the game, queue, spawn policy, box selector, window roll, DDA, parser, rule set and spawning hook;
  - the Frozen, Hidden, Ice Item, Lock and Linked, and Countdown mechanics;
  - the bot tests.

  It also has a bot sweep over every team level that checks the item count after every step.
- **`board.test.js`** covers:
  - the opening pile settling inside the pool;
  - the refill gate and drop columns;
  - Hidden reveal and Frozen thaw driven by physics;
  - refusals;
  - box unlock (opening, the "not enough targets" refusal, pressure stopping in the current window);
  - the item art remap (random unused id with art, the shared-type fallback);
  - greedy play to a result;
  - difficulty 4 and 5.

No team data is copied into this repo; set `PSP_LEVELS` to the levels folder when the brain path differs.

The browser state is exposed as `window.pspState` for console debugging.
