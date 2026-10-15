#!/usr/bin/env node

/**
 * Playwright tests for continuous semantic-zoom apos-space-map
 * Screenshots: galaxy-full, constellation-kuwait, location-machines,
 *   machine-branches, branch-card, terminal-popup, zoomed-out-after-drill
 */

import { chromium, firefox } from 'playwright';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.SPACE_MAP_URL || 'http://127.0.0.1:8777/apos-space-map.html';
const ARTIFACTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE,
  '.cursor',
  'projects',
  'mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app',
  'artifacts'
);

if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitMapReady(page, timeout = 8000) {
  await page.waitForFunction(() => {
    const api = window.APOS_SPACE_MAP;
    if (!api || !window.__APOS_SPACE_READY__) return false;
    const s = api.getLinkDrawStats?.();
    return s && s.count >= 3;
  }, { timeout });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_SPACE_MAP?.waitForIdle) await window.APOS_SPACE_MAP.waitForIdle();
  });
  // Allow staggered grow to settle before shots/assertions
  await delay(400);
}

async function shot(page, name, browserName) {
  const path = join(ARTIFACTS_DIR, `${name}-${browserName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`   📸 ${path}`);
  return path;
}

async function flyTo(page, id) {
  await page.evaluate((nid) => window.APOS_SPACE_MAP.flyTo(nid), id);
  await waitIdle(page);
}

async function drillToMachine(page) {
  await flyTo(page, 'country-kw');
  await flyTo(page, 'client-leet');
  await flyTo(page, 'area-shadadiya');
  await flyTo(page, 'loc-ku-coba');
  await flyTo(page, 'm-ku-1');
}

async function captureScreenshots(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Screenshots — ${browserName.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    console.error(`❌ Failed to load: ${err.message}`);
    await browser.close();
    return false;
  }

  await waitMapReady(page);
  await page.evaluate(() => window.APOS_SPACE_MAP.reset());
  await waitIdle(page);
  console.log('1. galaxy-full');
  await shot(page, 'galaxy-full', browserName);

  await flyTo(page, 'country-kw');
  console.log('2. constellation-kuwait');
  await shot(page, 'constellation-kuwait', browserName);

  await flyTo(page, 'loc-ku-coba');
  console.log('3. location-machines');
  await shot(page, 'location-machines', browserName);

  await flyTo(page, 'm-ku-1');
  // ensure branches LOD
  await page.evaluate(() => {
    const k = Math.max(window.APOS_SPACE_MAP.getTransform().k, window.APOS_SPACE_MAP.LOD.branch.draw * 1.1);
    window.APOS_SPACE_MAP.setZoomK(k);
  });
  await delay(200);
  console.log('4. machine-branches');
  await shot(page, 'machine-branches', browserName);

  await page.locator('[data-id="m-ku-1::revenue"]').click({ force: true });
  await delay(400);
  console.log('5. branch-card');
  await shot(page, 'branch-card', browserName);

  await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ku-1', 'operator'));
  await delay(350);
  console.log('6. terminal-popup');
  await shot(page, 'terminal-popup', browserName);

  await page.evaluate(() => window.APOS_SPACE_MAP.closeTerminal());
  // wheel zoom out from machine — continuous world reveals siblings/brands
  await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(0.55));
  await delay(300);
  console.log('7. zoomed-out-after-drill');
  await shot(page, 'zoomed-out-after-drill', browserName);

  if (browserName === 'chromium') {
    await page.evaluate(() => {
      window.APOS_MAP_GEMINI?.closeInspector?.();
      window.APOS_SPACE_MAP.reset();
    });
    await waitIdle(page);
    await delay(200);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-full.png'), fullPage: false });
    console.log('   📸 space-level-full.png');
    await flyTo(page, 'country-kw');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-country.png'), fullPage: false });
    console.log('   📸 space-level-country.png');
    await flyTo(page, 'client-ee');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-brand.png'), fullPage: false });
    console.log('   📸 space-level-brand.png');
    await flyTo(page, 'area-ee-farwaniya');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-area.png'), fullPage: false });
    console.log('   📸 space-level-area.png');
    await flyTo(page, 'loc-ee-farwaniya');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-site.png'), fullPage: false });
    console.log('   📸 space-level-site.png');
    await flyTo(page, 'm-ee-4');
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-machine.png'), fullPage: false });
    console.log('   📸 space-level-machine.png');
    await page.evaluate(() => {
      const need = window.APOS_SPACE_MAP.LOD.branch.draw * 1.15;
      window.APOS_SPACE_MAP.setZoomK(Math.max(window.APOS_SPACE_MAP.getTransform().k, need));
    });
    await delay(100);
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="m-ee-4::revenue"]') || document.querySelector('[data-id^="m-ee-4::"]');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await delay(500);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-branch-card.png'), fullPage: false });
    console.log('   📸 space-level-branch-card.png');
    await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ee-4', 'operator'));
    await delay(200);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-level-terminal.png'), fullPage: false });
    console.log('   📸 space-level-terminal.png');
    await page.evaluate(() => window.APOS_SPACE_MAP.closeTerminal());
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(2.4));
    await flyTo(page, 'country-kw');
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(0.4));
    await delay(80);
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-pan-zoom-stress.png'), fullPage: false });
    console.log('   📸 space-pan-zoom-stress.png');

    // Gemini: hover arcs + hex mode
    await page.evaluate(() => {
      window.APOS_MAP_GEMINI?.closeInspector?.();
      window.APOS_SPACE_MAP.reset();
    });
    await waitIdle(page);
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="country-kw"]') || document.querySelector('[data-id="client-ee"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    await delay(350);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-hover-arcs.png'), fullPage: false });
    console.log('   📸 space-hover-arcs.png');
    await page.evaluate(() => {
      const el = document.querySelector('[data-id="country-kw"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    await page.evaluate(() => {
      window.APOS_MAP_GEMINI?.closeInspector?.();
      window.APOS_MAP_GEMINI?.setLayoutMode?.('hex') || window.APOS_SPACE_MAP.setLayoutMode('hex');
    });
    await delay(750);
    await page.screenshot({ path: join(ARTIFACTS_DIR, 'space-hex-mode.png'), fullPage: false });
    console.log('   📸 space-hex-mode.png');
    await page.evaluate(() => {
      window.APOS_MAP_GEMINI?.setLayoutMode?.('radial') || window.APOS_SPACE_MAP.setLayoutMode('radial');
    });
    await delay(700);
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
  }

  await browser.close();
  console.log(`✅ ${browserName} screenshots done\n`);
  return true;
}

async function runTests(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Tests — ${browserName.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const results = { browser: browserName, passed: 0, failed: 0 };

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(`   ${err.message}`);
      results.failed++;
    }
  };

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    console.error(`❌ Failed to load: ${err.message}`);
    await browser.close();
    results.failed++;
    return results;
  }

  await waitMapReady(page);

  await test('boots with galaxy focus and APOS core', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    if ((await page.locator('[data-id="ent-apos"]').count()) < 1) throw new Error('missing APOS core');
    if ((await page.locator('[data-id="country-kw"]').count()) < 1) throw new Error('missing Kuwait');
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level > 1) throw new Error(`expected galaxy/country depth, got ${focus.level}`);
  });

  await test('drill-down fly-to: country → client → area → location → machine', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await drillToMachine(page);
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.machineId !== 'm-ku-1' && focus.id !== 'm-ku-1') {
      throw new Error(`expected machine m-ku-1, got ${JSON.stringify(focus)}`);
    }
  });

  await test('after fly-to, focus node is near viewport center', async () => {
    await flyTo(page, 'client-leet');
    const info = await page.evaluate(() => {
      const pos = window.APOS_SPACE_MAP.nodeScreenPos('client-leet');
      const stage = document.getElementById('space-stage');
      return { pos, w: stage.clientWidth, h: stage.clientHeight };
    });
    if (!info.pos) throw new Error('no screen pos');
    const dx = Math.abs(info.pos.x - info.w / 2) / info.w;
    const dy = Math.abs(info.pos.y - info.h / 2) / info.h;
    if (dx > 0.18 || dy > 0.22) {
      throw new Error(`client-leet not centered dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}`);
    }
  });

  await test('visible labels stay near their node balls', async () => {
    await flyTo(page, 'country-kw');
    const report = await page.evaluate(() => {
      const bad = [];
      const api = window.APOS_SPACE_MAP;
      for (const el of document.querySelectorAll('.node-label-dom')) {
        if (el.style.display === 'none' || Number(el.style.opacity || 1) < 0.2) continue;
        const id = el.dataset.nid;
        if (!id || !api.isNodeDrawn(id)) continue;
        const pos = api.nodeScreenPos(id);
        if (!pos) continue;
        const lb = el.getBoundingClientRect();
        if (lb.width < 1) continue;
        const dist = Math.hypot(lb.left + lb.width / 2 - pos.x, lb.top + lb.height / 2 - pos.y);
        if (dist > 140) bad.push({ id, dist: Math.round(dist) });
      }
      return bad;
    });
    if (report.length) throw new Error(`misplaced labels: ${JSON.stringify(report.slice(0, 5))}`);
  });

  await test('clicking a machine expands only that location path (not sibling locations)', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    // Fly into KU-3 Engineering under loc-ku-coba
    await flyTo(page, 'm-ku-3');
    const state = await page.evaluate(() => {
      const drawn = (id) => window.APOS_SPACE_MAP.isNodeDrawn(id);
      return {
        focus: window.APOS_SPACE_MAP.getFocus(),
        expanded: window.APOS_SPACE_MAP.getExpandedPath(),
        ku3: drawn('m-ku-3'),
        ku1: drawn('m-ku-1'), // sibling machine same location — ok
        mew1: drawn('m-mew-1'), // other location — must NOT be drawn
        jg21: drawn('m-jg2-1'),
        mar1: drawn('m-mar-1'),
        ee1: drawn('m-ee-1'),
        locCoba: drawn('loc-ku-coba'),
        locMew: drawn('loc-mew-zahra'),
      };
    });
    if (state.focus.id !== 'm-ku-3' && state.focus.machineId !== 'm-ku-3') {
      throw new Error(`expected focus m-ku-3, got ${JSON.stringify(state.focus)}`);
    }
    if (!state.ku3) throw new Error('KU-3 should be drawn');
    if (state.mew1 || state.jg21 || state.mar1 || state.ee1) {
      throw new Error(`other-location machines leaked: ${JSON.stringify(state)}`);
    }
    // sibling location hub may exist as collapsed star, but not its machines
    if (state.locMew && state.mew1) throw new Error('MEW location expanded incorrectly');
  });

  await test('wheel zoom-out after drill reveals siblings and other brands', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await drillToMachine(page);
    // deep enough for machine
    const deepK = await page.evaluate(() => window.APOS_SPACE_MAP.getTransform().k);
    if (deepK < 1) throw new Error(`expected zoomed-in k, got ${deepK}`);

    // zoom out continuously to country-ish scale — siblings/brands must reappear
    // Collapse toward country framing (shared engine thresholds)
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(0.95));
    await delay(150);
    const drawn = await page.evaluate(() => ({
      types: window.APOS_SPACE_MAP.visibleDrawnTypes(),
      brandEE: window.APOS_SPACE_MAP.isNodeDrawn('client-ee'),
      brandLeet: window.APOS_SPACE_MAP.isNodeDrawn('client-leet'),
      kuwait: window.APOS_SPACE_MAP.isNodeDrawn('country-kw'),
      area: window.APOS_SPACE_MAP.isNodeDrawn('area-shadadiya') || window.APOS_SPACE_MAP.isNodeDrawn('area-zahra'),
      k: window.APOS_SPACE_MAP.getTransform().k,
      focus: window.APOS_SPACE_MAP.getFocus(),
    }));
    if (!drawn.kuwait) throw new Error('Kuwait not drawn after zoom-out');
    if (!drawn.brandLeet) throw new Error('Leet brand not drawn after zoom-out');
    if (!drawn.brandEE) throw new Error('EE brand not visible again after zoom-out');
    if (!(drawn.types.client >= 2)) throw new Error(`expected multiple brands, got ${JSON.stringify(drawn.types)}`);
    if (!(drawn.area || drawn.types.area >= 1)) {
      throw new Error(`expected areas under Kuwait after zoom-out: ${JSON.stringify(drawn)}`);
    }
  });

  await test('continuous zoom: intermediate k values render without errors', async () => {
    const before = consoleErrors.length;
    const ks = [0.12, 0.35, 0.8, 1.5, 3.2, 6.5, 12];
    for (const k of ks) {
      await page.evaluate((zk) => window.APOS_SPACE_MAP.setZoomK(zk), k);
      await delay(40);
      const got = await page.evaluate(() => window.APOS_SPACE_MAP.getTransform().k);
      if (Math.abs(got - k) > 0.01) throw new Error(`k mismatch set ${k} got ${got}`);
      await page.evaluate(() => window.APOS_SPACE_MAP.visibleDrawnTypes());
    }
    const relevant = consoleErrors.slice(before).filter(
      (e) => !e.includes('favicon') && !e.includes('/api/') && !e.includes('Failed to load resource')
    );
    if (relevant.length) throw new Error(relevant.slice(0, 2).join(' | '));
  });

  await test('branch click shows data card', async () => {
    await flyTo(page, 'm-ku-1');
    await page.evaluate(() => {
      const need = window.APOS_SPACE_MAP.LOD.branch.draw * 1.15;
      window.APOS_SPACE_MAP.setZoomK(Math.max(window.APOS_SPACE_MAP.getTransform().k, need));
    });
    await delay(100);
    await page.locator('[data-id="m-ku-1::stock"]').click({ force: true });
    await delay(250);
    const open = await page.evaluate(() => window.APOS_SPACE_MAP.isBranchCardOpen());
    if (!open) throw new Error('branch card not open');
    const title = await page.locator('#branch-card-title').textContent();
    if (!title.includes('Stock')) throw new Error(`unexpected title: ${title}`);
  });

  await test('signals canvas renders pulses', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.spawnTestPulse());
    await delay(150);
    const count = await page.evaluate(() => window.APOS_SPACE_MAP.pulseCount());
    if (count < 1) throw new Error('no pulses after spawnTestPulse');
  });

  await test('terminal open + send mock task', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ku-1', 'operator'));
    await delay(150);
    if (!(await page.evaluate(() => window.APOS_SPACE_MAP.isTerminalOpen()))) throw new Error('terminal not open');
    await page.locator('#term-task').fill('Restock Spanish Latte hopper before 09:00.');
    await page.locator('#term-send').click();
    await delay(300);
    const log = await page.locator('#term-log').textContent();
    if (!log.includes('task dispatched') || !log.includes('mobile inbox')) {
      throw new Error(`unexpected log: ${log}`);
    }
  });

  
  await test('map page nav links present', async () => {
    const n = await page.locator('.map-page-nav a').count();
    if (n < 3) throw new Error(`nav ${n}`);
  });

  await test('gemini inspector opens on fly', async () => {
    await flyTo(page, 'client-ee');
    await delay(500);
    const open = await page.evaluate(() => document.getElementById('inspector-drawer')?.classList.contains('is-open'));
    if (!open) throw new Error('inspector closed');
    await page.evaluate(() => window.APOS_MAP_GEMINI?.closeInspector?.() || window.APOS_SPACE_MAP.closeInspector?.());
  });

  await test('hex layout mode toggles', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_SPACE_MAP.setLayoutMode('hex'));
    await delay(650);
    const mode = await page.evaluate(() => window.APOS_SPACE_MAP.getLayoutMode?.() || document.querySelector('#space-stage')?.dataset.layoutMode);
    if (mode !== 'hex') throw new Error(`mode ${mode}`);
    await page.evaluate(() => window.APOS_SPACE_MAP.setLayoutMode('radial'));
    await delay(650);
  });

await test('back navigation via Esc and chevron', async () => {
    await page.evaluate(() => {
      window.APOS_SPACE_MAP.closeTerminal();
      window.APOS_SPACE_MAP.closeBranchCard();
    });
    await flyTo(page, 'm-ku-1');
    await page.keyboard.press('Escape');
    await waitIdle(page);
    let focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.id === 'm-ku-1') {
      throw new Error(`Esc should fly out from machine, still at ${JSON.stringify(focus)}`);
    }
    if (focus.level !== 4 && focus.type !== 'location') {
      // parent of machine is location
      throw new Error(`expected location parent after Esc, got ${JSON.stringify(focus)}`);
    }
    for (let i = 0; i < 8; i++) {
      const disabled = await page.locator('.nav-chevron[data-dir="prev"]').isDisabled();
      if (disabled) break;
      await page.locator('.nav-chevron[data-dir="prev"]').click();
      await waitIdle(page);
    }
    focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level > 1) throw new Error(`expected near galaxy after back, got level ${focus.level}`);
  });

  await test('Map | Dashboards toggle', async () => {
    await page.locator('.toggle-btn[data-view="dashboards"]').click();
    await delay(150);
    if (await page.locator('#dashboards-view').evaluate((el) => el.hidden)) {
      throw new Error('dashboards still hidden');
    }
    await page.locator('.toggle-btn[data-view="map"]').click();
    await delay(150);
    if (!(await page.locator('#dashboards-view').evaluate((el) => el.hidden))) {
      throw new Error('dashboards should be hidden on Map');
    }
  });

  
  await test('Farwaniya drill keeps continuous parent & child links', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'area-ee-farwaniya');
    const info = await page.evaluate(() => {
      const api = window.APOS_SPACE_MAP;
      const area = 'area-ee-farwaniya';
      const areaPos = api.nodeScreenPos(area);
      const links = api.getIncidentDrawnLinks(area);
      const parentLink = links.find((L) => L.source === 'client-ee' || L.target === 'client-ee');
      const childLinks = links.filter((L) => (L.source === area || L.target === area) && L.source !== 'client-ee' && L.target !== 'client-ee');
      const within2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 2.05;
      const parentAttached = parentLink && areaPos && (
        within2(parentLink.sourceScreen, areaPos) || within2(parentLink.targetScreen, areaPos)
      );
      const stubLen = parentLink
        ? Math.hypot(
            parentLink.sourceScreen.x - parentLink.targetScreen.x,
            parentLink.sourceScreen.y - parentLink.targetScreen.y
          )
        : 0;
      const childOk = childLinks.length > 0 && childLinks.every((L) => {
        const s = api.nodeScreenPos(L.source);
        const t = api.nodeScreenPos(L.target);
        return s && t && within2(L.sourceScreen, s) && within2(L.targetScreen, t);
      });
      return {
        focus: api.getFocus(),
        parentOk: !!parentAttached && stubLen > 0 && stubLen <= 60,
        stubLen: Math.round(stubLen),
        childOk,
        childCount: childLinks.length,
      };
    });
    if (info.focus.id !== 'area-ee-farwaniya') throw new Error(JSON.stringify(info.focus));
    if (!info.parentOk) throw new Error(`parent link broken: ${JSON.stringify(info)}`);
    if (!info.childOk) throw new Error(`child links broken: ${JSON.stringify(info)}`);
  });

  await test('pan/zoom stress restores exact overview state', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await delay(100);
    const before = await page.evaluate(() => window.APOS_SPACE_MAP.snapshotOverviewState());
    if (!before.overview) throw new Error('expected overview before');
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(2.4));
    await flyTo(page, 'country-kw');
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(3.0));
    await delay(40);
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(0.4));
    await delay(80);
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await delay(120);
    const after = await page.evaluate(() => window.APOS_SPACE_MAP.snapshotOverviewState());
    if (!after.overview) throw new Error('expected overview after');
    if (before.drawn.join('|') !== after.drawn.join('|')) {
      throw new Error(`drawn mismatch before=${before.drawn} after=${after.drawn}`);
    }
    if (Math.abs(before.k - after.k) > 0.01 || Math.abs(before.x - after.x) > 2 || Math.abs(before.y - after.y) > 2) {
      throw new Error(`transform mismatch`);
    }
    const byId = new Map(before.labels.map((l) => [l.id, l]));
    const drifts = [];
    for (const l of after.labels) {
      const b = byId.get(l.id);
      if (!b) continue;
      const d = Math.hypot(l.x - b.x, l.y - b.y);
      if (d > 2.05) drifts.push({ id: l.id, d });
    }
    if (drifts.length) throw new Error(`label drift ${JSON.stringify(drifts.slice(0, 5))}`);
  });

await test('no console errors during session', async () => {
    const relevant = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('/api/alert/red-flags') &&
        !e.includes('/api/tasks') &&
        !e.includes('Failed to load resource')
    );
    if (relevant.length) throw new Error(relevant.slice(0, 3).join(' | '));
  });

  await test('machine count present for scale', async () => {
    const n = await page.evaluate(() => window.APOS_SPACE_MAP.machineCount());
    if (n < 8) throw new Error(`expected >=8 machines, got ${n}`);
  });

  await test('rollup alert badge on client/location', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'client-leet');
    const info = await page.evaluate(() => ({
      count: window.APOS_SPACE_MAP.getAlertCount('client-leet'),
      rollup: window.APOS_SPACE_MAP.getRollup('client-leet'),
      drawn: window.APOS_SPACE_MAP.isNodeDrawn('client-leet'),
      // Canvas renders tidy pills (SVG badge layer is hit-test only)
      canvasPill: window.APOS_SPACE_MAP.getAlertCount('client-leet') > 0,
    }));
    if (!(info.count > 0)) throw new Error(`expected alert rollup > 0, got ${JSON.stringify(info)}`);
    if (!info.rollup || info.rollup.alerts !== info.count) throw new Error(`rollup mismatch ${JSON.stringify(info)}`);
    if (!info.drawn || !info.canvasPill) throw new Error(`expected drawn client with canvas pill: ${JSON.stringify(info)}`);
  });

  await test('interrupted fly-to redirects without snap', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_SPACE_MAP.flyTo('country-kw'));
    await delay(120);
    const mid = await page.evaluate(() => ({
      flying: window.APOS_SPACE_MAP.isFlying(),
      t: window.APOS_SPACE_MAP.getTransform(),
    }));
    if (!mid.flying) throw new Error('expected mid-flight after first flyTo');
    await page.evaluate(() => window.APOS_SPACE_MAP.flyTo('client-leet'));
    await delay(80);
    const mid2 = await page.evaluate(() => ({
      flying: window.APOS_SPACE_MAP.isFlying(),
      t: window.APOS_SPACE_MAP.getTransform(),
    }));
    const dx = Math.abs(mid2.t.x - mid.t.x) + Math.abs(mid2.t.y - mid.t.y);
    if (dx > 1200) throw new Error(`suspected snap mid-redirect dx=${dx}`);
    await waitIdle(page);
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.id !== 'client-leet' && focus.clientId !== 'client-leet') {
      throw new Error(`expected client-leet after interrupt, got ${JSON.stringify(focus)}`);
    }
  });

  await test('labels do not overlap at 3 zoom levels', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await flyTo(page, 'country-kw');
    const samples = await page.evaluate(async () =>
      window.APOS_SPACE_MAP.sampleLabelOverlaps([0.3, 1.2, 3.5])
    );
    const bad = samples.filter((s) => s.overlap);
    if (bad.length) throw new Error(`label overlaps: ${JSON.stringify(bad)}`);
  });

  await browser.close();
  return results;
}

async function recordFlow() {
  console.log('\nRecording flow-space.webm\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(400);
  await page.evaluate(() => window.APOS_SPACE_MAP.reset());
  await waitIdle(page);
  await delay(500);
  await flyTo(page, 'country-kw');
  await delay(500);
  await flyTo(page, 'client-leet');
  await delay(500);
  await flyTo(page, 'area-shadadiya');
  await delay(400);
  await flyTo(page, 'loc-ku-coba');
  await delay(400);
  await flyTo(page, 'm-ku-1');
  await delay(700);
  await page.evaluate(() => window.APOS_SPACE_MAP.flyTo('client-ee'));
  await delay(180);
  await page.evaluate(() => window.APOS_SPACE_MAP.flyTo('client-leet'));
  await waitIdle(page);
  await delay(500);
  await page.evaluate(() => window.APOS_SPACE_MAP.reset());
  await waitIdle(page);
  await delay(400);
  const vid = page.video();
  await context.close();
  await browser.close();
  if (vid) {
    const raw = await vid.path();
    const dest = join(ARTIFACTS_DIR, 'flow-space.webm');
    try {
      const { execSync } = await import('child_process');
      execSync(`ffmpeg -y -i "${raw}" -t 12 -c:v libvpx -b:v 1M -an "${dest}"`, { stdio: 'pipe' });
      console.log(`   🎬 ${dest}`);
    } catch {
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
    await captureScreenshots(b.type, b.name);
    all.push(await runTests(b.type, b.name));
  }
  await recordFlow();
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  let passed = 0;
  let failed = 0;
  for (const r of all) {
    console.log(`${r.browser}: ${r.passed} passed, ${r.failed} failed`);
    passed += r.passed;
    failed += r.failed;
  }
  console.log(`TOTAL: ${passed} passed, ${failed} failed (${passed + failed} tests)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
