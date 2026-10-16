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


  await test('overview closes inspector drawer', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await delay(200);
    const open = await page.evaluate(() => document.getElementById('inspector-drawer')?.classList.contains('is-open'));
    if (open) throw new Error('drawer open at overview');
  });

  await test('focus Leet keeps Leet→KW→APOS path visible', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('client-leet'));
    await waitIdle(page);
    const info = await page.evaluate(() => ({
      focus: window.APOS_3D_MAP.getFocus(),
      pathOk: window.APOS_3D_MAP.pathLinksVisible('client-leet'),
    }));
    if (info.focus.id !== 'client-leet') throw new Error(JSON.stringify(info.focus));
    if (!info.pathOk) throw new Error('Leet→KW→APOS path not visible in 3D');
  });

  await test('focus machine keeps full chain; zoom-out restores within 100ms', async () => {
    await page.evaluate(() => window.APOS_3D_MAP.flyTo('m-ee-4'));
    await waitIdle(page);
    const atMachine = await page.evaluate(() => window.APOS_3D_MAP.pathLinksVisible('m-ee-4'));
    if (!atMachine) throw new Error('machine→…→APOS path missing in 3D');
    const zoomOk = await page.evaluate(async () => {
      const api = window.APOS_3D_MAP;
      // Pull camera out without waiting for idle
      const cam = api.getTransform();
      const t0 = performance.now();
      // Nudge via zoom-out button equivalent
      document.querySelector('.zoom-btn[data-action="zoom-out"]')?.click();
      document.querySelector('.zoom-btn[data-action="zoom-out"]')?.click();
      let ok = false;
      while (performance.now() - t0 < 100) {
        if (api.pathLinksVisible('m-ee-4')) { ok = true; break; }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { ok, ms: Math.round(performance.now() - t0), cam };
    });
    if (!zoomOk.ok) throw new Error(`3D links not restored within 100ms: ${JSON.stringify(zoomOk)}`);
  });

  await test('visible labels at hub / site / machine', async () => {
    const check = async (id, minLabels) => {
      await page.evaluate((nid) => window.APOS_3D_MAP.flyTo(nid), id);
      await waitIdle(page);
      await delay(300);
      const labels = await page.evaluate(() => {
        const list = window.APOS_3D_MAP.visibleLabels();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return list.map((l) => ({
          ...l,
          inView: l.x >= 0 && l.y >= 0 && l.x + (l.w || 0) <= vw && l.y + (l.h || 0) <= vh
            && l.w > 4 && l.h > 4,
        }));
      });
      const visible = labels.filter((l) => l.inView);
      if (visible.length < minLabels) {
        throw new Error(`${id}: visible labels ${visible.length} < ${minLabels} (${labels.map((l) => l.text).join(',')})`);
      }
      // Non-overlapping in viewport (AABB)
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i], b = visible[j];
          const aw = a.w || 40, ah = a.h || 12, bw = b.w || 40, bh = b.h || 12;
          const overlapX = a.x < b.x + bw && a.x + aw > b.x;
          const overlapY = a.y < b.y + bh && a.y + ah > b.y;
          if (overlapX && overlapY) throw new Error(`overlap ${a.text} / ${b.text}`);
        }
      }
      return visible;
    };
    await check('country-kw', 3); // KW + brands
    await check('loc-ee-farwaniya', 2); // site + machine children
    const mLabels = await check('m-ee-4', 6); // machine + 5 branch children
    const texts = mLabels.map((l) => l.text.toLowerCase());
    const need = ['revenue', 'operators', 'stock', 'contract', 'technical'];
    for (const n of need) {
      if (!texts.some((t) => t.includes(n))) throw new Error(`missing branch label ${n}: ${texts.join(',')}`);
    }
  });

  // Stills (chromium)
  if (name === 'chromium') {
    console.log('\nScreenshots — CHROMIUM\n');
    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await delay(500);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-full.png') });
    console.log('   📸 3d-level-full.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('country-kw'));
    await waitIdle(page);
    await delay(350);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-hub.png') });
    console.log('   📸 3d-level-hub.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('loc-ee-farwaniya'));
    await waitIdle(page);
    await delay(350);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-site.png') });
    console.log('   📸 3d-level-site.png');

    await page.evaluate(() => window.APOS_3D_MAP.flyTo('m-ee-4'));
    await waitIdle(page);
    await delay(400);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-level-machine.png') });
    console.log('   📸 3d-level-machine.png');
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-focus.png') });
    console.log('   📸 3d-focus.png');

    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(true));
    await delay(400);
    await page.screenshot({ path: join(ARTIFACTS_DIR, '3d-hud.png') });
    console.log('   📸 3d-hud.png');
    await page.evaluate(() => window.APOS_3D_MAP.setHudMode(false));

    await page.evaluate(() => window.APOS_3D_MAP.reset());
    await waitIdle(page);
    await delay(600);
    // Ensure drawer closed for overview still
    await page.evaluate(() => {
      document.getElementById('inspector-drawer')?.classList.remove('is-open');
    });
    await delay(100);
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
