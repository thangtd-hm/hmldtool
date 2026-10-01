#!/usr/bin/env node
'use strict';
// Renders index.html (the entry page) from tools.json with the brain's report design system.
// Run from anywhere: node build.js. The brain is found by walking up from this folder, or from HM_BRAIN.
const fs = require('node:fs');
const path = require('node:path');

const STATUS = { live: 'OK', planned: 'PENDING' }; // catalogue status -> report-ds chip flag

function findBrain(start) {
  if (process.env.HM_BRAIN) return process.env.HM_BRAIN;
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, '05-tools', 'lib', 'report-ds', 'index.js'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function loadDs(start) {
  const brain = findBrain(start);
  if (!brain) throw new Error('report-ds not found: run inside the workspace brain or set HM_BRAIN=<brain folder>');
  return require(path.join(brain, '05-tools', 'lib', 'report-ds'));
}

function validate(cat, repoDir) {
  const errors = [];
  if (!Array.isArray(cat.tools)) errors.push('tools.json: "tools" must be an array');
  const seen = new Set();
  for (const t of cat.tools || []) {
    for (const k of ['id', 'name', 'game', 'status', 'summary']) if (!t[k]) errors.push(`tool ${t.id || '?'}: missing "${k}"`);
    if (t.id && !/^[a-z0-9-]+$/.test(t.id)) errors.push(`tool ${t.id}: id must be kebab-case`);
    if (t.id && seen.has(t.id)) errors.push(`tool ${t.id}: duplicate id`);
    seen.add(t.id);
    if (t.status && !STATUS[t.status]) errors.push(`tool ${t.id}: status must be one of ${Object.keys(STATUS).join(', ')}`);
    if (t.status === 'live' && repoDir && !fs.existsSync(path.join(repoDir, 'tools', t.id, 'index.html'))) {
      errors.push(`tool ${t.id}: status live but tools/${t.id}/index.html is missing`);
    }
  }
  // games: { "<game>": { icon: "icons/<slug>.webp", source } }; a game without an entry gets no icon
  for (const [game, g] of Object.entries(cat.games || {})) {
    if (!g || !g.icon) { errors.push(`game ${game}: missing "icon"`); continue; }
    if (repoDir && !fs.existsSync(path.join(repoDir, g.icon))) errors.push(`game ${game}: icon ${g.icon} is missing`);
  }
  return errors;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function slug(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''); }

function card(t, ds, games) {
  const href = `tools/${encodeURIComponent(t.id)}/`;
  const title = t.status === 'live' ? `<a href="${href}">${esc(t.name)}</a>` : esc(t.name);
  const chip = `<span class="ds-chip ${STATUS[t.status]}">${esc(t.status)}</span>`;
  const meta = [t.game, t.since ? `since ${t.since}` : ''].filter(Boolean).map(esc).join(' · ');
  const g = games[t.game];
  const icon = g && ds.icon ? ds.icon(g.icon, { alt: t.game }) : '';
  const foot = t.status === 'live'
    ? `<p class="ds-fig-cap"><a href="${href}">Open the tool</a></p>`
    : `<p class="ds-fig-cap">Not moved in yet${t.source ? `; lives at <code>${esc(t.source)}</code>` : ''}.</p>`;
  return `<section class="ds-panel"><div class="ds-fig-head">${icon}<h4>${title}</h4>${chip}</div><p class="ds-fig-sub">${meta}</p><p>${esc(t.summary)}</p>${foot}</section>`;
}

function render(cat, ds) {
  const games = cat.games || {};
  const gameIcon = (game) => (games[game] && ds.icon ? ds.icon(games[game].icon, { size: 'sm' }) : '');
  const tools = [...cat.tools].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'live' ? -1 : 1));
  const counts = Object.keys(STATUS).map((s) => [s, tools.filter((t) => t.status === s).length]).filter(([, n]) => n > 0);
  const byGame = new Map();
  for (const t of tools) byGame.set(t.game, [...(byGame.get(t.game) || []), t]);
  const howTo = '<p>Put the page in <code>tools/&lt;id&gt;/index.html</code>, add an entry to <code>tools.json</code>, ' +
    'run <code>node build.js</code>, commit all three. The catalogue keeps the status honest: a card links only when its folder exists.</p>';
  const body = [
    `<div class="ds-chips">${counts.map(([s, n]) => `<span class="ds-chip ${STATUS[s]}">${esc(s)} ${n}</span>`).join('')}</div>`,
    ...[...byGame.entries()].map(([game, list]) => `<h2 id="${esc(slug(game))}">${gameIcon(game)}${esc(game)}</h2>${ds.grid(list.map((t) => card(t, ds, games)))}`),
    `<h2 id="add-a-tool">Add a tool</h2>${ds.callout('note', howTo)}`,
  ].join('\n');
  return ds.page({
    title: cat.title || 'HM Level Design Tools',
    eyebrow: 'HM Games',
    lede: cat.lede || '',
    meta: `Built ${new Date().toISOString().slice(0, 10)} · ${tools.length} tool${tools.length === 1 ? '' : 's'}`,
    body,
    footer: 'HM Level Design Tools · generated from tools.json by build.js',
    charts: false,
  });
}

function build(repoDir) {
  const cat = JSON.parse(fs.readFileSync(path.join(repoDir, 'tools.json'), 'utf8'));
  const errors = validate(cat, repoDir);
  if (errors.length) throw new Error(errors.join('\n'));
  const html = render(cat, loadDs(repoDir));
  fs.writeFileSync(path.join(repoDir, 'index.html'), html);
  return { tools: cat.tools.length, bytes: html.length };
}

module.exports = { build, validate, render, findBrain, STATUS };

if (require.main === module) {
  try {
    const r = build(__dirname);
    console.log(`index.html: ${r.tools} tools, ${r.bytes} bytes`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
