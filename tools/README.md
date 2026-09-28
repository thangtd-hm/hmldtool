# tools/

One folder per tool. The page is `tools/<id>/index.html`, self-contained: inline CSS and JS, CDN libraries pinned
by version, extra files only inside the folder. The `<id>` is the entry's `id` in `../tools.json`.

After adding or changing a tool: update `tools.json`, run `node build.js` at the root, commit the folder, the
catalogue and `index.html` together.
