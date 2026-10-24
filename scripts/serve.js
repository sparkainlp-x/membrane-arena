'use strict';
/* Serve dist/index.html for a local preview:  node scripts/serve.js [port]   (default 8080, bound to 127.0.0.1) */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
const port = parseInt(process.argv[2], 10) || 8080;
http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  } else { res.writeHead(404); res.end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Membrane Arena preview: http://127.0.0.1:${port}/`));
