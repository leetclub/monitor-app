#!/usr/bin/env node

/**
 * Playwright tests for continuous semantic-zoom apos-space-map
 * Screenshots: galaxy-full, constellation-kuwait, location-machines,
 *   machine-branches, branch-card, terminal-popup, zoomed-out-after-drill
 */

import { chromium, firefox } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:8767/apos-space-map.html';
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

async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_SPACE_MAP?.waitForIdle) await window.APOS_SPACE_MAP.waitForIdle();
  });
  await delay(60);
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (err) {
    console.error(`❌ Failed to load: ${err.message}`);
    await browser.close();
    return false;
  }

  await delay(600);
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (err) {
    console.error(`❌ Failed to load: ${err.message}`);
    await browser.close();
    results.failed++;
    return results;
  }

  await delay(600);

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
    if (dx > 0.12 || dy > 0.12) {
      throw new Error(`client-leet not centered dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}`);
    }
  });

  await test('visible labels stay near their node balls', async () => {
    const report = await page.evaluate(() => {
      const bad = [];
      for (const g of document.querySelectorAll('g.node')) {
        const label = g.querySelector('text.node-label');
        if (!label) continue;
        const style = getComputedStyle(label);
        if (style.display === 'none' || Number(style.opacity) < 0.2) continue;
        const core = g.querySelector('.star-core') || g.querySelector('.core-body') || g.querySelector('.hit-target');
        if (!core) continue;
        const nb = core.getBoundingClientRect();
        const lb = label.getBoundingClientRect();
        if (lb.width < 1) continue;
        const dist = Math.hypot(
          lb.left + lb.width / 2 - (nb.left + nb.width / 2),
          lb.top + lb.height / 2 - (nb.top + nb.height / 2)
        );
        if (dist > 100) bad.push({ id: g.getAttribute('data-id'), dist: Math.round(dist) });
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
    await page.evaluate(() => window.APOS_SPACE_MAP.setZoomK(0.6));
    await delay(150);
    const drawn = await page.evaluate(() => ({
      types: window.APOS_SPACE_MAP.visibleDrawnTypes(),
      sibling: window.APOS_SPACE_MAP.isNodeDrawn('m-ku-2'),
      otherLoc: window.APOS_SPACE_MAP.isNodeDrawn('loc-ku-science') || window.APOS_SPACE_MAP.isNodeDrawn('area-zahra'),
      brandEE: window.APOS_SPACE_MAP.isNodeDrawn('client-ee'),
      brandLeet: window.APOS_SPACE_MAP.isNodeDrawn('client-leet'),
      kuwait: window.APOS_SPACE_MAP.isNodeDrawn('country-kw'),
      k: window.APOS_SPACE_MAP.getTransform().k,
    }));
    if (!drawn.kuwait) throw new Error('Kuwait not drawn after zoom-out');
    if (!drawn.brandLeet) throw new Error('Leet brand not drawn after zoom-out');
    if (!drawn.brandEE) throw new Error('EE brand not visible again after zoom-out');
    // at k=0.6, machines may be past LOD draw threshold — locations/areas/brands matter
    if (!(drawn.types.client >= 2)) throw new Error(`expected multiple brands, got ${JSON.stringify(drawn.types)}`);
    if (!(drawn.otherLoc || drawn.types.area >= 1 || drawn.types.location >= 1)) {
      throw new Error(`expected other areas/locations after zoom-out: ${JSON.stringify(drawn)}`);
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

  await browser.close();
  return results;
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
