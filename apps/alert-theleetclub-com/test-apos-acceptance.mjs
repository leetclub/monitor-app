#!/usr/bin/env node
/**
 * Exhaustive APOS map acceptance walk + 200-step stress.
 * Local only. Serves from http://127.0.0.1:8777
 */
import { chromium, firefox } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const BASE = process.env.APOS_BASE || 'http://127.0.0.1:8777';
const ARTIFACTS = join(
  process.env.HOME || '/tmp',
  '.cursor/projects/mnt-c-Users-mahdi-OneDrive-theleetclub-monitoring-app/artifacts'
);
mkdirSync(ARTIFACTS, { recursive: true });

const PAGES = [
  { id: 'tree', file: 'apos-tree-map.html', api: 'APOS_TREE_MAP', ready: '__APOS_TREE_READY__' },
  { id: 'space', file: 'apos-space-map.html', api: 'APOS_SPACE_MAP', ready: '__APOS_SPACE_READY__' },
  { id: '3d', file: 'apos-3d-map.html', api: 'APOS_3D_MAP', ready: '__APOS_3D_READY__' },
];

const CHECKS = ['F1', 'F2', 'F3', 'F4', 'F5', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'C1', 'D1', 'D2', 'D3', 'D4', 'V1', 'V2', 'V3', 'V4', 'B1'];

function blankScore() {
  const o = {};
  CHECKS.forEach((c) => { o[c] = { pass: 0, fail: 0, notes: [] }; });
  return o;
}

function note(score, code, ok, msg) {
  const row = score[code];
  if (ok) row.pass += 1;
  else {
    row.fail += 1;
    if (row.notes.length < 8) row.notes.push(msg);
  }
}

async function boot(page, pageDef) {
  const url = `${BASE}/${pageDef.file}?fly=220`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction((flag) => window[flag] && window.__APOS_MAP_READY__, pageDef.ready, { timeout: 15000 });
  await page.evaluate(async (apiName) => {
    const api = window[apiName];
    if (api.reset) api.reset();
    if (api.waitForIdle) await api.waitForIdle();
  }, pageDef.api);
  await page.waitForTimeout(280);
}

async function walk(page, pageDef, score) {
  const result = await page.evaluate(async ({ apiName, limit }) => {
    const api = window[apiName];
    const fails = [];
    const fail = (code, msg) => { if (fails.length < 80) fails.push({ code, msg }); };
    const nodes = api.listNodes();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const stage = document.querySelector('.tree-stage, .space-stage, .map3d-stage');
    const usable = () => {
      const sr = stage.getBoundingClientRect();
      const f = api.getUsableFrame();
      return {
        l: sr.left + f.x, t: sr.top + f.y, r: sr.left + f.x + f.w, b: sr.top + f.y + f.h,
        cx: f.cx, cy: f.cy, w: f.w, h: f.h,
      };
    };
    const labelBoxes = () => {
      const sel = '.node-label-dom, .hub-title-dom, .hub-sub, .focus-title, .m3d-label, .node-badge, .m3d-badge, .orbit-level';
      const out = [];
      document.querySelectorAll(sel).forEach((el) => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return;
        if (Number.parseFloat(st.opacity || '1') < 0.2) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const badge = el.classList.contains('node-badge') || el.classList.contains('m3d-badge');
        out.push({
          id: badge ? '' : (el.dataset.nid || el.dataset.id || ''),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height,
        });
      });
      return out;
    };
    const overlapPairs = (boxes) => {
      const hits = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1) {
            hits.push(`${a.text.slice(0, 24)} | ${b.text.slice(0, 24)}`);
          }
        }
      }
      return hits;
    };
    const dataIssues = api.auditData();
    const finite = (t) => t && [t.k, t.x, t.y].every((v) => Number.isFinite(v));

    let targets = nodes.filter((n) => n.type !== 'artic');
    if (limit > 0) targets = targets.slice(0, limit);

    const zoomCollision = async (tag, id) => {
      if (id) api.flyTo(id);
      else api.reset();
      await api.waitForIdle();
      await new Promise((r) => setTimeout(r, 60));
      overlapPairs(labelBoxes()).slice(0, 4).forEach((msg) => fail('C1', `${tag} ${msg}`));
      if (typeof api.countLabelLinkHits === 'function' && api.countLabelLinkHits() > 0) {
        fail('C1', `${tag} link crosses label ${api.countLabelLinkHits()}`);
      }
    };
    await zoomCollision('overview');
    const mid = nodes.find((n) => n.type === 'client') || nodes.find((n) => n.type === 'area') || nodes.find((n) => n.type === 'country');
    if (mid) await zoomCollision('mid', mid.id);
    const machine = nodes.find((n) => n.id === 'm-ee-4') || nodes.find((n) => n.type === 'machine');
    if (machine) await zoomCollision('focus', machine.id);
    api.reset();
    await api.waitForIdle();
    if (typeof api.fleetSnapshot === 'function') {
      const agree = () => {
        const s = api.fleetSnapshot();
        const kpi = (document.querySelector('[data-kpi="offline"] b')?.textContent || '').trim();
        const crumb = document.getElementById('crumb-list')?.dataset.offline;
        const cards = [...document.querySelectorAll('#map-event-feed .incident[data-kind="offline"]')];
        const ids = new Set(cards.map((c) => c.dataset.machine).filter(Boolean));
        const ringOff = (api.getHealthRing?.() || []).find((p) => p.key === 'offline')?.n || 0;
        const ent = api.getRollup?.('ent-apos');
        if (kpi !== String(s.offline)) fail('D2', `kpi offline ${kpi} != snapshot ${s.offline}`);
        if (crumb != null && crumb !== String(s.offline)) fail('D2', `crumb offline ${crumb} != ${s.offline}`);
        if (cards.length !== (s.openIncidents || []).filter((i) => i.kind === 'offline').length) fail('D2', `offline cards ${cards.length}`);
        if (ids.size !== (s.machinesOfflineNow || []).length) fail('D2', `offline machines ${ids.size} != ${s.machinesOfflineNow.length}`);
        if (ringOff !== s.offline) fail('D2', `health ring offline ${ringOff} != ${s.offline}`);
        if (ent && ent.offline !== s.offline) fail('D2', `rollup offline ${ent.offline} != ${s.offline}`);
      };
      agree();
      const victim = nodes.find((n) => n.type === 'machine' && n.id === 'm-ee-4') || nodes.find((n) => n.type === 'machine');
      if (victim && api.emitTestEvent) {
        api.emitTestEvent(victim.id, 'offline');
        api.emitTestEvent(victim.id, 'offline');
        await new Promise((r) => setTimeout(r, 40));
        agree();
        const s2 = api.fleetSnapshot();
        if ((s2.historyCount || 0) < 2) fail('D2', `history did not keep repeats (${s2.historyCount})`);
        if ((s2.machinesOfflineNow || []).filter((id) => id === victim.id).length !== 1) fail('D2', 'offline machine not unique');
      }
    }
    let smoothChecked = 0;
    for (const n of targets) {
      api.reset();
      await api.waitForIdle();
      const before = api.getTransform();
      const beforeFocus = api.getFocus().id;
      const samples = [];
      let live = true;
      const sample = () => {
        if (!live) return;
        const t = api.getTransform();
        if (t) samples.push({ k: t.k, x: t.x, y: t.y, t: performance.now() });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      api.flyTo(n.id);
      await api.waitForIdle();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      live = false;
      await new Promise((r) => setTimeout(r, 40));
      const after = api.getTransform();
      const focus = api.getFocus();
      if (focus.id !== n.id && n.type !== 'enterprise') {
        fail('F3', `${n.id} focus landed on ${focus.id}`);
      }
      if (samples.length >= 3 && finite(before) && finite(after)) {
        smoothChecked += 1;
        const lo = Math.min(before.k, after.k);
        const hi = Math.max(before.k, after.k);
        const over = samples.some((s) => s.k < lo * 0.96 || s.k > hi * 1.04);
        if (over) fail('F1', `${n.id} scale overshoot`);
        const span = Math.abs(Math.log(Math.max(after.k, 1e-4)) - Math.log(Math.max(before.k, 1e-4)));
        let maxStep = 0;
        let fastFrames = false;
        for (let i = 1; i < samples.length; i++) {
          const dt = (samples[i].t || 0) - (samples[i - 1].t || 0);
          const dk = Math.abs(Math.log(Math.max(samples[i].k, 1e-4)) - Math.log(Math.max(samples[i - 1].k, 1e-4)));
          if (dt > 0 && dt < 50 && span > 0.02) {
            fastFrames = true;
            maxStep = Math.max(maxStep, dk / span);
          }
        }
        if (fastFrames && maxStep > 0.72) fail('F1', `${n.id} camera jump ${maxStep.toFixed(2)}`);
      }
      const pos = api.nodeScreenPos(n.id);
      const u = usable();
      if (pos && !pos.behind) {
        const dx = Math.abs(pos.x - u.cx) / u.w;
        const dy = Math.abs(pos.y - u.cy) / u.h;
        if (dx > 0.22 || dy > 0.22) fail('F4', `${n.id} off-centre dx ${dx.toFixed(2)} dy ${dy.toFixed(2)}`);
      } else fail('F4', `${n.id} has no screen position`);

      const pathOk = api.pathLinksVisible(n.id);
      const chip = api.getAposEdgeHint?.();
      const core = api.nodeScreenPos('ent-apos');
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      const coreIn = core && !core.behind && core.x > -30 && core.x < W + 30 && core.y > -30 && core.y < H + 30;
      if (!pathOk && !(chip && !coreIn)) fail('R1', `${n.id} path broken`);
      else if (!pathOk && chip) { /* indicated */ }
      else if (!pathOk) fail('R3', `${n.id} dangling path`);

      const sibs = nodes.filter((s) => s.parentId && s.parentId === n.parentId && s.id !== n.id && s.type === n.type && s.type !== 'branch' && s.type !== 'enterprise');
      sibs.forEach((s) => {
        if (!api.isNodeDrawn(s.id)) fail('R2', `${n.id} hid sibling ${s.id}`);
        else if ((api.getTransform().k || 1) >= 1.25 && api.getNodeAlpha(s.id) > 0.85) {
          fail('R2', `${n.id} sibling ${s.id} not dimmed (${api.getNodeAlpha(s.id).toFixed(2)})`);
        }
      });
      if (typeof api.countLinkCrossings === 'function' && api.countLinkCrossings() > 0) {
        fail('R4', `${n.id} crossings ${api.countLinkCrossings()}`);
      }

      const boxes = labelBoxes();
      boxes.forEach((b) => {
        if (!b.id || !byId.get(b.id)) return;
        const label = byId.get(b.id).label || '';
        if (label && !b.text.includes(label)) fail('R5', `${b.id} label "${b.text}" != "${label}"`);
      });
      overlapPairs(boxes).slice(0, 3).forEach((msg) => fail('R6', `${n.id} labels overlap ${msg}`));
      const focusAndKids = new Set([n.id, ...nodes.filter((c) => c.parentId === n.id).map((c) => c.id)]);
      boxes.forEach((b) => {
        if (!focusAndKids.has(b.id)) return;
        const u2 = usable();
        const inside = b.l >= u2.l - 2 && b.t >= u2.t - 2 && b.r <= u2.r + 2 && b.b <= u2.b + 2;
        if (!inside) fail('V2', `${n.id} clipped ${b.text.slice(0, 32)}`);
      });

      if (n.type === 'enterprise' || n.type === 'hub' || n.type === 'country') {
        const hubs = nodes.filter((h) => h.type === 'hub' || h.type === 'country');
        if (n.type === 'enterprise' && hubs.some((h) => !api.isNodeDrawn(h.id))) fail('V1', 'overview hid a hub');
      }
      if (n.type === 'client' || n.type === 'area' || n.type === 'country' || n.type === 'hub') {
        const kids = nodes.filter((c) => c.parentId === n.id && c.type !== 'branch');
        if (kids.length && kids.every((c) => !api.isNodeDrawn(c.id))) fail('V1', `${n.id} shows no children`);
      }
      if (n.type === 'machine') {
        const kids = nodes.filter((c) => c.parentId === n.id);
        if (kids.length) fail('V1', `${n.id} still has child nodes`);
        const facts = api.nodeFacts(n.id);
        const drawer = document.getElementById('insp-title')?.textContent || '';
        const gridRaw = document.getElementById('insp-grid')?.innerText || '';
        const gridFold = gridRaw.toLowerCase();
        if (facts && drawer && !drawer.includes(facts.label)) fail('V1', `${n.id} drawer title ${drawer}`);
        ['Overview', 'Performance', 'Stock', 'Support', 'Contract'].forEach((sec) => {
          if (!gridFold.includes(sec.toLowerCase())) fail('V1', `${n.id} missing ${sec}`);
        });
      }

      if (typeof api.refreshInspector === 'function') api.refreshInspector();
      const facts = api.nodeFacts(n.id);
      if (facts) {
        if (n.type !== 'machine' && facts.badge !== facts.alerts) fail('D2', `${n.id} badge ${facts.badge} != ${facts.alerts}`);
        if (n.type !== 'enterprise') {
          const grid = document.getElementById('insp-grid')?.innerText || '';
          if (!grid.includes(String(facts.alerts))) fail('D2', `${n.id} drawer alerts missing`);
          if (facts.revenueToday != null && !grid.includes(String(facts.revenueToday))) fail('D2', `${n.id} drawer revenue missing`);
          if (!grid.includes(String(facts.offline))) fail('D2', `${n.id} drawer offline missing`);
        }
      }

      api.goBack();
      await api.waitForIdle();
      const back = api.getTransform();
      const backFocus = api.getFocus().id;
      if (!finite(back) || Math.abs(back.k - before.k) > 0.02 || Math.abs(back.x - before.x) > 1.5 || Math.abs(back.y - before.y) > 1.5) {
        fail('F3', `${n.id} back transform`);
      }
      if (backFocus !== beforeFocus) fail('F3', `${n.id} back focus ${backFocus} != ${beforeFocus}`);

      if (api.setZoomK && (n.type === 'machine' || n.type === 'location')) {
        api.flyTo(n.id);
        await api.waitForIdle();
        const sibBefore = sibs.filter((s) => api.isNodeDrawn(s.id)).length;
        api.setZoomK(0.5);
        await new Promise((r) => setTimeout(r, 40));
        const hubs = nodes.filter((h) => (h.type === 'hub' || h.type === 'country') && !h.id.includes('pad'));
        if (hubs.length && hubs.some((h) => !api.isNodeDrawn(h.id))) fail('F5', `${n.id} zoom-out hid hub`);
        if (sibs.length && sibBefore === 0) fail('F5', `${n.id} siblings were already hidden`);
      }
    }

    if (api.setHudMode) {
      api.setHudMode(true);
      await new Promise((r) => setTimeout(r, 800));
      const stat = document.getElementById('hud-live-stat')?.textContent || '';
      const ent = api.nodeFacts('ent-apos');
      if (ent && stat) {
        if (!stat.includes(String(ent.alerts))) fail('D2', `HUD alerts ${stat}`);
        const rounded = String(Math.round(ent.revenueToday || 0));
        if (!stat.includes(rounded)) fail('D2', `HUD revenue ${stat}`);
      }
      api.setHudMode(false);
    }

    const stats = api.getFrameStats();
    return { fails, dataIssues, smoothChecked, stats, nodeCount: targets.length };
  }, { apiName: pageDef.api, limit: Number(process.env.APOS_LIMIT || 0) });

  note(score, 'D1', result.dataIssues.length === 0, result.dataIssues.slice(0, 4).join('; ') || 'ok');
  note(score, 'D4', result.dataIssues.length === 0, result.dataIssues.filter((s) => /fill|revenue|label|NaN/.test(s)).join('; ') || 'ok');
  const grouped = {};
  result.fails.forEach((f) => { grouped[f.code] = grouped[f.code] || []; grouped[f.code].push(f.msg); });
  ['F1', 'F3', 'F4', 'F5', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'C1', 'D2', 'V1', 'V2'].forEach((code) => {
    const msgs = grouped[code] || [];
    if (!msgs.length) note(score, code, true, 'ok');
    else msgs.slice(0, 6).forEach((m) => note(score, code, false, m));
  });
  note(score, 'F2', result.stats.median <= 16 && result.stats.n >= 8, `median ${result.stats.median} n ${result.stats.n}`);
  return result;
}

async function liveRevert(page, pageDef, score) {
  const ok = await page.evaluate(async (apiName) => {
    const api = window[apiName];
    if (api.setLive) api.setLive(false);
    api.reset();
    await api.waitForIdle();
    const target = api.listNodes().find((n) => n.id === 'm-ku-1') || api.listNodes().find((n) => n.type === 'machine');
    const before = api.nodeFacts(target.id);
    const entBefore = api.nodeFacts('ent-apos');
    api.emitTestEvent(target.id, 'offline');
    const mid = api.nodeFacts(target.id);
    const entMid = api.nodeFacts('ent-apos');
    const bumped = mid?.status === 'offline' && entMid.alerts >= entBefore.alerts;
    await new Promise((r) => setTimeout(r, 9300));
    const after = api.nodeFacts(target.id);
    const reverted = after && before && after.status === before.status && after.alerts === before.alerts;
    const fillBefore = after?.stockPct;
    api.emitTestEvent(target.id, 'lowstock');
    const low = api.nodeFacts(target.id);
    const dropped = low && low.stockPct != null && low.stockPct < 15;
    await new Promise((r) => setTimeout(r, 9300));
    const restored = api.nodeFacts(target.id);
    const fillBack = restored && fillBefore != null && restored.stockPct === fillBefore;
    return { bumped, reverted, dropped, fillBack, id: target.id, before: before?.status, after: after?.status, fillBefore, fillAfter: restored?.stockPct };
  }, pageDef.api);
  note(score, 'D3', ok.bumped && ok.reverted && ok.dropped && ok.fillBack, JSON.stringify(ok));
}

async function stress(page, pageDef, score) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const inPage = page.evaluate(async (apiName) => {
    const api = window[apiName];
    const nodes = api.listNodes().filter((n) => n.type !== 'branch');
    const pick = () => nodes[Math.floor(Math.random() * nodes.length)];
    for (let i = 0; i < 160; i++) {
      const k = i % 5;
      if (k === 0) api.flyTo(pick().id);
      else if (k === 1) api.goBack();
      else if (k === 2 && api.setZoomK) api.setZoomK(0.35 + Math.random() * 4);
      else if (k === 3) api.goBack();
      else api.flyTo(pick().id);
      if (i % 11 === 0) {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      await new Promise((r) => setTimeout(r, i % 4 === 0 ? 16 : 8));
    }
    api.reset();
    await api.waitForIdle();
    return 'in-page';
  }, pageDef.api).catch((e) => { errors.push(String(e)); return 'in-page-error'; });
  const timed = await Promise.race([
    inPage,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 150000)),
  ]);
  if (timed !== 'in-page') {
    errors.push(`stress in-page ${timed}`);
    note(score, 'B1', false, errors.slice(0, 2).join(' | '));
    await page.goto(`${BASE}/${pageDef.file}?fly=220`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    return;
  }
  const box = await page.locator('.tree-stage, .space-stage, .map3d-stage').boundingBox();
  for (let i = 0; i < 40; i++) {
    if (!box) break;
    if (i % 4 === 0) await page.mouse.wheel(0, (i % 8 === 0 ? -1 : 1) * 480);
    else if (i % 4 === 1) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45, { timeout: 2500 }).catch(() => {});
    else if (i % 4 === 2) await page.keyboard.press('Escape');
    else await page.setViewportSize(i % 8 === 0 ? { width: 1366, height: 768 } : { width: 1920, height: 1080 });
    if (i % 3 === 0) await page.evaluate((apiName) => window[apiName].flyTo(window[apiName].listNodes().find((n) => n.type === 'machine')?.id), pageDef.api);
  }
  await page.evaluate(async (apiName) => {
    const api = window[apiName];
    if (api.waitForIdle) await api.waitForIdle();
  }, pageDef.api);
  const state = await page.evaluate((apiName) => {
    const api = window[apiName];
    const t = api.getTransform();
    const focus = api.getFocus();
    const audit = api.auditData();
    const known = api.listNodes().some((n) => n.id === focus.id);
    return {
      known,
      finite: [t.k, t.x, t.y].every((v) => Number.isFinite(v)),
      audit: audit.slice(0, 4),
    };
  }, pageDef.api);
  const ok = errors.length === 0 && state.known && state.finite && state.audit.length === 0;
  note(score, 'B1', ok, ok ? 'ok' : `${errors.slice(0, 2).join(' | ')} ${JSON.stringify(state)}`);
}

async function stills(page, pageDef) {
  const dir = join(ARTIFACTS, 'acceptance-stills');
  mkdirSync(dir, { recursive: true });
  const picks = await page.evaluate((apiName) => {
    const nodes = window[apiName].listNodes();
    const brand = nodes.find((n) => n.type === 'client') || nodes.find((n) => n.type === 'country');
    const area = nodes.find((n) => n.type === 'area') || nodes.find((n) => n.type === 'location');
    const machine = nodes.find((n) => n.id === 'm-ee-4') || nodes.find((n) => n.type === 'machine');
    return { brand: brand?.id, area: area?.id, machine: machine?.id };
  }, pageDef.api);
  const shots = [];
  const take = async (name, id) => {
    if (id) {
      await page.evaluate(async ({ apiName, id }) => {
        window[apiName].flyTo(id);
        await window[apiName].waitForIdle();
      }, { apiName: pageDef.api, id });
      await page.waitForTimeout(200);
    }
    const file = join(dir, `${pageDef.id}-${name}.png`);
    try {
      await page.screenshot({ path: file, timeout: 8000, animations: 'disabled' });
    } catch {
      const url = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? c.toDataURL('image/png') : '';
      });
      if (!url.startsWith('data:image')) throw new Error(`still failed ${name}`);
      writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    }
    shots.push(file);
  };
  await page.evaluate(async (apiName) => { window[apiName].reset(); await window[apiName].waitForIdle(); }, pageDef.api);
  await take('overview');
  await take('brand', picks.brand);
  await take('area', picks.area);
  await take('machine', picks.machine);
  await page.evaluate(async (apiName) => { window[apiName].goBack(); await window[apiName].waitForIdle(); }, pageDef.api);
  await take('zoom-out');
  return shots;
}

function composeGrid(files, dest) {
  const py = `
import sys
from PIL import Image
files = sys.argv[1:-1]
dest = sys.argv[-1]
cols, rows = 5, 3
cell = (480, 270)
canvas = Image.new('RGB', (cols*cell[0], rows*cell[1]), (17,17,17))
for i, f in enumerate(files[:15]):
    im = Image.open(f).convert('RGB').resize(cell)
    canvas.paste(im, ((i % cols) * cell[0], (i // cols) * cell[1]))
canvas.save(dest)
`;
  const r = spawnSync('python3', ['-c', py, ...files, dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'grid failed');
}

async function runBrowser(browserType, browserName, viewport, { full, doStress, doLive, doStills }) {
  const browser = await browserType.launch({ headless: true });
  const scores = {};
  const stillFiles = [];
  try {
    for (const pageDef of PAGES) {
      const score = blankScore();
      scores[pageDef.id] = score;
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      page.on('pageerror', (e) => consoleErrors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      console.log(`\n${browserName} ${viewport.width}x${viewport.height} ${pageDef.id}`);
      await boot(page, pageDef);
      if (full) {
        const walked = await walk(page, pageDef, score);
        console.log(`  nodes ${walked.nodeCount} smooth ${walked.smoothChecked} fails ${walked.fails.length} data ${walked.dataIssues.length}`);
        walked.fails.slice(0, 12).forEach((f) => console.log(`  ${f.code} ${f.msg}`));
        walked.dataIssues.slice(0, 6).forEach((d) => console.log(`  data ${d}`));
      } else {
        const sample = await page.evaluate(async (apiName) => {
          const api = window[apiName];
          const nodes = api.listNodes();
          const ids = [
            nodes.find((n) => n.type === 'enterprise')?.id,
            nodes.find((n) => n.type === 'client' || n.type === 'country')?.id,
            nodes.find((n) => n.type === 'area')?.id,
            (nodes.find((n) => n.id === 'm-ee-4') || nodes.find((n) => n.type === 'machine'))?.id,
          ].filter(Boolean);
          const issues = [];
          for (const id of ids) {
            api.flyTo(id);
            await api.waitForIdle();
            const pos = api.nodeScreenPos(id);
            const f = api.getUsableFrame();
            if (!pos || Math.abs(pos.x - f.cx) / f.w > 0.28 || Math.abs(pos.y - f.cy) / f.h > 0.28) {
              issues.push(`${id} centre`);
            }
            if (!api.pathLinksVisible(id) && !api.getAposEdgeHint?.()) issues.push(`${id} path`);
            const keep = new Set([id, ...nodes.filter((c) => c.parentId === id).map((c) => c.id)]);
            const boxes = [...document.querySelectorAll('.node-label-dom, .m3d-label, .focus-title')].map((el) => {
              const nid = el.dataset.nid || '';
              if (nid && !keep.has(nid) && !el.classList.contains('focus-title')) return null;
              const r = el.getBoundingClientRect();
              const st = getComputedStyle(el);
              if (st.display === 'none' || Number(st.opacity) < 0.2 || r.width < 2) return null;
              return r;
            }).filter(Boolean);
            const stage = document.querySelector('.tree-stage, .space-stage, .map3d-stage').getBoundingClientRect();
            const L = stage.left + f.x;
            const T = stage.top + f.y;
            const R = L + f.w;
            const B = T + f.h;
            boxes.forEach((r) => {
              if (r.right > R + 4 || r.bottom > B + 4 || r.left < L - 4 || r.top < T - 4) issues.push('clip');
            });
          }
          api.goBack();
          await api.waitForIdle();
          return { issues, audit: api.auditData() };
        }, pageDef.api);
        note(score, 'V3', sample.issues.length === 0 && sample.audit.length === 0, sample.issues.concat(sample.audit).slice(0, 4).join('; ') || 'ok');
        console.log(`  sample ${sample.issues.length} ${sample.audit.length} ${sample.issues.slice(0, 3).join(' | ')}`);
      }
      if (doLive) {
        console.log('  live');
        await liveRevert(page, pageDef, score);
      }
      if (doStress) {
        console.log('  stress');
        await stress(page, pageDef, score);
      }
      if (doStills) {
        console.log('  stills');
        stillFiles.push(...await stills(page, pageDef));
      }
      if (consoleErrors.length) note(score, 'B1', false, consoleErrors.slice(0, 2).join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { scores, stillFiles };
}

function tally(scores) {
  const out = {};
  for (const [page, score] of Object.entries(scores)) {
    let pass = 0;
    let fail = 0;
    const failed = [];
    for (const [code, row] of Object.entries(score)) {
      if (row.fail > 0) { fail += 1; failed.push(`${code}(${row.fail})`); }
      else if (row.pass > 0) pass += 1;
    }
    out[page] = { pass, fail, failed };
  }
  return out;
}

const only = process.env.APOS_PAGES;
const pagesFilter = only ? only.split(',') : null;
if (pagesFilter) {
  for (let i = PAGES.length - 1; i >= 0; i--) if (!pagesFilter.includes(PAGES[i].id)) PAGES.splice(i, 1);
}

const mode = process.env.APOS_MODE || 'full';
const primary = await runBrowser(chromium, 'chromium', { width: 1920, height: 1080 }, {
  full: mode === 'full',
  doStress: mode === 'full',
  doLive: mode === 'full' || mode === 'live',
  doStills: mode === 'full',
});
const matrix = [];
if (mode === 'full' || mode === 'matrix') {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 2560, height: 1440 }]) {
    matrix.push(['chromium', viewport, await runBrowser(chromium, 'chromium', viewport, { full: false })]);
  }
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    matrix.push(['firefox', viewport, await runBrowser(firefox, 'firefox', viewport, { full: false })]);
  }
  for (const page of PAGES) {
    note(primary.scores[page.id], 'V3', matrix.every((m) => (m[2].scores[page.id].V3?.fail || 0) === 0), 'viewport matrix');
    note(primary.scores[page.id], 'V4', matrix.filter((m) => m[0] === 'firefox').every((m) => (m[2].scores[page.id].V3?.fail || 0) === 0), 'firefox');
  }
}

const gridPath = join(ARTIFACTS, 'acceptance-stills-grid.png');
if (primary.stillFiles.length) await composeGrid(primary.stillFiles, gridPath);

const report = {
  tally: tally(primary.scores),
  scores: primary.scores,
  matrix: matrix.map(([name, vp, res]) => ({ name, vp, tally: tally(res.scores) })),
  grid: gridPath,
};
writeFileSync(join(ARTIFACTS, 'acceptance-report.json'), JSON.stringify(report, null, 2));
console.log('\nTALLY');
console.log(JSON.stringify(report.tally, null, 2));
console.log('grid', gridPath);
