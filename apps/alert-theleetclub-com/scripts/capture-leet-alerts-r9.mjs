#!/usr/bin/env node
/**
 * Capture round-9 overview / hover stills for Desktop review folder.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review';
const ART = process.env.LEET_ART_DIR
  || '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/alerts.html?r9=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
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
await page.waitForTimeout(200);

const overviewPath = path.join(OUT, 'overview-r9.png');
await page.screenshot({ path: overviewPath, type: 'png' });
fs.copyFileSync(overviewPath, path.join(ART, 'overview-r9.png'));
console.log('wrote', overviewPath);

const titles = await page.evaluate(() => window.LEET_ALERTS_MAP.titlesClearOfToolbar());
console.log('titlesClearOfToolbar', JSON.stringify(titles));

await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('revenue'));
await page.waitForTimeout(400);
const hoverPath = path.join(OUT, 'hover-r9.png');
await page.screenshot({ path: hoverPath, type: 'png' });
fs.copyFileSync(hoverPath, path.join(ART, 'hover-r9.png'));
console.log('wrote', hoverPath);

await browser.close();
console.log('capture done');
