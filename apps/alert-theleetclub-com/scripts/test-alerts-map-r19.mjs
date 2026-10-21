#!/usr/bin/env node
/**
 * Round 19: solid leaves, sparse overview, straight dive, idle rotate,
 * per-frame zoom/label metrics (no hard jumps / pops).
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R19_TEST_OUT || join(__dirname, '../artifacts/r19-tests');
const VIEWPORTS = [{ width: 1280, height: 800 }];
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?v=19&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.solidLeafDots && t.straightLinks && t.sparseOverview && t.idleRotate;
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
      name: `${tag}/r19-flags`,
      ok: consts.solidLeafDots && consts.straightLinks && consts.sparseOverview
        && consts.LEAF_R > 0 && consts.LEAF_R < 4
        && consts.DIVE_MORPH_MS === 1200 && consts.RISE_MS >= 700 && consts.RISE_MS <= 1000
        && consts.IDLE_ROT_DEG_PER_S > 0,
      consts: {
        LEAF_R: consts.LEAF_R, IDLE_ROT_DEG_PER_S: consts.IDLE_ROT_DEG_PER_S,
        DIVE_MORPH_MS: consts.DIVE_MORPH_MS, RISE_MS: consts.RISE_MS,
      },
    });

    const spokes = await page.evaluate(() => window.LEET_ALERTS_MAP.snapshot().categories
      .map((c) => ({ id: c.id, n: window.LEET_ALERTS_MAP.overviewSpokeCount(c.id) })));
    results.push({
      name: `${tag}/sparse-3-chains`,
      ok: spokes.every((s) => s.n === 3),
      spokes,
    });

    // Idle rotate: wheelA increases over ~1.5s after quiet
    await page.evaluate(() => {
      window.LEET_ALERTS_MAP.setIdleRotate(true);
      window.LEET_ALERTS_MAP.recenter();
    });
    await page.waitForTimeout(1400);
    const rot = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      const a0 = m.getTransform().wheelA;
      await new Promise((r) => setTimeout(r, 1000));
      const a1 = m.getTransform().wheelA;
      m.setIdleRotate(false);
      return { a0, a1, d: a1 - a0 };
    });
    results.push({
      name: `${tag}/idle-rotate-cw`,
      ok: rot.d > 2 && rot.d < 12, // ~4°/s ± slack
      rot,
    });

    // Hover ease: others opacity not instantly at DIM
    const hoverEase = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.clearHover();
      await new Promise((r) => requestAnimationFrame(r));
      m.setHover('offline');
      const samples = [];
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const a = m.getHover().hoverAlpha;
        const others = Object.entries(a).filter(([id]) => id !== 'offline').map(([, v]) => v);
        samples.push(others.reduce((s, v) => s + v, 0) / others.length);
      }
      return {
        first: samples[0],
        mid: samples[8],
        last: samples[samples.length - 1],
        dim: m.interactionConstants().DIM_OTHERS,
      };
    });
    results.push({
      name: `${tag}/hover-dim-eased`,
      ok: hoverEase.first > hoverEase.dim + 0.05
        && hoverEase.last <= hoverEase.dim + 0.04
        && hoverEase.mid > hoverEase.last,
      hoverEase,
    });

    // Wheel zoom: per-frame scale deltas
    const zoomLog = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
      const frames = [];
      document.getElementById('alerts-canvas').dispatchEvent(new WheelEvent('wheel', {
        deltaY: -160, clientX: hub.x, clientY: hub.y, bubbles: true, cancelable: true,
      }));
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const f = m.sampleMotionFrame();
        frames.push({ t: f.t, zoom: f.zoom, targetZoom: f.targetZoom });
      }
      m.settleNow();
      let maxRel = 0;
      for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1].zoom;
        const cur = frames[i].zoom;
        const rel = Math.abs(cur - prev) / Math.max(prev, 0.01);
        if (rel > maxRel) maxRel = rel;
      }
      return { maxRelJump: maxRel, frames: frames.length, z0: frames[0].zoom, z1: frames[frames.length - 1].zoom };
    });
    results.push({
      name: `${tag}/wheel-no-big-jumps`,
      ok: zoomLog.maxRelJump < 0.08 && zoomLog.z1 > zoomLog.z0 + 0.05,
      zoomLog,
    });

    // Label fade: no hard 0→1 pop
    const fade = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
      const z = m.interactionConstants().LOD_GROUP_FULL;
      m.zoomAt(hub.x, hub.y, z / Math.max(m.getTransform().zoom, 0.01));
      let hardPop = false;
      let maxJump = 0;
      let prev = new Map();
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const ops = m.sampleLabelOpacities();
        const cur = new Map(ops.map((o) => [o.id, o.op]));
        for (const [id, op] of cur) {
          if (!prev.has(id)) continue;
          const d = op - prev.get(id);
          if (d > maxJump) maxJump = d;
          if (prev.get(id) < 0.08 && op > 0.92) hardPop = true;
        }
        prev = cur;
      }
      m.settleNow();
      return { hardPop, maxJump };
    });
    results.push({
      name: `${tag}/label-fade-no-hard-pop`,
      ok: !fade.hardPop && fade.maxJump < 0.55,
      fade,
    });

    // Dive: OFFLINE from top → seat bottom, zoom ~4.8, duration ~1.2s
    const dive = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      await new Promise((r) => setTimeout(r, 100));
      const t0 = performance.now();
      const frames = [];
      m.focusCategory('offline');
      while (performance.now() - t0 < 2800) {
        await new Promise((r) => requestAnimationFrame(r));
        const f = m.sampleMotionFrame();
        frames.push(f);
        if (f.mapState === 'fan' && frames.length > 10) break;
      }
      const end = m.getFocus();
      const tr = m.getTransform();
      // Seat: wheelT ≈ 180 for cat0
      const seated = Math.abs(((tr.wheelT % 360) + 360) % 360 - 180) < 8
        || Math.abs(((tr.wheelA % 360) + 360) % 360 - 180) < 8;
      const diveFrames = frames.filter((f) => f.mapState === 'diving' || f.mapState === 'aligning');
      const fanFrames = frames.filter((f) => f.mapState === 'fan');
      let maxZoomStep = 0;
      for (let i = 1; i < frames.length; i++) {
        const d = Math.abs(frames[i].zoom - frames[i - 1].zoom);
        if (d > maxZoomStep) maxZoomStep = d;
      }
      return {
        state: end.mapState,
        zoom: tr.zoom,
        wheelA: tr.wheelA,
        seated,
        diveMs: diveFrames.length ? (diveFrames[diveFrames.length - 1].t - frames[0].t) : 0,
        maxZoomStep,
        othersEnd: fanFrames[0]?.othersMean ?? 1,
        nFrames: frames.length,
      };
    });
    results.push({
      name: `${tag}/dive-offline-seat-bottom`,
      ok: dive.state === 'fan' && dive.seated && dive.zoom >= 4 && dive.zoom <= 6
        && dive.maxZoomStep < 0.35,
      dive,
    });

    // Overlap at dive + zoom tiers
    await ensureSky(page);
    for (const tier of ['rest', 'group', 'dive']) {
      if (tier === 'group') {
        await page.evaluate(() => {
          const m = window.LEET_ALERTS_MAP;
          const hub = m.hubScreen('offline') || { x: innerWidth / 2, y: innerHeight * 0.35 };
          const z = m.interactionConstants().LOD_GROUP_FULL;
          m.zoomAt(hub.x, hub.y, z / Math.max(m.getTransform().zoom, 0.01));
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => window.LEET_ALERTS_MAP.settleNow());
        await page.waitForTimeout(400);
      } else if (tier === 'dive') {
        await page.evaluate(() => window.LEET_ALERTS_MAP.focusCategory('offline'));
        await page.waitForFunction(() => window.LEET_ALERTS_MAP.getMapState() === 'fan', null, { timeout: 8000 });
        await page.waitForTimeout(300);
      }
      const snap = await page.evaluate(() => ({
        overlaps: window.LEET_ALERTS_MAP.labelOverlapCount(),
        orphans: window.LEET_ALERTS_MAP.orphanLabels(),
      }));
      results.push({
        name: `${tag}/no-overlap-${tier}`,
        ok: snap.overlaps === 0 && snap.orphans.length === 0,
        snap,
      });
      if (tier === 'dive') {
        await page.evaluate(() => window.LEET_ALERTS_MAP.clearFocus({ immediate: true }));
      }
    }

    // Rise smooth duration
    await ensureSky(page);
    const rise = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.focusCategory('offline');
      await new Promise((r) => {
        const iv = setInterval(() => {
          if (m.getMapState() === 'fan') { clearInterval(iv); r(); }
        }, 40);
        setTimeout(() => { clearInterval(iv); r(); }, 4000);
      });
      const t0 = performance.now();
      m.clearFocus();
      const frames = [];
      while (performance.now() - t0 < 2000) {
        await new Promise((r) => requestAnimationFrame(r));
        frames.push(m.sampleMotionFrame());
        if (m.getMapState() === 'sky' && frames.length > 5) break;
      }
      const rising = frames.filter((f) => f.mapState === 'rising');
      const dur = rising.length ? rising[rising.length - 1].t - rising[0].t : 0;
      return { state: m.getMapState(), dur, n: rising.length };
    });
    results.push({
      name: `${tag}/rise-smooth-duration`,
      ok: rise.state === 'sky' && rise.dur >= 500 && rise.dur <= 1200,
      rise,
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
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 400));
    }
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name),
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r19-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r19-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
