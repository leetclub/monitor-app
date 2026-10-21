#!/usr/bin/env node
/**
 * Round 18: label fade (no 0→1 jump), path particles, no overlap at 3 zoom levels,
 * alive-motion constants from skilltree map.html.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R18_TEST_OUT || join(__dirname, '../artifacts/r18-tests');
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  const bust = Date.now();
  await page.goto(`${BASE}/alerts.html?r18=1&_=${bust}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.plainWheelZooms && t.aliveMotion && t.labelFade && t.pathParticles;
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
  await page.waitForTimeout(450);
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
      name: `${tag}/skilltree-constants`,
      ok: consts.EASE_CAM === 0.13
        && consts.EASE_WHEEL === 0.11
        && consts.STROKE_SPOKE === 1.5
        && consts.STROKE_SPOKE_OP === 0.14
        && consts.STROKE_BRANCH === 2
        && consts.JDOT_R === 7.5
        && consts.GRID_STEP === 14
        && consts.DIVE_MORPH_MS === 1200
        && consts.DIVE_ZOOM_TARGET === 4.8
        && consts.LABEL_FADE_MS === 500
        && consts.aliveMotion && consts.pathParticles && consts.organicCore,
      consts: {
        EASE_CAM: consts.EASE_CAM, EASE_WHEEL: consts.EASE_WHEEL,
        STROKE_SPOKE: consts.STROKE_SPOKE, JDOT_R: consts.JDOT_R,
        DIVE_MORPH_MS: consts.DIVE_MORPH_MS, DIVE_ZOOM_TARGET: consts.DIVE_ZOOM_TARGET,
      },
    });

    // Particles present on overview
    const particles = await page.evaluate(() => {
      const m = window.LEET_ALERTS_MAP;
      const n = m.particleCount?.() ?? m.interactionConstants().particleCount?.() ?? 0;
      return { n, alive: !!m.interactionConstants().pathParticles };
    });
    results.push({
      name: `${tag}/particles-present`,
      ok: particles.n >= 20 && particles.alive,
      particles,
    });

    // Category subline visible at rest
    const sub = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.cat-label.is-on .sub')]
        .filter((el) => Number(getComputedStyle(el.parentElement).opacity) > 0.2);
      return els.map((el) => (el.textContent || '').trim()).filter(Boolean);
    });
    results.push({
      name: `${tag}/category-subline`,
      ok: sub.length >= 3 && sub.every((s) => /[a-z]/.test(s) && s === s.toLowerCase()),
      sub: sub.slice(0, 5),
    });

    // Label fade: no frame where any tracked label opacity jumps 0→1
    await ensureSky(page);
    const fade = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
      const samples = [];
      const startZ = m.getTransform().zoom;
      const targetZ = m.interactionConstants().LOD_NODE_FULL;
      m.zoomAt(hub.x, hub.y, targetZ / Math.max(startZ, 0.01));
      // Sample ~45 frames (~750ms) while ease + CSS fade run
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ops = [];
        document.querySelectorAll('.group-label, .node-label, .cat-label').forEach((el) => {
          const op = Number(getComputedStyle(el).opacity) || 0;
          const id = el.dataset.id || el.className;
          ops.push({ id, op });
        });
        samples.push({ z: m.getTransform().zoom, ops });
      }
      m.settleNow();
      // Per-id max delta between consecutive frames
      const byId = new Map();
      let maxJump = 0;
      let jumpExample = null;
      for (let i = 1; i < samples.length; i++) {
        const prev = new Map(samples[i - 1].ops.map((o) => [o.id, o.op]));
        for (const o of samples[i].ops) {
          const p = prev.get(o.id);
          if (p == null) continue;
          const d = o.op - p;
          if (d > maxJump) {
            maxJump = d;
            jumpExample = { id: o.id, from: p, to: o.op, frame: i };
          }
          if (!byId.has(o.id)) byId.set(o.id, []);
          byId.get(o.id).push(o.op);
        }
      }
      // Fail only on hard pop: was ~0 and becomes ~1 in one frame
      const hardPop = jumpExample && jumpExample.from < 0.08 && jumpExample.to > 0.92;
      return {
        maxJump, jumpExample, hardPop,
        frames: samples.length,
        zEnd: m.getTransform().zoom,
      };
    });
    results.push({
      name: `${tag}/label-fade-no-hard-pop`,
      ok: !fade.hardPop && fade.maxJump < 0.85,
      fade,
    });

    // No overlap at 3 zoom levels
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
        z: window.LEET_ALERTS_MAP.getTransform().zoom,
      }));
      results.push({
        name: `${tag}/no-overlap-${tier}`,
        ok: snap.overlaps === 0 && snap.orphans.length === 0,
        snap,
      });
    }

    // Smooth wheel: targetZoom eases — after one tick zoom ≠ target immediately, then settles
    await ensureSky(page);
    const smooth = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
      const z0 = m.getTransform().zoom;
      document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
        deltaY: -180, clientX: hub.x, clientY: hub.y, bubbles: true, cancelable: true,
      }));
      await new Promise((r) => requestAnimationFrame(r));
      const mid = m.getTransform();
      // Allow a few frames of ease then settle
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
      const later = m.getTransform();
      m.settleNow();
      const done = m.getTransform();
      return {
        z0,
        midZ: mid.zoom,
        midTarget: mid.targetZoom,
        laterZ: later.zoom,
        doneZ: done.zoom,
        eased: mid.targetZoom > mid.zoom + 0.01 || later.zoom > z0 + 0.05,
        reached: done.zoom > z0 + 0.08,
      };
    });
    results.push({
      name: `${tag}/smooth-wheel-ease`,
      ok: smooth.eased && smooth.reached && consts.EASE_CAM === 0.13,
      smooth,
    });

    // Dive duration / zoom target constants wired
    results.push({
      name: `${tag}/dive-parity-constants`,
      ok: consts.DIVE_MORPH_MS >= 1100
        && consts.DIVE_ZOOM_TARGET >= 4
        && consts.DIVE_ZOOM_TARGET <= 6
        && consts.TRANSITIONING_MS >= 1200
        && consts.DIVE_SWAP_MS === 520,
      dive: {
        DIVE_MORPH_MS: consts.DIVE_MORPH_MS,
        DIVE_ZOOM_TARGET: consts.DIVE_ZOOM_TARGET,
        TRANSITIONING_MS: consts.TRANSITIONING_MS,
        DIVE_SWAP_MS: consts.DIVE_SWAP_MS,
      },
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
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 360));
    }
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name), viewports: VIEWPORTS,
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r18-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r18-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
