# Valley Smash level editor — art pipeline

The level editor is a single self-contained `index.html`. Open it by
double-clicking, or from the hub site
(`https://thangtd-hm.github.io/hmldtool/tools/valley-smash-level-editor/`); nothing to install.

> **Moved again 2026-09-28.** The tool now lives in the HM Level Design Tools hub
> (`hmldtool` repo, `tools/valley-smash-level-editor/`), and every future update
> happens here. The page was renamed from `index.html` to `index.html` so
> the folder is the URL. Set the Unity exporter's art output folder to this
> folder's `art/` once per machine (**Tools ▸ Level Editor ▸ Set Art Output Folder…**).
> The brain's `01-projects/valley-smash/level-editor/` no longer exists. This folder also holds the pipeline that
feeds it **real art from the Unity project** so the block palette and the 2D/3D
views look like the game instead of like coloured boxes.

> **Moved 2026-09-23.** This tool used to sit inside the Unity project at
> `block-shot-2/tools/level-editor/`. It now lives in the brain at
> `01-projects/valley-smash/level-editor/`, because it is personal tooling and
> the team repo should not carry it — nor the 34 MB of art it bakes.
>
> Only the exporter stays in Unity (`Assets/_BaseCode/Editor/LevelEditorArtExporter.cs`).
> Point it here once with **Tools ▸ Level Editor ▸ Set Art Output Folder…** and
> pick this folder's `art/`. The choice is stored per machine in `EditorPrefs`,
> so the team repo never holds anyone's personal path, and a teammate who clones
> the project still gets the in-project default. **Do this on each machine.**
>
> `art/` is ignored by the brain's git as well: it is 34 MB of output that the
> exporter regenerates. The baked `index.html` is tracked, so the tool
> works after a fresh clone even before the first export.

## Saving a level back over the file you opened

Load with **📂 Nạp file** or **📁 Nạp thư mục** and the **⬇️ Tải về** button
becomes **💾 Lưu đè**: it writes straight back to that file, in its own folder.
No download, no copying into `levels/prod-13/` by hand. Browsing a folder with
◀ ▶ retargets the button at whichever level is on screen.

This uses the File System Access API, which works on a `file://` page in
Chrome and Edge. The browser asks once for write permission on the file or
folder you picked — there is no way to write silently, and there shouldn't be.

Everything still falls back cleanly:

- **Firefox and Safari** have no such API, so both buttons keep using the old
  `<input type="file">` and the button stays **⬇️ Tải về**.
- **Shift+click** forces a plain download even when saving in place is possible.
- Loading through the old file input, or pasting JSON, clears the handle — so
  the button can never write one level's contents over a different file.

## Refresh the art after an art change

```bash
# 0. Once per machine:  Unity ▸ Tools ▸ Level Editor ▸ Set Art Output Folder…
#    and pick this folder's  art/
# 1. In Unity:  Tools ▸ Level Editor ▸ Export Art
# 2. Then, from this folder:
python inline_art.py
```

The Export Art log prints the full path it wrote to and the exact `inline_art.py`
command for step 2, so you can copy it straight out of the Unity console.

**Run step 1 from the open editor, never headless.** A batch-mode run
(`Unity.exe -batchmode -executeMethod LevelEditorArtExporter.ExportArt`) finishes
without errors but draws some palette icons before their shader or textures are
ready. On 2026-09-24 two headless runs gave ids 1, 2, 12 and 130 a magenta, pink,
green or untextured 3/4 icon, a different set each run, while their
front/top/side views were fine. The same export clicked in the editor was clean.
Every export, clicked or not, also rewrites `humanDescription.globalScale` in
~28 `.fbx.meta` files of the Unity repo when it toggles mesh readability. That is
importer churn, not a real change: `git checkout` those files afterwards.

`inline_art.py` drops ids 220–237 from the Ocean Block Shoot (`obs`) art. The
exporter bakes Valley Smash's table under both game keys, and since 2026-09-24
Valley Smash uses those ids for jar shades, while in OBS 220/221 are the new wood
and 230 the Nuclear bomb.

Add `--no-textures --no-meshes` if you only want the 2D palette/canvas art and
a smaller file (~1.6 MB instead of ~7.9 MB) — the 3D view then falls back to
primitives.

Step 1 renders every block id through URP with its real prefab, its real
material (MK Toon / Toony Colors Pro) and the game's own light, and writes
`art/`. Step 2 embeds that into `index.html`. The HTML stays a single
file — only the region between `<!--ART:BEGIN-->` and `<!--ART:END-->` is
rewritten, so you can still hand-edit everything else.

## Files

| File | What it does |
|---|---|
| `index.html` | The tool. Single file, self-contained. |
| `art/` | Baked output: `icons/`, `meshes/`, `textures/`, `manifest.json`. |
| `inline_art.py` | Embeds `art/` into the HTML. Idempotent. |
| `extract_registry.py` | Reads the Unity `.asset`/`.prefab`/`.meta` YAML directly and writes `art/registry.json` (id → prefab → mesh → material → albedo). No Unity needed. |
| `provisional_bake.py` | Draws stand-in icons with Pillow so the tool works before anyone opens Unity. Marked `provisional: true`. |
| `block-shot-2/Assets/_BaseCode/Editor/LevelEditorArtExporter.cs` (in the brain's Valley Smash project) | The real exporter (the Unity menu item). |

## Current state: real Unity art

`art/manifest.json` has `"provisional": false` — everything is generated from
the real prefabs, materials and lighting. Last export: **2026-09-24 18:27**, from
the open editor on block-shot-2 `gd-leveldesign` (after `877180980`, which added
238 Jar yellow). 81 Valley Smash ids and 65 Ocean Block Shoot ids carry:

| | |
|---|---|
| 4 rendered views each | 3/4 for the palette, Front/Top/Side for the 2D canvas |
| 93 meshes | real geometry for the 3D view, size variants and the 11 table pieces included |
| 130 textures | albedo up to 512 px, plus TCP2 matcaps and masks, re-encoded to WebP |
| per-id shading data | MK Toon cel constants, or the full TCP2 set (ramp, matcap, rim, specular, reflection) |
| the table | `Raft.prefab` pieces with a linear matrix per piece (see the upgrades table above) |

The finished single-file tool is **~7.8 MB**:

| Part | Size |
|---|---|
| size-variant sprites (q75) | 3.1 MB |
| textures (512 px + matcaps) | 2.3 MB |
| meshes (packed) | 0.6 MB |
| 1-cell sprites + palette icons | 0.7 MB |
| tool code | 0.5 MB |

That is down from 9.8 MB before the upgrades, with sharper textures and the table added.
The hub repo has no size guard; GitHub's limit is 100 MB per file.

**Measured fidelity (2026-09-24).** Rendered through the editor's shaders and framed
like Unity's 96 px front icon, the 12 TCP2 blocks tested (cans 1/3, jars 11, 12, 14,
220, 225, 226, 231, 232, 237, 238) differ from Unity by a mean 7.5 RGB levels, against
44.1 with the old MK Toon path. Brightness is within about 2 levels on every one.
The MK Toon family (stone 21, wood 41, ice 61) is unchanged at 26–41 levels, and draws
20–45 luminance darker than Unity. That path is the next thing to rebuild from its
shader source.

**The outline gotcha (fixed, keep in mind if you change the bake framing).**
Materials on the MK Toon *Outline* shader carry `_OutlineSize: 200`. At
gameplay camera distance that reads as a thin rim, but inside the bake's
1.24-unit frame the extruded hull swelled into a solid block of colour behind
the object — it ruined 35 of 59 sprites on the first pass. The exporter now
sets `DISABLE_OUTLINE`, which turns off just the `MKToonOutline` pass on a
throwaway material clone; the project's own materials are never touched.

## Scene view upgrades of 2026-09-24

Cross-checked against the Ocean Block Shoot editor (`level_editor_v3_art.html`), which
taught the mesh packing and the live sprites. Everything here is in the scene view
only; the tool UI is unchanged.

| | What | Where |
|---|---|---|
| Two shading families | The game uses two toon shaders. **MK Toon** (stone 21/22, wood 41/42, ice 61/62) keeps the old cel path. **Toony Colors Pro 2 Hybrid** (cans 1/2/3 and every jar) now has its own path, copied term by term from `TCP2 Hybrid 2 Include.cginc`: ramp between `_SColor` and `_HColor`, masked matcap, ambient, light-masked rim, GGX specular in its gamma form, fresnel reflection. Jars use `_MatCapType 1`: the matcap *replaces* the albedo wherever `Jar_Mark` is white, which is what makes the body glossy while the label keeps its texture. Before, all 24 TCP2 ids were drawn with default MK Toon numbers and no matcap. | exporter `Tcp2Json` · editor `tcp2Material` |
| Real table | The flat blue deck is replaced by the game's snow sled table (`Raft.prefab`, 11 pieces of `Table_Snow.fbx`). The exporter calls the game's own `Raft.ApplyDimension` and `SnowDecor.OnSetupRaft` at five table sizes and records each piece's matrix as a linear function of `dim`. The editor rebuilds any size exactly. A fifth size checks the model stays linear, and the Unity log warns if a code change breaks that. The deck stays as an invisible click target. The current table glows faint blue. The table sits at the blocks' own origin: `SpawnTable` puts the raft at `table.pos − (0,1,0)`, but `Raft.SpawnObject` parents every block to the raft, so blocks and table share one frame. (The first version lowered the table by 1 and blocks floated one cell above it. A steep camera hid the gap; the game-camera view showed it.) | exporter `BakeTable` · editor `tableArt` |
| Sharper textures | Albedo textures export at up to 512 px instead of 256. Labels stay readable when zoomed in 3D. | exporter `TEX_MAX` |
| Anisotropic filtering | Uses the GPU maximum (usually 16) instead of a fixed 4. | editor `ART_ANISO` |
| Packed meshes | Positions int16 in each mesh's bounding box, normals int8, UVs uint16, indices delta + zigzag, each array zlib'd, then unpacked in the browser with `DecompressionStream`. 3.1 MB of JSON became about 0.6 MB. Largest position error 0.00004 units. Unity's own normals are kept, not recomputed, so hard edges stay hard. | `inline_art.py pack_mesh` · editor `unpack` |
| Lighter variant sprites | The front/top/side sprites of 2- to 5-long blocks are WebP q75 (`--var-quality`); palette icons and 1-cell sprites stay q88. | `inline_art.py` |
| Rotated blocks in 2D | A rotated block used to fall back to flat vector shapes. It is now rendered live from its real mesh with the same shaders as the 3D view, framed by its true rotated bounding box, cached per rotation. Needs three.js from the CDN, like the 3D view. | editor `rotSprite` |

**Known mirror in the baked side sprites (pre-existing, harmless so far).** The canvas's
side view puts +Z to the right, but the exporter's side camera looks along +X, which puts
−Z to the right. Every baked side sprite is therefore a mirror image. Blocks are
left-right symmetric seen from the side, so nothing shows, but an asymmetric block
would. The live rotated sprites follow the canvas axes. The fix, if ever needed, is
`dir = new Vector3(1, 0, 0)` for "side" in `RenderView`.

## Sprite scale — why 1.24 matters

The ortho bake frames `2 × orthoHalf = 1.24` world units while a block is 1
unit, so the object covers ~80% of its sprite. The 2D canvas multiplies the
destination rect by that factor and centres it, otherwise neighbouring blocks
show a gap instead of stacking flush. `orthoHalf` travels in the manifest, so
changing it in the exporter automatically corrects the canvas.

## How the tool degrades

Everything is optional. `window.ART` missing, an id missing from it, or an
image failing to decode all fall back to the original flat-colour primitives.
Concretely:

- ids not in `ObjectDataTest.asset` (e.g. **230 Nuclear bomb**, still unregistered
  in Unity) keep drawing the old way;
- the 2D canvas only uses sprites when `front`/`top`/`side` exist (Unity bake
  only — `provisional_bake.py` produces just the 3/4 `iso` view, in which case
  2D keeps its vector drawing);
- sprites decode lazily: the first frame after switching view may draw the
  vector fallback, then repaint once the image is ready;
- rotated blocks always use vector drawing, because an orthographic sprite
  can't represent an arbitrary rotation.

## Two data bugs this surfaced in `ObjectDataTest.asset`

Both are real and worth a look — the exporter works around them, matching what
the game does (`GetObjectData` returns the **first** id match):

1. **`id: 1` appears twice.** The first is `HopCa_Cylinder` (the can). The last
   is `Plank`, and the game can never reach it. A plank also looks misplaced in
   `objectDataList` — there is a separate `nonTargetObjectDataList` for planks.
2. **`id: -1` appears twice** (`Go_Box`, `Go_Cylinder`). Negative ids are
   unreachable; the same prefabs are registered properly as 41/42.

The exporter skips duplicates and negative ids and logs each one it skipped.

## Where the numbers came from

| Setting | Value | Source |
|---|---|---|
| Directional light | white, intensity 1, euler (20.71, −16.12, 19.79), soft shadow 0.5 | `Assets/_BaseCode/Prefab/_SceneRoot.prefab` |
| Ambient | gradient — sky `#363a42`, equator `#1d2022`, ground `#0c0b09` | `Assets/_BaseCode/Scene/Game.unity` RenderSettings |
| Camera | perspective, FOV **30**, near 0.3, far 1000 | `Main Camera-3D.prefab` |
| Colour space | Gamma | `ProjectSettings/ProjectSettings.asset` |
| Cel shading | `_LightBands 4`, `_LightBandsScale 0.56`, `_Contrast 1.72` | MK Toon materials |

The tool's 3D view used FOV 48 and an invented light at (8, 20, 12) before
this; both now follow the table above.

## The 3D view (phase 2)

When the manifest carries a per-id `mesh` / `tex` / `shade`, the 3D preview
stops using box/cylinder/cone primitives and renders the **real mesh with the
real albedo texture**, shaded by a small cel `ShaderMaterial` that reproduces
MK Toon's banding:

```
ndl   = dot(N, L) * 0.5 + 0.5
band  = floor(ndl * _LightBands) / (_LightBands - 1)
band  = (band - 0.5) * _LightBandsScale + 0.5
rgb   = albedo * tint, contrast-stretched, * (band * lightColour + ambient)
```

Light direction, colour, the ambient gradient and the cel constants all come
from the manifest, so they stay in step with the Unity project.

### Getting the lighting right — two traps

**The world is mirrored.** The scene lives inside a group with `scale.z = -1`, so
three.js "world space" is a mirror of Unity's. Any light direction taken from
Unity euler angles **must have its Z negated** before use. The scene's
`DirectionalLight` did this; the cel shader originally did not, so it lit the
back of every block and left camera-facing surfaces in shadow — the whole view
came out roughly half as bright. `celLightWorld()` now derives from
`manifest.light.dir`, which the exporter already writes Z-negated.

**Measure against the icons, not by eye.** The baked icons *are* Unity's
renderer, so they are ground truth. Mean luminance of lit surfaces:

| | lit surfaces |
|---|---|
| before the light fix | 128 |
| after the light fix | 161 |
| after adding specular/rim | 167 |
| Unity's own icon | 210 |

The residual gap is mostly that a stacked tower has far more shadowed faces
than a single object framed for an icon.

### Three more things worth knowing:

- **Coordinate space.** Meshes are exported in raw Unity coordinates. The tool
  already wraps the scene in a group with `scale.z = -1` (so you view from the
  cannon's side), and *that* is what converts left-handed to right-handed.
  Negating Z at export too would cancel out and render every object inside-out.
  The manifest records `"coordinateSpace": "unity"`; an older export without it
  is detected and converted at load, so both work.
- **No inverted-hull outline.** A hull outline is exactly what blew up during
  the icon bake, so the 3D view doesn't add one.
- **No wireframe edges on real meshes either.** The editor's edge overlay is
  built from the box/cylinder primitive; drawn over a real mesh it becomes a
  wrong-shaped cage. It is skipped whenever a real mesh is used.
- **Asset names are not unique; the manifest must not key on them.** The project
  has three different `Jar_Blue_BaseColor.png` (Reskin, Theme Canival, OBS2),
  three `Jar_Red_BaseColor.png`, two `Rock_Square_1x3x`, and more. Keying the
  manifest on `asset.name` made distinct assets overwrite each other's `.png`
  and collide as JSON keys. `UniqueName()` now appends 6 guid characters on a
  clash.
- **An id's representative texture comes from its override material, not from
  scanning renderers.** The game does `objectData.GetMaterial(materialAxis)` and
  applies it to the renderers, so that material's albedo *defines* the id's
  colour. The old renderer scan once returned the model's built-in material
  instead — id 12 (Hũ đỏ, `Jar_Red_mat`) was recorded as `Jar_Blue_BaseColor`,
  so the 3D view painted the red jar with the blue jar's texture while its
  baked 2D icon was correctly red. The exporter now also logs a `LỆCH ẢNH` line
  whenever the recorded texture disagrees with the override material.
- **Both tool profiles read `ObjectDataTest.asset`.** It is the only config
  `GameModuleConfig.asset` points at, so it is what the game actually runs, and
  this repo is Valley Smash. `ObjectDataTestCarnival.asset` is referenced by
  nothing — an unfinished reskin. Feeding it to the `vs` profile (the original
  wiring) gave id 1 a red-zigzag carnival can, because the carnival prefab
  disables `BS_FishCan-Cylinder_1y` and enables `OBS_can_1x1` instead. Give the
  carnival theme its own game key if it ever ships; don't reuse `vs`.
- **Prefabs can contain disabled variants.** `HopCa_Cylinder_Carnival` holds
  three models and disables two (`m_IsActive: 0`). The exporter must not
  force-enable children, and must take the mesh *and* the texture from the same
  dominant enabled renderer — otherwise it records the geometry of one variant
  and the texture of another.
- **Long blocks get their own baked art.** A 3-long can is not a 1×1 can
  stretched, nor three cans joined: `prefab3y` points at
  `BS_FishCan-Cylinder_3y.fbx`, a dedicated model with the *same vertex count*
  as the 1×1 (all five sizes are ~48 KB) and the UVs re-laid so the label stays
  round. The exporter bakes every assigned variant — mesh plus `front`/`top`/
  `side` — under `icons[game][id].var["3y"]`, and the tool looks it up by
  `varKey(o)`.

  The cost is far lower than the slot count suggests. `2x`, `2y` and `2z` all
  reference **one** FBX and differ only by a rotation baked into the prefab, so
  504 variant slots resolve to 63 distinct models. The exporter's
  `(prefab|material)` cache collapses the repeats, and `inline_art.py` pools
  images by encoded content, so identical renders cost nothing twice.

  Two details that are easy to get wrong:
  - The **render frame grows with the block**, but the 0.12-unit margin stays
    fixed per side. Scaling the margin too would make long blocks look smaller
    than short ones once drawn into the grid.
  - The mesh in the FBX always runs along **+Y** (every file is named `…_Ny`);
    the prefab supplies the rotation. Cylinders get it for free because `oc`
    already carries `visQuat`, but **boxes** need `bakedQuat` applied to the
    mesh, since their group quaternion is only the data rotation.

  `artTiles()` — repeating the 1×1 N times — survives only as the fallback for
  a block whose variant has not been baked, and for `foot`/`fsc` blocks whose
  mesh is already bigger than one cell.

Anything missing — no mesh for an id, a texture still decoding — falls back to
the old primitive for that object only.

## Note on `art/textures/`

Gitignored: it is regenerated by every Unity export and adds ~3.7 MB. `meshes/`
*is* committed (72 files, ~3 MB of JSON) since the 3D view
depends on it.
