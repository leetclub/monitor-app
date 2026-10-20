#!/usr/bin/env node
/**
 * Leet Alerts map acceptance (round 10): wide buildSky ~140° fans, short chains,
 * titles clear of toolbar, compact core, hover dim, pan.
 */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';

function fail(msg) {
  throw new Error(msg);
}

async function checkOverview(page, tag) {
  await page.evaluate(() => window.LEET_ALERTS_MAP.setIdleSpin(false));
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.evaluate(() => window.LEET_ALERTS_MAP.waitForIdle());
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    try { await document.fonts.load('400 0.92rem Marcellus'); } catch (_) { /* ignore */ }
  });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const ok = await page.evaluate(() => (
      window.LEET_ALERTS_MAP.labelNodeOverlaps() === 0
      && window.LEET_ALERTS_MAP.nodeOverlaps() === 0
      && window.LEET_ALERTS_MAP.titlesClearOfToolbar().clear
    ));
    if (ok) break;
  }
  // Final paint after fonts/layout settle
  await page.waitForTimeout(200);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const overview = await page.evaluate(() => ({
    visible: window.LEET_ALERTS_MAP.visibleNodeCount(),
    nodeOverlaps: window.LEET_ALERTS_MAP.nodeOverlaps(),
    labelNodeOverlaps: window.LEET_ALERTS_MAP.labelNodeOverlaps(),
    hub: window.LEET_ALERTS_MAP.hubRadiusRatio(),
    tip: window.LEET_ALERTS_MAP.tipRadiusRatio(),
    crossings: window.LEET_ALERTS_MAP.lineCrossings(),
    coreHub: window.LEET_ALERTS_MAP.hasCoreHubLinks(),
    deptCounts: window.LEET_ALERTS_MAP.departmentNodeCounts(),
    overflow: window.LEET_ALERTS_MAP.viewportOverflow(),
    titles: window.LEET_ALERTS_MAP.titlesClearOfToolbar(),
    fans: window.LEET_ALERTS_MAP.fanSpanDegrees(),
    rot: window.LEET_ALERTS_MAP.getTransform().rot,
  }));
  if (overview.visible < 60) fail(`${tag} visible ${overview.visible} < 60`);
  if (overview.nodeOverlaps > 0) fail(`${tag} node overlaps ${overview.nodeOverlaps}`);
  if (overview.labelNodeOverlaps > 0) fail(`${tag} label↔node ${overview.labelNodeOverlaps}`);
  if (overview.hub < 0.16 || overview.hub > 0.22) {
    fail(`${tag} hub/H ${overview.hub.toFixed(3)} outside 0.16–0.22`);
  }
  // Small viewports clamp tip for title clearance; larger ones keep ~1.0× hub chain length
  if (overview.tip < 0.30 || overview.tip > 0.44) {
    fail(`${tag} tip/H ${overview.tip.toFixed(3)} outside 0.30–0.44`);
  }
  if (overview.crossings > 0) fail(`${tag} line crossings ${overview.crossings}`);
  if (overview.coreHub) fail(`${tag} has core→hub links`);
  Object.entries(overview.deptCounts).forEach(([id, n]) => {
    if (n < 16 || n > 42) fail(`${tag} ${id} nodes ${n} outside ~18–36 (5–7×3–5)`);
  });
  Object.entries(overview.fans).forEach(([id, deg]) => {
    if (deg < 110 || deg > 155) fail(`${tag} ${id} fan ${deg.toFixed(1)}° outside ~140° (±25)`);
  });
  if (overview.overflow > 0) fail(`${tag} viewport overflow ${overview.overflow}`);
  if (!overview.titles.clear) {
    fail(`${tag} titles overlap toolbar: ${JSON.stringify(overview.titles.hits)}`);
  }
  return overview;
}

const browser = await chromium.launch({ headless: true });
const notes = [];

for (const vp of [
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
]) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.goto(`${BASE}/alerts.html?r10=4`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
  await page.evaluate(() => window.LEET_ALERTS_MAP.waitForIdle());
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(200);
  const ov = await checkOverview(page, `${vp.w}x${vp.h}`);
  const fanAvg = Object.values(ov.fans).reduce((s, d) => s + d, 0) / Object.keys(ov.fans).length;
  notes.push(
    `${vp.w}x${vp.h} visible=${ov.visible} hub=${ov.hub.toFixed(3)} tip=${ov.tip.toFixed(3)} fan≈${fanAvg.toFixed(0)}° titlesClear=${ov.titles.clear}`
  );

  if (vp.w === 1440) {
    await page.evaluate(() => window.LEET_ALERTS_MAP.setHover('revenue'));
    await page.waitForTimeout(250);
    const hover = await page.evaluate(() => window.LEET_ALERTS_MAP.getHover());
    if (hover.hoverCat !== 'revenue') fail('hover cat not set');
    const dimmed = Object.entries(hover.hoverAlpha).filter(([id, a]) => id !== 'revenue' && a > 0.28);
    if (dimmed.length) fail(`hover did not dim others: ${JSON.stringify(dimmed)}`);
    if (Math.abs((hover.hoverAlpha.revenue || 0) - 1) > 0.05) fail('hover target not full opacity');
    notes.push('hover dim ok');
    await page.evaluate(() => window.LEET_ALERTS_MAP.setHover(null));

    const before = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform());
    await page.evaluate(() => window.LEET_ALERTS_MAP.panBy(40, -25));
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.LEET_ALERTS_MAP.getTransform());
    if (Math.abs(after.rot - before.rot) > 1e-6) fail('pan rotated the map');
    if (Math.abs(after.tCamX - before.tCamX) < 1 || Math.abs(after.tCamY - before.tCamY) < 1) {
      fail('pan did not move camera');
    }
    notes.push(`pan dx=${(after.tCamX - before.tCamX).toFixed(1)} dy=${(after.tCamY - before.tCamY).toFixed(1)}`);
    await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());

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
    notes.push(`restored tip=${restored.tip.toFixed(3)}`);
  }
  await page.close();
}

console.log('leet-alerts OK');
notes.forEach((n) => console.log(' ', n));
await browser.close();
