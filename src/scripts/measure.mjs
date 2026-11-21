#!/usr/bin/env node
/* Measures how fast the app loads, cold (empty cache) and warm (second visit), in a real Chromium/Chrome.
 *
 *   npm run measure                      production/ build, 5 runs, real window (real GPU)
 *   npm run measure -- --dev             the source index.html (needs internet for the CDNs, takes a long time per run)
 *   npm run measure -- --runs 9 --throttle slow4g --cpu 4 --headless
 *   npm run measure -- --url https://my-site.netlify.app/        measure a deployed site
 *   npm run measure -- --json            machine readable
 *
 * Browser: set CHROME_PATH, or it looks for google-chrome / chromium (Fedora: sudo dnf install chromium).
 * Numbers are milliseconds since navigation start. Marks come from the production loader (performance.mark "kv:*"):
 *   logo = loader card visible | stars = star field drawing | libs = libraries+CSS ready | app = app script executed | mounted = React mounted
 *   ready = every hold released | reveal = reveal animation starts | revealed = loader gone
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(root + '/');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);

const NET = { none: null, fast4g: { latency: 60, down: 9e6, up: 1.5e6 }, slow4g: { latency: 150, down: 1.6e6, up: 0.75e6 }, '3g': { latency: 300, down: 0.4e6, up: 0.4e6 } };
const runs = Number(opt('runs', 5)), cpu = Number(opt('cpu', 1)), net = opt('throttle', 'none');
if (!(net in NET)) { console.error('--throttle must be one of: ' + Object.keys(NET).join(', ')); process.exit(1); }

function findBrowser() {
  const c = [opt('browser'), process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/lib64/chromium-browser/chromium-browser', '/opt/google/chrome/chrome'].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}
const exe = findBrowser();
if (!exe) { console.error('No Chrome/Chromium found. Fedora: sudo dnf install chromium   (or set CHROME_PATH=/path/to/chrome)'); process.exit(1); }
let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { console.error('puppeteer-core missing: npm install'); process.exit(1); }

const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const MARKS = ['logo', 'stars', 'libs', 'app', 'mounted', 'ready', 'reveal', 'revealed'];

async function visit(page, url, isDev, cdp) {
  let bytes = 0, reqs = 0; const sizes = new Map();
  const onFin = (e) => { bytes += e.encodedDataLength; reqs++; };
  cdp.on('Network.loadingFinished', onFin);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 600000 }).catch(() => {});
  await page.waitForFunction(isDev
    ? () => document.querySelectorAll('#root button').length > 10
    : () => performance.getEntriesByName('kv:revealed').length > 0 || !!document.querySelector('#kv-ld.fail'), { timeout: 600000, polling: 100 });
  const r = await page.evaluate(() => {
    const m = {}; for (const e of performance.getEntriesByType('mark')) if (e.name.startsWith('kv:')) m[e.name.slice(3)] = Math.round(e.startTime);
    const paint = {}; for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime);
    const nav = performance.getEntriesByType('navigation')[0];
    return { m, fp: paint['first-paint'], fcp: paint['first-contentful-paint'], dcl: Math.round(nav.domContentLoadedEventEnd), failed: !!document.querySelector('#kv-ld.fail'), now: Math.round(performance.now()) };
  });
  cdp.off('Network.loadingFinished', onFin);
  return { ...r, bytes, reqs };
}

(async () => {
  const isDev = flag('dev') && !opt('url');
  let srv = null, url = opt('url');
  if (!url) {
    srv = await startServer({ root: isDev ? root : path.join(root, 'production'), port: 0, host: '127.0.0.1', secure: false });
    url = srv.urls.local;
  }
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--ignore-gpu-blocklist'];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  if (flag('headless')) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await puppeteer.launch({ executablePath: exe, headless: flag('headless') ? (opt('headless-mode', 'new') === 'shell' ? 'shell' : true) : false, args });
  const cold = [], warm = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.createBrowserContext();         // fresh profile = empty HTTP cache
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    if (NET[net]) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET[net].latency, downloadThroughput: NET[net].down / 8, uploadThroughput: NET[net].up / 8 });
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    cold.push(await visit(page, url, isDev, cdp));
    await page.close();
    const page2 = await ctx.newPage();                          // same profile: cached assets
    await page2.setViewport({ width: 1280, height: 800 });
    const cdp2 = await page2.createCDPSession();
    await cdp2.send('Network.enable');
    if (NET[net]) await cdp2.send('Network.emulateNetworkConditions', { offline: false, latency: NET[net].latency, downloadThroughput: NET[net].down / 8, uploadThroughput: NET[net].up / 8 });
    if (cpu > 1) await cdp2.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    warm.push(await visit(page2, url, isDev, cdp2));
    await ctx.close();
    process.stderr.write(`run ${i + 1}/${runs} done\r`);
  }
  await browser.close(); if (srv) await srv.close();
  const summarize = (list) => ({ firstPaint: median(list.map((r) => r.fp)), firstContentfulPaint: median(list.map((r) => r.fcp)), ...Object.fromEntries(MARKS.map((k) => [k, median(list.map((r) => r.m[k]))])), transferKB: Math.round(median(list.map((r) => r.bytes)) / 1024), requests: median(list.map((r) => r.reqs)), failedRuns: list.filter((r) => r.failed).length });
  const out = { target: url, mode: isDev ? 'development (source index.html)' : 'production', runs, throttle: net, cpuSlowdown: cpu, browser: path.basename(exe), headless: flag('headless'), cold: summarize(cold), warm: summarize(warm) };
  if (flag('json')) return console.log(JSON.stringify(out, null, 1));
  const f = (v) => (v == null ? '-' : String(v)).padStart(9);
  console.log(`\n${out.mode} | ${url} | ${runs} runs (median) | network: ${net} | cpu x${cpu} | ${out.headless ? 'headless/software GL' : 'real window'}\n`);
  console.log('ms since navigation start'.padEnd(28) + 'cold cache'.padStart(11) + 'warm cache'.padStart(11));
  for (const [k, label] of [['firstPaint', 'first paint'], ['firstContentfulPaint', 'first contentful paint'], ['logo', 'loader card visible'], ['stars', 'stars drawing'], ['libs', 'libraries + css ready'], ['app', 'app script executed'], ['mounted', 'React mounted'], ['ready', 'all holds released'], ['reveal', 'reveal starts'], ['revealed', 'app fully visible']])
    console.log(label.padEnd(28) + f(out.cold[k]).padStart(11) + f(out.warm[k]).padStart(11));
  console.log('transferred (KB)'.padEnd(28) + f(out.cold.transferKB).padStart(11) + f(out.warm.transferKB).padStart(11));
  console.log('requests'.padEnd(28) + f(out.cold.requests).padStart(11) + f(out.warm.requests).padStart(11));
  if (out.cold.failedRuns || out.warm.failedRuns) console.log(`\n! ${out.cold.failedRuns + out.warm.failedRuns} run(s) ended on the loader error screen`);
  if (isDev) console.log('\n(dev has no loader marks: it is measured until the UI has rendered)');
  console.log();
})().catch((e) => { console.error(e); process.exit(1); });
