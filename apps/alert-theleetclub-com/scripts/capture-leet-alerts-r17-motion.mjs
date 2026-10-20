#!/usr/bin/env node
/**
 * r17 clips + stills: dense fans, scroll zoom with camera settle, LOD tiers.
 * Writes to artifacts/ and Windows Desktop via /mnt/c/...
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r17-motion');
const DESK = '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review/r17-motion';
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?r17=1&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => window.LEET_ALERTS_MAP?.interactionConstants?.()?.denseGroupForks);
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

async function zoomToAbsolute(page, catId, targetZ) {
  const pt = await hubPt(page, catId);
  await page.mouse.move(pt.cx, pt.cy);
  await page.evaluate(({ id, z, cx, cy }) => {
    const m = window.LEET_ALERTS_MAP;
    const hub = m.hubScreen(id) || { x: cx, y: cy };
    const cur = Math.max(m.getTransform().zoom, 0.01);
    m.zoomAt(hub.x, hub.y, z / cur);
  }, { id: catId, z: targetZ, cx: pt.cx, cy: pt.cy });
  await page.waitForTimeout(80);
  await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
  await page.waitForTimeout(420);
}

async function zoomIntoDept(page, catIndex, stillPrefix) {
  const aim = await page.evaluate((idx) => {
    const m = window.LEET_ALERTS_MAP;
    m.recenter();
    const cat = m.snapshot().categories[idx];
    return {
      catId: cat.id, cat: cat.label, spokes: m.overviewSpokeCount(cat.id),
      groupZ: m.interactionConstants().LOD_GROUP_FULL,
      nodeZ: m.interactionConstants().Z_SKY_MAX,
    };
  }, catIndex);
  await page.waitForTimeout(120);

  // Group-tier still (exactly at LOD_GROUP_FULL — not into node tier)
  await zoomToAbsolute(page, aim.catId, aim.groupZ);
  await page.screenshot({ path: join(ART, `${stillPrefix}-group.png`) });

  // Scroll-zoom motion toward deep, then node-tier still after settle
  for (let burst = 0; burst < 6; burst++) {
    const pt = await hubPt(page, aim.catId);
    await plainWheelAt(page, pt.cx, pt.cy, -100, 3, 40);
  }
  await page.waitForTimeout(280);
  await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(ART, `${stillPrefix}-node.png`) });

  const deep = await page.evaluate(() => ({
    lod: window.LEET_ALERTS_MAP.lodState(),
    transform: window.LEET_ALERTS_MAP.getTransform(),
    orphans: window.LEET_ALERTS_MAP.orphanLabels(),
    overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
    empty: window.LEET_ALERTS_MAP.viewportEmptyRatio(),
    arrow: window.LEET_ALERTS_MAP.wchevOpacity(),
    groups: [...document.querySelectorAll('.group-label.is-on')]
      .filter((e) => Number(getComputedStyle(e).opacity) > 0.15)
      .map((e) => e.textContent),
    nodes: [...document.querySelectorAll('.node-label.is-on')]
      .filter((e) => Number(getComputedStyle(e).opacity) > 0.15)
      .slice(0, 12)
      .map((e) => e.textContent),
  }));

  // Zoom back out to Fit
  for (let i = 0; i < 40; i++) {
    const z = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
    if (z <= 1.05) break;
    const mid = await page.evaluate(() => ({ cx: innerWidth / 2, cy: innerHeight / 2 }));
    await plainWheelAt(page, mid.cx, mid.cy, 100, 2, 30);
  }
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.waitForTimeout(400);
  return { aim, deep };
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await waitMap(page);
const review = { round: 17, clips: {}, checks: {}, stills: {} };

// Full-out still
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(400);
await page.screenshot({ path: join(ART, '00-full-out.png') });
review.stills.fullOut = true;

await recordClip(page, '01-scroll-zoom-offline', async (p) => {
  review.checks.offline = await zoomIntoDept(p, 0, '01-offline');
});
await recordClip(page, '02-scroll-zoom-tasks', async (p) => {
  review.checks.tasks = await zoomIntoDept(p, 3, '02-tasks');
});

review.ok = (review.checks.offline?.deep?.orphans?.length === 0)
  && (review.checks.tasks?.deep?.orphans?.length === 0)
  && (review.checks.offline?.deep?.overlaps === 0)
  && (review.checks.tasks?.deep?.overlaps === 0)
  && (review.checks.offline?.deep?.empty <= 0.25)
  && (review.checks.tasks?.deep?.empty <= 0.25)
  && (review.checks.offline?.deep?.lod?.node > 0.5)
  && (review.checks.tasks?.deep?.lod?.node > 0.5)
  && (review.checks.offline?.aim?.spokes >= 7)
  && (review.checks.tasks?.aim?.spokes >= 7);

for (const name of ['01-scroll-zoom-offline', '02-scroll-zoom-tasks']) {
  review.clips[name] = {
    webm: existsSync(join(ART, `${name}.webm`)),
    start: existsSync(join(ART, `${name}-start.png`)),
    end: existsSync(join(ART, `${name}-end.png`)),
  };
}

writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));
cpSync(ART, DESK, { recursive: true });
// Keep Desktop lean: webms + key stills only
execSync(`rm -rf '${DESK}/_frames_01-scroll-zoom-offline' '${DESK}/_frames_02-scroll-zoom-tasks' 2>/dev/null || true`);
console.log(JSON.stringify(review, null, 2));
await browser.close();
process.exit(review.ok ? 0 : 1);
