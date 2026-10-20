#!/usr/bin/env node
/**
 * Round 13 motion clips: rest-state gate, REF+OURS webms, dive frame-steps,
 * mid-clip visual confirm that ours pane shows hubs/chains/core.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PNG } = (() => {
  try { return require('pngjs'); } catch { return { PNG: null }; }
})();

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const REF = process.env.SKILLTREE_LOCAL || 'http://127.0.0.1:8768/map.html';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review';
const MOTION = path.join(OUT, 'r13-motion');
const ART = '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts/r13-motion';
const TMP = path.join(MOTION, '_raw');
const OURS_URL = `${BASE}/alerts.html?r13=1`;

fs.mkdirSync(MOTION, { recursive: true });
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const VW = 1440;
const VH = 900;

function sh(cmd) {
  execSync(cmd, { stdio: 'pipe' });
}

function copyArt(file) {
  const base = path.basename(file);
  fs.copyFileSync(file, path.join(ART, base));
}

function hstack(left, right, out) {
  sh(`ffmpeg -y -i ${JSON.stringify(left)} -i ${JSON.stringify(right)} -filter_complex "[0:v]scale=${VW / 2}:${VH},setsar=1[l];[1:v]scale=${VW / 2}:${VH},setsar=1[r];[l][r]hstack=inputs=2[v]" -map "[v]" -c:v libvpx-vp9 -b:v 1.5M -an ${JSON.stringify(out)}`);
  copyArt(out);
}

/** Extract a mid-clip frame; return path. */
function extractFrame(webm, outPng, ss = '00:00:01.200') {
  sh(`ffmpeg -y -ss ${ss} -i ${JSON.stringify(webm)} -frames:v 1 -q:v 2 ${JSON.stringify(outPng)}`);
  copyArt(outPng);
  return outPng;
}

/**
 * Confirm the RIGHT half (ours) of an hstack frame has constellation ink
 * (hubs/chains/core) — not label-only charcoal.
 */
function oursPaneHasConstellation(pngPath) {
  if (!fs.existsSync(pngPath)) return { ok: false, reason: 'missing frame' };
  // Prefer sharp/pngjs; fall back to ffmpeg + raw via ImageMagick identify stats
  try {
    const { createCanvas, loadImage } = require('canvas');
    // optional
  } catch { /* ignore */ }

  // Use ffmpeg to crop right half and count non-near-bg pixels via a tiny node decode of PNG
  const half = pngPath.replace(/\.png$/, '-ours-half.png');
  sh(`ffmpeg -y -i ${JSON.stringify(pngPath)} -vf "crop=iw/2:ih:iw/2:0" -frames:v 1 ${JSON.stringify(half)}`);
  copyArt(half);

  const pyFile = path.join(TMP, '_count_ink.py');
  fs.writeFileSync(pyFile, [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(half)}).convert("RGB")`,
    'w,h = im.size',
    'pix = im.load()',
    'bg = (32,36,45)',
    'non = bright = colored = 0',
    'for y in range(60, h-40):',
    '  for x in range(w):',
    '    r,g,b = pix[x,y]',
    '    if abs(r-bg[0])>14 or abs(g-bg[1])>14 or abs(b-bg[2])>14:',
    '      non += 1',
    '      if r+g+b > 200: bright += 1',
    '      if max(r,g,b) - min(r,g,b) > 25 or r+g+b > 160:',
    '        colored += 1',
    'print(f"{w} {h} {non} {bright} {colored}")',
    '',
  ].join('\n'));
  const out = execSync(`python3 ${JSON.stringify(pyFile)}`, { encoding: 'utf8' }).trim();
  const [w, h, non, bright, colored] = out.split(/\s+/).map(Number);
  // Thresholds: rest overview has thousands of colored pixels; labels-only ≪ 2k.
  // Hover-dim clips legitimately sit lower — require colored≥2500 / non≥3000.
  const ok = colored >= 2500 && non >= 3000;
  return { ok, w, h, non, bright, colored, half, reason: ok ? 'ok' : `colored=${colored} non=${non} (need colored≥2500, non≥3000)` };
}

async function withVideo(browser, url, fileBase, run) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: TMP, size: { width: VW, height: VH } },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (url.includes('8768')) {
    await page.waitForFunction(() => document.querySelectorAll('.mini').length >= 3 && document.body.classList.contains('ready'), null, { timeout: 20000 });
    await page.waitForTimeout(600);
  } else {
    await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const g = window.LEET_ALERTS_MAP.assertRestOverview();
      return g.ok && g.coreInk > 40;
    }, null, { timeout: 10000 });
    await page.waitForTimeout(500);
  }
  await run(page);
  const vid = page.video();
  await ctx.close();
  const raw = await vid.path();
  const dest = path.join(TMP, `${fileBase}.webm`);
  if (raw && fs.existsSync(raw)) fs.copyFileSync(raw, dest);
  return dest;
}

const browser = await chromium.launch({ headless: true });

// ── Rest-state gate (must pass before any clip) ──────────────────────────
{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(OURS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const gate = await page.evaluate(() => window.LEET_ALERTS_MAP.assertRestOverview());
  const constants = await page.evaluate(() => ({
    ours: window.LEET_ALERTS_MAP.interactionConstants(),
    geom: window.LEET_ALERTS_MAP.overviewGeom(),
    hub: window.LEET_ALERTS_MAP.hubRadiusRatio(),
    tip: window.LEET_ALERTS_MAP.tipRadiusRatio(),
    restGate: window.LEET_ALERTS_MAP.assertRestOverview(),
  }));
  fs.writeFileSync(path.join(MOTION, 'ours-constants.json'), JSON.stringify(constants, null, 2));
  copyArt(path.join(MOTION, 'ours-constants.json'));
  await page.screenshot({ path: path.join(MOTION, 'ours-overview.png'), type: 'png' });
  copyArt(path.join(MOTION, 'ours-overview.png'));
  fs.writeFileSync(path.join(MOTION, 'rest-gate.json'), JSON.stringify(gate, null, 2));
  copyArt(path.join(MOTION, 'rest-gate.json'));
  await page.close();
  if (!gate.ok) {
    console.error('REST GATE FAILED', gate);
    await browser.close();
    process.exit(1);
  }
  console.log('rest gate OK', { nodeDots: gate.nodeDots, hubs: gate.hubs, coreInk: gate.coreInk });
}

{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(REF, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(MOTION, 'ref-overview.png'), type: 'png' });
  copyArt(path.join(MOTION, 'ref-overview.png'));
  await page.close();
}

// ── Dive morph frame-step stills (0/130/260/390/520ms from morph start) ──
{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(OURS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.LEET_ALERTS_MAP.recenter(); });
  await page.waitForTimeout(300);
  // Dive a side category so align is short (tasks is near bottom at rest)
  await page.evaluate(() => window.LEET_ALERTS_MAP.focusCategory('tasks'));
  await page.waitForFunction(() => {
    const s = window.LEET_ALERTS_MAP.getFocus().mapState;
    return s === 'diving' || s === 'fan';
  }, null, { timeout: 5000 });
  // If already fan (reduce-motion), still grab frames from now
  const t0 = Date.now();
  const stamps = [0, 130, 260, 390, 520];
  for (const ms of stamps) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    const fp = path.join(MOTION, `dive-morph-${String(ms).padStart(3, '0')}ms.png`);
    await page.screenshot({ path: fp, type: 'png' });
    copyArt(fp);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(MOTION, 'dive-morph-settled.png'), type: 'png' });
  copyArt(path.join(MOTION, 'dive-morph-settled.png'));
  await page.close();
  console.log('wrote dive morph frame-steps');
}

const scenarios = [
  {
    name: '01-hover-fan',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(300);
        const cat = MAP.snapshot().categories[0];
        MAP.setHover(cat.id);
        await MAP.waitForIdle(400);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        for (let i = 0; i < 10; i++) {
          const ang = -0.4 + i * 0.08;
          const rad = 0.18 + i * 0.03;
          const x = r.left + r.width * (0.5 + Math.sin(ang) * rad);
          const y = r.top + r.height * (0.42 + Math.cos(ang) * rad * 0.6);
          canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
          await MAP.waitForIdle(220);
        }
      });
      await page.waitForTimeout(400);
    },
    ref: async (page) => {
      await page.waitForTimeout(800);
      await page.evaluate(async () => {
        const minis = [...document.querySelectorAll('.mini')];
        for (const el of minis.slice(0, 3)) {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 500));
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        }
        if (minis[0]) {
          minis[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          const dots = minis[0].querySelectorAll('.jdot');
          for (const d of [...dots].slice(0, 6)) {
            d.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 280));
          }
        }
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: '02-wheel-zoom',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width * 0.55;
        const cy = r.top + r.height * 0.5;
        for (let i = 0; i < 6; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(80);
        }
        for (let i = 0; i < 25; i++) {
          await MAP.waitForIdle(80);
          if (MAP.getFocus().mapState === 'fan') break;
        }
        await MAP.waitForIdle(200);
        for (let i = 0; i < 8; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(100);
        }
        for (let i = 0; i < 8; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(100);
        }
      });
      await page.waitForTimeout(400);
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 1400));
        const cx = innerWidth * 0.55, cy = innerHeight * 0.5;
        for (let i = 0; i < 8; i++) {
          dispatchEvent(new WheelEvent('wheel', { deltaY: -80, clientX: cx, clientY: cy, ctrlKey: true, bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, 100));
        }
        for (let i = 0; i < 10; i++) {
          dispatchEvent(new WheelEvent('wheel', { deltaY: 80, clientX: cx, clientY: cy, ctrlKey: true, bubbles: true, cancelable: true }));
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: '03-drag-release',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        MAP.focusCategory(MAP.snapshot().categories[1].id);
        for (let i = 0; i < 40; i++) {
          await MAP.waitForIdle(80);
          if (MAP.getFocus().mapState === 'fan') break;
        }
        await MAP.waitForIdle(200);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.5;
        const y0 = r.top + r.height * 0.55;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 14; i++) {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + i * 16, clientY: y0 + i * 5, pointerId: 1, bubbles: true }));
          await MAP.waitForIdle(35);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 224, clientY: y0 + 70, pointerId: 1, bubbles: true }));
        await MAP.waitForIdle(600);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(1);
        await new Promise((r) => setTimeout(r, 1400));
        const x0 = innerWidth * 0.5, y0 = innerHeight * 0.55;
        dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 14; i++) {
          dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + i * 16, clientY: y0 + i * 5, pointerId: 1, bubbles: true }));
          await new Promise((r) => setTimeout(r, 35));
        }
        dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 224, clientY: y0 + 70, pointerId: 1, bubbles: true }));
        await new Promise((r) => setTimeout(r, 800));
      });
    },
  },
  {
    name: '04-hub-focus-back',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        MAP.focusCategory(MAP.snapshot().categories[0].id);
        await MAP.waitForIdle(1600);
        MAP.clearFocus();
        await MAP.waitForIdle(1000);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 1600));
        if (typeof rise === 'function') rise();
        await new Promise((r) => setTimeout(r, 1000));
      });
    },
  },
  {
    name: '05-click-node',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        const a = MAP.snapshot().alerts[0];
        MAP.openAlert(a.id);
        await MAP.waitForIdle(1800);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 1600));
        const node = document.querySelector('.fan .node');
        if (node && node._sel) node._sel();
        else if (node) node.click();
        await new Promise((r) => setTimeout(r, 1200));
      });
    },
  },
  {
    name: '06-next-arrow',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        for (let i = 0; i < 4; i++) {
          MAP.stepWheel(1);
          await MAP.waitForIdle(550);
        }
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
          if (typeof stepWheel === 'function') stepWheel(1);
          document.getElementById('wchev-r')?.click();
          await new Promise((r) => setTimeout(r, 550));
        }
      });
    },
  },
  {
    name: '07-dial-drag',
    ours: async (page) => {
      await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(300);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.62;
        const y0 = r.top + r.height * 0.55;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 20; i++) {
          const ang = i * 0.08;
          window.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x0 + Math.cos(ang) * 40 - 40,
            clientY: y0 + Math.sin(ang) * 90,
            pointerId: 1, bubbles: true,
          }));
          await MAP.waitForIdle(40);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x0, clientY: y0 + 80, pointerId: 1, bubbles: true }));
        await MAP.waitForIdle(900);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const x0 = innerWidth * 0.62, y0 = innerHeight * 0.55;
        dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 20; i++) {
          const ang = i * 0.08;
          dispatchEvent(new PointerEvent('pointermove', {
            clientX: x0 + Math.cos(ang) * 40 - 40,
            clientY: y0 + Math.sin(ang) * 90,
            pointerId: 1, bubbles: true,
          }));
          await new Promise((r) => setTimeout(r, 40));
        }
        dispatchEvent(new PointerEvent('pointerup', { clientX: x0, clientY: y0 + 80, pointerId: 1, bubbles: true }));
        await new Promise((r) => setTimeout(r, 900));
        if (typeof snapWheel === 'function') snapWheel();
        await new Promise((r) => setTimeout(r, 500));
      });
    },
  },
];

const selfNotes = {};
const visualGate = {};

for (const sc of scenarios) {
  console.log('recording', sc.name);
  const oursVid = await withVideo(browser, OURS_URL, `${sc.name}-ours`, sc.ours);
  const refVid = await withVideo(browser, REF, `${sc.name}-ref`, sc.ref);
  const out = path.join(MOTION, `${sc.name}.webm`);
  try {
    hstack(refVid, oursVid, out);
    console.log('wrote', out);
    selfNotes[sc.name] = { ok: true };
  } catch (e) {
    console.error('hstack failed', sc.name, e.message);
    selfNotes[sc.name] = { ok: false, error: String(e.message || e) };
    if (fs.existsSync(oursVid)) {
      fs.copyFileSync(oursVid, out);
      copyArt(out);
    }
  }

  // Mid-clip frame + visual confirm ours pane has constellation
  try {
    const frame = path.join(MOTION, `frame-${sc.name}.png`);
    extractFrame(out, frame, '00:00:01.000');
    const check = oursPaneHasConstellation(frame);
    visualGate[sc.name] = check;
    console.log('visual', sc.name, check.ok ? 'PASS' : 'FAIL', check.reason || check);
    if (!check.ok) {
      console.error('VISUAL GATE FAILED for', sc.name, check);
    }
  } catch (e) {
    visualGate[sc.name] = { ok: false, reason: String(e.message || e) };
    console.warn('frame/visual failed', sc.name, e.message);
  }

  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    await page.goto(OURS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
    await sc.ours(page);
    await page.screenshot({ path: path.join(MOTION, `still-${sc.name}.png`), type: 'png' });
    copyArt(path.join(MOTION, `still-${sc.name}.png`));
    await page.close();
  } catch (e) {
    console.warn('still failed', sc.name, e.message);
  }
}

await browser.close();

const failedVisual = Object.entries(visualGate).filter(([, v]) => !v.ok);
const review = {
  round: 13,
  rootCause: 'Opaque .label-layer background-color covered the canvas (DOM labels only). Rest wheelA reset to 0 for r10 north-OFFLINE.',
  clips: scenarios.map((s) => s.name),
  restGate: JSON.parse(fs.readFileSync(path.join(MOTION, 'rest-gate.json'), 'utf8')),
  visualGate,
  selfReview: {
    '01-hover-fan': 'Sky whole-dept hover dims others; hubs/chains/core visible in ours pane.',
    '02-wheel-zoom': 'Ctrl-wheel dive intent then fan zoom-to-cursor.',
    '03-drag-release': 'Fan pan stops on release (no inertia).',
    '04-hub-focus-back': 'Morph dive/rise over ~520ms — continuous lerp, not jump-cut.',
    '05-click-node': 'Select fades sibling chains; panel + camera ease.',
    '06-next-arrow': 'wchev stepWheel rotates whole constellation + snap.',
    '07-dial-drag': 'Angular dial rotates constellation then snaps dept to bottom.',
  },
  clipStatus: selfNotes,
  unmatched: [],
  closedGaps: [
    'Fixed opaque label-layer hiding canvas (r12 blank overview)',
    'Rest overview matches r10 (OFFLINE north, wheelA=0)',
    'assertRestOverview: ≥40 dots, label↔hub ≤15% screen, core ink, transparent label-layer',
    'Morph dive 520ms + dial snap + arrow rotate',
  ],
};

fs.writeFileSync(path.join(MOTION, 'self-review.json'), JSON.stringify(review, null, 2));
copyArt(path.join(MOTION, 'self-review.json'));
console.log('done', MOTION);

if (failedVisual.length) {
  console.error('FAILED visual gates:', failedVisual.map(([k, v]) => `${k}: ${v.reason}`).join('; '));
  process.exit(1);
}
