#!/usr/bin/env node
/**
 * Capture round-10 overview / hover + print fan-angle diagnostics.
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
await page.goto(`${BASE}/alerts.html?r10=4`, { waitUntil: 'domcontentloaded', timeout: 20000 });
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

const diag = await page.evaluate(() => ({
  hub: window.LEET_ALERTS_MAP.hubRadiusRatio(),
  tip: window.LEET_ALERTS_MAP.tipRadiusRatio(),
  fans: window.LEET_ALERTS_MAP.fanSpanDegrees(),
  titles: window.LEET_ALERTS_MAP.titlesClearOfToolbar(),
  geom: window.LEET_ALERTS_MAP.overviewGeom(),
}));
console.log('diag', JSON.stringify(diag, null, 2));
const fanVals = Object.values(diag.fans);
const fanAvg = fanVals.reduce((s, d) => s + d, 0) / fanVals.length;
console.log(`fan angle avg=${fanAvg.toFixed(1)}° (target ~140°)`);

const overviewPath = path.join(OUT, 'overview-r10.png');
await page.screenshot({ path: overviewPath, type: 'png' });
fs.copyFileSync(overviewPath, path.join(ART, 'overview-r10.png'));
console.log('wrote', overviewPath);

await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('revenue'));
await page.waitForTimeout(400);
const hoverPath = path.join(OUT, 'hover-r10.png');
await page.screenshot({ path: hoverPath, type: 'png' });
fs.copyFileSync(hoverPath, path.join(ART, 'hover-r10.png'));
console.log('wrote', hoverPath);

fs.writeFileSync(path.join(OUT, 'fan-angles-r10.json'), JSON.stringify({ ...diag, fanAvg }, null, 2));

await browser.close();
console.log('capture done');
