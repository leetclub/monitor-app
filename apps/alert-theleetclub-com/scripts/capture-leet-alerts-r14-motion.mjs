#!/usr/bin/env node
/**
 * Round 14: morph dive/rise stills (8 each), dial coast, hover glow;
 * re-record all 7 motion clips; visual mid-frame gates.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const REF = process.env.SKILLTREE_LOCAL || 'http://127.0.0.1:8768/map.html';
const OUT = process.env.LEET_REVIEW_DIR
  || '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review';
const MOTION = path.join(OUT, 'r14-motion');
const ART = '/home/mahdi/projects/monitoring-app-radial-local/apps/alert-theleetclub-com/artifacts/r14-motion';
const TMP = path.join(MOTION, '_raw');
const OURS_URL = `${BASE}/alerts.html?r14=1`;
const VW = 1440;
const VH = 900;

fs.mkdirSync(MOTION, { recursive: true });
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function sh(cmd) { execSync(cmd, { stdio: 'pipe' }); }
function copyArt(file) {
  fs.copyFileSync(file, path.join(ART, path.basename(file)));
}
function hstack(left, right, out) {
  sh(`ffmpeg -y -i ${JSON.stringify(left)} -i ${JSON.stringify(right)} -filter_complex "[0:v]scale=720:900,setsar=1[l];[1:v]scale=720:900,setsar=1[r];[l][r]hstack=inputs=2[v]" -map "[v]" -c:v libvpx-vp9 -b:v 1.5M -an ${JSON.stringify(out)}`);
  copyArt(out);
}

function oursPaneInk(pngPath) {
  const half = pngPath.replace(/\.png$/, '-ours-half.png');
  sh(`ffmpeg -y -i ${JSON.stringify(pngPath)} -vf "crop=iw/2:ih:iw/2:0" -frames:v 1 ${JSON.stringify(half)}`);
  copyArt(half);
  const py = path.join(TMP, '_ink.py');
  fs.writeFileSync(py, [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(half)}).convert("RGB")`,
    'w,h=im.size; pix=im.load(); bg=(32,36,45)',
    'non=colored=white=0',
    'for y in range(60,h-40):',
    '  for x in range(w):',
    '    r,g,b=pix[x,y]',
    '    if r>240 and g>240 and b>240: white+=1',
    '    if abs(r-bg[0])>14 or abs(g-bg[1])>14 or abs(b-bg[2])>14:',
    '      non+=1',
    '      if max(r,g,b)-min(r,g,b)>25 or r+g+b>160: colored+=1',
    'print(f"{non} {colored} {white}")',
    '',
  ].join('\n'));
  const [non, colored, white] = execSync(`python3 ${JSON.stringify(py)}`, { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  const ok = colored >= 2500 && non >= 3000 && white < 50000;
  return { ok, non, colored, white, reason: ok ? 'ok' : `colored=${colored} non=${non} white=${white}` };
}

async function withVideo(browser, url, fileBase, run) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: TMP, size: { width: VW, height: VH } },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (url.includes('8768')) {
    await page.waitForFunction(() => document.querySelectorAll('.mini').length >= 3 && document.body.classList.contains('ready'), null, { timeout: 20000 });
    await page.waitForTimeout(700);
  } else {
    await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
    await page.waitForFunction(() => window.LEET_ALERTS_MAP.assertRestOverview().ok, null, { timeout: 10000 });
    await page.waitForTimeout(500);
  }
  await run(page);
  const vid = page.video();
  await ctx.close();
  const raw = await vid.path();
  const dest = path.join(TMP, `${fileBase}.webm`);
  if (raw && fs.existsSync(raw)) fs.copyFileSync(raw, dest);
  return dest;
}

const browser = await chromium.launch({ headless: true });

// ── Rest gate + constants ───────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(OURS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
  await page.waitForTimeout(700);
  const gate = await page.evaluate(() => window.LEET_ALERTS_MAP.assertRestOverview());
  const constants = await page.evaluate(() => ({
    ours: window.LEET_ALERTS_MAP.interactionConstants(),
    geom: window.LEET_ALERTS_MAP.overviewGeom(),
    restGate: window.LEET_ALERTS_MAP.assertRestOverview(),
  }));
  fs.writeFileSync(path.join(MOTION, 'ours-constants.json'), JSON.stringify(constants, null, 2));
  copyArt(path.join(MOTION, 'ours-constants.json'));
  fs.writeFileSync(path.join(MOTION, 'rest-gate.json'), JSON.stringify(gate, null, 2));
  copyArt(path.join(MOTION, 'rest-gate.json'));
  await page.screenshot({ path: path.join(MOTION, 'ours-overview.png'), type: 'png' });
  copyArt(path.join(MOTION, 'ours-overview.png'));
  await page.close();
  if (!gate.ok) {
    console.error('REST GATE FAILED', gate);
    await browser.close();
    process.exit(1);
  }
  console.log('rest gate OK');
}

{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(REF, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(MOTION, 'ref-overview.png'), type: 'png' });
  copyArt(path.join(MOTION, 'ref-overview.png'));
  await page.close();
}

// ── Dive / rise: 8 evenly spaced stills each ────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(OURS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__LEET_ALERTS_READY__);
  await page.waitForTimeout(500);

  // Capture 8 frames via in-page rAF + canvas.toDataURL (no Playwright screenshot lag)
  function writeDataUrl(dataUrl, filePath) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    copyArt(filePath);
  }

  await page.evaluate(() => { window.LEET_ALERTS_MAP.recenter(); });
  await page.waitForTimeout(200);

  const divePack = await page.evaluate(async () => {
    const MAP = window.LEET_ALERTS_MAP;
    const canvas = document.getElementById('alerts-canvas');
    const waitState = async (s, ms = 5000) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (MAP.getFocus().mapState === s) return true;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return false;
    };
    MAP.focusCategory('tasks');
    await waitState('diving');
    const dur = MAP.interactionConstants().DIVE_MORPH_MS;
    const t0 = performance.now();
    const frames = [];
    for (let i = 0; i < 8; i++) {
      const target = (i / 7) * dur;
      while (performance.now() - t0 < target) await new Promise((r) => requestAnimationFrame(r));
      // one more paint
      await new Promise((r) => requestAnimationFrame(r));
      const xf = MAP.getTransform();
      frames.push({
        i, u: i / 7,
        prog: MAP.getMorphProgress(),
        state: MAP.getFocus().mapState,
        zoom: xf.zoom, camY: xf.camY, camX: xf.camX,
        dataUrl: canvas.toDataURL('image/png'),
      });
    }
    await waitState('fan', 3000);
    return { dur, frames, settled: canvas.toDataURL('image/png') };
  });

  const diveMeta = { stamps: [], distinctCamY: new Set(), distinctZoom: new Set() };
  divePack.frames.forEach((f) => {
    writeDataUrl(f.dataUrl, path.join(MOTION, `dive-${String(f.i).padStart(2, '0')}.png`));
    diveMeta.stamps.push({ i: f.i, u: f.u, prog: f.prog, state: f.state, zoom: f.zoom, camY: f.camY });
    diveMeta.distinctCamY.add(+f.camY.toFixed(1));
    diveMeta.distinctZoom.add(+f.zoom.toFixed(3));
  });
  writeDataUrl(divePack.settled, path.join(MOTION, 'dive-settled.png'));

  const risePack = await page.evaluate(async () => {
    const MAP = window.LEET_ALERTS_MAP;
    const canvas = document.getElementById('alerts-canvas');
    const waitState = async (s, ms = 5000) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (MAP.getFocus().mapState === s) return true;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return false;
    };
    MAP.clearFocus();
    await waitState('rising');
    const dur = MAP.interactionConstants().RISE_MS;
    const t0 = performance.now();
    const frames = [];
    for (let i = 0; i < 8; i++) {
      const target = (i / 7) * dur;
      while (performance.now() - t0 < target) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const xf = MAP.getTransform();
      frames.push({
        i, u: i / 7,
        prog: MAP.getMorphProgress(),
        state: MAP.getFocus().mapState,
        zoom: xf.zoom, camY: xf.camY, camX: xf.camX,
        dataUrl: canvas.toDataURL('image/png'),
      });
    }
    await waitState('sky', 3000);
    return { dur, frames };
  });

  const riseMeta = { stamps: [], distinctCamY: new Set(), distinctZoom: new Set() };
  risePack.frames.forEach((f) => {
    writeDataUrl(f.dataUrl, path.join(MOTION, `rise-${String(f.i).padStart(2, '0')}.png`));
    riseMeta.stamps.push({ i: f.i, u: f.u, prog: f.prog, state: f.state, zoom: f.zoom, camY: f.camY });
    riseMeta.distinctCamY.add(+f.camY.toFixed(1));
    riseMeta.distinctZoom.add(+f.zoom.toFixed(3));
  });

  const morphReport = {
    dive: {
      dur: divePack.dur,
      distinctCamY: diveMeta.distinctCamY.size,
      distinctZoom: diveMeta.distinctZoom.size,
      stamps: diveMeta.stamps,
      ok: diveMeta.distinctCamY.size >= 6 && diveMeta.distinctZoom.size >= 6,
    },
    rise: {
      dur: risePack.dur,
      distinctCamY: riseMeta.distinctCamY.size,
      distinctZoom: riseMeta.distinctZoom.size,
      stamps: riseMeta.stamps,
      ok: riseMeta.distinctCamY.size >= 6 && riseMeta.distinctZoom.size >= 6,
    },
  };
  fs.writeFileSync(path.join(MOTION, 'morph-frame-report.json'), JSON.stringify(morphReport, null, 2));
  copyArt(path.join(MOTION, 'morph-frame-report.json'));
  console.log('morph report', { dive: morphReport.dive.ok, rise: morphReport.rise.ok, diveCam: morphReport.dive.distinctCamY, riseCam: morphReport.rise.distinctCamY });
  if (!morphReport.dive.ok || !morphReport.rise.ok) {
    console.error('MORPH FRAME GATE FAILED', morphReport);
    await browser.close();
    process.exit(1);
  }
  await page.close();
}

const scenarios = [
  {
    name: '01-hover-fan',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(300);
        const cats = MAP.snapshot().categories;
        for (const cat of cats.slice(0, 4)) {
          MAP.setHover(cat.id);
          await MAP.waitForIdle(380);
        }
        MAP.setHover(null);
        await MAP.waitForIdle(400);
        MAP.setHover(cats[0].id);
        await MAP.waitForIdle(500);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const minis = [...document.querySelectorAll('.mini')];
        for (const el of minis.slice(0, 4)) {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 400));
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        }
        if (minis[0]) minis[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
      });
    },
  },
  {
    name: '02-wheel-zoom',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width * 0.55, cy = r.top + r.height * 0.5;
        for (let i = 0; i < 6; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(80);
        }
        for (let i = 0; i < 30; i++) {
          await MAP.waitForIdle(80);
          if (MAP.getFocus().mapState === 'fan') break;
        }
        for (let i = 0; i < 6; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
          await MAP.waitForIdle(90);
        }
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 1600));
      });
    },
  },
  {
    name: '03-drag-release',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        MAP.focusCategory('lowstock');
        for (let i = 0; i < 50; i++) {
          await MAP.waitForIdle(80);
          if (MAP.getFocus().mapState === 'fan') break;
        }
        await MAP.waitForIdle(200);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.55;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 14; i++) {
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + i * 16, clientY: y0 + i * 5, pointerId: 1, bubbles: true }));
          await MAP.waitForIdle(35);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 224, clientY: y0 + 70, pointerId: 1, bubbles: true }));
        await MAP.waitForIdle(600);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(1);
        await new Promise((r) => setTimeout(r, 1500));
      });
    },
  },
  {
    name: '04-hub-focus-back',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(250);
        MAP.focusCategory(MAP.snapshot().categories[0].id);
        // Wait full morph (~align + 900ms)
        for (let i = 0; i < 60; i++) {
          await MAP.waitForIdle(50);
          if (MAP.getFocus().mapState === 'fan') break;
        }
        await MAP.waitForIdle(400);
        MAP.clearFocus();
        for (let i = 0; i < 40; i++) {
          await MAP.waitForIdle(50);
          if (MAP.getFocus().mapState === 'sky') break;
        }
        await MAP.waitForIdle(400);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 2000));
        if (typeof rise === 'function') rise();
        await new Promise((r) => setTimeout(r, 1200));
      });
    },
  },
  {
    name: '05-click-node',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        MAP.openAlert(MAP.snapshot().alerts[0].id);
        await MAP.waitForIdle(2200);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(500);
      await page.evaluate(async () => {
        if (typeof dive === 'function') dive(0);
        await new Promise((r) => setTimeout(r, 1800));
      });
    },
  },
  {
    name: '06-next-arrow',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(200);
        for (let i = 0; i < 4; i++) {
          MAP.stepWheel(1);
          await MAP.waitForIdle(700);
        }
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
          if (typeof stepWheel === 'function') stepWheel(1);
          document.getElementById('wchev-r')?.click();
          await new Promise((r) => setTimeout(r, 650));
        }
      });
    },
  },
  {
    name: '07-dial-drag',
    ours: async (page) => {
      await page.evaluate(async () => {
        const MAP = window.LEET_ALERTS_MAP;
        MAP.recenter();
        await MAP.waitForIdle(300);
        const canvas = document.getElementById('alerts-canvas');
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.65;
        const y0 = r.top + r.height * 0.52;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        // Fast arc drag to build velocity
        for (let i = 1; i <= 22; i++) {
          const ang = i * 0.12;
          window.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x0 + Math.sin(ang) * 70,
            clientY: y0 + Math.cos(ang) * 40 + i * 6,
            pointerId: 1, bubbles: true,
          }));
          await MAP.waitForIdle(18);
        }
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 20, clientY: y0 + 160, pointerId: 1, bubbles: true }));
        // Let coast + snap play out
        await MAP.waitForIdle(1400);
      });
    },
    ref: async (page) => {
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const x0 = innerWidth * 0.65, y0 = innerHeight * 0.52;
        dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, bubbles: true }));
        for (let i = 1; i <= 22; i++) {
          const ang = i * 0.12;
          dispatchEvent(new PointerEvent('pointermove', {
            clientX: x0 + Math.sin(ang) * 70,
            clientY: y0 + Math.cos(ang) * 40 + i * 6,
            pointerId: 1, bubbles: true,
          }));
          await new Promise((r) => setTimeout(r, 18));
        }
        dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + 20, clientY: y0 + 160, pointerId: 1, bubbles: true }));
        await new Promise((r) => setTimeout(r, 1400));
      });
    },
  },
];

const visualGate = {};
const clipStatus = {};

for (const sc of scenarios) {
  console.log('recording', sc.name);
  const oursVid = await withVideo(browser, OURS_URL, `${sc.name}-ours`, sc.ours);
  const refVid = await withVideo(browser, REF, `${sc.name}-ref`, sc.ref);
  const out = path.join(MOTION, `${sc.name}.webm`);
  try {
    hstack(refVid, oursVid, out);
    clipStatus[sc.name] = { ok: true };
  } catch (e) {
    clipStatus[sc.name] = { ok: false, error: String(e.message || e) };
    if (fs.existsSync(oursVid)) { fs.copyFileSync(oursVid, out); copyArt(out); }
  }
  const ss = sc.name === '01-hover-fan' ? '00:00:01.200' : (sc.name === '04-hub-focus-back' || sc.name === '07-dial-drag' ? '00:00:01.800' : '00:00:01.400');
  const frame = path.join(MOTION, `frame-${sc.name}.png`);
  try {
    sh(`ffmpeg -y -ss ${ss} -i ${JSON.stringify(out)} -frames:v 1 -q:v 2 ${JSON.stringify(frame)}`);
    copyArt(frame);
    visualGate[sc.name] = { ...oursPaneInk(frame), ss };
    console.log('visual', sc.name, visualGate[sc.name].ok ? 'PASS' : 'FAIL', visualGate[sc.name].reason);
  } catch (e) {
    visualGate[sc.name] = { ok: false, reason: String(e.message || e) };
  }
}

await browser.close();

const review = {
  round: 14,
  fixes: [
    'Dive/rise: shared easeInOutCubic morph for nodes+camera (900/700ms), no instant cam snap, no rebuild flash',
    'Dial: angular velocity coast + friction then snapWheel detent; arrows use same EASE_WHEEL',
    'Hover: HOVER_FADE_MS 350 ease; hovered dept solid glowing paths + lit dots',
  ],
  morphReport: JSON.parse(fs.readFileSync(path.join(MOTION, 'morph-frame-report.json'), 'utf8')),
  visualGate,
  clipStatus,
};
fs.writeFileSync(path.join(MOTION, 'self-review.json'), JSON.stringify(review, null, 2));
copyArt(path.join(MOTION, 'self-review.json'));
fs.writeFileSync(path.join(MOTION, 'visual-gate.json'), JSON.stringify(visualGate, null, 2));
copyArt(path.join(MOTION, 'visual-gate.json'));

const failed = Object.entries(visualGate).filter(([, v]) => !v.ok);
console.log('done', MOTION);
if (failed.length) {
  console.error('VISUAL FAILED', failed);
  process.exit(1);
}
if (!review.morphReport.dive.ok || !review.morphReport.rise.ok) process.exit(1);
console.log('ALL GATES PASS');
