#!/usr/bin/env node
/**
 * Capture round-6 overview / hover stills + short hover+drag+click webm.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/Desktop/leet-alerts-review';
const ASSETS = '/home/mahdi/.cursor/projects/home-mahdi-projects-monitoring-app-radial-local/assets';
const ART = process.env.LEET_ART_DIR
  || '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/alerts.html?r6=9`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
await page.evaluate(() => window.LEET_ALERTS_MAP.setIdleSpin(false));
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.evaluate(() => window.LEET_ALERTS_MAP.waitForIdle());
await page.waitForTimeout(700);

const overviewPath = path.join(OUT, 'overview-r6.png');
await page.screenshot({ path: overviewPath, type: 'png' });
fs.copyFileSync(overviewPath, path.join(ART, 'overview-r6.png'));
fs.copyFileSync(overviewPath, path.join(ASSETS, 'overview-r6.png'));
console.log('wrote', overviewPath);

await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('revenue'));
await page.waitForTimeout(350);
const hoverPath = path.join(OUT, 'hover-r6.png');
await page.screenshot({ path: hoverPath, type: 'png' });
fs.copyFileSync(hoverPath, path.join(ART, 'hover-r6.png'));
fs.copyFileSync(hoverPath, path.join(ASSETS, 'hover-r6.png'));
console.log('wrote', hoverPath);

await page.evaluate(() => window.LEET_ALERTS_MAP.setHover(null));
await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await page.waitForTimeout(200);

const webmPath = path.join(OUT, 'hover-r6.webm');
const recordPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await recordPage.goto(`${BASE}/alerts.html?r6=9`, { waitUntil: 'domcontentloaded' });
await recordPage.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP);
await recordPage.evaluate(() => {
  window.LEET_ALERTS_MAP.setIdleSpin(false);
  window.LEET_ALERTS_MAP.recenter();
});
await recordPage.waitForTimeout(400);

const context = recordPage.context();
// Playwright video: recreate page with recordVideo
await recordPage.close();
const videoDir = path.join(OUT, '_video_tmp');
fs.mkdirSync(videoDir, { recursive: true });
const vContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const vPage = await vContext.newPage();
await vPage.goto(`${BASE}/alerts.html?r6=9`, { waitUntil: 'domcontentloaded' });
await vPage.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP);
await vPage.evaluate(() => {
  window.LEET_ALERTS_MAP.setIdleSpin(false);
  window.LEET_ALERTS_MAP.recenter();
});
await vPage.waitForTimeout(400);

// Hover revenue hub area (right side)
const hub = await vPage.evaluate(() => {
  const nodes = [];
  // use transform center; pick via setHover + visual
  window.LEET_ALERTS_MAP.setHover('revenue');
  return true;
});
await vPage.waitForTimeout(500);
await vPage.evaluate(() => window.LEET_ALERTS_MAP.setHover('offline'));
await vPage.waitForTimeout(400);
await vPage.evaluate(() => window.LEET_ALERTS_MAP.setHover(null));
await vPage.waitForTimeout(200);

// Drag pan
const box = await vPage.locator('#alerts-canvas').boundingBox();
if (box) {
  await vPage.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await vPage.mouse.down();
  await vPage.mouse.move(box.x + box.width * 0.5 + 80, box.y + box.height * 0.55 - 40, { steps: 12 });
  await vPage.mouse.up();
}
await vPage.waitForTimeout(350);
await vPage.evaluate(() => window.LEET_ALERTS_MAP.recenter());
await vPage.waitForTimeout(250);

// Click a category hub to enter focus
await vPage.evaluate(() => window.LEET_ALERTS_MAP.focusCategory('offline'));
await vPage.waitForTimeout(700);
await vPage.evaluate(() => window.LEET_ALERTS_MAP.clearFocus());
await vPage.waitForTimeout(500);

await vPage.close();
await vContext.close();

const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
if (!videos.length) throw new Error('no webm recorded');
const src = path.join(videoDir, videos[0]);
fs.copyFileSync(src, webmPath);
fs.copyFileSync(src, path.join(ART, 'hover-r6.webm'));
fs.rmSync(videoDir, { recursive: true, force: true });
console.log('wrote', webmPath);

await browser.close();
console.log('capture done');
