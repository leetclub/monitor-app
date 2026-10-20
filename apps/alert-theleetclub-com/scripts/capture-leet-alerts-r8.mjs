#!/usr/bin/env node
/**
 * Capture round-8 overview / hover / category close-up for Desktop review.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review';
const ART = process.env.LEET_ART_DIR
  || '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts';
const REF = path.join(OUT, 'skilltree-ref', '01-overview.png');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

function cropPy(src, dest, left, top, width, height) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(src)})
W, H = im.size
l = max(0, min(W - 1, ${Math.round(left)}))
t = max(0, min(H - 1, ${Math.round(top)}))
w = min(${Math.round(width)}, W - l)
h = min(${Math.round(height)}, H - t)
im.crop((l, t, l + w, t + h)).save(${JSON.stringify(dest)})
print(l, t, w, h)
`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'crop failed');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/alerts.html?r8=4`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
await page.evaluate(() => {
  window.LEET_ALERTS_MAP.setIdleSpin(false);
  window.LEET_ALERTS_MAP.recenter();
});
await page.evaluate(() => window.LEET_ALERTS_MAP.waitForIdle());
await page.waitForTimeout(800);
await page.evaluate(async () => {
  if (document.fonts?.ready) await document.fonts.ready;
});
await page.waitForTimeout(250);

const overviewPath = path.join(OUT, 'overview-r8.png');
await page.screenshot({ path: overviewPath, type: 'png' });
fs.copyFileSync(overviewPath, path.join(ART, 'overview-r8.png'));
console.log('wrote', overviewPath);

await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('revenue'));
await page.waitForTimeout(400);
const hoverPath = path.join(OUT, 'hover-r8.png');
await page.screenshot({ path: hoverPath, type: 'png' });
fs.copyFileSync(hoverPath, path.join(ART, 'hover-r8.png'));
console.log('wrote', hoverPath);
await page.evaluate(() => window.LEET_ALERTS_MAP.setHover(null));

// Hub screen position for REVENUE (from live hit list)
const hub = await page.evaluate(() => {
  const hits = window.LEET_ALERTS_MAP._hitNodes
    || null;
  // Fallback: walk visible via temporary API — use label position + geom
  const el = document.querySelector('.cat-label[data-id="revenue"]');
  const canvas = document.getElementById('alerts-canvas');
  const cr = canvas.getBoundingClientRect();
  const g = window.LEET_ALERTS_MAP.overviewGeom();
  const cats = window.LEET_ALERTS_DATA.buildSnapshot().categories;
  const idx = cats.findIndex((c) => c.id === 'revenue');
  const rot = -Math.PI / 2;
  const a = (idx / cats.length) * Math.PI * 2 + rot;
  // Usable centre matches map (no panel open)
  const cx = cr.width / 2;
  const cy = cr.height / 2 + 0; // topbar inset handled in usable(); approx OK for crop
  // Prefer label rect to estimate outward; hub is inward from label
  let hx = cx + Math.cos(a) * g.rHub;
  let hy = cy + Math.sin(a) * g.rHub;
  if (el) {
    const lr = el.getBoundingClientRect();
    const lx = lr.left + lr.width / 2 - cr.left;
    const ly = lr.top + lr.height / 2 - cr.top;
    // Hub lies on the line from center toward label, at rHub/rLabel
    const t = g.rHub / g.rLabel;
    hx = cx + (lx - cx) * t;
    hy = cy + (ly - cy) * t;
  }
  return { hx, hy, tipR: g.rTip, rHub: g.rHub, W: cr.width, H: cr.height, a };
});

const cropSize = 440;
const oursCrop = path.join(OUT, 'closeup-ours-r8.png');
// Frame the fan: hub near inner edge, tips toward outer
const ox = Math.cos(hub.a);
const oy = Math.sin(hub.a);
const midX = hub.hx + ox * (hub.tipR - hub.rHub) * 0.45;
const midY = hub.hy + oy * (hub.tipR - hub.rHub) * 0.45;
const left = Math.max(0, Math.min(hub.W - cropSize, midX - cropSize / 2));
const top = Math.max(0, Math.min(hub.H - cropSize, midY - cropSize / 2));
cropPy(overviewPath, oursCrop, left, top, cropSize, cropSize);
fs.copyFileSync(oursCrop, path.join(ART, 'closeup-ours-r8.png'));
console.log('wrote', oursCrop, { left, top, midX, midY });

const refCrop = path.join(OUT, 'closeup-ref-r8.png');
if (fs.existsSync(REF)) {
  // BACK OFFICE fan — clear spoke zig-zag in skilltree ref
  cropPy(REF, refCrop, 580, 420, cropSize, cropSize);
  fs.copyFileSync(refCrop, path.join(ART, 'closeup-ref-r8.png'));
  console.log('wrote', refCrop);
} else {
  throw new Error(`missing ref ${REF}`);
}

await browser.close();
console.log('capture done');
