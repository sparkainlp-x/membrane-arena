'use strict';
/*
 * Build dist/index.html (the arena), dist/brain.html (the brain architecture page) and
 * dist/quorum.html (the Quorum Keeper game): each one self-contained file with its stylesheets
 * and every script inlined.
 *   node build.js            write all three files
 * build() returns the arena HTML string, buildBrain() the brain page and buildQuorum() the game
 * (used by the tests).
 */
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function inline(page) {
  let html = read(page);
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, f) => `<style>\n${read(f).trimEnd()}\n</style>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, f) => `<script>\n${read(f).trimEnd().replace(/<\/script/gi, '<\\/script')}\n</script>`);
  return html;
}
function build() { return inline('index.html'); }
function buildBrain() { return inline('brain.html'); }
function buildQuorum() { return inline('quorum.html'); }

if (require.main === module) {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const [name, fn] of [['index.html', build], ['brain.html', buildBrain], ['quorum.html', buildQuorum]]) {
    const html = fn();
    fs.writeFileSync(path.join(root, 'dist', name), html);
    console.log(`wrote dist/${name} (${html.length} bytes)`);
  }
}
module.exports = { build, buildBrain, buildQuorum };
