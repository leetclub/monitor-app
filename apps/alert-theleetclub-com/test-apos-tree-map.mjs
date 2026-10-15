#!/usr/bin/env node

/**
 * Playwright tests for light apos-tree-map (continuous world + focused expansion)
 * Screenshots: tree-full, tree-hub, tree-leaf-card, tree-zoomed-out-after-drill
 * Compare: compare-full, compare-hub, compare-leaf vs reference frames
 */

import { chromium, firefox } from 'playwright';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:8767/apos-tree-map.html';
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

async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_TREE_MAP?.waitForIdle) await window.APOS_TREE_MAP.waitForIdle();
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
  await page.evaluate((nid) => window.APOS_TREE_MAP.flyTo(nid), id);
  await waitIdle(page);
}

async function capture(browserType, browserName) {
  console.log(`\nScreenshots — ${browserName.toUpperCase()}\n`);
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await delay(500);
  await page.evaluate(() => window.APOS_TREE_MAP.reset());
  await waitIdle(page);
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
  await page.locator('[data-id="m-ku-1::revenue"]').click({ force: true });
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
      ['tree-full-chromium.png', 'f_16.jpg', 'compare-full.png'],
      ['tree-hub-chromium.png', 'f_02.jpg', 'compare-hub.png'],
      ['tree-leaf-card-chromium.png', 'f_12.jpg', 'compare-leaf.png'],
    ];
    for (const [ours, refName, out] of pairs) {
      const left = join(ARTIFACTS_DIR, ours);
      const right = existsSync(join(ASSETS, refName))
        ? join(ASSETS, refName)
        : join(REF_DIR, 'ref-01.png');
      // Compose with ffmpeg hstack when possible
      const outPath = join(ARTIFACTS_DIR, out);
      try {
        const { execSync } = await import('child_process');
        execSync(
          `ffmpeg -y -i "${left}" -i "${right}" -filter_complex "[0:v]scale=960:-1[a];[1:v]scale=960:-1[b];[a][b]hstack=inputs=2" "${outPath}"`,
          { stdio: 'pipe' }
        );
        console.log(`   📸 ${outPath}`);
      } catch {
        copyFileSync(left, outPath);
        console.log(`   📸 ${outPath} (fallback copy)`);
      }
    }
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

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await delay(500);

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
        if (dist > 110) out.push({ id: g.getAttribute('data-id'), dist: Math.round(dist) });
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
    await page.locator('[data-id="m-ku-1::stock"]').click({ force: true });
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

  await test('no console errors', async () => {
    const relevant = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('/api/') && !e.includes('Failed to load resource')
    );
    if (relevant.length) throw new Error(relevant.slice(0, 2).join(' | '));
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
    await capture(b.type, b.name);
    all.push(await runTests(b.type, b.name));
  }
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
