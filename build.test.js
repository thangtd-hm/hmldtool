'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate, render, findBrain, build } = require('./build');

const tool = (o) => ({ id: 't-one', name: 'Tool One', game: 'Game', status: 'planned', summary: 'Does a thing.', ...o });

test('validate accepts a good catalogue and rejects a bad one', () => {
  assert.deepEqual(validate({ tools: [tool()] }), []);
  const errs = validate({ tools: [tool({ id: 'Bad Id', status: 'shipped' }), tool({ id: 'dup' }), tool({ id: 'dup' })] });
  assert.ok(errs.some((e) => /kebab-case/.test(e)));
  assert.ok(errs.some((e) => /status must be/.test(e)));
  assert.ok(errs.some((e) => /duplicate id/.test(e)));
});

test('a live tool needs its folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmld-'));
  assert.ok(validate({ tools: [tool({ status: 'live' })] }, dir).some((e) => /missing/.test(e)));
  fs.mkdirSync(path.join(dir, 'tools', 't-one'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 't-one', 'index.html'), '<!doctype html>');
  assert.deepEqual(validate({ tools: [tool({ status: 'live' })] }, dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('render links live tools only and escapes text', () => {
  const brain = findBrain(__dirname);
  if (!brain) return; // outside the brain there is no report-ds to render with
  const ds = require(path.join(brain, '05-tools', 'lib', 'report-ds'));
  const html = render({ title: 'Hub', tools: [tool({ status: 'live' }), tool({ id: 't-two', name: 'Two <b>', game: 'Other' })] }, ds);
  assert.ok(html.includes('href="tools/t-one/"'));
  assert.ok(!html.includes('href="tools/t-two/"'));
  assert.ok(html.includes('Two &lt;b&gt;'));
  assert.ok(html.includes('<h2 id="game">Game</h2>'));
  assert.ok(html.includes('data-theme-set="dark"'));
});

test('build writes index.html from the repo catalogue', () => {
  if (!findBrain(__dirname)) return;
  const r = build(__dirname);
  assert.ok(r.tools >= 1);
  assert.ok(fs.existsSync(path.join(__dirname, 'index.html')));
});

test('game icons: validated against the repo, drawn on the card and the game heading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmld-'));
  const cat = { tools: [tool()], games: { Game: { icon: 'icons/game.webp' } } };
  assert.ok(validate(cat, dir).some((e) => /icon icons\/game\.webp is missing/.test(e)));
  assert.ok(validate({ tools: [tool()], games: { Game: {} } }).some((e) => /missing "icon"/.test(e)));
  fs.mkdirSync(path.join(dir, 'icons'));
  fs.writeFileSync(path.join(dir, 'icons', 'game.webp'), '');
  assert.deepEqual(validate(cat, dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
  const brain = findBrain(__dirname);
  if (!brain) return;
  const ds = require(path.join(brain, '05-tools', 'lib', 'report-ds'));
  const html = render({ title: 'Hub', ...cat, tools: [tool(), tool({ id: 't-two', game: 'Other' })] }, ds);
  assert.ok(html.includes('<h2 id="game"><img class="ds-icon sm" src="icons/game.webp"'));
  assert.ok(html.includes('<div class="ds-fig-head"><img class="ds-icon" src="icons/game.webp" alt="Game"'));
  assert.ok(html.includes('<h2 id="other">Other</h2>'));
});
