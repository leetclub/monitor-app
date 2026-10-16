/**
 * Shared checks for always-on map motion (tree, space, 3D).
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { copyFileSync } from 'fs';
import { join } from 'path';

export const MOTION_ARTIFACTS = join(
  process.env.HOME || process.env.USERPROFILE,
  '.cursor/projects/mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app/artifacts'
);

export async function assertLiveMotion(page, apiName) {
  await page.evaluate((name) => window[name].reset?.(), apiName);
  await page.evaluate(async (name) => {
    if (window[name].waitForIdle) await window[name].waitForIdle();
  }, apiName);
  await page.waitForTimeout(700);
  const stats = await page.evaluate((name) => {
    const api = window[name];
    api.setFilter('alerts');
    const dim = api.getFilterDimmedCount();
    api.setFilter('all');
    return {
      frames: api.getFrameStats(),
      dim,
      hits: api.searchNodes('leet'),
      motion: api.getMotionState(),
      searchUi: !!document.getElementById('map-command'),
    };
  }, apiName);
  if (!stats.searchUi) throw new Error('search/filter chrome missing');
  if (!stats.motion || stats.motion.reduceMotion) throw new Error(`motion flags ${JSON.stringify(stats.motion)}`);
  if (stats.motion.bobAmp < 2) throw new Error(`bob amp ${stats.motion.bobAmp}`);
  if (!stats.frames || stats.frames.n < 8) throw new Error(`fps samples ${JSON.stringify(stats.frames)}`);
  if (stats.frames.median > 16) throw new Error(`frame median ${stats.frames.median}ms (want ≤16)`);
  if (stats.dim < 1) throw new Error('alerts filter did not dim any node');
  if (!stats.hits?.length) throw new Error('search for leet returned nothing');
  await page.keyboard.press('Control+k');
  const open = await page.locator('#map-search').isVisible();
  if (!open) throw new Error('Ctrl+K did not open search');
  await page.keyboard.press('Escape');
}

export async function assertReducedMotion(browser, url, apiName) {
  const ctx = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  let navigated = false;
  for (let attempt = 0; attempt < 2 && !navigated; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      navigated = true;
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
  await page.waitForFunction((name) => window[name]?.getMotionState, apiName, { timeout: 15000 });
  await page.waitForTimeout(300);
  const motion = await page.evaluate((name) => window[name].getMotionState(), apiName);
  await ctx.close();
  if (!motion.reduceMotion) throw new Error('prefers-reduced-motion was not honoured');
  if (motion.bobAmp !== 0) throw new Error(`bob still ${motion.bobAmp} under reduced motion`);
}

function frameStats(png) {
  const out = execSync(
    `python3 -c "from PIL import Image; im=Image.open('${png}').convert('L').resize((80,45)); d=list(im.getdata()); n=len(d); m=sum(d)/n; v=sum((x-m)**2 for x in d)/n; print(m, v**0.5)"`,
    { encoding: 'utf8' }
  );
  const [mean, std] = out.trim().split(/\s+/).map(Number);
  return { mean, std };
}

export async function recordMotionMp4(url, filename) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: MOTION_ARTIFACTS, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  // Headless video starts on about:blank (white). Paint the page background
  // immediately so a slow canvas does not encode as an empty white clip.
  await page.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = 'html,body{background:#12142a!important}';
    document.documentElement.appendChild(s);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.__APOS_MAP_READY__, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.mouse.move(640, 380);
  await page.waitForTimeout(1100);
  await page.mouse.move(460, 300);
  await page.waitForTimeout(900);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.mouse.move(720, 430);
  await page.mouse.down();
  await page.mouse.move(800, 480, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(4600);
  const vid = page.video();
  await context.close();
  await browser.close();
  if (!vid) return;
  const raw = await vid.path();
  const dest = join(MOTION_ARTIFACTS, filename);
  const probe = join(MOTION_ARTIFACTS, '.motion-probe.png');
  try {
    let ss = 0.2;
    for (let t = 0; t < 8; t += 0.25) {
      execSync(`ffmpeg -y -hide_banner -loglevel error -ss ${t} -i "${raw}" -frames:v 1 "${probe}"`, { stdio: 'pipe' });
      const { mean, std } = frameStats(probe);
      // Skip about:blank white and the flat dark page before the canvas paints.
      if (mean < 180 && std > 8) { ss = t; break; }
    }
    execSync(
      `ffmpeg -y -ss ${ss} -i "${raw}" -t 10 -c:v libx264 -pix_fmt yuv420p -an "${dest}"`,
      { stdio: 'pipe' }
    );
    console.log(`   🎬 ${dest} (from ${ss.toFixed(2)}s)`);
  } catch (e) {
    copyFileSync(raw, dest.replace(/\.mp4$/, '.webm'));
    console.warn('mp4 encode failed', e.message || e);
  }
}
