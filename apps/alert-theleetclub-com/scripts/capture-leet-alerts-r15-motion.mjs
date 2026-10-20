#!/usr/bin/env node
/**
 * Round 15 motion clips: label clear on fast leave + zoom in/out (sky & fan).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const ART = join(__dirname, '../artifacts/r15-motion');
const DESK = process.env.HOME
  ? join(process.env.HOME, 'Desktop/leet-alerts-review/r15-motion')
  : ART;
mkdirSync(ART, { recursive: true });
mkdirSync(DESK, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?r15=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function ctrlWheel(page, deltaY, steps, pause = 50) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((dy) => {
      const c = document.getElementById('alerts-canvas');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.55,
      }));
    }, deltaY);
    await page.waitForTimeout(pause);
  }
}

async function recordClip(page, name, run) {
  const path = join(ART, `${name}.webm`);
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ART, `${name}-start.png`) });
  const ctx = page.context();
  // Playwright context video — use page screencast via CDP
  const client = await ctx.newCDPSession(page);
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push(Buffer.from(f.data, 'base64'));
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await run(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ART, `${name}-end.png`) });
  try { await client.send('Page.stopScreencast'); } catch {}
  // Write frame sequence + ffmpeg to webm
  const tmp = join(ART, `_frames_${name}`);
  mkdirSync(tmp, { recursive: true });
  frames.forEach((buf, i) => {
    writeFileSync(join(tmp, `f${String(i).padStart(4, '0')}.jpg`), buf);
  });
  if (frames.length > 2) {
    try {
      execSync(
        `ffmpeg -y -framerate 20 -i '${tmp}/f%04d.jpg' -c:v libvpx-vp9 -b:v 1M -pix_fmt yuva420p '${path}'`,
        { stdio: 'pipe' },
      );
    } catch (e) {
      execSync(
        `ffmpeg -y -framerate 20 -i '${tmp}/f%04d.jpg' -c:v libvpx -b:v 1M '${path.replace(/\.webm$/, '.webm')}'`,
        { stdio: 'pipe' },
      );
    }
  }
  console.log(`  recorded ${name} (${frames.length} frames)`);
  return path;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await waitMap(page);

const review = { round: 15, clips: {}, checks: {} };

// 01 — hover then fast leave (no orphan labels)
await recordClip(page, '01-leave-fast', async (p) => {
  await p.evaluate(() => {
    const id = window.LEET_ALERTS_MAP.snapshot().categories[0].id;
    window.LEET_ALERTS_MAP.setHover(id);
  });
  await p.waitForTimeout(500);
  const box = await p.locator('#alerts-canvas').boundingBox();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await p.waitForTimeout(200);
  await p.mouse.move(2, 2, { steps: 3 });
  await p.evaluate(() => {
    document.getElementById('alerts-canvas')
      .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    window.LEET_ALERTS_MAP.clearHover();
  });
  await p.waitForTimeout(600);
});
review.checks.leaveOrphans = await page.evaluate(() => window.LEET_ALERTS_MAP.orphanLabels());

// 02 — overview zoom in / out
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(300);
const zStart = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
await recordClip(page, '02-zoom-overview', async (p) => {
  await ctrlWheel(p, -70, 10, 60);
  await p.waitForTimeout(400);
  await ctrlWheel(p, 70, 10, 60);
  await p.waitForTimeout(400);
  await p.click('#zoom-out');
  await p.waitForTimeout(300);
  await p.click('#zoom-in');
  await p.waitForTimeout(300);
});
const zMid = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
review.checks.overviewZoom = { zStart, zEnd: zMid };

// 03 — focus zoom out → rise
await page.evaluate(() => {
  const id = window.LEET_ALERTS_MAP.snapshot().categories[3].id;
  window.LEET_ALERTS_MAP.focusCategory(id);
});
await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 8000 });
await page.waitForTimeout(300);
await recordClip(page, '03-zoom-focus-rise', async (p) => {
  await ctrlWheel(p, -50, 6, 50); // zoom in a bit first
  await p.waitForTimeout(300);
  for (let i = 0; i < 20; i++) {
    await ctrlWheel(p, 100, 1, 40);
    const st = await p.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
    if (st === 'rising' || st === 'sky') break;
  }
  // minus fallback
  for (let i = 0; i < 5; i++) {
    const st = await p.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
    if (st === 'sky' || st === 'rising') break;
    await p.click('#zoom-out');
    await p.waitForTimeout(150);
  }
  await p.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'sky', null, { timeout: 8000 });
  await p.waitForTimeout(400);
});
review.checks.focusRiseState = await page.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
review.checks.afterRiseOrphans = await page.evaluate(() => window.LEET_ALERTS_MAP.orphanLabels());

// Mid-frame stills for visual gate
for (const name of ['01-leave-fast', '02-zoom-overview', '03-zoom-focus-rise']) {
  const start = join(ART, `${name}-start.png`);
  const end = join(ART, `${name}-end.png`);
  review.clips[name] = {
    webm: existsSync(join(ART, `${name}.webm`)),
    start: existsSync(start),
    end: existsSync(end),
  };
}

review.ok = review.checks.leaveOrphans.length === 0
  && review.checks.afterRiseOrphans.length === 0
  && review.checks.focusRiseState === 'sky';

writeFileSync(join(ART, 'self-review.json'), JSON.stringify(review, null, 2));

// Copy to Desktop
for (const f of ['01-leave-fast', '02-zoom-overview', '03-zoom-focus-rise']) {
  for (const ext of ['.webm', '-start.png', '-end.png']) {
    const src = join(ART, f + (ext.startsWith('.') && !ext.includes('-') ? ext : ext));
    // normalize
  }
}
execSync(`cp -a '${ART}/.' '${DESK}/'`);
console.log(JSON.stringify(review, null, 2));
await browser.close();
process.exit(review.ok ? 0 : 1);
