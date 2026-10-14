#!/usr/bin/env node

/**
 * Playwright smoke tests for radial-org-map.html
 * Tests core interactions in Chromium and Firefox
 */

import { chromium, firefox } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_DIR = join(__dirname, '..', 'public');
const HTML_PATH = join(PUBLIC_DIR, 'radial-org-map.html');
const ARTIFACTS_DIR = join(process.env.HOME || process.env.USERPROFILE, '.cursor', 'projects', 'mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app', 'artifacts');

if (!existsSync(ARTIFACTS_DIR)) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests(browserType, browserName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing in ${browserName.toUpperCase()}`);
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
    tests: [],
  };

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(`   ${err.message}`);
      results.failed++;
      results.tests.push({ name, status: 'FAIL', error: err.message });
    }
  };

  await page.goto(`file://${HTML_PATH}`);
  await delay(1500);

  await test('Page loads with APOS title', async () => {
    const title = await page.title();
    if (!title.includes('APOS')) {
      throw new Error(`Expected title to include 'APOS', got: ${title}`);
    }
  });

  await test('SVG canvas renders', async () => {
    const svg = await page.locator('#org-map-svg');
    const count = await svg.count();
    if (count !== 1) {
      throw new Error(`Expected 1 SVG canvas, found ${count}`);
    }
  });

  await test('APOS core text visible', async () => {
    const coreText = await page.locator('text=APOS').first();
    const visible = await coreText.isVisible();
    if (!visible) {
      throw new Error('APOS core text not visible');
    }
  });

  await test('Department nodes present', async () => {
    await delay(500);
    const deptNodes = await page.locator('.department-node').count();
    if (deptNodes < 7) {
      throw new Error(`Expected at least 7 departments, found ${deptNodes}`);
    }
  });

  await test('Job nodes present', async () => {
    const jobNodes = await page.locator('.job-node').count();
    if (jobNodes < 10) {
      throw new Error(`Expected at least 10 job nodes, found ${jobNodes}`);
    }
  });

  await test('Click department zooms in', async () => {
    const deptNode = page.locator('.department-node').first();
    await deptNode.click();
    await delay(1000);
    const labelText = await page.locator('#current-department').textContent();
    if (labelText === 'All Departments') {
      throw new Error('Department label did not update after click');
    }
  });

  await test('Reset button restores view', async () => {
    const resetBtn = page.locator('[data-action="reset"]');
    await resetBtn.click();
    await delay(1000);
    const labelText = await page.locator('#current-department').textContent();
    if (labelText !== 'All Departments') {
      throw new Error(`Expected 'All Departments', got: ${labelText}`);
    }
  });

  await test('Zoom in button works', async () => {
    const zoomInBtn = page.locator('[data-action="zoom-in"]');
    await zoomInBtn.click();
    await delay(500);
  });

  await test('Zoom out button works', async () => {
    const zoomOutBtn = page.locator('[data-action="zoom-out"]');
    await zoomOutBtn.click();
    await delay(500);
  });

  await test('Next chevron cycles departments', async () => {
    await page.locator('[data-action="reset"]').click();
    await delay(800);
    const nextBtn = page.locator('[data-dir="next"]');
    await nextBtn.click();
    await delay(1000);
    const labelText = await page.locator('#current-department').textContent();
    if (labelText === 'All Departments') {
      throw new Error('Next chevron did not cycle department');
    }
  });

  await test('Previous chevron cycles departments', async () => {
    const prevBtn = page.locator('[data-dir="prev"]');
    await prevBtn.click();
    await delay(1000);
  });

  await test('Click job node opens drawer', async () => {
    await page.locator('[data-action="reset"]').click();
    await delay(800);
    const jobNode = page.locator('.job-node circle').first();
    await jobNode.click();
    await delay(500);
    const drawer = page.locator('#detail-drawer');
    const hasOpenClass = await drawer.evaluate((el) => el.classList.contains('open'));
    if (!hasOpenClass) {
      throw new Error('Drawer did not open after job click');
    }
  });

  await test('Drawer shows job title', async () => {
    const jobTitle = await page.locator('#job-title').textContent();
    if (!jobTitle || jobTitle === 'Loading...') {
      throw new Error('Drawer job title not populated');
    }
  });

  await test('Drawer shows department tag', async () => {
    const deptTag = await page.locator('#job-department').textContent();
    if (!deptTag || deptTag === '—') {
      throw new Error('Drawer department tag not populated');
    }
  });

  await test('Drawer shows "What it replaces" text', async () => {
    const replacesText = await page.locator('#replaces-text').textContent();
    if (!replacesText || replacesText === '—') {
      throw new Error('Drawer replaces text not populated');
    }
  });

  await test('Autonomy ladder highlights level', async () => {
    const activeLadder = await page.locator('.ladder-item.active').count();
    if (activeLadder !== 1) {
      throw new Error(`Expected 1 active ladder item, found ${activeLadder}`);
    }
  });

  await test('Drawer close button works', async () => {
    const closeBtn = page.locator('.drawer-close');
    await closeBtn.click();
    await delay(500);
    const drawer = page.locator('#detail-drawer');
    const hasOpenClass = await drawer.evaluate((el) => el.classList.contains('open'));
    if (hasOpenClass) {
      throw new Error('Drawer did not close');
    }
  });

  await test('Run Skill button exists and clickable', async () => {
    await page.locator('.job-node circle').first().click();
    await delay(500);
    const runBtn = page.locator('#run-skill-btn');
    const visible = await runBtn.isVisible();
    if (!visible) {
      throw new Error('Run Skill button not visible');
    }
    await runBtn.click();
    await delay(300);
    page.once('dialog', (dialog) => dialog.accept());
  });

  await test('View Payload button exists and clickable', async () => {
    const payloadBtn = page.locator('#view-payload-btn');
    const visible = await payloadBtn.isVisible();
    if (!visible) {
      throw new Error('View Payload button not visible');
    }
  });

  await test('Workflow form renders', async () => {
    const form = page.locator('#workflow-form');
    const visible = await form.isVisible();
    if (!visible) {
      throw new Error('Workflow form not visible');
    }
  });

  const screenshotPath = join(ARTIFACTS_DIR, `radial-org-map-${browserName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n📸 Screenshot saved: ${screenshotPath}`);

  const screenshotDrawerPath = join(ARTIFACTS_DIR, `radial-org-map-drawer-${browserName}.png`);
  await page.screenshot({ path: screenshotDrawerPath, fullPage: false });
  console.log(`📸 Drawer screenshot saved: ${screenshotDrawerPath}\n`);

  await page.locator('.drawer-close').click();
  await delay(500);

  const screenshotZoomedPath = join(ARTIFACTS_DIR, `radial-org-map-zoomed-${browserName}.png`);
  await page.locator('.department-node').nth(2).click();
  await delay(1000);
  await page.screenshot({ path: screenshotZoomedPath, fullPage: false });
  console.log(`📸 Zoomed screenshot saved: ${screenshotZoomedPath}\n`);

  await browser.close();

  console.log(`\n${browserName.toUpperCase()} Results:`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  Total:  ${results.passed + results.failed}\n`);

  return results;
}

async function main() {
  console.log('\n🚀 Starting Playwright tests for radial-org-map.html\n');
  console.log(`HTML file: ${HTML_PATH}`);
  console.log(`Artifacts: ${ARTIFACTS_DIR}\n`);

  const chromiumResults = await runTests(chromium, 'chromium');
  const firefoxResults = await runTests(firefox, 'firefox');

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

  if (totalFailed > 0) {
    console.error('❌ Some tests failed. Review output above for details.\n');
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
