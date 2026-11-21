#!/usr/bin/env node
/* Builds the PRODUCTION site from the editable source index.html.
 *
 *   npm run build                  -> production/            (static files: deploy this folder to Netlify / any static host)
 *   node scripts/build.mjs --offline   never touches the network (uses node_modules + .cache only)
 *   node scripts/build.mjs --no-fonts  keep Google Fonts on Google (skip self-hosting them)
 *
 * What it does:  index.html (source: JSX inline, Babel + Tailwind CDN at runtime, slow)  ->  production/
 *   index.html                 ~120 KB: head (incl. the inline kv-assets script), the loader (paints immediately, no dependencies), boot engine. Nothing render-blocking.
 *   assets/logo.*, icon-*.png  the app logo from kv-assets as real files for the tab icon / apple-touch-icon / crawlers
 *   assets/app.<hash>.js       the app, JSX compiled + minified (streamed/parsed off the main thread by the browser, cached forever)
 *   assets/app.<hash>.css      Tailwind CSS compiled at build time (no Tailwind CDN / in-browser compiler)
 *   assets/vendor/*.js         React, three.js, ... self-hosted (from npm, same files the CDNs serve) -> nothing third-party is needed at runtime
 *   assets/fonts/*, fonts*.css Google Fonts + the base64 fonts of the source, as real files
 *   _headers                   Netlify cache rules: hashed assets are immutable, index.html is always revalidated
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sha, mkdir, vendorLib, extractDataFonts, selfHostGoogleFonts } from './assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(root + '/');
const flag = (n) => process.argv.includes('--' + n);
const opt = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const srcFile = path.resolve(root, opt('src', 'index.html'));
const outRoot = path.resolve(root, opt('out', 'production'));
const cacheDir = path.join(root, '.cache');
const offline = flag('offline');
const log = (...a) => console.log(...a);
const t0 = Date.now();

const babel = require('@babel/core'), esbuild = require('esbuild'), postcss = require('postcss'), tailwind = require('tailwindcss');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const attr = (tag, name) => { const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? (m[1] ?? m[2]) : null; };
const hasAttr = (tag, name) => new RegExp('\\s' + name + '(?=[\\s=/>])', 'i').test(tag);
const jsonInScript = (o) => JSON.stringify(o, null, 1).replace(/<\//g, '<\\/');

/* ------------------------------------------------------------------ 1. read + split the source */
const html = fs.readFileSync(srcFile, 'utf8').replace(/\r\n?/g, '\n');
const htmlOpen = /<html([^>]*)>/i.exec(html), headOpen = /<head[^>]*>/i.exec(html), bodyOpen = /<body([^>]*)>/i.exec(html);
if (!htmlOpen || !headOpen || !bodyOpen) throw new Error('index.html must have <html>, <head> and <body> tags');
const head = html.slice(headOpen.index + headOpen[0].length, html.indexOf('</head>'));
let body = html.slice(bodyOpen.index + bodyOpen[0].length, html.lastIndexOf('</body>'));

const babelM = /<script\b[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/i.exec(body);
if (!babelM) throw new Error('no <script type="text/babel"> found in the body of index.html');
const jsx = babelM[1];
if (!/KV_BOOT\s*\.\s*mounted\s*\(/.test(jsx)) throw new Error('index.html never calls window.KV_BOOT.mounted(): the production loader would never reveal the app. Restore the guarded call (see AGENTS.md, "Loader contract").');
body = body.replace(babelM[0], '').replace(/<div id="root"[^>]*>\s*<\/div>/i, '');

const keep = [], libUrls = [], fontSheets = [], heavyScripts = [], heavyStyles = []; let twConfigSrc = null, titleAt = -1, hadFontPreconnect = false, logo = null;
for (const tok of head.match(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*>|<meta\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>|<base\b[^>]*>/gi) || []) {
  if (/^<script/i.test(tok)) {
    const open = tok.slice(0, tok.indexOf('>') + 1), src = attr(open, 'src');
    if (src) { if (!/babel|cdn\.tailwindcss\.com/i.test(src)) libUrls.push(src); continue; }       // Babel + Tailwind CDN are dev-only
    const inner = tok.slice(open.length, -'</script>'.length);
    if (/tailwind\.config/.test(inner)) { twConfigSrc = inner; continue; }
    if (inner.length > 256000) { heavyScripts.push({ id: attr(open, 'id') || 'inline', code: inner }); continue; }   // huge inline scripts become cacheable files; small ones (incl. kv-assets) stay inline
    const lm = /window\.KV_LOGO_SRC\s*=\s*["'](data:image\/([a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+))["']/i.exec(inner);
    if (lm) logo = { mime: lm[2].toLowerCase(), bytes: Buffer.from(lm[3], 'base64') };
  } else if (/^<style/i.test(tok)) {
    const open = tok.slice(0, tok.indexOf('>') + 1), inner = tok.slice(open.length, -'</style>'.length);
    if (inner.length > 20000 || (/@font-face/i.test(inner) && /url\(\s*["']?data:/i.test(inner))) { heavyStyles.push({ id: attr(open, 'id') || 'style' + heavyStyles.length, css: inner }); continue; }
  } else if (/^<link/i.test(tok)) {
    const href = attr(tok, 'href') || '';
    if (/stylesheet/i.test(attr(tok, 'rel') || '') && /fonts\.googleapis\.com\/css2/.test(href)) { fontSheets.push({ href, critical: hasAttr(tok, 'data-kv-critical') }); continue; }
    if (/preconnect/i.test(attr(tok, 'rel') || '') && /fonts\.(googleapis|gstatic)\.com/.test(href)) { hadFontPreconnect = true; continue; }
  }
  if (/^<title/i.test(tok)) titleAt = keep.length;
  keep.push(tok);
}
if (fontSheets.length && !fontSheets.some((f) => f.critical)) fontSheets[0].critical = true;   // no data-kv-critical anywhere -> the first sheet (UI fonts) gates the reveal
log(`source: ${(html.length / 1048576).toFixed(2)} MB | ${libUrls.length} libraries, ${fontSheets.length} Google font sheets, ${heavyStyles.length} embedded font blocks, JSX ${(jsx.length / 1048576).toFixed(2)} MB`);

/* ------------------------------------------------------------------ 2. output folder */
fs.rmSync(outRoot, { recursive: true, force: true });
const A = path.join(outRoot, 'assets'); mkdir(A);
const sizes = []; const emit = (name, data) => { fs.writeFileSync(path.join(A, name), data); sizes.push([`assets/${name}`, Buffer.byteLength(data)]); return 'assets/' + name; };

/* ------------------------------------------------------------------ 3. libraries (self-hosted) */
const libsMeta = JSON.parse(read('loader', 'libs.json'));
const scripts = [];
for (const url of libUrls) {
  const meta = libsMeta.find((m) => new RegExp(m.match, 'i').test(url));
  const name = meta?.name || path.basename(new URL(url).pathname) || url;
  try {
    const r = await vendorLib({ root, url, meta, outDir: A, cacheDir, offline, log });
    scripts.push({ id: 'lib-' + scripts.length, name, src: 'assets/' + r.file, ...(meta?.global ? { global: meta.global } : {}) });
    log(`  lib  ${name.padEnd(14)} ${(r.size / 1024).toFixed(0).padStart(5)} KB  (${r.from})`);
  } catch (e) {
    log(`  ! ${name}: could not self-host (${e.message}); the page will load it from ${url}`);
    scripts.push({ id: 'lib-' + scripts.length, name, src: url, ...(meta?.global ? { global: meta.global } : {}) });
  }
}
for (const hs of heavyScripts) {                         // e.g. kv-assets: logo/namer data URIs. Runs before the app, in order.
  const src = emit(`${hs.id}.${sha(hs.code)}.js`, hs.code); scripts.push({ id: 'inline-' + hs.id, name: hs.id, src });
}

/* ------------------------------------------------------------------ 4. app code + Tailwind CSS */
let js = babel.transformSync(jsx, { presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]], sourceType: 'script', comments: false, compact: false, configFile: false, babelrc: false }).code;
js = esbuild.transformSync(js, { minifyWhitespace: true, minifySyntax: true, legalComments: 'none', target: 'es2020' }).code;   // never renames identifiers
new vm.Script(js);                                                                                                         // syntax gate
const appSrc = emit(`app.${sha(js)}.js`, js);
if (!twConfigSrc) throw new Error('tailwind.config script not found in the head of index.html');
const twCfg = new Function('tailwind', twConfigSrc + '; return tailwind.config;')({});
const twRes = await postcss([tailwind({ ...twCfg, content: [{ raw: html, extension: 'html' }] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
const twCss = esbuild.transformSync(twRes.css, { loader: 'css', minify: true }).code;
const styles = [{ id: 'css-app', href: emit(`app.${sha(twCss)}.css`, twCss), critical: true, required: true }];
log(`  app  ${(js.length / 1024).toFixed(0)} KB js | tailwind ${(twCss.length / 1024).toFixed(0)} KB css`);

/* ------------------------------------------------------------------ 5. fonts */
const fontDescs = (hrefs) => [...new Set(hrefs.flatMap((h) => [...new URL(h).searchParams.getAll('family')].map((f) => `400 1em "${f.split(':')[0].replace(/\+/g, ' ')}"`)))];
if (heavyStyles.length) {
  const css = heavyStyles.map((s) => extractDataFonts(s.css, s.id.replace(/^kv-/, ''), A)).map((r) => r.css).join('\n');
  styles.push({ id: 'css-fonts-local', href: emit(`fonts-local.${sha(css)}.css`, css), critical: true });
}
const critSheets = fontSheets.filter((s) => s.critical), lazySheets = fontSheets.filter((s) => !s.critical);
let fontsSelfHosted = false;
if (fontSheets.length && !flag('no-fonts')) {
  try {
    const r = await selfHostGoogleFonts({ hrefs: fontSheets.map((s) => s.href), outDir: A, cacheDir, offline, log });
    const core = critSheets.map((s) => r.css[s.href]).join('\n'), more = lazySheets.map((s) => r.css[s.href]).join('\n');
    if (core) styles.push({ id: 'css-fonts-core', href: emit(`fonts-core.${sha(core)}.css`, core), critical: true, fonts: fontDescs(critSheets.map((s) => s.href)) });
    if (more) styles.push({ id: 'css-fonts-more', href: emit(`fonts-more.${sha(more)}.css`, more), critical: false });
    fontsSelfHosted = true;
  } catch (e) { log(`  ! Google Fonts could not be self-hosted (${e.message}) - keeping them on fonts.googleapis.com (lazy, non-blocking)`); }
}
if (!fontsSelfHosted) for (const s of fontSheets) styles.push({ id: 'gf-' + styles.length, href: s.href, critical: s.critical, ...(s.critical ? { fonts: fontDescs([s.href]) } : {}) });

/* ------------------------------------------------------------------ 5b. icons: real files for the tab icon / touch icon / crawlers.
   The inline kv-assets script still swaps the data URIs in at runtime (same image); these static hrefs are what bots and the first paint see. */
const iconHref = {};
if (logo) {
  const ext = { jpeg: 'jpg', 'svg+xml': 'svg' }[logo.mime] || logo.mime;
  iconHref.logo = emit(`logo.${sha(logo.bytes)}.${ext}`, logo.bytes);
  try {
    const sharp = require('sharp');                                   // optional dependency
    const png = (n) => sharp(logo.bytes).resize(n, n, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
    const [p192, p180] = [await png(192), await png(180)];
    iconHref.icon = emit(`icon-192.${sha(p192)}.png`, p192); iconHref.icon_type = 'image/png';
    iconHref.touch = emit(`apple-touch-icon.${sha(p180)}.png`, p180);
  } catch (e) { log(`  ! sharp not available (${String(e.message).split('\n')[0]}): tab icon falls back to the WebP file, no PNG touch icon (npm i sharp)`); iconHref.icon = iconHref.logo; iconHref.icon_type = 'image/' + ext; }
  const setHref = (tok, href, type) => tok.replace(/\s(href|type)\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/<link/i, `<link${type ? ` type="${type}"` : ''} href="${href}"`);
  keep.forEach((tok, i) => {
    if (!/^<link/i.test(tok)) return;
    if (/\sid\s*=\s*["']kv-icon["']/i.test(tok)) keep[i] = setHref(tok, iconHref.icon, iconHref.icon_type);
    else if (iconHref.touch && /\sid\s*=\s*["']kv-touch-icon["']/i.test(tok)) keep[i] = setHref(tok, iconHref.touch);
  });
} else log('  ! no window.KV_LOGO_SRC data URI found in the head of index.html: the loader card shows without a logo and no icon files are written');

/* ------------------------------------------------------------------ 6. index.html (loader inlined) */
keep.forEach((tok, i) => { if (/^<meta[^>]+Content-Security-Policy/i.test(tok)) keep[i] = tok.replace(/\s+https:\/\/cdn\.tailwindcss\.com/g, ''); });   // Tailwind CDN is dev-only
const stripHead = (code) => code.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');                                                       // drop the leading documentation comment (maintainer docs live in AGENTS.md / loader/*.js, not in production)
const manifest = stripHead(read('loader', 'manifest.js')).replace('/*SCRIPTS*/[]', jsonInScript(scripts)).replace('/*STYLES*/[]', jsonInScript(styles)).replace('/*APP*/{}', jsonInScript({ src: appSrc }));
const boot = stripHead(read('loader', 'boot.js')).replace('__STARS__', read('loader', 'stars.js'));
if (/<\/script/i.test(boot + manifest)) throw new Error('"</script" inside loader code');
const loaderCss = `<style id="kv-ld-css">${read('loader', 'loader.css').trim()}</style>`;
if (titleAt >= 0) keep.splice(titleAt + 1, 0, loaderCss); else keep.push(loaderCss);
if (hadFontPreconnect && !fontsSelfHosted) keep.push('<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
const hOpen = /\sclass\s*=\s*"([^"]*)"/i.test(htmlOpen[1]) ? htmlOpen[1].replace(/(\sclass\s*=\s*")([^"]*)"/i, '$1$2 kv-boot"') : htmlOpen[1] + ' class="kv-boot"';
const out = [
  '<!DOCTYPE html>', `<html${hOpen}>`, '<head>', keep.join('\n    '),
  '<script id="kv-ld-i18n">' + stripHead(read('loader', 'i18n.js')) + '</script>',
  '<script id="kv-boot-manifest">' + manifest + '</script>', '</head>', `<body${bodyOpen[1]}>`,
  read('loader', 'loader.html').trim(),
  '<script>' + read('loader', 'micro.js') + '</script>', '<div id="root" inert></div>',
  '<script id="kv-boot">' + boot + '</script>', body.trim(), '</body>', '</html>', ''
].join('\n');
fs.writeFileSync(path.join(outRoot, 'index.html'), out);
fs.writeFileSync(path.join(outRoot, '_headers'), `# Netlify: hashed files never change, the page itself is always revalidated\n/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

/* ------------------------------------------------------------------ 7. report + self-check */
for (const f of fs.readdirSync(A, { recursive: true })) { if (/\.(js|css)$/.test(f) && f.startsWith('vendor')) continue; }
for (const s of [...scripts, ...styles, { src: appSrc }]) { const f = s.src || s.href; if (!/^https?:/.test(f) && !fs.existsSync(path.join(outRoot, f))) throw new Error('manifest points to a missing file: ' + f); }
const total = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).reduce((n, d) => n + fs.statSync(path.join(d.parentPath ?? d.path, d.name)).size, 0);
log(`\nproduction/index.html ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB (gzip ${(zlib.gzipSync(out).length / 1024).toFixed(0)} KB) | whole site ${(total(outRoot) / 1048576).toFixed(1)} MB | built in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(process.cwd(), outRoot) || '.'}/`);
