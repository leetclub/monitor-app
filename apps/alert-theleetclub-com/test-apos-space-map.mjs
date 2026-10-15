#!/usr/bin/env node

/**
 * Playwright tests for apos-space-map.html — Chromium + Firefox
 * Screenshots: galaxy-full, constellation-kuwait, location-machines,
 *              machine-branches, branch-card, terminal-popup
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

async function shot(page, name, browserName) {
  const path = join(ARTIFACTS_DIR, `${name}-${browserName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`   📸 ${path}`);
  return path;
}

async function drillPath(page) {
  // Kuwait → Leet → Shadadiya → KU COBA → KU-1 → Revenue
  await page.locator('[data-id="country-kw"]').click();
  await delay(800);
  await page.locator('[data-id="client-leet"]').click();
  await delay(800);
  await page.locator('[data-id="area-shadadiya"]').click();
  await delay(800);
  await page.locator('[data-id="loc-ku-coba"]').click();
  await delay(800);
  await page.locator('[data-id="m-ku-1"]').click();
  await delay(800);
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

  await delay(1200);
  await page.evaluate(() => window.APOS_SPACE_MAP?.reset());
  await delay(600);
  console.log('1. galaxy-full');
  await shot(page, 'galaxy-full', browserName);

  await page.locator('[data-id="country-kw"]').click();
  await delay(900);
  console.log('2. constellation-kuwait');
  await shot(page, 'constellation-kuwait', browserName);

  await page.locator('[data-id="client-leet"]').click();
  await delay(700);
  await page.locator('[data-id="area-shadadiya"]').click();
  await delay(700);
  await page.locator('[data-id="loc-ku-coba"]').click();
  await delay(900);
  console.log('3. location-machines');
  await shot(page, 'location-machines', browserName);

  await page.locator('[data-id="m-ku-1"]').click();
  await delay(900);
  console.log('4. machine-branches');
  await shot(page, 'machine-branches', browserName);

  await page.locator('[data-id$="::revenue"]').click();
  await delay(700);
  console.log('5. branch-card');
  await shot(page, 'branch-card', browserName);

  await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ku-1', 'operator'));
  await delay(500);
  console.log('6. terminal-popup');
  await shot(page, 'terminal-popup', browserName);

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

  const results = { browser: browserName, passed: 0, failed: 0, names: [] };

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
      results.names.push({ name, ok: true });
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(`   ${err.message}`);
      results.failed++;
      results.names.push({ name, ok: false, error: err.message });
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

  await delay(1000);

  await test('boots with galaxy focus and APOS core', async () => {
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 0) throw new Error(`expected galaxy level 0, got ${focus.level}`);
    const core = page.locator('[data-id="ent-apos"]');
    if ((await core.count()) < 1) throw new Error('missing APOS core');
    const kw = page.locator('[data-id="country-kw"]');
    if ((await kw.count()) < 1) throw new Error('missing Kuwait');
  });

  await test('drill-down: galaxy → country → client → area → location → machine', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await delay(400);
    await drillPath(page);
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 5 || focus.machineId !== 'm-ku-1') {
      throw new Error(`expected machine m-ku-1, got ${JSON.stringify(focus)}`);
    }
    const branches = await page.locator('[data-type="branch"]').count();
    if (branches < 5) throw new Error(`expected 5 branches, got ${branches}`);
  });

  await test('branch click shows data card', async () => {
    await page.locator('[data-id="m-ku-1::stock"]').click();
    await delay(400);
    const open = await page.evaluate(() => window.APOS_SPACE_MAP.isBranchCardOpen());
    if (!open) throw new Error('branch card not open');
    const title = await page.locator('#branch-card-title').textContent();
    if (!title.includes('Stock')) throw new Error(`unexpected title: ${title}`);
  });

  await test('signals canvas renders pulses', async () => {
    await page.evaluate(() => {
      window.APOS_SPACE_MAP.spawnTestPulse();
    });
    await delay(200);
    const count = await page.evaluate(() => window.APOS_SPACE_MAP.pulseCount());
    if (count < 1) throw new Error('no pulses after spawnTestPulse');
    const canvas = page.locator('#signal-canvas');
    if ((await canvas.count()) !== 1) throw new Error('signal canvas missing');
  });

  await test('terminal open + send mock task', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ku-1', 'operator'));
    await delay(200);
    if (!(await page.evaluate(() => window.APOS_SPACE_MAP.isTerminalOpen()))) {
      throw new Error('terminal not open');
    }
    const assignee = await page.locator('#term-assignee').textContent();
    if (!assignee || assignee === '—') throw new Error('assignee not prefilling');
    await page.locator('#term-task').fill('Restock Spanish Latte hopper before 09:00.');
    await page.locator('#term-send').click();
    await delay(400);
    const log = await page.locator('#term-log').textContent();
    if (!log.includes('task dispatched') || !log.includes('mobile inbox')) {
      throw new Error(`unexpected log: ${log}`);
    }
  });

  await test('back navigation via Esc and chevron', async () => {
    await page.evaluate(() => {
      window.APOS_SPACE_MAP.closeTerminal();
      window.APOS_SPACE_MAP.reset();
    });
    await delay(400);
    await drillPath(page);
    let focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 5) throw new Error(`setup failed, level ${focus.level}`);

    await page.keyboard.press('Escape');
    await delay(500);
    focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 4) throw new Error(`Esc should pop to location (4), got ${focus.level}`);

    const before = focus.level;
    for (let i = 0; i < 6; i++) {
      const disabled = await page.locator('.nav-chevron[data-dir="prev"]').isDisabled();
      if (disabled) break;
      await page.locator('.nav-chevron[data-dir="prev"]').click();
      await delay(400);
    }
    focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 0) {
      throw new Error(`expected galaxy after chevron back, got level ${focus.level} (from ${before})`);
    }
  });

  await test('Map | Dashboards toggle', async () => {
    await page.locator('.toggle-btn[data-view="dashboards"]').click();
    await delay(200);
    const hidden = await page.locator('#dashboards-view').getAttribute('hidden');
    if (hidden !== null && hidden !== '') {
      // getAttribute returns '' when present as boolean attribute in some browsers
    }
    const isHidden = await page.locator('#dashboards-view').evaluate((el) => el.hidden);
    if (isHidden) throw new Error('dashboards view still hidden');
    await page.locator('.toggle-btn[data-view="map"]').click();
    await delay(200);
    const mapHidden = await page.locator('#dashboards-view').evaluate((el) => el.hidden);
    if (!mapHidden) throw new Error('dashboards should be hidden on Map');
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
    if (n < 8) throw new Error(`expected >=8 machines in mock, got ${n}`);
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
    const r = await runTests(b.type, b.name);
    all.push(r);
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
