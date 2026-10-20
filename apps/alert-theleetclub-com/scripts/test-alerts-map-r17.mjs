#!/usr/bin/env node
/**
 * Round 17: dense group forks, camera settle, overlap=0 every tier, empty-area check.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R17_TEST_OUT || join(__dirname, '../artifacts/r17-tests');
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  const bust = Date.now();
  await page.goto(`${BASE}/alerts.html?r17=1&_=${bust}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.plainWheelZooms && t.denseGroupForks && t.cameraSettle;
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

async function zoomToTier(page, tierKey) {
  await page.evaluate((key) => {
    const m = window.LEET_ALERTS_MAP;
    m.recenter();
    const t = m.interactionConstants();
    const z = t[key];
    const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
    m.zoomAt(hub.x, hub.y, z / Math.max(m.getTransform().zoom, 0.01));
  }, tierKey);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
  await page.waitForTimeout(400);
}

async function runSuite(browserType, name, viewport) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  const tag = `${name}-${viewport.width}x${viewport.height}`;
  try {
    await waitMap(page);
    await ensureSky(page);

    // Dense fans: each dept has ~7–10 spokes
    const spokes = await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      return m.snapshot().categories.map((c) => ({
        id: c.id, n: m.overviewSpokeCount(c.id),
      }));
    });
    results.push({
      name: `${tag}/dense-spokes-7-10`,
      ok: spokes.every((s) => s.n >= 7 && s.n <= 10),
      spokes,
    });

    // r9 titlesClear: ≥40px below toolbar/toggle at rest
    const titles = await page.evaluate(() => window.LEET_ALERTS_MAP.titlesClearOfToolbar(56, 40));
    results.push({
      name: `${tag}/titles-clear-40px`,
      ok: !!titles.clear,
      titles,
    });

    // Plain wheel zooms, not dial
    const before = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
    }));
    await plainWheel(page, -120, 8);
    const mid = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
      state: window.LEET_ALERTS_MAP.getMapState(),
    }));
    results.push({
      name: `${tag}/plain-wheel-zooms-not-dial`,
      ok: mid.state === 'sky' && mid.z > before.z + 0.08 && Math.abs(mid.wa - before.wa) < 0.5,
      before, mid,
    });

    // Arrows fade when zoomed > ~120%
    await page.waitForTimeout(100);
    const arrowZoomed = await page.evaluate(() => window.LEET_ALERTS_MAP.wchevOpacity());
    results.push({
      name: `${tag}/arrows-fade-when-zoomed`,
      ok: mid.z > 1.2 ? arrowZoomed < 0.08 : arrowZoomed >= 0,
      arrowZoomed, z: mid.z,
    });

    // Round-trip zoom
    await plainWheel(page, 120, 10);
    await page.evaluate(() => window.LEET_ALERTS_MAP.recenter());
    await page.waitForTimeout(250);
    const end = await page.evaluate(() => ({
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      wa: window.LEET_ALERTS_MAP.getTransform().wheelA,
      arrow: window.LEET_ALERTS_MAP.wchevOpacity(),
    }));
    results.push({
      name: `${tag}/plain-wheel-in-out-roundtrip`,
      ok: Math.abs(end.z - before.z) < 0.3 && Math.abs(end.wa - before.wa) < 0.5 && end.arrow > 0.5,
      before, end,
    });

    // Overlap = 0 at every LOD tier
    for (const [tier, key] of [
      ['rest', null],
      ['group', 'LOD_GROUP_FULL'],
      ['node', 'LOD_NODE_FULL'],
    ]) {
      if (key) await zoomToTier(page, key);
      else {
        await ensureSky(page);
        await page.waitForTimeout(200);
      }
      const snap = await page.evaluate(() => ({
        overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
        orphans: window.LEET_ALERTS_MAP.orphanLabels(),
        lod: window.LEET_ALERTS_MAP.lodState(),
        groups: [...document.querySelectorAll('.group-label.is-on')]
          .filter((el) => Number(getComputedStyle(el).opacity) > 0.15)
          .map((el) => (el.textContent || '').trim()),
        nodeLabels: [...document.querySelectorAll('.node-label.is-on')]
          .filter((el) => Number(getComputedStyle(el).opacity) > 0.15)
          .map((el) => (el.textContent || '').trim()),
      }));
      results.push({
        name: `${tag}/overlap-zero-${tier}`,
        ok: snap.overlaps === 0 && snap.orphans.length === 0,
        snap,
      });
      if (tier === 'group') {
        const need = ['MACHINES', 'HEARTBEAT', 'CONNECTIVITY'];
        const hasAll = need.every((g) => snap.groups.includes(g));
        results.push({
          name: `${tag}/group-tier-all-three-offline`,
          ok: hasAll && snap.groups.length >= 3,
          groups: snap.groups,
        });
      }
      if (tier === 'node') {
        const perCat = await page.evaluate(() => window.LEET_ALERTS_MAP.nodeLabelsUniquePerCategory());
        const ok = Object.values(perCat).every((c) => c.total >= 3 && c.total === c.unique);
        results.push({
          name: `${tag}/node-labels-unique-per-cat`,
          ok,
          perCat,
        });
      }
    }

    // Deep zoom + settle → empty area ≤ 25%
    await ensureSky(page);
    await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.32 };
      m.zoomAt(hub.x, hub.y, 5.5 / Math.max(m.getTransform().zoom, 0.01));
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
    await page.waitForTimeout(500);
    const framed = await page.evaluate(() => ({
      empty: window.LEET_ALERTS_MAP.viewportEmptyRatio(),
      z: window.LEET_ALERTS_MAP.getTransform().zoom,
      overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
      arrow: window.LEET_ALERTS_MAP.wchevOpacity(),
    }));
    results.push({
      name: `${tag}/deep-settle-empty-le-25`,
      ok: framed.z > 3 && framed.empty <= 0.25 && framed.overlaps === 0 && framed.arrow < 0.08,
      framed,
    });

    // Leave no orphans
    await page.evaluate(() => {
      window.LEET_ALERTS_MAP.setHover(window.LEET_ALERTS_MAP.snapshot().categories[0].id);
    });
    await page.waitForTimeout(150);
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
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 320));
    }
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name), viewports: VIEWPORTS,
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r17-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r17-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
