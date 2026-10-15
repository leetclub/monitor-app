/**
 * APOS 3D constellation — Playwright (Chromium + Firefox)
 */
import { chromium, firefox } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PORT = 8777;
const BASE_URL = `http://127.0.0.1:${PORT}/apos-3d-map.html`;
const ARTIFACTS_DIR = join(
  process.env.HOME,
  '.cursor/projects/mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app/artifacts'
);
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page) {
  await page.waitForFunction(() => window.__APOS_3D_READY__, null, { timeout: 20000 });
}

async function waitIdle(page) {
  await page.evaluate(async () => {
    if (window.APOS_3D_MAP?.waitForIdle) await window.APOS_3D_MAP.waitForIdle();
  });
  await delay(120);
}

async function runBrowser(browserType, name) {
  const results = [];
  const test = async (label, fn) => {
    try {
      await fn();
      results.push({ ok: true, label });
      console.log(`✅ ${label}`);
    } catch (e) {
      results.push({ ok: false, label, err: String(e.message || e) });
      console.log(`❌ ${label}`);
      console.log(`   ${e.message || e}`);
    }
  };

  console.log(`\n============================================================\nTests — ${name.toUpperCase()}\n============================================================\n`);
  const browser = await browserType.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitReady(page);
  await delay(400);

  await test('boots with APOS_3D_MAP API', async () => {
    const ok = await page.evaluate(() => !!(window.APOS_3D_MAP && window.__APOS_3D_READY__));
    if (!ok) throw new Error('API missing');
  });

  await test('overview focus is enterprise', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    const f = await page.evaluate(() => window.APOS_3D_MAP.getFocus());
    if (!f.overview && f.type !== 'enterprise') throw new Error(JSON.stringify(f));
  });

  await test('fly to Kuwait country', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('country-kw'));
    await waitIdle(page);
    const f = await page.evaluate(() => window.APOS_3D_MAP.getFocus());
    if (f.id !== 'country-kw') throw new Error(JSON.stringify(f));
  });

  await test('fly to brand / site / machine', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('client-ee'));
    await waitIdle(page);
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('loc-ee-farwaniya'));
    await waitIdle(page);
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('m-ee-4'));
    await waitIdle(page);
    const f = await page.evaluate(() => window.APOS_3D_MAP.getFocus());
    if (f.id !== 'm-ee-4') throw new Error(JSON.stringify(f));
  });

  await test('inspector drawer opens', async () => {
    const open = await page.evaluate(() => document.getElementById('inspector-drawer')?.classList.contains('is-open'));
    if (!open) throw new Error('inspector not open');
  });

  await test('terminal open/close', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.openTerminal());
    if (!(await page.evaluate(() => window.APOS_3D_MAP.isTerminalOpen()))) throw new Error('term closed');
    await page.evaluate(() => window.APOS_3D_MAP.closeTerminal());
  });

  await test('HUD mode toggle', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(true));
    await delay(250);
    const on = await page.evaluate(() => window.APOS_3D_MAP.isHudMode());
    if (!on) throw new Error('hud off');
    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(false));
  });

  await test('nav links present', async () => {
    const n = await page.locator('.map-page-nav a').count();
    if (n < 3) throw new Error(`nav links ${n}`);
  });

  await test('node count present', async () => {
    const n = await page.evaluate(() => window.APOS_3D_MAP.nodeCount());
    if (!(n > 10)) throw new Error(`nodes ${n}`);
  });

  await test('no page errors', async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
  });

  // Stills (chromium)
  if (name === 'chromium') {
    console.log('\nScreenshots — CHROMIUM\n');
    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await delay(300);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-full.png') });
    console.log('   📸 3d-level-full.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('country-kw'));
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-hub.png') });
    console.log('   📸 3d-level-hub.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('loc-ee-farwaniya'));
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-site.png') });
    console.log('   📸 3d-level-site.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('m-ee-4'));
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-machine.png') });
    console.log('   📸 3d-level-machine.png');
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-focus.png') });
    console.log('   📸 3d-focus.png');

    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(true));
    await delay(300);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-hud.png') });
    console.log('   📸 3d-hud.png');
    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(false));

    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-overview.png') });
    console.log('   📸 3d-overview.png');
  }

  await browser.close();
  return results;
}

const all = [];
all.push(...(await runBrowser(chromium, 'chromium')));
all.push(...(await runBrowser(firefox, 'firefox')));
const failed = all.filter((r) => !r.ok);
console.log(`\nSUMMARY\nchromium+firefox: ${all.length - failed.length} passed, ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
