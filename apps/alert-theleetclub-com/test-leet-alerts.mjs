#!/usr/bin/env node
/**
 * Leet Alerts map acceptance: counters, focus/restore, panels, label collisions.
 */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';

function fail(msg) {
  throw new Error(msg);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const notes = [];

await page.goto(`${BASE}/alerts.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
await page.waitForTimeout(400);

const snap = await page.evaluate(() => window.LEET_ALERTS_MAP.getCounters());
const categories = await page.evaluate(() => window.LEET_ALERTS_MAP.snapshot().categories.map((c) => ({ id: c.id, count: c.count })));
const sumCats = categories.reduce((s, c) => s + c.count, 0);
if (snap.open < 1) fail('no open alerts in snapshot');
if (sumCats !== snap.open) fail(`counter mismatch open ${snap.open} vs category sum ${sumCats}`);
notes.push(`counters open=${snap.open} critical=${snap.critical} cats=${categories.map((c) => c.id + ':' + c.count).join(',')}`);

const overviewCollisions = await page.evaluate(() => window.LEET_ALERTS_MAP.labelCollisions());
if (overviewCollisions > 2) fail(`overview label collisions ${overviewCollisions}`);

await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.focusCategory('offline');
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(200);
const focus1 = await page.evaluate(() => window.LEET_ALERTS_MAP.getFocus());
if (focus1.categoryId !== 'offline') fail(`focus ${focus1.categoryId}`);
const t1 = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform());
if (t1.zoom < 1.2) fail(`category zoom ${t1.zoom}`);
const focusBar = await page.evaluate(() => !document.getElementById('focus-bar').hidden);
if (!focusBar) fail('focus bar hidden');
notes.push(`focus offline zoom=${t1.zoom.toFixed(2)}`);

const firstAlert = await page.evaluate(() => {
  const a = window.LEET_ALERTS_MAP.snapshot().alerts.find((x) => x.categoryId === 'offline')
    || window.LEET_ALERTS_MAP.snapshot().alerts[0];
  return a?.id;
});
await page.evaluate(async (id) => {
  window.LEET_ALERTS_MAP.openAlert(id);
  await window.LEET_ALERTS_MAP.waitForIdle();
}, firstAlert);
await page.waitForTimeout(250);
const panel = await page.evaluate(() => {
  const api = window.LEET_ALERTS_MAP.getFocus();
  const body = document.getElementById('panel-body')?.innerText || '';
  return {
    open: api.panelOpen,
    hasLadder: /DETECTED|ACKNOWLEDGED|IN PROGRESS|RESOLVED/i.test(body),
    hasImpact: /KWD/i.test(body),
    hasAffects: /Affects/i.test(body),
    clearance: window.LEET_ALERTS_MAP.panelClearance(),
  };
});
if (!panel.open) fail('node panel closed');
if (!panel.hasLadder) fail('ladder missing');
if (!panel.hasImpact) fail('impact missing');
if (!panel.hasAffects) fail('affects missing');
if (!panel.clearance) fail('nodes under panel');
notes.push(`panel ${firstAlert} clearance ok`);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const afterEsc1 = await page.evaluate(() => window.LEET_ALERTS_MAP.getFocus());
if (afterEsc1.panelOpen) fail('panel still open after Esc');

await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.openCore();
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(200);
const core = await page.evaluate(() => {
  const body = document.getElementById('core-body')?.innerText || '';
  return {
    open: window.LEET_ALERTS_MAP.getFocus().coreOpen,
    hasOverview: /Leet overview/i.test(body),
    hasCats: /OFFLINE|LOW STOCK|REVENUE/i.test(body),
    counters: window.LEET_ALERTS_MAP.getCounters().open,
  };
});
if (!core.open || !core.hasOverview || !core.hasCats) fail('core panel incomplete');
if (core.counters !== snap.open) fail('core counters drifted');
notes.push('core panel ok');

await page.keyboard.press('Escape');
await page.waitForTimeout(120);
await page.evaluate(async () => {
  window.LEET_ALERTS_MAP.clearFocus();
  await window.LEET_ALERTS_MAP.waitForIdle();
});
await page.waitForTimeout(350);
const restored = await page.evaluate(() => {
  const f = window.LEET_ALERTS_MAP.getFocus();
  const t = window.LEET_ALERTS_MAP.getTransform();
  return { ...f, zoom: t.zoom };
});
if (restored.categoryId || restored.panelOpen || restored.coreOpen) fail('focus not restored');
if (Math.abs(restored.zoom - 1) > 0.08) fail(`zoom restore ${restored.zoom}`);
notes.push('esc restore ok');

await page.evaluate(() => window.LEET_ALERTS_MAP.setView('dashboards'));
await page.waitForTimeout(100);
const dash = await page.evaluate(() => ({
  view: window.LEET_ALERTS_MAP.getFocus().view,
  rows: document.querySelectorAll('.dash-row').length,
}));
if (dash.view !== 'dashboards' || dash.rows < 1) fail('dashboards empty');
notes.push(`dashboards rows=${dash.rows}`);

console.log('leet-alerts OK');
notes.forEach((n) => console.log(' ', n));
await browser.close();
