#!/usr/bin/env node
/**
 * Round 20: dive sector fan integrity, core hidden in dive/zoom,
 * label↔edge collision, chrome fade. Keeps r19 overview flags.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R20_TEST_OUT || join(__dirname, '../artifacts/r20-tests');
const VIEWPORTS = [{ width: 1280, height: 800 }];
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?v=20&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.diveSectorFan && t.coreHiddenInDive && t.labelEdgeCollision;
  }, null, { timeout: 5000 });
  await page.evaluate(() => window.LEET_ALERTS_MAP.setIdleRotate(false));
  await page.waitForTimeout(400);
}

async function ensureSky(page) {
  await page.evaluate(() => {
    const m = window.LEET_ALERTS_MAP;
    if (m.getMapState() !== 'sky') try { m.clearFocus({ immediate: true }); } catch {}
    m.recenter();
  });
  await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'sky', null, { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function runSuite(browserType, name, viewport) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  const tag = `${name}-${viewport.width}x${viewport.height}`;
  try {
    await waitMap(page);
    await ensureSky(page);

    const consts = await page.evaluate(() => window.LEET_ALERTS_MAP.interactionConstants());
    results.push({
      name: `${tag}/r20-flags`,
      ok: consts.diveSectorFan && consts.coreHiddenInDive && consts.labelEdgeCollision
        && consts.chromeLabelFade && consts.solidLeafDots && consts.sparseOverview
        && consts.DIVE_MORPH_MS === 1200 && consts.DIVE_ZOOM_TARGET === 4.8,
      consts: {
        diveSectorFan: consts.diveSectorFan,
        DIVE_ZOOM_TARGET: consts.DIVE_ZOOM_TARGET,
        LEAF_R: consts.LEAF_R,
      },
    });

    // Overview still sparse 3 chains (r19 keep)
    const spokes = await page.evaluate(() => window.LEET_ALERTS_MAP.snapshot().categories
      .map((c) => ({ id: c.id, n: window.LEET_ALERTS_MAP.overviewSpokeCount(c.id) })));
    results.push({
      name: `${tag}/sparse-3-chains-kept`,
      ok: spokes.every((s) => s.n === 3),
      spokes,
    });

    // Dive integrity
    await page.evaluate(() => window.LEET_ALERTS_MAP.focusCategory('offline'));
    await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 8000 });
    await page.waitForTimeout(350);
    await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
    await page.waitForTimeout(100);

    const dive = await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      const di = m.diveIntegrity(28);
      return {
        ...di,
        state: m.getMapState(),
        zoom: m.getTransform().zoom,
        focusNodes: m.focusNodeCount(),
        focusLinks: m.focusLinkCount(),
        coreOp: m.coreDrawOpacity(),
      };
    });
    results.push({
      name: `${tag}/dive-zero-cross-chain`,
      ok: dive.state === 'fan' && dive.crossChainHits === 0,
      dive: { crossChainHits: dive.crossChainHits, crossSamples: dive.crossSamples },
    });
    results.push({
      name: `${tag}/dive-every-node-edged`,
      // Forest of 3 group trees: every visible node has ≥1 edge (orphans API)
      ok: Array.isArray(dive.orphans) && dive.orphans.length === 0
        && dive.focusNodes >= 12 && dive.focusLinks >= 12,
      dive: { orphans: dive.orphans, focusNodes: dive.focusNodes, focusLinks: dive.focusLinks },
    });
    results.push({
      name: `${tag}/dive-nodes-in-viewport`,
      ok: dive.offscreen.length === 0,
      offscreen: dive.offscreen,
    });
    results.push({
      name: `${tag}/dive-core-hidden`,
      ok: dive.coreOp < 0.05 && dive.coreOpacity < 0.05,
      coreOp: dive.coreOp,
    });
    results.push({
      name: `${tag}/dive-integrity-ok`,
      ok: !!dive.ok,
      dive,
    });

    // Label overlaps + orphans in dive
    const diveLabels = await page.evaluate(() => ({
      overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
      orphans: window.LEET_ALERTS_MAP.orphanLabels(),
    }));
    results.push({
      name: `${tag}/dive-label-clean`,
      ok: diveLabels.overlaps === 0 && diveLabels.orphans.length === 0,
      diveLabels,
    });

    await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
    await ensureSky(page);

    // Zoom view: core faded, chrome-faded labels allowed under bar
    const zoomCore = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
      for (let i = 0; i < 14; i++) {
        document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
          deltaY: -120, clientX: hub.x, clientY: hub.y, bubbles: true, cancelable: true,
        }));
        await new Promise((r) => requestAnimationFrame(r));
      }
      m.settleNow();
      await new Promise((r) => setTimeout(r, 200));
      const z = m.getTransform().zoom;
      const coreOp = m.coreDrawOpacity();
      const top = document.querySelector('.view-toggle')?.getBoundingClientRect().bottom
        || document.querySelector('.topbar')?.getBoundingClientRect().bottom || 56;
      const underChrome = [];
      document.querySelectorAll('.group-label.is-on, .node-label.is-on, .cat-label.is-on').forEach((el) => {
        const r = el.getBoundingClientRect();
        const op = parseFloat(el.style.opacity || '0');
        if (r.top + r.height * 0.5 < top - 4 && op > 0.35) {
          underChrome.push({ id: el.dataset.id, op, y: Math.round(r.top) });
        }
      });
      return { z, coreOp, underChrome };
    });
    results.push({
      name: `${tag}/zoom-core-faded`,
      ok: zoomCore.z >= 1.6 && zoomCore.coreOp < 0.35,
      zoomCore: { z: zoomCore.z, coreOp: zoomCore.coreOp },
    });
    results.push({
      name: `${tag}/zoom-chrome-labels-faded`,
      ok: zoomCore.underChrome.length === 0,
      underChrome: zoomCore.underChrome,
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
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 500));
    }
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name),
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r20-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r20-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
