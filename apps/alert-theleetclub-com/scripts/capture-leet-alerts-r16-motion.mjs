#!/usr/bin/env node
/**
 * r16 clips: plain-scroll zoom into a department (LOD labels) and back out — twice.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r16-motion');
const DESK = join(process.env.HOME || '', 'Desktop/leet-alerts-review/r16-motion');
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?r16=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function plainWheelAt(page, clientX, clientY, deltaY, steps, pause = 45) {
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await waitMap(page);
const review = { round: 16, clips: {}, checks: {} };

async function zoomIntoDept(page, catIndex) {
  const aim = await page.evaluate((idx) => {
    const m = window.LEET_ALERTS_MAP;
    m.recenter();
    const cat = m.snapshot().categories[idx];
    // Prefer live hub screen position from hit list
    const hub = (m.visibleNodeCount && null);
    void hub;
    return { catId: cat.id, cat: cat.label };
  }, catIndex);
  // Resolve hub screen coords after a paint
  await page.waitForTimeout(100);
  let pt = await page.evaluate((catId) => {
    // Fall back: angle from wheel seat
    const m = window.LEET_ALERTS_MAP;
    const cats = m.snapshot().categories;
    const idx = cats.findIndex((c) => c.id === catId);
    const a = (idx * (360 / cats.length)) * Math.PI / 180;
    return {
      cx: innerWidth / 2 + Math.sin(a) * Math.min(innerWidth, innerHeight) * 0.18,
      cy: innerHeight * 0.5 - Math.cos(a) * Math.min(innerWidth, innerHeight) * 0.18,
    };
  }, aim.catId);
  await page.mouse.move(pt.cx, pt.cy);
  await page.waitForTimeout(150);
  // Progressive zoom toward hub; re-aim each burst via map world→screen
  for (let burst = 0; burst < 6; burst++) {
    pt = await page.evaluate((catId) => {
      const m = window.LEET_ALERTS_MAP;
      const hub = m.hubScreen(catId);
      if (hub) {
        return {
          cx: Math.max(40, Math.min(innerWidth - 40, hub.x)),
          cy: Math.max(60, Math.min(innerHeight - 40, hub.y)),
        };
      }
      return { cx: innerWidth / 2, cy: innerHeight * 0.4 };
    }, aim.catId);
    await page.mouse.move(pt.cx, pt.cy);
    await plainWheelAt(page, pt.cx, pt.cy, -100, 4, 40);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ART, `deep-${aim.cat.toLowerCase().replace(/\s+/g, '-')}.png`) });
  const deep = await page.evaluate(() => ({
    lod: window.LEET_ALERTS_MAP.lodState(),
    transform: window.LEET_ALERTS_MAP.getTransform(),
    orphans: window.LEET_ALERTS_MAP.orphanLabels(),
    overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
    groups: [...document.querySelectorAll('.group-label.is-on')]
      .filter((e) => Number(getComputedStyle(e).opacity) > 0.15)
      .map((e) => e.textContent),
    nodes: [...document.querySelectorAll('.node-label.is-on')]
      .filter((e) => Number(getComputedStyle(e).opacity) > 0.15)
      .slice(0, 10)
      .map((e) => e.textContent),
  }));
  // Zoom back out (cursor at viewport center)
  const mid = await page.evaluate(() => ({ cx: innerWidth / 2, cy: innerHeight / 2 }));
  await plainWheelAt(page, mid.cx, mid.cy, 100, 24, 35);
  await page.waitForTimeout(350);
  return { aim, deep };
}

await recordClip(page, '01-scroll-zoom-offline', async (p) => {
  review.checks.offline = await zoomIntoDept(p, 0);
});
await recordClip(page, '02-scroll-zoom-tasks', async (p) => {
  review.checks.tasks = await zoomIntoDept(p, 3);
});

review.ok = (review.checks.offline?.deep?.orphans?.length === 0)
  && (review.checks.tasks?.deep?.orphans?.length === 0)
  && (review.checks.offline?.deep?.lod?.node > 0.5)
  && (review.checks.tasks?.deep?.lod?.node > 0.5)
  && (review.checks.offline?.deep?.overlaps === 0)
  && (review.checks.tasks?.deep?.overlaps === 0);

for (const name of ['01-scroll-zoom-offline', '02-scroll-zoom-tasks']) {
  review.clips[name] = {
    webm: existsSync(join(ART, `${name}.webm`)),
    start: existsSync(join(ART, `${name}-start.png`)),
    end: existsSync(join(ART, `${name}-end.png`)),
  };
  try {
    execSync(`ffmpeg -y -i '${join(ART, `${name}.webm`)}' -vf "select=eq(n\\,30)" -vframes 1 '${join(ART, `${name}-mid.png`)}'`, { stdio: 'pipe' });
  } catch {}
}

writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));
execSync(`cp -a '${ART}/.' '${DESK}/'`);
console.log(JSON.stringify(review, null, 2));
await browser.close();
process.exit(review.ok ? 0 : 1);
