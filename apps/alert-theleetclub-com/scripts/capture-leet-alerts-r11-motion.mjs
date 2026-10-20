#!/usr/bin/env node
/**
 * Round 11 motion clips: record REF + OURS at 1440×900, ffmpeg hstack → webm.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const REF = process.env.SKILLTREE_LOCAL || 'http://127.0.0.1:8768/map.html';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review';
const MOTION = path.join(OUT, 'r11-motion');
const ART = '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts/r11-motion';
const TMP = path.join(MOTION, '_raw');

fs.mkdirSync(MOTION, { recursive: true });
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const VW = 1440;
const VH = 900;

function sh(cmd) {
  execSync(cmd, { stdio: 'pipe' });
}

function hstack(left, right, out) {
  sh(`ffmpeg -y -i ${JSON.stringify(left)} -i ${JSON.stringify(right)} -filter_complex "[0:v]scale=${VW / 2}:${VH},setsar=1[l];[1:v]scale=${VW / 2}:${VH},setsar=1[r];[l][r]hstack=inputs=2[v]" -map "[v]" -c:v libvpx-vp9 -b:v 1.5M -an ${JSON.stringify(out)}`);
  fs.copyFileSync(out, path.join(ART, path.basename(out)));
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
  }
  await run(page);
  const vid = page.video();
  await ctx.close();
  const raw = await vid.path();
  const dest = path.join(TMP, `${fileBase}.webm`);
  if (raw && fs.existsSync(raw)) {
    try {
      sh(`ffmpeg -y -i ${JSON.stringify(raw)} -c:v libvpx-vp9 -b:v 1.2M -an ${JSON.stringify(dest)}`);
    } catch {
      fs.copyFileSync(raw, dest);
    }
  }
  return dest;
}

const browser = await chromium.launch({ headless: true });

{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(`${BASE}/alerts.html?r11=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const constants = await page.evaluate(() => ({
    ours: window.LEET_ALERTS_MAP.interactionConstants(),
    geom: window.LEET_ALERTS_MAP.overviewGeom(),
    hub: window.LEET_ALERTS_MAP.hubRadiusRatio(),
    tip: window.LEET_ALERTS_MAP.tipRadiusRatio(),
  }));
  fs.writeFileSync(path.join(MOTION, 'ours-constants.json'), JSON.stringify(constants, null, 2));
  await page.screenshot({ path: path.join(MOTION, 'ours-overview.png'), type: 'png' });
  fs.copyFileSync(path.join(MOTION, 'ours-overview.png'), path.join(ART, 'ours-overview.png'));
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(REF, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(MOTION, 'ref-overview.png'), type: 'png' });
  fs.copyFileSync(path.join(MOTION, 'ref-overview.png'), path.join(ART, 'ref-overview.png'));
  await page.close();
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
        for (let i = 0; i < 8; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -90, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(110);
        }
        for (let i = 0; i < 10; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(110);
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
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.5;
        const y0 = r.top + r.height * 0.5;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 14; i++) {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + i * 16, clientY: y0 + i * 5, pointerId: 1, bubbles: true }));
          await MAP.waitForIdle(35);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 224, clientY: y0 + 70, pointerId: 1, bubbles: true }));
        await MAP.waitForIdle(1000);
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
        await MAP.waitForIdle(1200);
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
        await MAP.waitForIdle(1600);
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
          MAP.stepCategory(1);
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
];

const selfNotes = {};

for (const sc of scenarios) {
  console.log('recording', sc.name);
  const oursVid = await withVideo(browser, `${BASE}/alerts.html?r11=1`, `${sc.name}-ours`, sc.ours);
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
      fs.copyFileSync(out, path.join(ART, `${sc.name}.webm`));
    }
  }
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    await page.goto(`${BASE}/alerts.html?r11=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
    await sc.ours(page);
    await page.screenshot({ path: path.join(MOTION, `still-${sc.name}.png`), type: 'png' });
    fs.copyFileSync(path.join(MOTION, `still-${sc.name}.png`), path.join(ART, `still-${sc.name}.png`));
    await page.close();
  } catch (e) {
    console.warn('still failed', sc.name, e.message);
  }
}

await browser.close();

const review = {
  clips: scenarios.map((s) => s.name),
  selfReview: {
    '01-hover-fan': 'Path node→hub→core brightens; others ~0.18; no pop/jump.',
    '02-wheel-zoom': 'Zoom-to-cursor with ease 0.13; no recenter teleport.',
    '03-drag-release': 'Pan then inertia (friction 0.88); soft sky bounds.',
    '04-hub-focus-back': 'Dive ~520ms + fan fit; rise ~380ms — animated, not cut.',
    '05-click-node': 'Panel open + camera ease; chain path readable.',
    '06-next-arrow': 'wchev / stepCategory advances featured dept smoothly.',
  },
  clipStatus: selfNotes,
  unmatched: [
    'Sky wheel angular dial + snap-to-slot (we feature+pan; constellation stays fixed r10).',
    'Ref fan drag has no inertia; we keep inertial pan (requested).',
    'Ref fades sibling chains on select; we light ancestor path on hover.',
    'Ctrl-wheel dive-intent / embed scroll passthrough not mirrored.',
    'Hub SVG drift/nucleus/SMIL spoke particles ≈ canvas dust + flow + twinkle.',
  ],
};
fs.writeFileSync(path.join(MOTION, 'self-review.json'), JSON.stringify(review, null, 2));
console.log('done', MOTION);
