#!/usr/bin/env node
/**
 * Leet Alerts map acceptance (round 5): drawing fill, hub/tip geometry, overlaps.
 */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';

function fail(msg) {
  throw new Error(msg);
}

async function checkOverview(page, tag) {
  await page.evaluate(() => window.LEET_ALERTS_MAP.setIdleSpin(false));
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const overview = await page.evaluate(() => ({
    visible: window.LEET_ALERTS_MAP.visibleNodeCount(),
    nodeOverlaps: window.LEET_ALERTS_MAP.nodeOverlaps(),
    labelNodeOverlaps: window.LEET_ALERTS_MAP.labelNodeOverlaps(),
    fill: window.LEET_ALERTS_MAP.mapFillRatio(),
    hub: window.LEET_ALERTS_MAP.hubRadiusRatio(),
    tip: window.LEET_ALERTS_MAP.tipRadiusRatio(),
    overflow: window.LEET_ALERTS_MAP.viewportOverflow(),
  }));
  if (overview.visible < 60) fail(`${tag} visible ${overview.visible} < 60`);
  if (overview.nodeOverlaps > 0) fail(`${tag} node overlaps ${overview.nodeOverlaps}`);
  if (overview.labelNodeOverlaps > 0) fail(`${tag} label↔node ${overview.labelNodeOverlaps}`);
  if (overview.fill < 0.70) fail(`${tag} drawing fill ${overview.fill.toFixed(3)} < 0.70 (links+leaves, not labels)`);
  if (overview.hub < 0.20 || overview.hub > 0.30) {
    fail(`${tag} hub/label radius ${overview.hub.toFixed(3)} outside 0.20–0.30 (want ~0.22–0.25)`);
  }
  if (overview.tip < 0.82 || overview.tip > 0.96) {
    fail(`${tag} tip/label radius ${overview.tip.toFixed(3)} outside 0.82–0.96 (want ~0.85–0.90)`);
  }
  if (overview.overflow > 0) fail(`${tag} viewport overflow ${overview.overflow}`);
  return overview;
}

const browser = await chromium.launch({ headless: true });
const notes = [];

for (const vp of [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }]) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.goto(`${BASE}/alerts.html?r5=3`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
  const ov = await checkOverview(page, `${vp.w}x${vp.h}`);
  notes.push(
    `${vp.w}x${vp.h} visible=${ov.visible} drawFill=${ov.fill.toFixed(3)} hub=${ov.hub.toFixed(3)} tip=${ov.tip.toFixed(3)}`
  );

  if (vp.w === 1440) {
    await page.evaluate(async () => {
      window.LEET_ALERTS_MAP.focusCategory('offline');
      await window.LEET_ALERTS_MAP.waitForIdle();
    });
    await page.waitForTimeout(500);
    const focus = await page.evaluate(() => ({
      id: window.LEET_ALERTS_MAP.getFocus().categoryId,
      labeled: window.LEET_ALERTS_MAP.labeledNodeCount(),
    }));
    if (focus.id !== 'offline' || focus.labeled < 12) fail('focus broken');
    notes.push(`focus labeled=${focus.labeled}`);
    await page.evaluate(async () => {
      window.LEET_ALERTS_MAP.clearFocus();
      await window.LEET_ALERTS_MAP.waitForIdle();
    });
    await page.waitForTimeout(400);
    const restored = await checkOverview(page, 'restored');
    notes.push(`restored drawFill=${restored.fill.toFixed(3)}`);
  }
  await page.close();
}

console.log('leet-alerts OK');
notes.forEach((n) => console.log(' ', n));
await browser.close();
