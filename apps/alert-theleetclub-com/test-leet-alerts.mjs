#!/usr/bin/env node
/**
 * Leet Alerts map acceptance (round 2): density, focus labels, viewport, panels.
 */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';

function fail(msg) {
  throw new Error(msg);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const notes = [];

await page.goto(`${BASE}/alerts.html?r2=2`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.evaluate(async () => {
  // Avoid stale module cache during local iteration.
  if (window.LEET_ALERTS_MAP) return;
});
await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
await page.waitForTimeout(600);

const snap = await page.evaluate(() => window.LEET_ALERTS_MAP.getCounters());
if (snap.totalNodes < 60) fail(`snapshot nodes ${snap.totalNodes} < 60`);
notes.push(`snapshot nodes=${snap.totalNodes} open=${snap.open} machines=${snap.machines}`);

const overview = await page.evaluate(() => ({
  visible: window.LEET_ALERTS_MAP.visibleNodeCount(),
  collisions: window.LEET_ALERTS_MAP.labelCollisions(),
  overflow: window.LEET_ALERTS_MAP.viewportOverflow(),
}));
if (overview.visible < 60) fail(`overview visible nodes ${overview.visible} < 60`);
if (overview.collisions > 4) fail(`overview label collisions ${overview.collisions}`);
if (overview.overflow > 0) fail(`viewport overflow elements ${overview.overflow}`);
notes.push(`overview visible=${overview.visible} collisions=${overview.collisions}`);

await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.focusCategory('offline');
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(500);
const focus = await page.evaluate(() => ({
  id: window.LEET_ALERTS_MAP.getFocus().categoryId,
  labeled: window.LEET_ALERTS_MAP.labeledNodeCount(),
  visible: window.LEET_ALERTS_MAP.visibleNodeCount(),
  zoom: window.LEET_ALERTS_MAP.getTransform().zoom,
  bar: !document.getElementById('focus-bar').hidden,
}));
if (focus.id !== 'offline') fail(`focus ${focus.id}`);
if (focus.labeled < 12) fail(`focus labeled nodes ${focus.labeled} < 12`);
if (!focus.bar) fail('focus bar hidden');
notes.push(`focus labeled=${focus.labeled} visible=${focus.visible} zoom=${focus.zoom.toFixed(2)}`);

const alertId = await page.evaluate(() => {
  const a = window.LEET_ALERTS_MAP.snapshot().alerts.find((x) => x.categoryId === 'offline')
    || window.LEET_ALERTS_MAP.snapshot().alerts[0];
  return a?.id;
});
await page.evaluate(async (id) => {
  window.LEET_ALERTS_MAP.openAlert(id);
  await window.LEET_ALERTS_MAP.waitForIdle();
}, alertId);
await page.waitForTimeout(350);
const panel = await page.evaluate(() => {
  const body = document.getElementById('panel-body')?.innerText || '';
  return {
    open: window.LEET_ALERTS_MAP.getFocus().panelOpen,
    ladder: /DETECTED|ACKNOWLEDGED|IN PROGRESS|RESOLVED/i.test(body),
    impact: /KWD/i.test(body),
    clearance: window.LEET_ALERTS_MAP.panelClearance(),
    overflow: window.LEET_ALERTS_MAP.viewportOverflow(),
  };
});
if (!panel.open || !panel.ladder || !panel.impact) fail('node panel incomplete');
if (panel.overflow > 0) fail(`panel viewport overflow ${panel.overflow}`);
notes.push(`panel ${alertId}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.openCore();
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(250);
const core = await page.evaluate(() => {
  const body = document.getElementById('core-body')?.innerText || '';
  return {
    open: window.LEET_ALERTS_MAP.getFocus().coreOpen,
    ok: /Leet overview/i.test(body) && /OFFLINE/i.test(body),
    counters: window.LEET_ALERTS_MAP.getCounters().open,
  };
});
if (!core.open || !core.ok) fail('core panel incomplete');
if (core.counters !== snap.open) fail('counters drifted');
notes.push('core ok');

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.clearFocus();
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(400);
const restored = await page.evaluate(() => {
  const f = window.LEET_ALERTS_MAP.getFocus();
  const t = window.LEET_ALERTS_MAP.getTransform();
  return { ...f, zoom: t.zoom, visible: window.LEET_ALERTS_MAP.visibleNodeCount() };
});
if (restored.categoryId || restored.panelOpen || restored.coreOpen) fail('focus not restored');
if (restored.visible < 60) fail(`restored visible ${restored.visible}`);
notes.push('restore ok');

console.log('leet-alerts OK');
notes.forEach((n) => console.log(' ', n));
await browser.close();
