#!/usr/bin/env node
/**
 * Round 16: plain-wheel zoom (never dial), LOD label tiers, no orphans/overlaps.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R16_TEST_OUT || join(__dirname, '../artifacts/r16-tests');
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  const bust = Date.now();
  await page.goto(`${BASE}/alerts.html?r16=1&_=${bust}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  // Confirm r16 LOD API (guards against stale cached JS)
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.plainWheelZooms && t.LOD_NODE_FULL >= 3;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(400);
}

async function ensureSky(page) {
  await page.evaluate(() => {
    const m = window.LEET_ALERTS_MAP;
    if (m.getMapState() !== 'sky') try { m.clearFocus({ immediate: true }); } catch {}
    m.recenter();
  });
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
    if (st === 'sky') break;
    if (st === 'fan') await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'sky', null, { timeout: 8000 });
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.waitForTimeout(250);
}

/** Plain wheel (NO ctrl) — r16 marketing behaviour */
async function plainWheel(page, deltaY, steps = 1) {
  const box = await page.locator('#alerts-canvas').boundingBox();
  const x = box.x + box.width * 0.55;
  const y = box.y + box.height * 0.45;
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(({ dy, cx, cy }) => {
      document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, deltaX: 0, ctrlKey: false, bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
      }));
    }, { dy: deltaY, cx: x, cy: y });
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(120);
}

async function runSuite(browserType, name, viewport) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  const tag = `${name}-${viewport.width}x${viewport.height}`;
  try {
    await waitMap(page);
    await ensureSky(page);

    // Plain wheel changes zoom, NOT wheel angle
    const before = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
    }));
    await plainWheel(page, -120, 8);
    const mid = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
      state: window.LEET_ALERTS_MAP.getMapState(),
      lod: window.LEET_ALERTS_MAP.lodState(),
    }));
    results.push({
      name: `${tag}/plain-wheel-zooms-not-dial`,
      ok: mid.state === 'sky'
        && mid.z > before.z + 0.08
        && Math.abs(mid.wa - before.wa) < 0.5,
      before, mid,
    });

    // Zoom back out → near start
    await plainWheel(page, 120, 8);
    await page.waitForTimeout(200);
    const end = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
      state: window.LEET_ALERTS_MAP.getMapState(),
    }));
    results.push({
      name: `${tag}/plain-wheel-in-out-roundtrip`,
      ok: end.state === 'sky'
        && Math.abs(end.z - before.z) < 0.25
        && Math.abs(end.wa - before.wa) < 0.5,
      before, end,
    });

    // LOD tiers at thresholds
    await ensureSky(page);
    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      // Jump to group tier
      const t = m.interactionConstants();
      const u = { cx: innerWidth / 2, cy: innerHeight * 0.5 };
      m.zoomAt(u.cx, u.cy, t.LOD_GROUP_FULL / Math.max(m.getTransform().zoom, 0.01));
    });
    await page.waitForTimeout(200);
    const atGroup = await page.evaluate(() => {
      const lod = window.LEET_ALERTS_MAP.lodState();
      const groups = [...document.querySelectorAll('.group-label.is-on')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.15).length;
      const nodes = [...document.querySelectorAll('.node-label.is-on')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.15).length;
      return { lod, groups, nodes, orphans: window.LEET_ALERTS_MAP.orphanLabels() };
    });
    results.push({
      name: `${tag}/lod-group-tier`,
      ok: atGroup.lod.group > 0.9 && atGroup.groups >= 1 && atGroup.nodes === 0
        && atGroup.orphans.length === 0,
      atGroup,
    });

    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      const t = m.interactionConstants();
      m.zoomAt(innerWidth / 2, innerHeight * 0.5,
        t.LOD_NODE_FULL / Math.max(m.getTransform().zoom, 0.01));
    });
    await page.waitForTimeout(250);
    const atNode = await page.evaluate(() => {
      const lod = window.LEET_ALERTS_MAP.lodState();
      const nodes = [...document.querySelectorAll('.node-label.is-on')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.15).length;
      return {
        lod, nodes,
        orphans: window.LEET_ALERTS_MAP.orphanLabels(),
        overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
      };
    });
    results.push({
      name: `${tag}/lod-node-tier`,
      ok: atNode.lod.node > 0.9 && atNode.lod.cat < 0.05 && atNode.nodes >= 1
        && atNode.orphans.length === 0 && atNode.overlaps <= 1,
      atNode,
    });

    // Zoom out clears deep labels; no orphans
    await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
    await page.waitForTimeout(300);
    const atRest = await page.evaluate(() => ({
      lod: window.LEET_ALERTS_MAP.lodState(),
      groups: [...document.querySelectorAll('.group-label.is-on')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.15).length,
      nodes: [...document.querySelectorAll('.node-label.is-on')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.15).length,
      orphans: window.LEET_ALERTS_MAP.orphanLabels(),
      overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
    }));
    results.push({
      name: `${tag}/lod-rest-dept-only`,
      ok: atRest.lod.group < 0.05 && atRest.lod.node < 0.05
        && atRest.groups === 0 && atRest.nodes === 0
        && atRest.orphans.length === 0 && atRest.overlaps === 0,
      atRest,
    });

    // Fast leave after deep zoom
    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      m.zoomAt(innerWidth / 2, innerHeight * 0.45, 2.8);
      m.setHover(m.snapshot().categories[0].id);
    });
    await page.waitForTimeout(200);
    await page.mouse.move(2, 2, { steps: 2 });
    await page.evaluate(() => {
      document.getElementById('alerts-canvas')
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      window.LEET_ALERTS_MAP.clearHover();
    });
    await page.waitForTimeout(250);
    const leave = await page.evaluate(() => window.LEET_ALERTS_MAP.orphanLabels());
    results.push({
      name: `${tag}/leave-no-orphans`,
      ok: leave.length === 0,
      leave,
    });
  } catch (err) {
    results.push({ name: `${tag}/ERROR`, ok: false, error: String(err && err.stack || err) });
  } finally {
    await browser.close();
  }
  return results;
}

async function browsersAvailable() {
  const list = [{ type: chromium, name: 'chromium' }];
  for (const [type, name] of [[firefox, 'firefox'], [webkit, 'webkit']]) {
    try {
      const b = await type.launch({ headless: true });
      await b.close();
      list.push({ type, name });
    } catch (e) {
      console.warn(`skip ${name}: ${e.message.split('\n')[0]}`);
    }
  }
  return list;
}

const browsers = await browsersAvailable();
const all = [];
for (const { type, name } of browsers) {
  for (const vp of VIEWPORTS) {
    console.log(`→ ${name} ${vp.width}x${vp.height}`);
    const rows = await runSuite(type, name, vp);
    all.push(...rows);
    for (const r of rows) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 280));
    }
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name), viewports: VIEWPORTS,
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r16-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r16-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
