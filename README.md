# HM Level Design Tools

Browser-based level design tools for HM Games projects, in one place. The entry page lists every tool; each tool is
a self-contained page in `tools/<id>/` that opens from the site or from disk.

## Layout

| Path | What |
|---|---|
| `index.html` | the entry page, generated from `tools.json` by `build.js` (do not edit by hand) |
| `tools.json` | the catalogue: `id`, `name`, `game`, `status` (`live` or `planned`), `summary`, `since`, `source` |
| `tools/<id>/index.html` | one tool per folder |
| `build.js`, `build.test.js` | the entry-page builder and its tests |
| `.nojekyll` | tells GitHub Pages to serve the files as they are |

## Add a tool

1. Put the page in `tools/<id>/index.html`.
2. Add an entry to `tools.json` with `"status": "live"`.
3. `node build.js`, open `index.html`, check the card.
4. Commit the folder, `tools.json` and `index.html` together.

`build.js` renders with the report design system of the owner's workspace brain. It finds the brain by walking up
from this folder; when the repo is cloned elsewhere, set `HM_BRAIN` to the brain folder. Tests:
`node --test build.test.js`.

## Publish

GitHub → repository Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
The site is then `https://<owner>.github.io/hm-leveldesign-tool/`.
