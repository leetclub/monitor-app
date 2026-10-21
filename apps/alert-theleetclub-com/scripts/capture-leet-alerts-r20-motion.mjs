#!/usr/bin/env node
/**
 * r20: stills + 60fps sequence. Desktop → leet-alerts-review/r20-motion/
 * Self-checks diveIntegrity vs ref_sales geometry goals.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, cpSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r20-motion');
const DESK = '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review/r20-motion';
const REF_SALES = '/home/mahdi/.cursor/projects/home-mahdi-projects-monitoring-app-radial-local/assets/ref_sales.png';
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?v=20&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function plainWheelAt(page, clientX, clientY, deltaY, steps, pause = 40) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(({ dy, cx, cy }) => {
      document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
    }, { dy: deltaY, cx: clientX, cy: clientY });
    await page.waitForTimeout(pause);
  }
}

async function hubPt(page, catId) {
  return page.evaluate((id) => {
    const hub = window.LEET_ALERTS_MAP.hubScreen(id);
    if (hub) return { cx: hub.x, cy: hub.y };
    return { cx: innerWidth / 2, cy: innerHeight * 0.35 };
  }, catId);
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({
  viewport: { width: 1280, height: 800 },
})).newPage();
await waitMap(page);

const metrics = [];
const pushMetric = async (tag) => {
  const f = await page.evaluate((tag) => {
    const m = window.LEET_ALERTS_MAP.sampleMotionFrame();
    return { tag, ...m };
  }, tag);
  metrics.push(f);
};

// --- Stills ---
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(1600);
await pushMetric('overview-idle');
await page.screenshot({ path: join(ART, '00-overview.png') });

const offline = await hubPt(page, 'offline');
await page.mouse.move(offline.cx, offline.cy);
await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
await page.waitForTimeout(400);
await pushMetric('hover');
await page.screenshot({ path: join(ART, '01-hover.png') });

await page.mouse.click(offline.cx, offline.cy);
const diveT0 = Date.now();
while (Date.now() - diveT0 < 3000) {
  await pushMetric('dive');
  const st = await page.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
  if (st === 'fan') break;
  await page.waitForTimeout(16);
}
await page.waitForTimeout(250);
await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
await page.waitForTimeout(100);
const diveIntegrity = await page.evaluate(() => window.LEET_ALERTS_MAP.diveIntegrity(28));
await pushMetric('dive-end');
await page.screenshot({ path: join(ART, '02-dive-fan.png') });
if (existsSync(REF_SALES)) {
  try { copyFileSync(REF_SALES, join(ART, 'ref_sales.png')); } catch {}
}

await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
await page.waitForTimeout(200);
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(200);

const pt = await hubPt(page, 'offline');
for (let b = 0; b < 8; b++) {
  await plainWheelAt(page, pt.cx, pt.cy, -90, 2, 35);
  await pushMetric('wheel-in');
}
await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
await page.waitForTimeout(400);
const zoomCoreOp = await page.evaluate(() => window.LEET_ALERTS_MAP.coreDrawOpacity());
await pushMetric('zoom-deep');
await page.screenshot({ path: join(ART, '03-zoom-group-node.png') });

const mid = await page.evaluate(() => ({ x: innerWidth * 0.55, y: innerHeight * 0.5 }));
await page.mouse.move(mid.x, mid.y);
await page.mouse.down();
await page.mouse.move(mid.x - 100, mid.y + 30, { steps: 20 });
await page.mouse.up();
await pushMetric('drag');
await page.screenshot({ path: join(ART, '04-drag.png') });

for (let i = 0; i < 50; i++) {
  const z = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
  if (z <= 1.05) break;
  const c = await page.evaluate(() => ({ cx: innerWidth / 2, cy: innerHeight / 2 }));
  await plainWheelAt(page, c.cx, c.cy, 100, 2, 30);
  await pushMetric('wheel-out');
}
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(400);
await pushMetric('overview-end');
await page.screenshot({ path: join(ART, '05-overview-return.png') });

// --- Sequence screencast @ high rate ---
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(400);
const client = await page.context().newCDPSession(page);
await client.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
const frames = [];
const seqMetrics = [];
client.on('Page.screencastFrame', async (f) => {
  frames.push(Buffer.from(f.data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});

const seqLog = setInterval(async () => {
  try {
    const f = await page.evaluate(() => window.LEET_ALERTS_MAP.sampleMotionFrame());
    seqMetrics.push(f);
  } catch {}
}, 16);

await page.waitForTimeout(2500);
await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
await page.waitForTimeout(600);
const hub = await hubPt(page, 'offline');
await page.mouse.click(hub.cx, hub.cy);
await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 8000 });
await page.waitForTimeout(500);
await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus());
await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'sky', null, { timeout: 5000 });
await page.waitForTimeout(200);
const hub2 = await hubPt(page, 'offline');
for (let b = 0; b < 6; b++) await plainWheelAt(page, hub2.cx, hub2.cy, -100, 3, 40);
await page.waitForTimeout(300);
const mid2 = await page.evaluate(() => ({ x: innerWidth * 0.5, y: innerHeight * 0.5 }));
await page.mouse.move(mid2.x, mid2.y);
await page.mouse.down();
await page.mouse.move(mid2.x + 80, mid2.y - 40, { steps: 16 });
await page.mouse.up();
for (let i = 0; i < 35; i++) {
  const z = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
  if (z <= 1.05) break;
  await plainWheelAt(page, 640, 400, 110, 2, 30);
}
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(500);

clearInterval(seqLog);
try { await client.send('Page.stopScreencast'); } catch {}

const tmp = join(ART, '_frames_seq');
mkdirSync(tmp, { recursive: true });
frames.forEach((buf, i) => writeFileSync(join(tmp, `f${String(i).padStart(4, '0')}.jpg`), buf));
const webm = join(ART, '01-ref-sequence.webm');
try {
  execSync(`ffmpeg -y -framerate 60 -i '${tmp}/f%04d.jpg' -c:v libvpx-vp9 -b:v 2M '${webm}'`, { stdio: 'pipe' });
} catch {
  execSync(`ffmpeg -y -framerate 30 -i '${tmp}/f%04d.jpg' -c:v libvpx -b:v 1.5M '${webm}'`, { stdio: 'pipe' });
}

let maxZoomJump = 0;
for (let i = 1; i < seqMetrics.length; i++) {
  const d = Math.abs(seqMetrics[i].zoom - seqMetrics[i - 1].zoom) / Math.max(seqMetrics[i - 1].zoom, 0.01);
  if (d > maxZoomJump) maxZoomJump = d;
}

const review = {
  round: 20,
  framesCaptured: frames.length,
  metricsSamples: seqMetrics.length,
  maxZoomRelJump: maxZoomJump,
  diveIntegrity,
  zoomCoreOpacity: zoomCoreOp,
  stills: {
    overview: existsSync(join(ART, '00-overview.png')),
    dive: existsSync(join(ART, '02-dive-fan.png')),
    zoom: existsSync(join(ART, '03-zoom-group-node.png')),
    refSalesCopied: existsSync(join(ART, 'ref_sales.png')),
  },
  webm: existsSync(webm),
  notes: {
    overview: 'r19 keep — sparse 3 chains, solid leaves, idle rotate',
    dive: 'sector fan (FAN_SPAN/ng), short zig + side leaves, zero cross-chain, core hidden',
    zoom: 'core faded at LOD_GROUP; label↔edge collision + chrome fade',
    compare: 'Open 02-dive-fan.png next to ref_sales.png — non-crossing upward fans from 3 group rings',
  },
  pass: !!(diveIntegrity && diveIntegrity.ok && zoomCoreOp < 0.35),
};

writeFileSync(join(ART, 'per-frame-metrics.json'), JSON.stringify({ stills: metrics, sequence: seqMetrics }, null, 2));
writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));
cpSync(ART, DESK, { recursive: true });
execSync(`rm -rf '${DESK}/_frames_seq' 2>/dev/null || true`);
console.log(JSON.stringify(review, null, 2));
console.log(`Desktop → ${DESK}`);
await browser.close();
process.exit(review.webm && review.stills.overview && review.pass ? 0 : 1);
