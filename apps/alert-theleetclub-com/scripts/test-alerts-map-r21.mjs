#!/usr/bin/env node
/**
 * Round 21 — motion only: gentle core, path particles, continuous dive/rise morph.
 * Keeps r20 dive geometry / solid leaves.
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ALERTS_BASE || 'http://127.0.0.1:8767';
const OUT = process.env.R21_TEST_OUT || join(__dirname, '../artifacts/r21-tests');
mkdirSync(OUT, { recursive: true });

async function waitMap(page) {
  await page.goto(`${BASE}/alerts.html?v=21&_=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('map-ready')
    && window.LEET_ALERTS_MAP?.getMapState() === 'sky', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = window.LEET_ALERTS_MAP?.interactionConstants?.();
    return t && t.continuousDiveMorph && t.gentleCoreSpin && t.pathParticlesOutward;
  }, null, { timeout: 5000 });
  await page.evaluate(() => window.LEET_ALERTS_MAP.setIdleRotate(false));
  await page.waitForTimeout(300);
}

async function runSuite(browserType, name) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const tag = `${name}-1280x800`;
  try {
    await waitMap(page);

    const consts = await page.evaluate(() => window.LEET_ALERTS_MAP.interactionConstants());
    results.push({
      name: `${tag}/r21-flags`,
      ok: consts.continuousDiveMorph && consts.gentleCoreSpin && consts.pathParticlesOutward
        && consts.CORE_SPIN_S === 170 && consts.DIVE_MORPH_MS === 1200 && consts.RISE_MS === 900
        && consts.diveSectorFan && consts.solidLeafDots && consts.RISE_ZOOM_TRIGGER >= 2.5,
      consts: {
        CORE_SPIN_S: consts.CORE_SPIN_S, DIVE_MORPH_MS: consts.DIVE_MORPH_MS,
        RISE_MS: consts.RISE_MS, RISE_ZOOM_TRIGGER: consts.RISE_ZOOM_TRIGGER,
        PARTICLE_R_OUT: consts.PARTICLE_R_OUT,
      },
    });

    // Path particles: outward u changes over ~250ms
    const parts = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      await new Promise((r) => requestAnimationFrame(r));
      const a = m.samplePathParticles(8);
      await new Promise((r) => setTimeout(r, 280));
      const b = m.samplePathParticles(8);
      let moved = 0;
      for (let i = 0; i < Math.min(a.outward.length, b.outward.length); i++) {
        if (Math.abs(a.outward[i].u - b.outward[i].u) > 0.02) moved += 1;
      }
      return { count: a.count, moved, u0: a.outward[0]?.u, u1: b.outward[0]?.u, r: a.outward[0]?.r };
    });
    results.push({
      name: `${tag}/path-particles-move`,
      ok: parts.count >= 40 && parts.moved >= 3 && parts.r >= 2.8,
      parts,
    });

    // Dive: continuous ~1200ms, node (x,y) changes, others+core ease over morph
    const dive = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      m.recenter();
      await new Promise((r) => setTimeout(r, 80));
      const rows = [];
      m.focusCategory('offline');
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = m.sampleDiveMotion();
        rows.push(s);
        if (s.mapState === 'fan' && rows.length > 10) break;
      }
      const diving = rows.filter((r) => r.mapState === 'diving');
      const every100 = [];
      let last = -999;
      for (const r of diving) {
        const t = r.t - (diving[0]?.t || r.t);
        if (t - last >= 95) {
          every100.push({
            t: Math.round(t),
            mp: +r.morphProgress.toFixed(3),
            zoom: +r.zoom.toFixed(3),
            core: +r.coreOpacity.toFixed(3),
            others: +r.othersMean.toFixed(3),
            x: r.sampleNode ? +r.sampleNode.x.toFixed(2) : null,
            y: r.sampleNode ? +r.sampleNode.y.toFixed(2) : null,
          });
          last = t;
        }
      }
      const dur = diving.length
        ? diving[diving.length - 1].t - diving[0].t
        : 0;
      const xs = every100.map((r) => r.x).filter((v) => v != null);
      let maxDx = 0;
      for (let i = 1; i < xs.length; i++) maxDx = Math.max(maxDx, Math.abs(xs[i] - xs[i - 1]));
      const mid = every100[Math.floor(every100.length / 2)];
      const early = every100[1] || every100[0];
      const late = every100[every100.length - 1];
      return {
        dur, n: every100.length, every100, maxDx,
        midOthers: mid?.others, earlyCore: early?.core, lateCore: late?.core,
        startZ: early?.zoom, endZ: late?.zoom,
        integrity: m.diveIntegrity(28),
      };
    });
    results.push({
      name: `${tag}/dive-morph-1200ms`,
      ok: dive.dur >= 900 && dive.dur <= 1600 && dive.every100.length >= 8,
      dive: { dur: dive.dur, n: dive.every100.length },
    });
    results.push({
      name: `${tag}/dive-node-interpolates`,
      ok: dive.maxDx > 2 && dive.every100.some((r) => r.x != null),
      maxDx: dive.maxDx, sample: dive.every100.slice(0, 3),
    });
    results.push({
      name: `${tag}/dive-others-core-crossfade`,
      ok: dive.earlyCore > 0.3 && dive.lateCore < 0.08
        && dive.midOthers != null && dive.midOthers > 0.15 && dive.midOthers < 0.85
        && dive.startZ < 1.5 && dive.endZ >= 4.2,
      dive: {
        earlyCore: dive.earlyCore, lateCore: dive.lateCore,
        midOthers: dive.midOthers, startZ: dive.startZ, endZ: dive.endZ,
      },
    });
    results.push({
      name: `${tag}/dive-geometry-kept`,
      ok: dive.integrity && dive.integrity.ok && dive.integrity.crossChainHits === 0,
      integrity: dive.integrity,
    });

    // Rise continuous
    const rise = await page.evaluate(async () => {
      const m = window.LEET_ALERTS_MAP;
      if (m.getMapState() !== 'fan') {
        m.focusCategory('offline');
        await new Promise((r) => {
          const iv = setInterval(() => { if (m.getMapState() === 'fan') { clearInterval(iv); r(); } }, 40);
          setTimeout(() => { clearInterval(iv); r(); }, 4000);
        });
      }
      await new Promise((r) => setTimeout(r, 100));
      const rows = [];
      m.clearFocus();
      const t0 = performance.now();
      while (performance.now() - t0 < 2500) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = m.sampleDiveMotion();
        rows.push(s);
        if (s.mapState === 'sky' && rows.length > 8) break;
      }
      const rising = rows.filter((r) => r.mapState === 'rising');
      const dur = rising.length ? rising[rising.length - 1].t - rising[0].t : 0;
      const mid = rising[Math.floor(rising.length / 2)];
      return {
        dur, n: rising.length,
        midOthers: mid?.othersMean,
        midCore: mid?.coreOpacity,
        endState: m.getMapState(),
      };
    });
    results.push({
      name: `${tag}/rise-morph-900ms`,
      ok: rise.endState === 'sky' && rise.dur >= 600 && rise.dur <= 1200
        && rise.midOthers > 0.2 && rise.midOthers < 0.9,
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
  console.log(`→ ${name}`);
  const rows = await runSuite(type, name);
  all.push(...rows);
  for (const r of rows) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`, r.ok ? '' : JSON.stringify(r).slice(0, 500));
  }
}
const failed = all.filter((r) => !r.ok);
const summary = {
  base: BASE, browsers: browsers.map((b) => b.name),
  passed: all.length - failed.length, failed: failed.length, results: all,
};
writeFileSync(join(OUT, 'r21-test-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${all.length} passed → ${join(OUT, 'r21-test-results.json')}`);
process.exit(failed.length ? 1 : 0);
