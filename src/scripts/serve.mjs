#!/usr/bin/env node
/* Static server for DEVELOPMENT and for previewing the production build. No dependencies.
 *
 *   npm run dev                 serves the project folder: the editable index.html (compiled in the browser = slow start)   HTTPS
 *   npm run serve               serves production/ the way a static host would (hashed assets immutable, html revalidated)  HTTPS
 *   npm run dev:http | serve:http   same over plain HTTP
 *   options: --port 8443  --host 0.0.0.0 (default, whole network) | 127.0.0.1 (this PC only)  --http  --verbose
 *
 * HTTPS uses a self-signed certificate generated once with openssl into .certs/ (it lists every LAN IP, so other PCs can open it after
 * accepting the browser warning once). HTTPS matters: browsers only allow the clipboard API & other secure-context features on https/localhost.
 * Also importable: startServer({ root, port, host, secure }) -> { urls, close() } (used by scripts/measure.mjs).
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|map|webmanifest|ttf|otf)$/i;
const DENY = /^(\.|node_modules$|scripts$|loader$|production$|package(-lock)?\.json$|netlify\.toml$|AGENTS\.md$|README\.md$)/i;   // never expose project internals when serving the project folder

export const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);

function certs(ips) {
  const dir = path.join(here, '.certs'), key = path.join(dir, 'key.pem'), crt = path.join(dir, 'cert.pem'), sanFile = path.join(dir, 'san.txt');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((i) => 'IP:' + i)].join(',');
  if (!(fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(sanFile) && fs.readFileSync(sanFile, 'utf8') === san)) {
    fs.mkdirSync(dir, { recursive: true });
    try { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '825', '-subj', '/CN=kvish-dev', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' }); }
    catch { throw new Error('HTTPS needs openssl (Fedora: sudo dnf install openssl). Or use the :http scripts.'); }
    fs.writeFileSync(sanFile, san);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

export function startServer({ root, port = 8080, host = '0.0.0.0', secure = true, verbose = false }) {
  root = path.resolve(root);
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`No index.html in ${root}${path.basename(root) === 'production' ? ' - run: npm run build' : ''}`);
  const isProduction = fs.existsSync(path.join(root, '_headers'));
  const cache = new Map();   // file -> { mtime, src, br, gz }

  const resolveFile = (urlPath) => {
    let p; try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
    if (p.includes('\0')) return null;
    const parts = p.split('/').filter(Boolean);
    if (parts.some((s) => s === '..' || DENY.test(s))) return null;
    let f = path.join(root, ...parts);
    if (!f.startsWith(root)) return null;
    try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { return null; }
    return fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
  };

  const handler = (req, res) => {
    const started = Date.now();
    const done = (code, note = '') => { if (verbose) console.log(`${code} ${req.method} ${req.url} ${Date.now() - started}ms ${note}`); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return done(405); }
    const file = resolveFile(req.url || '/');
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return done(404); }
    const st = fs.statSync(file), ext = path.extname(file).toLowerCase();
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const rel = '/' + path.relative(root, file).split(path.sep).join('/');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Last-Modified': st.mtime.toUTCString(), Vary: 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff',
      // production preview behaves like the Netlify _headers file: hashed assets immutable, everything else revalidated. Dev: always revalidate.
      'Cache-Control': isProduction && rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return done(304); }
    let body = null, enc = null;
    if (COMPRESSIBLE.test(file) && st.size > 1024 && req.method === 'GET') {
      const accept = String(req.headers['accept-encoding'] || '');
      let c = cache.get(file); if (!c || c.mtime !== st.mtimeMs) { c = { mtime: st.mtimeMs, src: fs.readFileSync(file) }; cache.set(file, c); }
      if (/\bbr\b/.test(accept)) { c.br ||= zlib.brotliCompressSync(c.src, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: c.src.length } }); body = c.br; enc = 'br'; }
      else if (/\bgzip\b/.test(accept)) { c.gz ||= zlib.gzipSync(c.src, { level: 9 }); body = c.gz; enc = 'gzip'; }
      else body = c.src;
    }
    if (enc) headers['Content-Encoding'] = enc;
    if (body) { headers['Content-Length'] = body.length; res.writeHead(200, headers); res.end(body); return done(200, enc || ''); }
    headers['Content-Length'] = st.size; res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end(), done(200);
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res); done(200);
  };

  const ips = lanIps();
  const server = secure ? https.createServer(certs(ips), handler) : http.createServer(handler);
  server.keepAliveTimeout = 30000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port, proto = secure ? 'https' : 'http', open = host === '0.0.0.0' || host === '::';
      resolve({ server, port: p, isProduction, secure, urls: { local: `${proto}://localhost:${p}/`, network: open ? ips.map((ip) => `${proto}://${ip}:${p}/`) : [] }, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) });
    });
  });
}

/* ------------------------------------------------------------------ CLI */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(port|host)$/.test(argv[i - 1])));
  const root = path.resolve(process.cwd(), positional[0] || '.');
  const port = Number(opt('port', process.env.PORT || 8443)), host = opt('host', process.env.HOST || '0.0.0.0'), secure = !argv.includes('--http');
  startServer({ root, port, host, secure, verbose: argv.includes('--verbose') }).then((s) => {
    const shown = path.relative(process.cwd(), root) || '.';
    console.log(`\n  Kvish ${s.isProduction ? 'PRODUCTION build' : 'SOURCE index.html (compiled in the browser - slow to start, needs internet for the CDNs)'} - serving ${shown}/\n`);
    console.log(`  This PC:     ${s.urls.local}`);
    if (s.urls.network.length) {
      s.urls.network.forEach((u) => console.log(`  Network:     ${u}        <- open this on the other PC`));
      if (process.platform === 'linux') {
        const fw = spawnSync('firewall-cmd', ['--state'], { encoding: 'utf8' });
        if (fw.status === 0 && /running/.test(fw.stdout)) console.log(`\n  Fedora firewall (firewalld) is running. If the other PC cannot connect, open the port:\n    sudo firewall-cmd --add-port=${s.port}/tcp                                          (until reload/reboot)\n    sudo firewall-cmd --permanent --add-port=${s.port}/tcp && sudo firewall-cmd --reload   (permanent)`);
      }
    } else console.log('  (bound to this PC only; use --host 0.0.0.0 to share it on the network)');
    console.log(secure ? '\n  Self-signed certificate: the browser warns once ("Advanced" -> continue). HTTPS enables the clipboard buttons on other PCs.' : '\n  Plain HTTP: the "copy to clipboard" buttons do not work from other PCs (use the https scripts).');
    console.log('\n  Ctrl+C to stop.\n');
    process.on('SIGINT', () => { s.server.close(); process.exit(0); });
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Pick another:  npm run <script> -- --port ${port + 1}`);
    else if (e.code === 'EACCES') console.error(`No permission for port ${port} (ports below 1024 need root). Use e.g. --port 8443`);
    else console.error(e.message);
    process.exit(1);
  });
}
