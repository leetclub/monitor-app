#!/usr/bin/env node
/** Fail if rest overview is missing hubs/chains/core or labels drift from hubs. */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const url = `${BASE}/alerts.html?r13=restcheck`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => window.__LEET_ALERTS_READY__ && window.LEET_ALERTS_MAP, null, { timeout: 15000 });
await page.waitForTimeout(800);
const gate = await page.evaluate(() => window.LEET_ALERTS_MAP.assertRestOverview());
await browser.close();
console.log(JSON.stringify(gate, null, 2));
if (!gate.ok) {
  console.error('assertRestOverview FAILED');
  process.exit(1);
}
console.log('assertRestOverview OK');
