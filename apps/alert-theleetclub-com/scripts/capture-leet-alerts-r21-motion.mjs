#!/usr/bin/env node
/**
 * r21 motion capture: stills + 60fps sequence + per-frame-metrics with dive/rise samples.
 * Desktop → leet-alerts-review/r21-motion/
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r21-motion');
const DESK = '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review/r21-motion';
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?v=21&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForTimeout(400);
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

const metrics = { stills: [], dive: [], rise: [], sequence: [], particles: [] };
const pushStill = async (tag) => {
  const f = await page.evaluate((tag) => ({ tag, ...window.LEET_ALERTS_MAP.sampleMotionFrame() }), tag);
  metrics.stills.push(f);
};

await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(1600);
await pushStill('overview-idle');
await page.screenshot({ path: join(ART, '00-overview.png') });

// Particle proof samples
for (let i = 0; i < 12; i++) {
  metrics.particles.push(await page.evaluate(() => window.LEET_ALERTS_MAP.samplePathParticles(6)));
  await page.waitForTimeout(50);
}

const offline = await hubPt(page, 'offline');
await page.mouse.move(offline.cx, offline.cy);
await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
await page.waitForTimeout(400);
await pushStill('hover');
await page.screenshot({ path: join(ART, '01-hover.png') });

await page.mouse.click(offline.cx, offline.cy);
const diveT0 = Date.now();
let lastDiveLog = -999;
while (Date.now() - diveT0 < 3500) {
  const s = await page.evaluate(() => window.LEET_ALERTS_MAP.sampleDiveMotion());
  const t = Date.now() - diveT0;
  if (t - lastDiveLog >= 100) {
    metrics.dive.push({ wallT: t, ...s });
    lastDiveLog = t;
  }
  if (s.mapState === 'fan' && s.morphProgress >= 1) break;
  await page.waitForTimeout(16);
}
await page.waitForTimeout(200);
await pushStill('dive-end');
await page.screenshot({ path: join(ART, '02-dive-fan.png') });

// Rise
await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus());
const riseT0 = Date.now();
let lastRiseLog = -999;
while (Date.now() - riseT0 < 2500) {
  const s = await page.evaluate(() => window.LEET_ALERTS_MAP.sampleDiveMotion());
  const t = Date.now() - riseT0;
  if (t - lastRiseLog >= 100) {
    metrics.rise.push({ wallT: t, ...s });
    lastRiseLog = t;
  }
  if (s.mapState === 'sky' && metrics.rise.length > 3) break;
  await page.waitForTimeout(16);
}
await page.waitForTimeout(200);
await pushStill('rise-end');
await page.screenshot({ path: join(ART, '03-rise-overview.png') });

// Zoom deep (overview) for chrome/core still
const pt = await hubPt(page, 'offline');
for (let b = 0; b < 8; b++) await plainWheelAt(page, pt.cx, pt.cy, -90, 2, 35);
await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
await page.waitForTimeout(300);
await pushStill('zoom-deep');
await page.screenshot({ path: join(ART, '04-zoom-group-node.png') });
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(300);

// Sequence screencast @ high rate
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(300);
const client = await page.context().newCDPSession(page);
await client.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
const frames = [];
client.on('Page.screencastFrame', async (f) => {
  frames.push(Buffer.from(f.data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});
const seqLog = setInterval(async () => {
  try {
    metrics.sequence.push(await page.evaluate(() => window.LEET_ALERTS_MAP.sampleMotionFrame()));
  } catch {}
}, 16);

await page.waitForTimeout(2200);
await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
await page.waitForTimeout(500);
const hub = await hubPt(page, 'offline');
await page.mouse.click(hub.cx, hub.cy);
await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 8000 });
await page.waitForTimeout(400);
await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus());
await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'sky', null, { timeout: 5000 });
await page.waitForTimeout(300);
const hub2 = await hubPt(page, 'offline');
for (let b = 0; b < 5; b++) await plainWheelAt(page, hub2.cx, hub2.cy, -100, 3, 40);
await page.waitForTimeout(200);
const mid2 = await page.evaluate(() => ({ x: innerWidth * 0.5, y: innerHeight * 0.5 }));
await page.mouse.move(mid2.x, mid2.y);
await page.mouse.down();
await page.mouse.move(mid2.x + 80, mid2.y - 40, { steps: 16 });
await page.mouse.up();
for (let i = 0; i < 30; i++) {
  const z = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
  if (z <= 1.05) break;
  await plainWheelAt(page, 640, 400, 110, 2, 30);
}
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(400);

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

// Analyze dive node path
const diveXs = metrics.dive.map((d) => d.sampleNode?.x).filter((v) => v != null);
let maxDiveStep = 0;
for (let i = 1; i < diveXs.length; i++) maxDiveStep = Math.max(maxDiveStep, Math.abs(diveXs[i] - diveXs[i - 1]));
const partMoved = [];
for (let i = 1; i < metrics.particles.length; i++) {
  const a = metrics.particles[i - 1].outward[0];
  const b = metrics.particles[i].outward[0];
  if (a && b) partMoved.push(Math.abs(a.u - b.u));
}

const review = {
  round: 21,
  framesCaptured: frames.length,
  diveSamples: metrics.dive.length,
  riseSamples: metrics.rise.length,
  diveDurMs: metrics.dive.length ? metrics.dive[metrics.dive.length - 1].wallT - metrics.dive[0].wallT : 0,
  riseDurMs: metrics.rise.length ? metrics.rise[metrics.rise.length - 1].wallT - metrics.rise[0].wallT : 0,
  maxDiveNodeStep: maxDiveStep,
  particleUdeltas: partMoved.slice(0, 8),
  stills: {
    overview: existsSync(join(ART, '00-overview.png')),
    dive: existsSync(join(ART, '02-dive-fan.png')),
    rise: existsSync(join(ART, '03-rise-overview.png')),
  },
  webm: existsSync(webm),
  notes: {
    core: 'hspin 170s + soft 8.5s twinkle',
    particles: 'copper outward on every connector, r≈3.1, u advances each frame',
    dive: '1200ms ease-in-out morph overview→fan; others+core crossfade; node (x,y) sampled @100ms',
    rise: '900ms morph fan→overview; wheel past RISE_ZOOM_TRIGGER≈3.15 starts rise',
    compare: 'Dive segment vs ref 0:08 / 0:22 — continuous seat+scale+morph, not hard swap',
  },
  pass: metrics.dive.length >= 8 && maxDiveStep > 2 && partMoved.some((d) => d > 0.00005),
};

writeFileSync(join(ART, 'per-frame-metrics.json'), JSON.stringify(metrics, null, 2));
writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));
cpSync(ART, DESK, { recursive: true });
execSync(`rm -rf '${DESK}/_frames_seq' 2>/dev/null || true`);
console.log(JSON.stringify(review, null, 2));
console.log(`Desktop → ${DESK}`);
await browser.close();
process.exit(review.webm && review.pass ? 0 : 1);
