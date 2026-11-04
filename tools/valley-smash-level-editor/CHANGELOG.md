# Valley Smash level editor changelog

Versions are vX.Y.Z, one bump per push, written by `python release.py` in this folder and tagged
`valley-smash-level-editor-vX.Y.Z`. Only commits that touch this folder count. The rules are the workspace brain's, read
on this tool:

- **X, major:** a complete overhaul, set by hand (`--major "<why>"`).
- **Y, feature:** a commit adds a tool, panel, mode or block group.
- **Z, fix:** a commit changes what exists: blocks in a group, shortcuts, styling, wording, bug fixes.
- A commit line `Tool-Change: major|feature|fix|none` overrides the guess; without one, a subject that starts with "add"
  or "new" is a feature and anything else a fix.
- Entries are written from commit subjects and may be edited by hand; a release only adds a new entry on top. After an
  edit, put the text back into the page: `python release.py embed`.
- The start pop-up of `index.html` shows the Vietnamese copy, `CHANGELOG-vi.md`, embedded in the page, in a scrollable box.
  A commit line `Vi: <text>` is its entry there; without one the entry stays English.

Versions up to v1.5.1 were backfilled on 2026-11-04 from the commits, one per day. Earlier history is in the brain's git.

## v1.6.1 · 2026-11-04

### Fixes

- Changelog box in Vietnamese `84218fd`

## v1.6.0 · 2026-11-04

### Features

- Add changelog and versioning, shown in the start pop-up `5429d7b`

### Fixes

- Ctrl/Cmd+A selects all blocks; a board press releases the typed field `7a80f45`

## v1.5.1 · 2026-11-04

### Fixes

- Creative/Experiment group with every block of the table `8a30e9f`
- Trim the Creative/Experiment group to 12 blocks `ab8eef5`

## v1.5.0 · 2026-11-03

### Features

- Creative group with Shark Box (id 260) `7236142`

## v1.4.0 · 2026-10-28

### Features

- TNT (id 130) in a new "Khối đặc biệt (Special Block)" group `1f224a6`
- Color blocks 250-259 with real render; TNT faces the cannon `ccf2cc0`

## v1.3.0 · 2026-10-22

### Features

- Royal Smash levels as a second game `08677e8`

### Fixes

- Remember a picked Royal Smash art pack in the browser `910c0cb`
- Remove Royal Smash mode (revert 910c0cb and 08677e8) `e2f98e6`

## v1.2.0 · 2026-10-19

### Features

- Start pop-up to reopen the last folder, as the Pool Sort editor `6e24527`

### Fixes

- Remove Ocean Block Shoot, Valley Smash is the only block set `8b6baa8`

## v1.1.0 · 2026-10-09

### Features

- Reopen the last folder in one click, as the Pool Sort editor `371cd9b`

## v1.0.0 · 2026-09-28

### Overhaul

- Level editor moves in from the brain (page, art pipeline, README) `a9eb07c`
