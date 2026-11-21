/* Helpers for the production build: self-hosting of libraries (from npm, else downloaded) and of fonts (Google Fonts + base64 fonts embedded in the source). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export const sha = (buf, n = 10) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, n);
export const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

/* ---------- libraries ---------- */
// Every <script src> of the source head is copied into production/assets/vendor. The file comes from node_modules when loader/libs.json knows the npm package
// (exact same bytes the CDN serves, no network needed, immune to CDN/VPN/region blocks); otherwise it is downloaded from the URL (cached in .cache/vendor).
export async function vendorLib({ root, url, meta, outDir, cacheDir, offline, log }) {
  const require = createRequire(root + '/');
  let bytes = null, from = '';
  if (meta && meta.npm) {
    try {
      const pkgDir = path.dirname(require.resolve(meta.npm + '/package.json'));
      bytes = fs.readFileSync(path.join(pkgDir, meta.file)); from = `npm:${meta.npm}@${require(meta.npm + '/package.json').version}`;
      const want = (url.match(/[@/](\d+\.\d+\.\d+)/) || [])[1];
      if (want && !from.endsWith(want) && !/three/.test(meta.npm)) log(`  ! ${meta.name}: source asks for ${want} but node_modules has ${from.split('@').pop()} - align package.json`);
    } catch (e) { bytes = null; }
  }
  if (!bytes) {
    const cached = path.join(cacheDir, 'vendor', sha(url, 16) + '.js');
    if (fs.existsSync(cached)) { bytes = fs.readFileSync(cached); from = 'cache'; }
    else if (!offline) {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 kvish-build' } });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer()); mkdir(path.dirname(cached)); fs.writeFileSync(cached, bytes); from = 'download';
    } else throw new Error(`${url}: not in node_modules/.cache and --offline given`);
  }
  const slug = (meta?.name || path.basename(new URL(url).pathname) || 'lib').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = `vendor/${slug}.${sha(bytes, 8)}.js`;
  mkdir(path.join(outDir, 'vendor')); fs.writeFileSync(path.join(outDir, file), bytes);
  return { file, from, size: bytes.length };
}

/* ---------- base64 fonts embedded in source <style> blocks -> real files ---------- */
const MIME_EXT = { 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'font/sfnt': 'ttf', 'application/font-woff': 'woff', 'application/font-woff2': 'woff2', 'application/x-font-ttf': 'ttf', 'application/x-font-woff': 'woff', 'application/vnd.ms-fontobject': 'eot' };
export function extractDataFonts(css, label, outDir) {
  mkdir(path.join(outDir, 'fonts'));
  let n = 0;
  const out = css.replace(/url\(\s*(["']?)data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)\1\s*\)/gi, (all, q, mime, b64) => {
    const ext = MIME_EXT[mime.toLowerCase()];
    if (!ext) return all;                                   // not a font (leave it embedded)
    const bytes = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    const file = `fonts/${label}-${sha(bytes, 8)}.${ext}`;
    fs.writeFileSync(path.join(outDir, file), bytes); n++;
    return `url(${file})`;
  });
  return { css: out, count: n };
}

/* ---------- Google Fonts -> self-hosted ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';   // makes Google answer with woff2 + unicode-range subsets
export async function selfHostGoogleFonts({ hrefs, outDir, cacheDir, offline, log, fetchFn = fetch }) {
  const cdir = path.join(cacheDir, 'fonts'); mkdir(cdir); mkdir(path.join(outDir, 'fonts'));
  const get = async (url, bin) => {
    const c = path.join(cdir, sha(url, 20) + (bin ? '.bin' : '.css'));
    if (fs.existsSync(c)) return fs.readFileSync(c);
    if (offline) throw new Error(`${url}: not cached and --offline given`);
    const r = await fetchFn(url, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(c, b); return b;
  };
  const pool = async (items, fn, n = 8) => { const q = items.slice(); await Promise.all(Array.from({ length: n }, async () => { for (let it; (it = q.shift());) await fn(it); })); };
  const sheets = {}; const files = new Map();
  await pool(hrefs, async (href) => { sheets[href] = (await get(href, false)).toString('utf8'); });
  const urls = [...new Set(Object.values(sheets).flatMap(css => [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g)].map(m => m[1])))];
  await pool(urls, async (u) => {
    const bytes = await get(u, true);
    const base = path.basename(new URL(u).pathname).replace(/\.[a-z0-9]+$/i, '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = (path.extname(new URL(u).pathname).slice(1) || 'woff2').toLowerCase();
    const file = `fonts/${base}-${sha(bytes, 6)}.${ext}`;
    fs.writeFileSync(path.join(outDir, file), bytes); files.set(u, file);
  });
  const rewrite = (css) => css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g, (m, u) => `url(${files.get(u)})`);
  log(`  fonts: ${hrefs.length} Google stylesheets, ${files.size} font files self-hosted`);
  return { css: Object.fromEntries(hrefs.map(h => [h, rewrite(sheets[h])])), fileCount: files.size };
}
