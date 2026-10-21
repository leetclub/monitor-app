/**
 * r22 side-by-side capture @ 1600x900
 * Live skilltree map.html redirects to /preview — we fullscreen its iframe.
 * Ours: http://127.0.0.1:8767/alerts.html
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/mnt/c/Users/mahdi/OneDrive/Desktop/leet-alerts-review/r22-motion';
const VW = 1600, VH = 900;
fs.mkdirSync(OUT, { recursive: true });

async function wheelZoom(pageOrFrame, { x, y, deltaY, steps }) {
  // mouse APIs live on Page; for Frame use page + evaluate wheel on window
  const isFrame = typeof pageOrFrame.page === 'function';
  const page = isFrame ? pageOrFrame.page() : pageOrFrame;
  const target = pageOrFrame;
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    if (isFrame) {
      await target.evaluate(({ x, y, deltaY }) => {
        window.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, deltaMode: 0,
        }));
      }, { x, y, deltaY });
    } else {
      await page.mouse.wheel(0, deltaY);
    }
    await page.waitForTimeout(35);
  }
}

async function ctrlWheelZoom(frame, { x, y, deltaY, steps }) {
  const page = frame.page();
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await frame.evaluate(({ x, y, deltaY }) => {
      window.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, ctrlKey: true, deltaMode: 0,
      }));
    }, { x, y, deltaY });
    await page.waitForTimeout(40);
  }
}

async function openLiveMap(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('st-email', 'leet-r22@example.com'); } catch (e) {}
    try { localStorage.setItem('skilltree-seen', '1'); } catch (e) {}
  });
  await page.goto('https://skilltree.altari.ai/preview', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.documentElement.innerHTML = '<head><title>SkillTree map</title></head><body style="margin:0;background:#20242D"></body>';
    const iframe = document.createElement('iframe');
    iframe.src = 'https://skilltree.altari.ai/map.html';
    iframe.setAttribute('allow', 'fullscreen');
    iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;';
    document.body.appendChild(iframe);
  });
  await page.waitForTimeout(2500);
  let frame = null;
  for (let i = 0; i < 40; i++) {
    frame = page.frames().find((f) => /map\.html/.test(f.url()));
    if (frame) {
      const n = await frame.evaluate(() => document.querySelectorAll('.tree.mini').length).catch(() => 0);
      if (n >= 5) break;
    }
    await page.waitForTimeout(400);
  }
  if (!frame) throw new Error('live map frame missing');
  await frame.evaluate(() => {
    document.body.classList.add('ready');
    const g = document.getElementById('mapgate');
    if (g) { g.hidden = true; g.remove(); }
  });
  await page.waitForTimeout(800);
  return frame;
}

async function runOurs(page) {
  const still = async (name) => {
    const file = path.join(OUT, `ours-${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };
  await page.goto('http://127.0.0.1:8767/alerts.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.tree.mini').length >= 5);
  await page.waitForTimeout(1200);

  const cx = 980, cy = 480;
  await still('01-idle');
  await page.waitForTimeout(3000);

  await wheelZoom(page, { x: cx, y: cy, deltaY: -90, steps: 12 });
  await page.waitForTimeout(500);
  await still('02-zoom-in');

  await wheelZoom(page, { x: cx, y: cy, deltaY: 140, steps: 22 });
  await page.waitForTimeout(500);
  await still('03-zoom-out');

  const hoverPt = await page.evaluate(() => {
    const t = document.querySelector('.tree.mini.focused') || document.querySelector('.tree.mini');
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + 36 };
  });
  await page.mouse.move(hoverPt.x, hoverPt.y);
  await page.waitForTimeout(1000);
  await still('04-hover');

  await page.mouse.click(hoverPt.x, hoverPt.y);
  await page.waitForFunction(() => document.body.classList.contains('fanmode'), null, { timeout: 8000 });
  await page.waitForTimeout(1800);
  await still('05-dive');

  await wheelZoom(page, { x: VW / 2, y: VH * 0.56, deltaY: 160, steps: 18 });
  await page.evaluate(() => { try { if (document.body.classList.contains('fanmode')) rise(); } catch (e) {} });
  await page.waitForTimeout(1500);
  await still('06-rise');
}

async function runRef(page, frame) {
  const still = async (name) => {
    const file = path.join(OUT, `ref-${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };
  const cx = 980, cy = 480;
  await still('01-idle');
  await page.waitForTimeout(3000);

  await ctrlWheelZoom(frame, { x: cx, y: cy, deltaY: -100, steps: 12 });
  await page.waitForTimeout(500);
  await still('02-zoom-in');

  await ctrlWheelZoom(frame, { x: cx, y: cy, deltaY: 140, steps: 18 });
  await page.waitForTimeout(500);
  await still('03-zoom-out');

  const hoverPt = await frame.evaluate(() => {
    const t = document.querySelector('.tree.mini.focused') || document.querySelector('.tree.mini');
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + 36 };
  });
  await page.mouse.move(hoverPt.x, hoverPt.y);
  await page.waitForTimeout(1000);
  await still('04-hover');

  await page.mouse.click(hoverPt.x, hoverPt.y);
  await frame.waitForFunction(() => document.body.classList.contains('fanmode'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await still('05-dive');

  await ctrlWheelZoom(frame, { x: VW / 2, y: VH * 0.56, deltaY: 160, steps: 14 });
  await frame.evaluate(() => { try { if (typeof rise === 'function') rise(); } catch (e) {} });
  await page.waitForTimeout(1500);
  await still('06-rise');
}

const browser = await chromium.launch({ headless: true });

// OURS
{
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  const page = await ctx.newPage();
  await runOurs(page);
  const vid = await page.video().path();
  await ctx.close();
  fs.renameSync(vid, path.join(OUT, 'ours.webm'));
  console.log('ours ok');
}

// REF (live)
{
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  const page = await ctx.newPage();
  let refOk = true;
  try {
    const frame = await openLiveMap(page);
    await runRef(page, frame);
    const vid = await page.video().path();
    await ctx.close();
    fs.renameSync(vid, path.join(OUT, 'ref-site.webm'));
    console.log('ref ok');
  } catch (e) {
    refOk = false;
    console.error('REF FAIL', e);
    // fallback: local fetched snapshot (byte-identical engine from r22-source)
    try {
      const page2 = await ctx.newPage();
      await page2.goto('http://127.0.0.1:8768/map.html', { waitUntil: 'networkidle' });
      await page2.waitForFunction(() => document.querySelectorAll('.tree.mini').length >= 5);
      await page2.waitForTimeout(1000);
      // minimal stills
      await page2.screenshot({ path: path.join(OUT, 'ref-01-idle.png') });
      console.log('fallback local snapshot stills only');
    } catch (e2) {
      console.error('fallback fail', e2);
    }
    await ctx.close().catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'capture-meta.json'), JSON.stringify({
    viewport: { width: VW, height: VH },
    refOk,
    note: 'Live map.html redirects to /preview; captured via fullscreen iframe of map.html',
    at: new Date().toISOString(),
  }, null, 2));
}

await browser.close();

const aliases = [
  ['ours-01-idle.png', 'ours-idle.png'],
  ['ours-02-zoom-in.png', 'ours-zoomin.png'],
  ['ours-03-zoom-out.png', 'ours-zoomout.png'],
  ['ours-04-hover.png', 'ours-hover.png'],
  ['ours-05-dive.png', 'ours-dive.png'],
  ['ours-06-rise.png', 'ours-rise.png'],
  ['ref-01-idle.png', 'ref-idle.png'],
  ['ref-02-zoom-in.png', 'ref-zoomin.png'],
  ['ref-03-zoom-out.png', 'ref-zoomout.png'],
  ['ref-04-hover.png', 'ref-hover.png'],
  ['ref-05-dive.png', 'ref-dive.png'],
  ['ref-06-rise.png', 'ref-rise.png'],
];
for (const [a, b] of aliases) {
  const from = path.join(OUT, a);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, b));
}
console.log('done');
