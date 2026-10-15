#!/usr/bin/env node

/**
 * Playwright tests for rebuilt radial-org-map.html
 * Captures 4 key screenshots matching reference video frames 1, 3, 6, 13
 */

import { chromium, firefox } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:8768/radial-org-map.html';
const ARTIFACTS_DIR = join(process.env.HOME || process.env.USERPROFILE, '.cursor', 'projects', 'mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app', 'artifacts');

if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureKeyFrames(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Capturing key frames in ${browserName.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 });
  } catch (err) {
    console.error(`❌ Failed to load page: ${err.message}`);
    await browser.close();
    return false;
  }

  await delay(2500);

  console.log('📸 Frame 1: Single department fan (landing view)');
  const frame1Path = join(ARTIFACTS_DIR, `frame1-single-fan-${browserName}.png`);
  await page.screenshot({ path: frame1Path, fullPage: false });
  console.log(`   Saved: ${frame1Path}\n`);

  console.log('📸 Frame 3: Zoom to full radial map');
  const resetBtn = page.locator('[data-action="reset"]');
  await resetBtn.click();
  await delay(1500);
  const frame3Path = join(ARTIFACTS_DIR, `frame3-full-map-${browserName}.png`);
  await page.screenshot({ path: frame3Path, fullPage: false });
  console.log(`   Saved: ${frame3Path}\n`);

  console.log('📸 Frame 6: Zoomed branch view (back to single department)');
  await resetBtn.click();
  await delay(1500);
  const frame6Path = join(ARTIFACTS_DIR, `frame6-branch-zoom-${browserName}.png`);
  await page.screenshot({ path: frame6Path, fullPage: false });
  console.log(`   Saved: ${frame6Path}\n`);

  console.log('📸 Frame 13: Detail panel open');
  const jobNodes = await page.locator('circle[data-node-id]').all();
  if (jobNodes.length > 0) {
    await jobNodes[0].click();
  } else {
    const anyJobNode = await page.locator('.node-group').first();
    await anyJobNode.click();
  }
  await delay(800);
  const frame13Path = join(ARTIFACTS_DIR, `frame13-detail-panel-${browserName}.png`);
  await page.screenshot({ path: frame13Path, fullPage: false });
  console.log(`   Saved: ${frame13Path}\n`);

  await browser.close();

  console.log(`✅ ${browserName.toUpperCase()} key frames captured\n`);
  return true;
}

async function runBasicTests(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running basic tests in ${browserName.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const results = {
    browser: browserName,
    passed: 0,
    failed: 0,
  };

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
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 });
  } catch (err) {
    console.error(`❌ Failed to load page: ${err.message}`);
    await browser.close();
    return results;
  }

  await delay(2000);

  await test('Page loads with APOS branding', async () => {
    const brandText = await page.locator('.header-brand').textContent();
    if (!brandText.includes('APOS')) {
      throw new Error('APOS branding not found');
    }
  });

  await test('SVG canvas renders', async () => {
    const svg = await page.locator('#org-map-svg');
    const count = await svg.count();
    if (count !== 1) {
      throw new Error(`Expected 1 SVG, found ${count}`);
    }
  });

  await test('Single department view loads (fan from bottom)', async () => {
    const deptName = await page.locator('#dept-name').textContent();
    if (!deptName || deptName === '') {
      throw new Error('Department name not loaded');
    }
  });

  await test('Department chevrons cycle', async () => {
    const nextBtn = page.locator('[data-dir="next"]');
    const label1 = await page.locator('#dept-name').textContent();
    await nextBtn.click();
    await delay(1200);
    const label2 = await page.locator('#dept-name').textContent();
    if (label1 === label2) {
      throw new Error('Chevron did not cycle department');
    }
  });

  await test('Reset toggles to full map', async () => {
    const resetBtn = page.locator('[data-action="reset"]');
    await resetBtn.click();
    await delay(1500);
    const label = await page.locator('#dept-name').textContent();
    if (!label.includes('ALL')) {
      throw new Error('Did not switch to full map view');
    }
  });

  await test('Click department returns to single view', async () => {
    const deptNode = page.locator('.department-node-group circle').first();
    await deptNode.click();
    await delay(1200);
    const label = await page.locator('#dept-name').textContent();
    if (label.includes('ALL')) {
      throw new Error('Did not return to single department view');
    }
  });

  await test('Click job node opens detail panel', async () => {
    const jobNodes = await page.locator('circle[data-node-id]').all();
    if (jobNodes.length > 0) {
      await jobNodes[0].click();
    } else {
      const anyNode = await page.locator('.node-group').first();
      await anyNode.click();
    }
    await delay(600);
    const panel = page.locator('#detail-panel');
    const hasOpenClass = await panel.evaluate((el) => el.classList.contains('open'));
    if (!hasOpenClass) {
      throw new Error('Detail panel did not open');
    }
  });

  await test('Panel shows job details', async () => {
    const jobTitle = await page.locator('#job-title-panel').textContent();
    if (!jobTitle || jobTitle === 'Loading...') {
      throw new Error('Job title not populated');
    }
  });

  await test('Autonomy ladder highlights active level', async () => {
    const activeLadder = await page.locator('.ladder-item.active').count();
    if (activeLadder !== 1) {
      throw new Error(`Expected 1 active ladder item, found ${activeLadder}`);
    }
  });

  await test('Panel close button works', async () => {
    const closeBtn = page.locator('.panel-close');
    await closeBtn.click();
    await delay(500);
    const panel = page.locator('#detail-panel');
    const hasOpenClass = await panel.evaluate((el) => el.classList.contains('open'));
    if (hasOpenClass) {
      throw new Error('Panel did not close');
    }
  });

  await test('Zoom controls functional', async () => {
    await page.locator('[data-action="zoom-in"]').click();
    await delay(300);
    await page.locator('[data-action="zoom-out"]').click();
    await delay(300);
  });

  await test('Workflow form renders', async () => {
    const jobNodes = await page.locator('circle[data-node-id]').all();
    if (jobNodes.length > 0) {
      await jobNodes[0].click();
    }
    await delay(600);
    const form = await page.locator('#workflow-form').isVisible();
    if (!form) {
      throw new Error('Workflow form not visible');
    }
  });

  await browser.close();

  console.log(`\n${browserName.toUpperCase()} Results:`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  Total:  ${results.passed + results.failed}\n`);

  return results;
}

async function main() {
  console.log('\n🚀 Testing rebuilt radial-org-map.html\n');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Artifacts: ${ARTIFACTS_DIR}\n`);

  const chromiumFrames = await captureKeyFrames(chromium, 'chromium');
  const firefoxFrames = await captureKeyFrames(firefox, 'firefox');

  if (!chromiumFrames || !firefoxFrames) {
    console.error('\n❌ Failed to capture key frames in one or both browsers\n');
    process.exit(1);
  }

  const chromiumResults = await runBasicTests(chromium, 'chromium');
  const firefoxResults = await runBasicTests(firefox, 'firefox');

  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60) + '\n');

  const totalPassed = chromiumResults.passed + firefoxResults.passed;
  const totalFailed = chromiumResults.failed + firefoxResults.failed;
  const totalTests = totalPassed + totalFailed;

  console.log(`Total tests run: ${totalTests}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`Success rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%\n`);

  console.log('📸 Key frame screenshots (matching video reference):');
  console.log('   Frame 1 (Single department fan): frame1-single-fan-*.png');
  console.log('   Frame 3 (Full radial map): frame3-full-map-*.png');
  console.log('   Frame 6 (Branch zoom): frame6-branch-zoom-*.png');
  console.log('   Frame 13 (Detail panel): frame13-detail-panel-*.png\n');

  if (totalFailed > 0) {
    console.error('⚠️  Some tests failed, but key frames were captured.\n');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
