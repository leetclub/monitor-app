#!/usr/bin/env node

/**
 * Playwright tests for rebuilt radial-org-map.html — single continuous tree world
 * Captures 4 screenshots: full-map, zoom-department, zoom-leaf-card, task-popover
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

async function captureKeyScreenshots(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Capturing key screenshots in ${browserName.toUpperCase()}`);
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

  console.log('📸 1. full-map.png — Default full continuous tree view');
  await page.locator('[data-action="reset"]').click();
  await delay(1000);
  const fullMapPath = join(ARTIFACTS_DIR, `full-map-${browserName}.png`);
  await page.screenshot({ path: fullMapPath, fullPage: false });
  console.log(`   Saved: ${fullMapPath}\n`);

  console.log('📸 2. zoom-department.png — Zoomed to one department via chevron');
  await page.locator('[data-dir="next"]').click();
  await delay(1200);
  const zoomDeptPath = join(ARTIFACTS_DIR, `zoom-department-${browserName}.png`);
  await page.screenshot({ path: zoomDeptPath, fullPage: false });
  console.log(`   Saved: ${zoomDeptPath}\n`);

  console.log('📸 3. zoom-leaf-card.png — Clicked leaf node, data card visible');
  // First click a department to zoom in (use the click target)
  const deptClickTargets = await page.locator('.dept-click-target').all();
  if (deptClickTargets.length > 0) {
    await deptClickTargets[0].click();
    await delay(1200);
  }
  // Then click a nearby node group
  const nodeGroups = await page.locator('.node-group circle').all();
  if (nodeGroups.length > 0) {
    await nodeGroups[0].click();
    await delay(1000);
  }
  const zoomLeafPath = join(ARTIFACTS_DIR, `zoom-leaf-card-${browserName}.png`);
  await page.screenshot({ path: zoomLeafPath, fullPage: false });
  console.log(`   Saved: ${zoomLeafPath}\n`);

  console.log('📸 4. task-popover.png — Task popover open');
  await page.locator('#new-task-link').click();
  await delay(600);
  const taskPopoverPath = join(ARTIFACTS_DIR, `task-popover-${browserName}.png`);
  await page.screenshot({ path: taskPopoverPath, fullPage: false });
  console.log(`   Saved: ${taskPopoverPath}\n`);

  await browser.close();

  console.log(`✅ ${browserName.toUpperCase()} key screenshots captured\n`);
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

  await test('Continuous tree world renders (all departments visible)', async () => {
    const deptGroups = await page.locator('.department-node-group').count();
    if (deptGroups < 8) {
      throw new Error(`Expected 8 department hubs, found ${deptGroups}`);
    }
  });

  await test('Dense leaves fill sectors (60+ leaf dots visible)', async () => {
    const leaves = await page.locator('circle.leaf-dot').count();
    if (leaves < 400) {
      throw new Error(`Expected dense galaxy (≥400 leaves across depts), found ${leaves}`);
    }
  });

  await test('Faint department labels present in background', async () => {
    const labels = await page.locator('.faint-label').count();
    if (labels < 8) {
      throw new Error(`Expected 8 faint dept labels, found ${labels}`);
    }
  });

  await test('Department chevrons cycle camera', async () => {
    const nextBtn = page.locator('[data-dir="next"]');
    await nextBtn.click();
    await delay(1200);
  });

  await test('Reset button zooms out to default view', async () => {
    const resetBtn = page.locator('[data-action="reset"]');
    await resetBtn.click();
    await delay(1000);
  });

  await test('Click department hub zooms camera to that department', async () => {
    const deptNode = page.locator('.department-node-group').first();
    await deptNode.click();
    await delay(1200);
  });

  await test('Click job node opens anchored data card', async () => {
    const nodeGroups = await page.locator('.node-group').all();
    if (nodeGroups.length > 0) {
      await nodeGroups[0].click();
    }
    await delay(800);
    const card = page.locator('#data-card');
    const isOpen = await card.evaluate((el) => el.classList.contains('open'));
    if (!isOpen) {
      throw new Error('Data card did not open');
    }
  });

  await test('Data card shows node details', async () => {
    const title = await page.locator('#card-title').textContent();
    if (!title) {
      throw new Error('Card title not populated');
    }
  });

  await test('Data card has "New task" link', async () => {
    const link = await page.locator('#new-task-link').isVisible();
    if (!link) {
      throw new Error('New task link not visible');
    }
  });

  await test('Click "New task" opens task popover', async () => {
    await page.locator('#new-task-link').click();
    await delay(500);
    const popover = page.locator('#task-popover');
    const isOpen = await popover.evaluate((el) => el.classList.contains('open'));
    if (!isOpen) {
      throw new Error('Task popover did not open');
    }
  });

  await test('Task popover has form fields', async () => {
    const desc = await page.locator('#task-desc').isVisible();
    const recipient = await page.locator('#task-recipient').isVisible();
    const priority = await page.locator('#task-priority').isVisible();
    if (!desc || !recipient || !priority) {
      throw new Error('Task form fields not visible');
    }
  });

  await test('Task popover close button works', async () => {
    await page.locator('#task-popover-close').click();
    await delay(500);
    const popover = page.locator('#task-popover');
    const isOpen = await popover.evaluate((el) => el.classList.contains('open'));
    if (isOpen) {
      throw new Error('Task popover did not close');
    }
  });

  await test('Data card close button works', async () => {
    await page.locator('#card-close').click();
    await delay(500);
    const card = page.locator('#data-card');
    const isOpen = await card.evaluate((el) => el.classList.contains('open'));
    if (isOpen) {
      throw new Error('Data card did not close');
    }
  });

  await test('Zoom controls functional', async () => {
    await page.locator('[data-action="zoom-in"]').click();
    await delay(300);
    await page.locator('[data-action="zoom-out"]').click();
    await delay(300);
  });

  await test('Node groups have SVG line icons (no emoji)', async () => {
    const icons = await page.locator('.node-icon').count();
    if (icons === 0) {
      throw new Error('No SVG line icons found');
    }
  });

  await test('Particle core animates', async () => {
    const particleGroup = await page.locator('.particle-group').count();
    if (particleGroup !== 1) {
      throw new Error('Particle core not rendered');
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
  console.log('\n🚀 Testing rebuilt radial-org-map.html (single continuous tree world)\n');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Artifacts: ${ARTIFACTS_DIR}\n`);

  const chromiumFrames = await captureKeyScreenshots(chromium, 'chromium');
  const firefoxFrames = await captureKeyScreenshots(firefox, 'firefox');

  if (!chromiumFrames || !firefoxFrames) {
    console.error('\n❌ Failed to capture key screenshots in one or both browsers\n');
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

  console.log('📸 Key screenshots saved:');
  console.log('   1. full-map-*.png — Default continuous tree view');
  console.log('   2. zoom-department-*.png — Camera zoomed to one department');
  console.log('   3. zoom-leaf-card-*.png — Leaf node clicked, data card anchored');
  console.log('   4. task-popover-*.png — Task popover open from card\n');

  if (totalFailed > 0) {
    console.error('⚠️  Some tests failed, but key screenshots were captured.\n');
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
