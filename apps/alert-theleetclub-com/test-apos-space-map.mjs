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

async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_SPACE_MAP?.waitForIdle) await window.APOS_SPACE_MAP.waitForIdle();
  });
  await delay(80);
}

async function shot(page, name, browserName) {
  const path = join(ARTIFACTS_DIR, `${name}-${browserName}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`   📸 ${path}`);
  return path;
}

async function clickNode(page, id) {
  await page.locator(`[data-id="${id}"]`).click();
  await waitIdle(page);
}

async function drillPath(page) {
  await clickNode(page, 'country-kw');
  await clickNode(page, 'client-leet');
  await clickNode(page, 'area-shadadiya');
  await clickNode(page, 'loc-ku-coba');
  await clickNode(page, 'm-ku-1');
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

  await delay(800);
  await page.evaluate(() => window.APOS_SPACE_MAP?.reset());
  await waitIdle(page);
  console.log('1. galaxy-full');
  await shot(page, 'galaxy-full', browserName);

  await clickNode(page, 'country-kw');
  console.log('2. constellation-kuwait');
  await shot(page, 'constellation-kuwait', browserName);

  await clickNode(page, 'client-leet');
  await clickNode(page, 'area-shadadiya');
  await clickNode(page, 'loc-ku-coba');
  console.log('3. location-machines');
  await shot(page, 'location-machines', browserName);

  await clickNode(page, 'm-ku-1');
  console.log('4. machine-branches');
  await shot(page, 'machine-branches', browserName);

  await page.locator('[data-id$="::revenue"]').click();
  await delay(400);
  console.log('5. branch-card');
  await shot(page, 'branch-card', browserName);

  await page.evaluate(() => window.APOS_SPACE_MAP.openTerminal('m-ku-1', 'operator'));
  await delay(400);
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

  await delay(800);

  await test('boots with galaxy focus and APOS core', async () => {
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 0) throw new Error(`expected galaxy level 0, got ${focus.level}`);
    if ((await page.locator('[data-id="ent-apos"]').count()) < 1) throw new Error('missing APOS core');
    if ((await page.locator('[data-id="country-kw"]').count()) < 1) throw new Error('missing Kuwait');
  });

  await test('drill-down: galaxy → country → client → area → location → machine', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await drillPath(page);
    const focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 5 || focus.machineId !== 'm-ku-1') {
      throw new Error(`expected machine m-ku-1, got ${JSON.stringify(focus)}`);
    }
    const branches = await page.locator('[data-type="branch"]').count();
    if (branches < 5) throw new Error(`expected 5 branches, got ${branches}`);
  });

  await test('after click, focus node is near viewport center', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await clickNode(page, 'country-kw');
    const info = await page.evaluate(() => {
      const pos = window.APOS_SPACE_MAP.nodeScreenPos('country-kw');
      const stage = document.getElementById('space-stage');
      return {
        pos,
        w: stage.clientWidth,
        h: stage.clientHeight,
      };
    });
    if (!info.pos) throw new Error('no screen pos for country-kw');
    const dx = Math.abs(info.pos.x - info.w / 2) / info.w;
    const dy = Math.abs(info.pos.y - info.h / 2) / info.h;
    // Country view centers the constellation; Kuwait sits slightly above center by design.
    // Require within ~10% of viewport center on X and ~18% on Y (content framing).
    if (dx > 0.1) throw new Error(`country-kw X offset ${(dx * 100).toFixed(1)}% > 10% (pos=${JSON.stringify(info.pos)})`);
    if (dy > 0.18) throw new Error(`country-kw Y offset ${(dy * 100).toFixed(1)}% too far (pos=${JSON.stringify(info.pos)})`);

    await clickNode(page, 'client-leet');
    const clientInfo = await page.evaluate(() => {
      const pos = window.APOS_SPACE_MAP.nodeScreenPos('client-leet');
      const stage = document.getElementById('space-stage');
      return { pos, w: stage.clientWidth, h: stage.clientHeight };
    });
    if (!clientInfo.pos) throw new Error('no screen pos for client-leet');
    const cdx = Math.abs(clientInfo.pos.x - clientInfo.w / 2) / clientInfo.w;
    const cdy = Math.abs(clientInfo.pos.y - clientInfo.h / 2) / clientInfo.h;
    if (cdx > 0.1 || cdy > 0.1) {
      throw new Error(
        `client-leet not centered: dx=${(cdx * 100).toFixed(1)}% dy=${(cdy * 100).toFixed(1)}% pos=${JSON.stringify(clientInfo.pos)}`
      );
    }
  });

  await test('visible labels stay near their node balls', async () => {
    const report = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('g.node')];
      const bad = [];
      for (const g of nodes) {
        const label = g.querySelector('text.node-label');
        if (!label || label.style.display === 'none') continue;
        const core =
          g.querySelector('.star-core') || g.querySelector('.core-body') || g.querySelector('.hit-target');
        if (!core) continue;
        const nb = core.getBoundingClientRect();
        const lb = label.getBoundingClientRect();
        if (lb.width < 1 || lb.height < 1) continue;
        const nx = nb.left + nb.width / 2;
        const ny = nb.top + nb.height / 2;
        const lx = lb.left + lb.width / 2;
        const ly = lb.top + lb.height / 2;
        const dist = Math.hypot(lx - nx, ly - ny);
        // label should sit under the ball: within ~90px of node center
        if (dist > 90) {
          bad.push({ id: g.getAttribute('data-id'), dist: Math.round(dist) });
        }
      }
      return { checked: nodes.length, bad };
    });
    if (report.bad.length) {
      throw new Error(`misplaced labels: ${JSON.stringify(report.bad.slice(0, 5))}`);
    }
  });

  await test('branch click shows data card', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.reset());
    await waitIdle(page);
    await drillPath(page);
    await page.locator('[data-id="m-ku-1::stock"]').click();
    await delay(300);
    const open = await page.evaluate(() => window.APOS_SPACE_MAP.isBranchCardOpen());
    if (!open) throw new Error('branch card not open');
    const title = await page.locator('#branch-card-title').textContent();
    if (!title.includes('Stock')) throw new Error(`unexpected title: ${title}`);
  });

  await test('signals canvas renders pulses', async () => {
    await page.evaluate(() => window.APOS_SPACE_MAP.spawnTestPulse());
    await delay(200);
    const count = await page.evaluate(() => window.APOS_SPACE_MAP.pulseCount());
    if (count < 1) throw new Error('no pulses after spawnTestPulse');
    if ((await page.locator('#signal-canvas').count()) !== 1) throw new Error('signal canvas missing');
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
    await waitIdle(page);
    await drillPath(page);
    let focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 5) throw new Error(`setup failed, level ${focus.level}`);

    await page.keyboard.press('Escape');
    await waitIdle(page);
    focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 4) throw new Error(`Esc should pop to location (4), got ${focus.level}`);

    const before = focus.level;
    for (let i = 0; i < 6; i++) {
      const disabled = await page.locator('.nav-chevron[data-dir="prev"]').isDisabled();
      if (disabled) break;
      await page.locator('.nav-chevron[data-dir="prev"]').click();
      await waitIdle(page);
    }
    focus = await page.evaluate(() => window.APOS_SPACE_MAP.getFocus());
    if (focus.level !== 0) {
      throw new Error(`expected galaxy after chevron back, got level ${focus.level} (from ${before})`);
    }
  });

  await test('Map | Dashboards toggle', async () => {
    await page.locator('.toggle-btn[data-view="dashboards"]').click();
    await delay(200);
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
