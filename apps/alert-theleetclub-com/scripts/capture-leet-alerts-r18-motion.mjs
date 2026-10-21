#!/usr/bin/env node
/**
 * r18 clips + stills matching reference sequence:
 * idle 3s → hover category → click-dive → wheel zoom group→node → drag → zoom out.
 * 1280×800 → artifacts/ + Windows OneDrive Desktop r18-motion/
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r18-motion');
const DESK = '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review/r18-motion';
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?r18=1&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => window.LEET_ALERTS_MAP?.interactionConstants?.()?.aliveMotion);
  await page.waitForTimeout(500);
}

async function plainWheelAt(page, clientX, clientY, deltaY, steps, pause = 50) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(({ dy, cx, cy }) => {
      document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, deltaX: 0, ctrlKey: false, bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
      }));
    }, { dy: deltaY, cx: clientX, cy: clientY });
    await page.waitForTimeout(pause);
  }
}

async function hubPt(page, catId) {
  return page.evaluate((id) => {
    const hub = window.LEET_ALERTS_MAP.hubScreen(id);
    if (hub) {
      return {
        cx: Math.max(40, Math.min(innerWidth - 40, hub.x)),
        cy: Math.max(60, Math.min(innerHeight - 40, hub.y)),
      };
    }
    return { cx: innerWidth / 2, cy: innerHeight * 0.35 };
  }, catId);
}

async function recordClip(page, name, run) {
  const path = join(ART, `${name}.webm`);
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(ART, `${name}-start.png`) });
  const client = await page.context().newCDPSession(page);
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 72, everyNthFrame: 1 });
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push(Buffer.from(f.data, 'base64'));
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await run(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(ART, `${name}-end.png`) });
  try { await client.send('Page.stopScreencast'); } catch {}
  const tmp = join(ART, `_frames_${name}`);
  mkdirSync(tmp, { recursive: true });
  frames.forEach((buf, i) => writeFileSync(join(tmp, `f${String(i).padStart(4, '0')}.jpg`), buf));
  if (frames.length > 2) {
    try {
      execSync(`ffmpeg -y -framerate 20 -i '${tmp}/f%04d.jpg' -c:v libvpx-vp9 -b:v 1.2M '${path}'`, { stdio: 'pipe' });
    } catch {
      execSync(`ffmpeg -y -framerate 20 -i '${tmp}/f%04d.jpg' -c:v libvpx -b:v 1.2M '${path}'`, { stdio: 'pipe' });
    }
  }
  console.log(`  recorded ${name} (${frames.length} frames)`);
  return { frames: frames.length, path };
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await waitMap(page);

const review = {
  round: 18,
  viewport: { width: 1280, height: 800 },
  clips: {},
  stills: {},
  checks: {},
};

// Full-out still
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(400);
await page.screenshot({ path: join(ART, '00-full-out.png') });
review.stills.fullOut = true;

await recordClip(page, '01-ref-sequence', async (p) => {
  // 1) Idle 3s at overview (alive particles / core web)
  await p.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await p.waitForTimeout(3000);
  await p.screenshot({ path: join(ART, '01-idle.png') });

  // 2) Hover a category (OFFLINE)
  const offline = await hubPt(p, 'offline');
  await p.mouse.move(offline.cx, offline.cy);
  await p.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(ART, '02-hover-offline.png') });

  // 3) Click-dive
  await p.mouse.click(offline.cx, offline.cy);
  await p.waitForFunction(() => {
    const st = window.LEET_ALERTS_MAP.getMapState();
    return st === 'fan' || st === 'diving' || st === 'aligning';
  }, null, { timeout: 8000 });
  await p.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(ART, '03-dive-fan.png') });
  review.checks.dive = await p.evaluate(() => ({
    state: window.LEET_ALERTS_MAP.getMapState(),
    z: window.LEET_ALERTS_MAP.getTransform().zoom,
    focus: window.LEET_ALERTS_MAP.getFocus(),
    consts: {
      DIVE_MORPH_MS: window.LEET_ALERTS_MAP.interactionConstants().DIVE_MORPH_MS,
      DIVE_ZOOM_TARGET: window.LEET_ALERTS_MAP.interactionConstants().DIVE_ZOOM_TARGET,
    },
  }));

  // Back to sky for continuous zoom sequence
  await p.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
  await p.waitForTimeout(300);
  await p.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await p.waitForTimeout(250);

  // 4) Wheel zoom in through group → node labels
  const pt = await hubPt(p, 'offline');
  await p.mouse.move(pt.cx, pt.cy);
  for (let burst = 0; burst < 5; burst++) {
    await plainWheelAt(p, pt.cx, pt.cy, -100, 3, 45);
  }
  await p.waitForTimeout(400);
  await p.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
  await p.waitForTimeout(350);
  await p.screenshot({ path: join(ART, '04-zoom-group-node.png') });
  review.checks.zoomIn = await p.evaluate(() => ({
    lod: window.LEET_ALERTS_MAP.lodState(),
    overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
    particles: window.LEET_ALERTS_MAP.particleCount(),
    z: window.LEET_ALERTS_MAP.getTransform().zoom,
  }));

  // 5) Drag-to-pan
  const mid = await p.evaluate(() => ({ x: innerWidth * 0.55, y: innerHeight * 0.5 }));
  await p.mouse.move(mid.x, mid.y);
  await p.mouse.down();
  await p.mouse.move(mid.x - 120, mid.y + 40, { steps: 18 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(ART, '05-drag-pan.png') });

  // 6) Wheel zoom out to full
  for (let i = 0; i < 40; i++) {
    const z = await p.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
    if (z <= 1.05) break;
    const c = await p.evaluate(() => ({ cx: innerWidth / 2, cy: innerHeight / 2 }));
    await plainWheelAt(p, c.cx, c.cy, 110, 2, 35);
  }
  await p.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await p.waitForTimeout(450);
  await p.screenshot({ path: join(ART, '06-zoom-out-full.png') });
});

review.checks.particlesAtRest = await page.evaluate(() => ({
  n: window.LEET_ALERTS_MAP.particleCount(),
  organicCore: window.LEET_ALERTS_MAP.interactionConstants().organicCore,
}));

review.ok = (review.checks.dive?.state === 'fan')
  && (review.checks.dive?.z >= 4)
  && (review.checks.zoomIn?.overlaps === 0)
  && (review.checks.zoomIn?.lod?.node > 0.3 || review.checks.zoomIn?.lod?.group > 0.5)
  && (review.checks.particlesAtRest?.n >= 20);

review.clips['01-ref-sequence'] = {
  webm: existsSync(join(ART, '01-ref-sequence.webm')),
  start: existsSync(join(ART, '01-ref-sequence-start.png')),
  end: existsSync(join(ART, '01-ref-sequence-end.png')),
};

writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));
cpSync(ART, DESK, { recursive: true });
execSync(`rm -rf '${DESK}/_frames_01-ref-sequence' 2>/dev/null || true`);
console.log(JSON.stringify(review, null, 2));
console.log(`Desktop → ${DESK}`);
await browser.close();
process.exit(review.ok ? 0 : 1);
