#!/usr/bin/env node
/**
 * Round 15 regression: orphan labels + zoom-out (overview & focus).
 * Viewports: 1280×800, 1920×1080. Browsers: chromium (+ firefox/webkit if installed).
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R15_TEST_OUT
  || join(__dirname, '../artifacts/r15-tests');
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?r15=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const m = window.LEET_ALERTS_MAP;
    return m && document.body.classList.contains('map-ready') && m.getMapState() === 'sky';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function orphans(page) {
  return page.evaluate(() => window.LEET_ALERTS_MAP.orphanLabels());
}

async function zoomOf(page) {
  return page.evaluate(() => window.LEET_ALERTS_MAP.getTransform().zoom);
}

async function mapState(page) {
  return page.evaluate(() => window.LEET_ALERTS_MAP.getMapState());
}

async function waitState(page, state, ms = 5000) {
  await page.waitForFunction((s) => window.LEET_ALERTS_MAP.getMapState() === s, state, { timeout: ms });
}

async function ensureSky(page) {
  await page.evaluate(() => {
    const m = window.LEET_ALERTS_MAP;
    const st = m.getMapState();
    if (st === 'fan' || st === 'diving' || st === 'rising' || st === 'aligning' || m.getFocus().categoryId) {
      // Force sky without waiting for morph when possible
      try { m.clearFocus({ immediate: true }); } catch {}
    }
    // Hard reset if still not sky
    if (m.getMapState() !== 'sky') {
      try { m.clearFocus({ immediate: true }); } catch {}
    }
    m.recenter();
  });
  // If morph still running, wait it out then force
  for (let i = 0; i < 40; i++) {
    const st = await mapState(page);
    if (st === 'sky') break;
    if (st === 'fan') {
      await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
    }
    await page.waitForTimeout(100);
  }
  await waitState(page, 'sky', 8000);
  await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
  await page.waitForTimeout(250);
}

async function wheelZoom(page, deltaY, steps = 6) {
  const canvas = page.locator('#alerts-canvas');
  const box = await canvas.boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    // Playwright mouse.wheel has no ctrlKey — dispatch pinch/ctrl-wheel explicitly
    await page.evaluate(({ dy, cx, cy }) => {
      const el = document.getElementById('alerts-canvas');
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
      }));
    }, { dy: deltaY, cx: x, cy: y });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
}

async function runSuite(browserType, name, viewport) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const tag = `${name}-${viewport.width}x${viewport.height}`;

  try {
    await waitMap(page);

    // --- (a) orphan labels ---
    // Hover a department, then move fast off-canvas
    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      const id = m.snapshot().categories[0].id;
      m.setHover(id);
    });
    await page.waitForTimeout(200);
    await page.mouse.move(2, 2, { steps: 2 });
    await page.evaluate(() => {
      document.getElementById('alerts-canvas')
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      window.LEET_ALERTS_MAP.clearHover();
    });
    await page.waitForTimeout(350);
    let o = await orphans(page);
    results.push({
      name: `${tag}/leave-fast`,
      ok: o.length === 0,
      detail: o,
    });

    // After dive
    await page.evaluate(() => {
      const id = window.LEET_ALERTS_MAP.snapshot().categories[0].id;
      window.LEET_ALERTS_MAP.focusCategory(id);
    });
    await waitState(page, 'fan', 6000);
    await page.waitForTimeout(200);
    o = await orphans(page);
    results.push({
      name: `${tag}/after-dive`,
      ok: o.length === 0,
      detail: o,
      state: await mapState(page),
    });

    // After rise + dial drag
    await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus());
    await waitState(page, 'sky', 6000);
    await page.waitForTimeout(200);
    const box = await page.locator('#alerts-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    await page.mouse.move(4, 4, { steps: 1 });
    await page.evaluate(() => {
      document.getElementById('alerts-canvas')
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      window.LEET_ALERTS_MAP.clearHover();
    });
    await page.waitForTimeout(200);
    o = await orphans(page);
    results.push({
      name: `${tag}/after-dial`,
      ok: o.length === 0,
      detail: o,
    });

    // After modest zoom in overview (API zoom — no dive intent)
    await ensureSky(page);
    const z0 = await zoomOf(page);
    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      const t = m.getTransform();
      m.zoomAt(640, 400, 1.25);
    });
    await page.waitForTimeout(200);
    const zIn = await zoomOf(page);
    await page.evaluate(() => window.LEET_ALERTS_MAP.zoomAt(640, 400, 0.8));
    await page.waitForTimeout(200);
    await page.mouse.move(3, 3);
    await page.evaluate(() => {
      document.getElementById('alerts-canvas')
        .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      window.LEET_ALERTS_MAP.clearHover();
    });
    await page.waitForTimeout(200);
    o = await orphans(page);
    results.push({
      name: `${tag}/after-zoom-labels`,
      ok: o.length === 0 && (await mapState(page)) === 'sky',
      detail: o,
      z0, zIn, zAfter: await zoomOf(page),
      state: await mapState(page),
    });

    // --- (b) zoom behaviour ---
    // Precise round-trip via zoomAt (same path as ctrl-wheel → zoomAtScreen)
    await ensureSky(page);
    const startZ = await zoomOf(page);
    await page.evaluate(() => window.LEET_ALERTS_MAP.zoomAt(640, 400, 1.22));
    await page.waitForTimeout(80);
    const midZ = await zoomOf(page);
    await page.evaluate(() => window.LEET_ALERTS_MAP.zoomAt(640, 400, 1 / 1.22));
    await page.waitForTimeout(80);
    const endZ = await zoomOf(page);
    const roundTripOk = (await mapState(page)) === 'sky'
      && midZ > startZ + 0.05
      && Math.abs(endZ - startZ) < 0.08;
    results.push({
      name: `${tag}/wheel-in-out-roundtrip`,
      ok: roundTripOk,
      startZ, midZ, endZ, state: await mapState(page),
    });

    // ctrl-wheel (pinch) actually changes scale in sky both ways
    await ensureSky(page);
    const w0 = await zoomOf(page);
    await wheelZoom(page, -20, 1);
    const wIn = await zoomOf(page);
    await wheelZoom(page, 20, 1);
    const wOut = await zoomOf(page);
    results.push({
      name: `${tag}/ctrl-wheel-sky-both-ways`,
      ok: (await mapState(page)) === 'sky' && wIn > w0 + 0.01 && wOut < wIn - 0.01,
      w0, wIn, wOut, state: await mapState(page),
    });

    // Minus button in overview
    await ensureSky(page);
    // Zoom in a bit first so minus has room
    await page.evaluate(() => window.LEET_ALERTS_MAP.zoomAt(640, 400, 1.3));
    await page.waitForTimeout(200);
    const beforeMinus = await zoomOf(page);
    await page.click('#zoom-out');
    await page.waitForTimeout(280);
    const afterMinus = await zoomOf(page);
    results.push({
      name: `${tag}/minus-button-sky`,
      ok: (await mapState(page)) === 'sky' && afterMinus < beforeMinus - 0.02,
      beforeMinus, afterMinus,
      state: await mapState(page),
    });

    // Zoom-out in focus returns to overview
    await page.evaluate(() => {
      const id = window.LEET_ALERTS_MAP.snapshot().categories[3].id;
      window.LEET_ALERTS_MAP.focusCategory(id);
    });
    await waitState(page, 'fan', 6000);
    await page.waitForTimeout(150);
    // Drive below RISE_SCALE with enough intent
    for (let i = 0; i < 24; i++) {
      await page.evaluate(() => {
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        }));
      });
      await page.waitForTimeout(35);
      const st = await mapState(page);
      if (st === 'rising' || st === 'sky') break;
    }
    // Also click minus repeatedly as fallback
    for (let i = 0; i < 6; i++) {
      const st = await mapState(page);
      if (st === 'sky' || st === 'rising') break;
      await page.click('#zoom-out');
      await page.waitForTimeout(120);
    }
    await page.waitForFunction(() => {
      const s = window.LEET_ALERTS_MAP.getMapState();
      return s === 'sky' || s === 'rising';
    }, null, { timeout: 8000 });
    await waitState(page, 'sky', 8000);
    results.push({
      name: `${tag}/focus-zoom-out-rises`,
      ok: (await mapState(page)) === 'sky',
      state: await mapState(page),
    });

    o = await orphans(page);
    results.push({
      name: `${tag}/after-rise-labels`,
      ok: o.length === 0,
      detail: o,
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
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r));
    }
  }
}

const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE,
  browsers: browsers.map((b) => b.name),
  viewports: VIEWPORTS,
  passed: all.length - failed.length,
  failed: failed.length,
  results: all,
};
writeFileSync(join(OUT, 'r15-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r15-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
