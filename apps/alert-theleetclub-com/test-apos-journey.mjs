#!/usr/bin/env node
/**
 * Per-page journey: APOS → Leet → machine → Esc → Esc, plus an incident-card click.
 * Checks framing, breadcrumb, selection, and inspector, and exact restore on Esc.
 */
import { chromium } from 'playwright';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8767';
const PAGES = [
  { id: 'tree', file: 'apos-tree-map.html', api: 'APOS_TREE_MAP', ready: '__APOS_TREE_READY__' },
  { id: 'space', file: 'apos-space-map.html', api: 'APOS_SPACE_MAP', ready: '__APOS_SPACE_READY__' },
  { id: '3d', file: 'apos-3d-map.html', api: 'APOS_3D_MAP', ready: '__APOS_3D_READY__' },
];

function fail(msg) {
  throw new Error(msg);
}

async function boot(page, def) {
  await page.goto(`${BASE}/${def.file}?fly=80`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction((flag) => window[flag] && window.__APOS_MAP_READY__, def.ready, { timeout: 15000 });
  await page.evaluate(async (apiName) => {
    const api = window[apiName];
    if (api.reset) api.reset();
    if (api.waitForIdle) await api.waitForIdle();
  }, def.api);
  await page.waitForTimeout(200);
}

async function stepState(page, apiName) {
  return page.evaluate((apiName) => {
    const api = window[apiName];
    const focus = api.getFocus();
    const t = api.getTransform();
    const frame = api.getUsableFrame();
    const pos = api.nodeScreenPos(focus.id);
    const crumb = [...document.querySelectorAll('#crumb-list button')].map((b) => (b.childNodes[0]?.textContent || b.textContent || '').trim());
    const drawer = document.getElementById('inspector-drawer');
    const open = !!(drawer && drawer.classList.contains('is-open'));
    const grid = document.getElementById('insp-grid')?.innerText || '';
    let framed = false;
    if (pos && frame && !pos.behind) {
      framed = pos.x >= frame.x - 8 && pos.x <= frame.x + frame.w + 8
        && pos.y >= frame.y - 8 && pos.y <= frame.y + frame.h + 8;
    }
    return {
      id: focus.id,
      overview: !!focus.overview,
      crumb: crumb.join(' > '),
      open,
      title: document.getElementById('insp-title')?.textContent || '',
      grid,
      framed,
      k: t?.k, x: t?.x, y: t?.y, z: t?.z,
    };
  }, apiName);
}

async function journey(page, def) {
  const notes = [];
  const snap = async (label) => {
    const s = await stepState(page, def.api);
    notes.push(`${label}: ${s.id} | ${s.crumb} | drawer ${s.open ? s.title : 'closed'} | framed ${s.framed}`);
    return s;
  };
  const overview = await snap('overview');
  if (!overview.overview && overview.id !== 'ent-apos') fail(`${def.id} overview focus ${overview.id}`);
  if (overview.open) fail(`${def.id} inspector open on overview`);
  if (!overview.framed) fail(`${def.id} APOS not in frame`);
  if (!/APOS/i.test(overview.crumb)) fail(`${def.id} breadcrumb ${overview.crumb}`);

  await page.evaluate(async (apiName) => {
    const api = window[apiName];
    api.flyTo('client-leet');
    if (api.waitForIdle) await api.waitForIdle();
  }, def.api);
  await page.waitForTimeout(120);
  const brand = await snap('leet');
  if (brand.id !== 'client-leet') fail(`${def.id} brand focus ${brand.id}`);
  if (!/Leet/i.test(brand.crumb)) fail(`${def.id} brand crumb ${brand.crumb}`);
  if (!brand.open) fail(`${def.id} brand inspector closed`);
  if (!/Leet/i.test(brand.title)) fail(`${def.id} brand title ${brand.title}`);
  if (!brand.framed) fail(`${def.id} Leet outside usable frame`);
  const brandView = await page.evaluate((apiName) => {
    const api = window[apiName];
    const nodes = api.listNodes();
    const frame = api.getUsableFrame();
    const ids = new Set(['client-leet']);
    let grew = true;
    while (grew) {
      grew = false;
      nodes.forEach((n) => {
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id) && n.type !== 'branch' && n.type !== 'artic') {
          ids.add(n.id);
          grew = true;
        }
      });
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, seen = 0;
    ids.forEach((id) => {
      if ((api.getNodeAlpha(id) || 0) < 0.2) return;
      const p = api.nodeScreenPos(id);
      if (!p || p.behind) return;
      seen += 1;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const geo = api.focusPathScreen ? api.focusPathScreen() : null;
    const chip = api.getAposEdgeHint ? api.getAposEdgeHint() : null;
    const offenders = [];
    if (geo) {
      (geo.nodes || []).forEach((n) => {
        const r = n.r || 14;
        const onStage = !n.behind && n.y > -40 && n.y < frame.H + 40 && n.x > -r && n.x < frame.W + r;
        if (onStage && n.x + r > geo.limit + 0.5) offenders.push(`node ${n.id}`);
      });
      (geo.samples || []).forEach((s) => {
        const onStageY = s.y >= -4 && s.y <= frame.H + 4;
        if (onStageY && s.x > geo.limit + 0.5) offenders.push('link');
      });
      if (chip && geo.drawerLeft != null && chip.x + 84 > geo.drawerLeft - 24) offenders.push('chip');
    }
    return {
      seen,
      bboxW: Number.isFinite(maxX) ? maxX - minX : 0,
      canvasW: frame.W,
      k: api.getTransform().k,
      offenders: offenders.slice(0, 6),
      chip: !!chip,
      limit: geo?.limit,
    };
  }, def.api);
  const dk = Math.abs(brandView.k - overview.k);
  if (dk < 0.05) fail(`${def.id} brand camera did not move (${brandView.k} vs ${overview.k})`);
  if (def.id === 'tree') {
    if (dk < 0.25) fail(`${def.id} brand camera barely changed (${brandView.k} vs ${overview.k})`);
    const frac = brandView.bboxW / Math.max(brandView.canvasW, 1);
    if (frac < 0.4) fail(`${def.id} brand bbox ${(frac * 100).toFixed(0)}% of canvas (${brandView.seen} nodes)`);
  }
  if (brandView.offenders.length) fail(`${def.id} path within 24px of drawer: ${brandView.offenders.join(', ')}`);

  const machineId = await page.evaluate((apiName) => {
    const nodes = window[apiName].listNodes();
    const areas = nodes.filter((n) => n.parentId === 'client-leet' && n.type === 'area');
    const locs = nodes.filter((n) => areas.some((a) => a.id === n.parentId));
    const machines = nodes.filter((n) => locs.some((l) => l.id === n.parentId) && n.type === 'machine');
    return (machines[0] || nodes.find((n) => n.type === 'machine')).id;
  }, def.api);
  await page.evaluate(async ({ apiName, machineId }) => {
    const api = window[apiName];
    api.flyTo(machineId);
    if (api.waitForIdle) await api.waitForIdle();
  }, { apiName: def.api, machineId });
  await page.waitForTimeout(150);
  const machine = await snap('machine');
  if (machine.id !== machineId) fail(`${def.id} machine focus ${machine.id}`);
  if (!machine.open) fail(`${def.id} machine inspector closed`);
  if (!machine.framed) fail(`${def.id} machine outside usable frame`);
  if (!/Overview|Performance|Stock|Support|Contract/i.test(machine.grid)) fail(`${def.id} machine sections missing`);
  const ghosts = await page.evaluate(({ apiName, machineId }) => {
    const api = window[apiName];
    const nodes = api.listNodes();
    const machine = nodes.find((n) => n.id === machineId);
    const site = nodes.find((n) => n.id === machine?.parentId);
    const area = nodes.find((n) => n.id === site?.parentId);
    const sibs = nodes.filter((n) => n.parentId === site?.id && n.type === 'machine' && n.id !== machineId);
    const frame = api.getUsableFrame();
    const hits = [site, area, ...sibs].filter(Boolean).filter((n) => {
      const p = api.nodeScreenPos(n.id);
      const alpha = api.getNodeAlpha(n.id) || 0;
      if (!p || p.behind || alpha < 0.3) return false;
      return p.x >= frame.x && p.x <= frame.x + frame.w && p.y >= frame.y && p.y <= frame.y + frame.h;
    }).map((n) => `${n.id}:${(api.getNodeAlpha(n.id) || 0).toFixed(2)}`);
    return hits;
  }, { apiName: def.api, machineId });
  if (ghosts.length < 3) fail(`${def.id} machine cluster ghosts ${ghosts.length} (${ghosts.join(', ')})`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.evaluate(async (apiName) => {
    if (window[apiName].waitForIdle) await window[apiName].waitForIdle();
  }, def.api);
  const back1 = await snap('esc1');
  if (back1.id !== 'client-leet') fail(`${def.id} first Esc landed on ${back1.id}`);
  if (Math.abs(back1.k - brand.k) > 0.02) fail(`${def.id} first Esc scale ${back1.k} != ${brand.k}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.evaluate(async (apiName) => {
    if (window[apiName].waitForIdle) await window[apiName].waitForIdle();
  }, def.api);
  const back2 = await snap('esc2');
  if (back2.id !== overview.id) fail(`${def.id} second Esc focus ${back2.id}`);
  if (Math.abs(back2.k - overview.k) > 0.02 || Math.abs(back2.x - overview.x) > 1.5 || Math.abs((back2.y || 0) - (overview.y || 0)) > 1.5) {
    fail(`${def.id} second Esc transform`);
  }
  if (back2.open) fail(`${def.id} inspector stayed open after restore`);

  await page.evaluate(async (apiName) => {
    const api = window[apiName];
    const m = api.listNodes().find((n) => n.type === 'machine' && n.id !== 'm-park-1');
    api.emitTestEvent(m.id, 'offline');
  }, def.api);
  await page.waitForTimeout(80);
  const clicked = await page.evaluate(async (apiName) => {
    const card = document.querySelector('#map-event-feed .incident[data-kind="offline"]');
    if (!card) return { missing: true };
    card.click();
    const api = window[apiName];
    if (api.waitForIdle) await api.waitForIdle();
    return { id: card.dataset.machine };
  }, def.api);
  await page.waitForTimeout(120);
  const incident = await snap('incident');
  if (clicked.missing) fail(`${def.id} no offline incident card`);
  if (incident.id !== clicked.id) fail(`${def.id} incident fly ${incident.id} != ${clicked.id}`);
  if (!incident.framed) fail(`${def.id} incident machine out of frame`);
  if (!/Impact/i.test(incident.grid) || !/Owner/i.test(incident.grid) || !/Next action/i.test(incident.grid)) {
    fail(`${def.id} incident inspector missing impact/owner/action`);
  }
  return notes;
}

const browser = await chromium.launch({ headless: true });
const failures = [];
for (const def of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await boot(page, def);
    const notes = await journey(page, def);
    console.log(def.id, 'OK');
    notes.forEach((n) => console.log(' ', n));
  } catch (err) {
    failures.push(`${def.id}: ${err.message}`);
    console.error(def.id, err.message);
  }
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('journey ok');
