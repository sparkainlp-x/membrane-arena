'use strict';
/*
 * Build dist/index.html: one self-contained file with the stylesheet and every script inlined.
 *   node build.js            write dist/index.html
 * build() returns the HTML string (used by the tests).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function build() {
  let html = read('index.html');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (m, f) => `<style>\n${read(f).trimEnd()}\n</style>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, f) => `<script>\n${read(f).trimEnd().replace(/<\/script/gi, '<\\/script')}\n</script>`);
  return html;
}

if (require.main === module) {
  const out = path.join(root, 'dist', 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = build();
  fs.writeFileSync(out, html);
  console.log(`wrote dist/index.html (${html.length} bytes)`);
}
module.exports = { build };
