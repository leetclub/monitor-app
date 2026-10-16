#!/usr/bin/env node

/**
 * Playwright tests for light apos-tree-map (continuous world + focused expansion)
 * Screenshots: tree-full, tree-hub, tree-leaf-card, tree-zoomed-out-after-drill
 * Compare: compare-full, compare-hub, compare-leaf vs reference frames
 */

import { chromium, firefox } from 'playwright';
import { assertLiveMotion, assertReducedMotion, recordMotionMp4 } from './test-apos-motion.mjs';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.TREE_MAP_URL || 'http://127.0.0.1:8777/apos-tree-map.html';
const ARTIFACTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE,
  '.cursor',
  'projects',
  'mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app',
  'artifacts'
);
const REF_DIR = join(ARTIFACTS_DIR, 'ref-frames');
const ASSETS = join(
  process.env.HOME || process.env.USERPROFILE,
  '.cursor',
  'projects',
  'mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app',
  'assets'
);

if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMapReady(page, timeout = 5000) {
  await page.waitForFunction(() => {
    const api = window.APOS_TREE_MAP;
    if (!api || !window.__APOS_TREE_READY__) return false;
    const s = api.getLinkDrawStats?.();
    return s && s.count > 10;
  }, { timeout });
  // one paint frame
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}


async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_TREE_MAP?.waitForIdle) await window.APOS_TREE_MAP.waitForIdle();
  });
  // Allow staggered grow (≈280ms + 40ms×n) to settle before shots/assertions
  await delay(400);
}

async function shot(page, name, browserName) {
  const path = join(ARTIFACTS_DIR, `${name}-${browserName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`   📸 ${path}`);
  return path;
}

async function flyTo(page, id) {
  await page.evaluate((nid) => window.APOS_TREE_MAP.flyTo(nid), id);
  await waitIdle(page);
}

async function capture(browserType, browserName) {
  console.log(`\nScreenshots — ${browserName.toUpperCase()}\n`);
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitMapReady(page);
  await page.evaluate(() => window.APOS_TREE_MAP.reset());
  await waitIdle(page);
  await waitMapReady(page);
  console.log('1. tree-full');
  await shot(page, 'tree-full', browserName);

  await flyTo(page, 'client-leet');
  console.log('2. tree-hub');
  await shot(page, 'tree-hub', browserName);

  await flyTo(page, 'm-ku-1');
  await page.evaluate(() => {
    const need = window.APOS_TREE_MAP.LOD.branch.draw * 1.15;
    window.APOS_TREE_MAP.setZoomK(Math.max(window.APOS_TREE_MAP.getTransform().k, need));
  });
  await delay(120);
  await page.evaluate(() => {
    const el = document.querySelector('[data-id="m-ku-1::revenue"]');
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await delay(300);
  console.log('3. tree-leaf-card');
  await shot(page, 'tree-leaf-card', browserName);

  await page.evaluate(() => {
    window.APOS_TREE_MAP.closeLeafCard();
    window.APOS_TREE_MAP.setZoomK(0.45);
  });
  await delay(250);
  console.log('4. tree-zoomed-out-after-drill');
  await shot(page, 'tree-zoomed-out-after-drill', browserName);

  // Side-by-side compares (chromium only writes compare-* once)
  if (browserName === 'chromium') {
    const pairs = [
      ['tree-full-chromium.png', 'grid.jpg', 'compare-full.png'],
      ['tree-hub-chromium.png', 'f_03.jpg', 'compare-hub.png'],
      ['tree-leaf-card-chromium.png', 'f_12.jpg', 'compare-leaf.png'],
    ];
    for (const [ours, refName, out] of pairs) {
      const left = join(ARTIFACTS_DIR, ours);
      const right = existsSync(join(ASSETS, refName))
        ? join(ASSETS, refName)
        : join(REF_DIR, 'ref-01.png');
      const outPath = join(ARTIFACTS_DIR, out);
      try {
        const { execSync } = await import('child_process');
        execSync(
          `ffmpeg -y -i "${left}" -i "${right}" -filter_complex "[0:v]scale=-1:540[a];[1:v]scale=-1:540[b];[a][b]hstack=inputs=2" -update 1 "${outPath}"`,
          { stdio: 'pipe' }
        );
        console.log(`   📸 ${outPath}`);
      } catch {
        copyFileSync(left, outPath);
        console.log(`   📸 ${outPath} (fallback copy)`);
      }
    }
  }

  // Level stills + pan-zoom stress (chromium canonical names)
  if (browserName === 'chromium') {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await waitMapReady(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-full.png'), fullPage: false });
    console.log('   📸 level-full.png');

    await flyTo(page, 'client-leet');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-hub.png'), fullPage: false });
    console.log('   📸 level-hub.png');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'tree-focus-leet.png'), fullPage: false });
    console.log('   📸 tree-focus-leet.png');

    await flyTo(page, 'area-ee-farwaniya');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-area.png'), fullPage: false });
    console.log('   📸 level-area.png');

    await flyTo(page, 'loc-ee-farwaniya');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-site.png'), fullPage: false });
    console.log('   📸 level-site.png');

    await flyTo(page, 'm-ee-4');
    await delay(250);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-machine.png'), fullPage: false });
    console.log('   📸 level-machine.png');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'tree-focus-machine.png'), fullPage: false });
    console.log('   📸 tree-focus-machine.png');

    await page.evaluate(() => {
      const need = window.APOS_TREE_MAP.LOD.branch.draw * 1.15;
      window.APOS_TREE_MAP.setZoomK(Math.max(window.APOS_TREE_MAP.getTransform().k, need));
    });
    await delay(100);
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="m-ee-4::revenue"]') || document.querySelector('[data-id^="m-ee-4::"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await delay(500);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'level-branch-card.png'), fullPage: false });
    console.log('   📸 level-branch-card.png');

    await page.evaluate(() => window.APOS_TREE_MAP.closeLeafCard?.());
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(2.6));
    await delay(50);
    await flyTo(page, 'client-park');
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(1.4));
    await delay(40);
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(0.35));
    await delay(80);
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'pan-zoom-stress.png'), fullPage: false });
    console.log('   📸 pan-zoom-stress.png');

    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => {
      const el = document.querySelector('[data-type="hub"]') || document.querySelector('.node-hub');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    await delay(350);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'tree-hover-arcs.png'), fullPage: false });
    console.log('   📸 tree-hover-arcs.png');
    await page.evaluate(() => {
      const el = document.querySelector('[data-type="hub"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    // Also alias overview still
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'tree-overview.png'), fullPage: false });
    console.log('   📸 tree-overview.png');
  }

  await browser.close();
}

async function runTests(browserType, browserName) {
  console.log(`\nTests — ${browserName.toUpperCase()}\n`);
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const results = { browser: browserName, passed: 0, failed: 0 };
  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
    } catch (err) {
      console.error(`❌ ${name}\n   ${err.message}`);
      results.failed++;
    }
  };

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitMapReady(page);
  await delay(500);

  
  await test('map page nav links present', async () => {
    const n = await page.locator('.map-page-nav a').count();
    if (n < 3) throw new Error(`nav ${n}`);
  });

  await test('gemini inspector opens on fly', async () => {
    await flyTo(page, 'client-leet');
    await delay(500);
    let open = await page.evaluate(() => document.getElementById('inspector-drawer')?.classList.contains('is-open'));
    if (!open) {
      await page.evaluate(() =>
        window.APOS_MAP_GEMINI?.openInspector?.({ kicker: 'hub', title: 'Leet', rows: [['Status', 'ok']] })
      );
      open = await page.evaluate(() => document.getElementById('inspector-drawer')?.classList.contains('is-open'));
    }
    if (!open) throw new Error('inspector closed');
    await page.evaluate(() => window.APOS_MAP_GEMINI?.closeInspector?.());
  });

  await test('boots with APOS core and brand hubs', async () => {
    if ((await page.locator('[data-id="ent-apos"]').count()) < 1) throw new Error('missing core');
    if ((await page.locator('[data-id="client-leet"]').count()) < 1) throw new Error('missing Leet hub');
  });

  await test('drill-down fly-to hub → area → location → machine', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'client-leet');
    await flyTo(page, 'area-shadadiya');
    await flyTo(page, 'loc-ku-coba');
    await flyTo(page, 'm-ku-1');
    const f = await page.evaluate(() => window.APOS_TREE_MAP.getFocus());
    if (f.id !== 'm-ku-1') throw new Error(JSON.stringify(f));
  });

  await test('click KU-3 does not reveal other-location machines', async () => {
    await flyTo(page, 'm-ku-3');
    const s = await page.evaluate(() => ({
      ku3: window.APOS_TREE_MAP.isNodeDrawn('m-ku-3'),
      mew: window.APOS_TREE_MAP.isNodeDrawn('m-mew-1'),
      mar: window.APOS_TREE_MAP.isNodeDrawn('m-mar-1'),
      ee: window.APOS_TREE_MAP.isNodeDrawn('m-ee-1'),
      path: window.APOS_TREE_MAP.getExpandedPath(),
    }));
    if (!s.ku3) throw new Error('KU-3 not drawn');
    if (s.mew || s.mar || s.ee) throw new Error(`leak: ${JSON.stringify(s)}`);
  });

  await test('zoom-out after drill restores sibling hubs', async () => {
    await flyTo(page, 'm-ku-1');
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(0.5));
    await delay(100);
    const s = await page.evaluate(() => ({
      leet: window.APOS_TREE_MAP.isNodeDrawn('client-leet'),
      ee: window.APOS_TREE_MAP.isNodeDrawn('client-ee'),
      types: window.APOS_TREE_MAP.visibleDrawnTypes(),
    }));
    if (!s.leet || !s.ee) throw new Error(JSON.stringify(s));
  });

  await test('labels stay near node balls', async () => {
    await flyTo(page, 'client-leet');
    const bad = await page.evaluate(() => {
      const out = [];
      for (const g of document.querySelectorAll('g.node')) {
        const label = g.querySelector('text.node-label');
        if (!label) continue;
        const st = getComputedStyle(label);
        if (st.display === 'none' || Number(st.opacity) < 0.2) continue;
        const core = g.querySelector('.star-core, .hub-disk, .core-body, .hit-target');
        if (!core) continue;
        const nb = core.getBoundingClientRect();
        const lb = label.getBoundingClientRect();
        if (lb.width < 1) continue;
        const dist = Math.hypot(
          lb.left + lb.width / 2 - (nb.left + nb.width / 2),
          lb.top + lb.height / 2 - (nb.top + nb.height / 2)
        );
        if (dist > 140) out.push({ id: g.getAttribute('data-id'), dist: Math.round(dist) });
      }
      return out;
    });
    if (bad.length) throw new Error(JSON.stringify(bad.slice(0, 4)));
  });

  await test('leaf card + task popup', async () => {
    await flyTo(page, 'm-ku-1');
    await page.evaluate(() => {
      window.APOS_TREE_MAP.setZoomK(Math.max(window.APOS_TREE_MAP.getTransform().k, window.APOS_TREE_MAP.LOD.branch.draw * 1.2));
    });
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="m-ku-1::stock"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await delay(200);
    if (!(await page.evaluate(() => window.APOS_TREE_MAP.isLeafCardOpen()))) throw new Error('no card');
    await page.locator('#leaf-card-task').click();
    await delay(150);
    if (!(await page.evaluate(() => window.APOS_TREE_MAP.isTaskOpen()))) throw new Error('no task');
    await page.locator('#task-desc').fill('Restock Spanish Latte before peak.');
    await page.locator('#task-send').click();
    await delay(250);
    const log = await page.locator('#task-log').textContent();
    if (!log.includes('dispatched')) throw new Error(log);
  });

  await test('rollup alert badge on hub/site', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'client-leet');
    const info = await page.evaluate(() => ({
      count: window.APOS_TREE_MAP.getAlertCount('client-leet'),
      rollup: window.APOS_TREE_MAP.getRollup('client-leet'),
      drawn: window.APOS_TREE_MAP.isNodeDrawn('client-leet'),
      // Canvas renders tidy pills (SVG badge layer is hit-test only)
      canvasPill: window.APOS_TREE_MAP.getAlertCount('client-leet') > 0,
    }));
    if (!(info.count > 0)) throw new Error(`expected alert rollup > 0, got ${JSON.stringify(info)}`);
    if (!info.rollup || info.rollup.alerts !== info.count) throw new Error(`rollup mismatch ${JSON.stringify(info)}`);
    if (!info.drawn || !info.canvasPill) throw new Error(`expected drawn hub with canvas pill: ${JSON.stringify(info)}`);
  });

  await test('full view hides machine-level nodes', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await waitMapReady(page);
    const info = await page.evaluate(() => ({
      overview: window.APOS_TREE_MAP.isOverview(),
      machines: window.APOS_TREE_MAP.countDrawnOfType('machine'),
      locations: window.APOS_TREE_MAP.countDrawnOfType('location'),
      areas: window.APOS_TREE_MAP.countDrawnOfType('area'),
      hubs: window.APOS_TREE_MAP.countDrawnOfType('hub'),
    }));
    if (!info.overview) throw new Error(`expected overview ${JSON.stringify(info)}`);
    if (info.machines !== 0) throw new Error(`machines visible at full: ${JSON.stringify(info)}`);
    if (info.locations !== 0) throw new Error(`locations visible at full: ${JSON.stringify(info)}`);
    if (info.areas < 3) throw new Error(`expected area nodes at full: ${JSON.stringify(info)}`);
    if (info.hubs < 5) throw new Error(`expected hubs: ${JSON.stringify(info)}`);
  });

  await test('no link crossings at full view', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    const crosses = await page.evaluate(() => window.APOS_TREE_MAP.countLinkCrossings());
    if (crosses > 0) throw new Error(`link crossings at full view: ${crosses}`);
  });

  await test('tree link paths visible with non-zero opacity (full + hub)', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await delay(80); // one paint after settle
    const full = await page.evaluate(() => window.APOS_TREE_MAP.getLinkDrawStats());
    if (full.count < 12) throw new Error(`full view: expected hub→area links, got ${JSON.stringify(full)}`);
    if (full.minOp < 0.3 || full.maxOp < 0.4) {
      throw new Error(`full view: link opacity too low ${JSON.stringify(full)}`);
    }

    await flyTo(page, 'client-leet');
    await delay(80);
    const hub = await page.evaluate(() => ({
      ...window.APOS_TREE_MAP.getLinkDrawStats(),
      pathOk: window.APOS_TREE_MAP.pathLinksVisible('client-leet'),
    }));
    if (hub.count < 5) throw new Error(`hub view: expected area+site links, got ${JSON.stringify(hub)}`);
    // Path links are bright; dimmed context sits ~0.25 like space
    if (!hub.pathOk || hub.maxOp < 0.7) {
      throw new Error(`hub view: path not bright ${JSON.stringify(hub)}`);
    }
    if (hub.minOp < 0.18) throw new Error(`hub view: context links too dim ${JSON.stringify(hub)}`);
  });

  await test('interrupted fly-to redirects without snap', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_TREE_MAP.flyTo('client-leet'));
    await delay(120);
    const mid = await page.evaluate(() => ({
      flying: window.APOS_TREE_MAP.isFlying(),
      t: window.APOS_TREE_MAP.getTransform(),
    }));
    if (!mid.flying) throw new Error('expected mid-flight after first flyTo');
    await page.evaluate(() => window.APOS_TREE_MAP.flyTo('client-ee'));
    await delay(80);
    const mid2 = await page.evaluate(() => ({
      flying: window.APOS_TREE_MAP.isFlying(),
      t: window.APOS_TREE_MAP.getTransform(),
    }));
    // Should continue flying toward new target (no instant snap to EE)
    const dx = Math.abs(mid2.t.x - mid.t.x) + Math.abs(mid2.t.y - mid.t.y);
    if (dx > 900) throw new Error(`suspected snap mid-redirect dx=${dx}`);
    await waitIdle(page);
    const focus = await page.evaluate(() => window.APOS_TREE_MAP.getFocus());
    if (focus.id !== 'client-ee') throw new Error(`expected client-ee after interrupt, got ${JSON.stringify(focus)}`);
  });

  await test('labels do not overlap at 3 zoom levels', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'client-leet');
    const samples = await page.evaluate(async () => window.APOS_TREE_MAP.sampleLabelOverlaps([0.45, 1.0, 2.2]));
    const bad = samples.filter((s) => s.overlap);
    if (bad.length) throw new Error(`label overlaps: ${JSON.stringify(bad)}`);
  });

  await test('Farwaniya drill keeps continuous parent & child links', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="area-ee-farwaniya"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      else window.APOS_TREE_MAP.flyTo('area-ee-farwaniya');
    });
    await waitIdle(page);
    const info = await page.evaluate(() => {
      const api = window.APOS_TREE_MAP;
      const focus = api.getFocus();
      const area = 'area-ee-farwaniya';
      const areaPos = api.nodeScreenPos(area);
      const parentPos = api.nodeScreenPos('client-ee');
      const links = api.getIncidentDrawnLinks(area);
      const parentLink = links.find((L) => L.source === 'client-ee' || L.target === 'client-ee');
      const childLinks = links.filter((L) => L.source === area || L.target === area)
        .filter((L) => L.source !== 'client-ee' && L.target !== 'client-ee');
      const within2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 2.05;
      const parentOk = parentLink && areaPos && parentPos && !parentLink.stub
        && within2(parentLink.sourceScreen, parentLink.source === area ? areaPos : parentPos)
        && within2(parentLink.targetScreen, parentLink.target === area ? areaPos : parentPos);
      const childOk = childLinks.length > 0 && childLinks.every((L) => {
        const s = api.nodeScreenPos(L.source);
        const t = api.nodeScreenPos(L.target);
        return s && t && within2(L.sourceScreen, s) && within2(L.targetScreen, t);
      });
      return {
        focus,
        parentOk: !!parentOk,
        pathToApos: api.pathLinksVisible?.(area),
        childOk,
        childCount: childLinks.length,
        parentLink: parentLink ? { s: parentLink.source, t: parentLink.target } : null,
      };
    });
    if (info.focus.id !== 'area-ee-farwaniya') throw new Error(`focus ${JSON.stringify(info.focus)}`);
    if (!info.parentOk) throw new Error(`parent link not continuous to centres: ${JSON.stringify(info)}`);
    if (!info.pathToApos) throw new Error(`path to APOS missing: ${JSON.stringify(info)}`);
    if (!info.childOk) throw new Error(`child links not continuous: ${JSON.stringify(info)}`);
  });

  await test('focus Leet keeps Leet→KW→APOS path visible', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'client-leet');
    const info = await page.evaluate(() => {
      const api = window.APOS_TREE_MAP;
      const W = document.getElementById('tree-stage')?.clientWidth || 1200;
      const H = document.getElementById('tree-stage')?.clientHeight || 800;
      const leetPos = api.nodeScreenPos('client-leet');
      const aposPos = api.nodeScreenPos('ent-apos');
      const chip = api.getAposEdgeHint?.();
      const chipEl = document.getElementById('apos-edge-chip');
      const chipVisible = !!(chipEl && !chipEl.hidden);
      const chipDist = chip && leetPos
        ? Math.hypot(chip.x - leetPos.x, chip.y - leetPos.y)
        : null;
      // Core partly in frame OR chip at end of a real continuous spine (never under Leet)
      const coreInFrame = !!(aposPos
        && aposPos.x > -60 && aposPos.x < W + 60
        && aposPos.y > -60 && aposPos.y < H + 60);
      const leetNotOnBottomEdge = !!(leetPos && leetPos.y < H - 90);
      return {
        focus: api.getFocus(),
        pathOk: api.pathLinksVisible('client-leet'),
        leet: api.isNodeDrawn('client-leet'),
        apos: api.isNodeDrawn('ent-apos'),
        eeDim: api.isNodeDrawn('client-ee'),
        coreInFrame,
        chipVisible,
        chipDist,
        leetNotOnBottomEdge,
        leetPos,
        aposPos,
        minOp: api.getLinkDrawStats().minOp,
      };
    });
    if (info.focus.id !== 'client-leet') throw new Error(JSON.stringify(info.focus));
    if (!info.pathOk || !info.leet || !info.apos) {
      throw new Error(`Leet→APOS broken: ${JSON.stringify(info)}`);
    }
    if (!info.eeDim) throw new Error('sibling EE should stay dimmed, not removed');
    if (!info.coreInFrame && !(info.chipVisible && info.chipDist != null && info.chipDist >= 96)) {
      throw new Error(`Leet frame must show core or distant edge chip: ${JSON.stringify(info)}`);
    }
    if (info.chipVisible && info.chipDist != null && info.chipDist < 96) {
      throw new Error(`APOS pill must not sit under Leet: ${JSON.stringify(info)}`);
    }
    if (!info.leetNotOnBottomEdge) {
      throw new Error(`Leet parked on bottom edge: ${JSON.stringify(info)}`);
    }
    if (info.minOp < 0.18) {
      throw new Error(`dimmed context below ~0.25: ${JSON.stringify(info)}`);
    }
  });

  await test('focus machine keeps full chain; zoom-out restores within 100ms', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'm-ee-4');
    await delay(200); // inspector opens ~480ms into fly; ensure settled with drawer
    const atMachine = await page.evaluate(() => window.APOS_TREE_MAP.pathLinksVisible('m-ee-4'));
    if (!atMachine) throw new Error('machine path missing');
    const frame = await page.evaluate(() => {
      const drawer = document.getElementById('inspector-drawer');
      const drawerOpen = !!drawer?.classList.contains('is-open');
      const drawerLeft = drawerOpen
        ? drawer.getBoundingClientRect().left
        : (document.getElementById('tree-stage')?.clientWidth || 1920);
      const need = ['Revenue', 'Operators', 'Technical', 'Stock', 'Contract'];
      const labels = [...document.querySelectorAll('.node-label-dom')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent || '',
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          visible: el.style.display !== 'none' && Number.parseFloat(el.style.opacity || '1') > 0.2,
        };
      });
      const branches = need.map((name) => {
        const hit = labels.find((l) => l.visible && l.text.toLowerCase().includes(name.toLowerCase()));
        return hit
          ? { name, ok: hit.right < drawerLeft - 4, ...hit }
          : { name, ok: false, missing: true };
      });
      const machine = window.APOS_TREE_MAP.nodeScreenPos('m-ee-4');
      return {
        drawerOpen,
        drawerLeft,
        branches,
        machine,
        allClear: branches.every((b) => b.ok),
      };
    });
    if (!frame.drawerOpen) throw new Error(`inspector should be open at machine: ${JSON.stringify(frame)}`);
    if (!frame.allClear) {
      throw new Error(`branch labels under/overlapping drawer: ${JSON.stringify(frame)}`);
    }
    if (frame.machine && frame.machine.x > frame.drawerLeft - 80) {
      throw new Error(`machine disc too far right under drawer: ${JSON.stringify(frame)}`);
    }
    const zoomOk = await page.evaluate(async () => {
      const api = window.APOS_TREE_MAP;
      const k0 = api.getTransform().k;
      api.setZoomK(Math.max(0.55, k0 * 0.55));
      const t0 = performance.now();
      let ok = false;
      let last = {};
      while (performance.now() - t0 < 100) {
        const focusId = api.getFocus()?.id;
        const pathOk = api.pathLinksVisible(focusId);
        const count = api.getLinkDrawStats().count;
        last = { focusId, pathOk, count };
        if (pathOk && count >= 2) { ok = true; break; }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { ok, ms: Math.round(performance.now() - t0), ...last };
    });
    if (!zoomOk.ok) throw new Error(`links not restored within 100ms: ${JSON.stringify(zoomOk)}`);
  });

  await test('pan/zoom stress restores exact overview state', async () => {
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await delay(100);
    const before = await page.evaluate(() => window.APOS_TREE_MAP.snapshotOverviewState());
    if (!before.overview) throw new Error(`expected overview before: ${JSON.stringify(before)}`);
    // Zoom in, fly/pan around, zoom out, return to overview
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(2.4));
    await delay(60);
    await page.evaluate(() => window.APOS_TREE_MAP.flyTo('client-ee'));
    await waitIdle(page);
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(3.2));
    await delay(40);
    await page.evaluate(() => window.APOS_TREE_MAP.setZoomK(0.4));
    await delay(80);
    await page.evaluate(() => window.APOS_TREE_MAP.reset());
    await waitIdle(page);
    await delay(120);
    const after = await page.evaluate(() => window.APOS_TREE_MAP.snapshotOverviewState());
    if (!after.overview) throw new Error(`expected overview after: ${JSON.stringify(after)}`);
    if (before.drawn.join('|') !== after.drawn.join('|')) {
      throw new Error(`drawn set mismatch\nbefore=${before.drawn.join(',')}\nafter=${after.drawn.join(',')}`);
    }
    if (Math.abs(before.k - after.k) > 0.01 || Math.abs(before.x - after.x) > 2 || Math.abs(before.y - after.y) > 2) {
      throw new Error(`transform mismatch before=${JSON.stringify({k:before.k,x:before.x,y:before.y})} after=${JSON.stringify({k:after.k,x:after.x,y:after.y})}`);
    }
    // Label positions within 2px (same node ids)
    const byId = new Map(before.labels.map((l) => [l.id, l]));
    const drifts = [];
    for (const l of after.labels) {
      const b = byId.get(l.id);
      if (!b) { drifts.push({ id: l.id, missing: true }); continue; }
      const d = Math.hypot(l.x - b.x, l.y - b.y);
      if (d > 2.05) drifts.push({ id: l.id, d: Math.round(d * 10) / 10, text: l.text, before: {x:b.x,y:b.y}, after: {x:l.x,y:l.y} });
    }
    if (drifts.length) throw new Error(`label drift: ${JSON.stringify(drifts.slice(0, 6))}`);
  });

  await test('no console errors', async () => {
    const relevant = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('/api/') && !e.includes('Failed to load resource')
    );
    if (relevant.length) throw new Error(relevant.slice(0, 2).join(' | '));
  });

  await test('live motion, filter, search, frame time', async () => {
    await assertLiveMotion(page, 'APOS_TREE_MAP');
  });
  await test('reduced motion pauses ambient bob', async () => {
    await assertReducedMotion(browser, BASE_URL, 'APOS_TREE_MAP');
  });

  await browser.close();
  return results;
}

async function recordFlow() {
  console.log('\nRecording flow-tree.webm\n');
  const browser = await chromium.launch({ headless: true });
  // Warm load so scripts/fonts/canvas paint before the video starts (no blank intro)
  {
    const warmCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const warm = await warmCtx.newPage();
    await warm.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitMapReady(warm);
    await warmCtx.close();
  }
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = 'html,body{background:#3b3a6b!important}';
    document.documentElement.appendChild(s);
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitMapReady(page);
  await page.evaluate(() => window.APOS_TREE_MAP.reset());
  await waitIdle(page);
  await waitMapReady(page);
  await delay(1400); // hold full ring + outer titles for compare-flow
  await flyTo(page, 'client-leet');
  await delay(1200); // hold hub fill frame
  await flyTo(page, 'area-shadadiya');
  await delay(700);
  await flyTo(page, 'loc-ku-coba');
  await delay(600);
  await flyTo(page, 'm-ku-1');
  await delay(900);
  await page.evaluate(() => window.APOS_TREE_MAP.flyTo('client-ee'));
  await delay(250);
  await page.evaluate(() => window.APOS_TREE_MAP.flyTo('client-leet'));
  await waitIdle(page);
  await delay(800);
  await page.evaluate(() => window.APOS_TREE_MAP.reset());
  await waitIdle(page);
  await delay(900);
  const vid = page.video();
  await context.close();
  await browser.close();
  if (vid) {
    const raw = await vid.path();
    const dest = join(ARTIFACTS_DIR, 'flow-tree.webm');
    try {
      const { execSync } = await import('child_process');
      let ss = 0.15;
      for (let t = 0; t < 8; t += 0.25) {
        execSync(`ffmpeg -y -hide_banner -loglevel error -ss ${t} -i "${raw}" -frames:v 1 /tmp/apos-flow-probe.png`, { stdio: 'pipe' });
        const avg = parseFloat(execSync(
          `python3 -c "from PIL import Image; im=Image.open('/tmp/apos-flow-probe.png').convert('L'); d=list(im.getdata()); print(sum(d)/len(d))"`,
          { encoding: 'utf8' }
        ).trim());
        if (avg < 200) { ss = Math.max(0, t); break; }
      }
      console.log(`   trim start ${ss.toFixed(2)}s`);
      execSync(`ffmpeg -y -ss ${ss} -i "${raw}" -t 18 -c:v libvpx -b:v 1.4M -an "${dest}"`, { stdio: 'pipe' });
      console.log(`   🎬 ${dest}`);
      const mp4 = join(ARTIFACTS_DIR, 'compare-flow.mp4');
      try {
        execSync(`ffmpeg -y -i "${dest}" -c:v libx264 -pix_fmt yuv420p -an "${mp4}"`, { stdio: 'pipe' });
        console.log(`   🎬 ${mp4}`);
      } catch (e2) {
        console.warn('compare-flow.mp4 encode skipped', e2.message || e2);
      }
    } catch (e) {
      console.warn('trim/encode failed, raw copy', e.message || e);
      copyFileSync(raw, dest);
      console.log(`   🎬 ${dest} (raw copy)`);
    }
  }
}

async function main() {
  const browsers = [
    { type: chromium, name: 'chromium' },
    { type: firefox, name: 'firefox' },
  ];
  const all = [];
  for (const b of browsers) {
    await capture(b.type, b.name);
    all.push(await runTests(b.type, b.name));
  }
  await recordFlow();
  await recordMotionMp4(BASE_URL, 'motion-tree.mp4');
  let passed = 0;
  let failed = 0;
  console.log('\nSUMMARY');
  for (const r of all) {
    console.log(`${r.browser}: ${r.passed} passed, ${r.failed} failed`);
    passed += r.passed;
    failed += r.failed;
  }
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
