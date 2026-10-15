/**
 * APOS 3D Constellation — three.js radial org map (Gemini-inspired, APOS hierarchy).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const DATA = window.APOS_SPACE_DATA;
const UTILS = window.APOS_MAP_UTILS || {};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = {
  core: 0xffffff,
  teal: 0x00f2fe,
  mint: 0x05ffa1,
  amber: 0xffaa00,
  magenta: 0xff2a85,
  indigo: 0x9d4edd,
  sky: 0x7ec8e8,
  dim: 0x3a4a5c,
};

const RING = { 'country-kw': COLORS.teal, 'country-sa': COLORS.amber, 'country-ae': COLORS.sky };

function buildGraph() {
  const nodes = [];
  const links = [];
  const byId = new Map();
  const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };

  const core = add({
    id: DATA.enterprise.id,
    type: 'enterprise',
    label: 'APOS',
    depth: 0,
    color: COLORS.core,
    r: 2.4,
  });

  const countries = (DATA.countries || []).slice().sort((a, b) => {
    if (a.id === 'country-kw') return -1;
    if (b.id === 'country-kw') return 1;
    return 0;
  });
  const nC = Math.max(countries.length, 3);
  countries.forEach((c, i) => {
    const a = -Math.PI / 2 + (i / nC) * Math.PI * 2;
    const country = add({
      id: c.id,
      type: 'country',
      label: c.code || c.label,
      subtitle: c.status === 'future' ? 'planned' : 'live',
      status: c.status,
      depth: 1,
      angle: a,
      orbit: 14,
      y: 0,
      color: RING[c.id] || COLORS.indigo,
      r: 1.1,
      parentId: core.id,
    });
    links.push({ source: core.id, target: country.id, kind: 'spine' });

    (c.clients || []).forEach((cl, ci, arr) => {
      const fan = ((ci + 0.5) / Math.max(arr.length, 1) - 0.5) * 1.1;
      const brand = add({
        id: cl.id,
        type: 'client',
        label: cl.label || cl.brand,
        depth: 2,
        angle: a + fan,
        orbit: 22,
        y: 1.5 + (ci % 3) * 0.4,
        color: country.color,
        r: 0.7,
        parentId: country.id,
        countryId: country.id,
        comingSoon: !!cl.comingSoon,
      });
      links.push({ source: country.id, target: brand.id, kind: 'tree' });

      (cl.areas || []).forEach((area, ai, aarr) => {
        const af = ((ai + 0.5) / Math.max(aarr.length, 1) - 0.5) * 0.7;
        const an = add({
          id: area.id,
          type: 'area',
          label: area.label,
          depth: 3,
          angle: brand.angle + af,
          orbit: 30,
          y: brand.y + (ai % 2 ? 0.8 : -0.4),
          color: country.color,
          r: 0.45,
          parentId: brand.id,
          countryId: country.id,
          clientId: brand.id,
        });
        links.push({ source: brand.id, target: an.id, kind: 'tree' });

        (area.locations || []).forEach((loc, li, larr) => {
          const lf = ((li + 0.5) / Math.max(larr.length, 1) - 0.5) * 0.45;
          const ln = add({
            id: loc.id,
            type: 'location',
            label: loc.label,
            depth: 4,
            angle: an.angle + lf,
            orbit: 36,
            y: an.y + (li % 2 ? 0.5 : -0.3),
            color: 0xddeeff,
            r: 0.32,
            parentId: an.id,
            countryId: country.id,
            clientId: brand.id,
            alert: !!(loc.machines || []).some((m) => m.alert),
          });
          links.push({ source: an.id, target: ln.id, kind: 'tree' });

          (loc.machines || []).forEach((m, mi, marr) => {
            const mf = ((mi + 0.5) / Math.max(marr.length, 1) - 0.5) * 0.35;
            const mn = add({
              id: m.id,
              type: 'machine',
              label: m.label,
              depth: 5,
              angle: ln.angle + mf,
              orbit: 41,
              y: ln.y + (mi % 2 ? 0.35 : -0.2),
              color: m.alert ? COLORS.magenta : 0xffffff,
              r: 0.22,
              parentId: ln.id,
              countryId: country.id,
              clientId: brand.id,
              alert: !!m.alert,
              revenue: m.revenue,
            });
            links.push({ source: ln.id, target: mn.id, kind: 'tree' });
            // Signal arcs: alert machines ↔ abstract tech lane
            if (m.alert) {
              links.push({
                source: brand.id,
                target: mn.id,
                kind: 'signal',
                alert: true,
              });
            }
          });
        });
      });
    });
  });

  // Place in 3D
  nodes.forEach((n) => {
    if (n.type === 'enterprise') {
      n.pos = new THREE.Vector3(0, 0, 0);
      return;
    }
    const ang = n.angle || 0;
    const orbit = n.orbit || 12;
    n.pos = new THREE.Vector3(Math.cos(ang) * orbit, n.y || 0, Math.sin(ang) * orbit);
  });

  return { nodes, links, byId, core };
}

function curvePoints(a, b, core, segments = 24) {
  const p0 = a.clone();
  const p3 = b.clone();
  const p1 = p0.clone().add(p0.clone().sub(core).multiplyScalar(0.25));
  const p2 = p3.clone().sub(p3.clone().sub(core).multiplyScalar(0.25));
  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  return curve.getPoints(segments);
}

function mount() {
  const stage = document.getElementById('map3d-stage');
  const canvas = document.getElementById('map3d-canvas');
  const graph = buildGraph();
  const meshes = new Map();
  const linkLines = [];
  const signalPackets = [];

  let focusId = graph.core.id;
  let expanded = new Set([graph.core.id, ...graph.nodes.filter((n) => n.depth <= 2).map((n) => n.id)]);
  let flying = false;
  let hudMode = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x04080e, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  camera.position.set(0, 18, 48);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 8;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0x6688aa, 0.55);
  scene.add(ambient);
  const key = new THREE.PointLight(0x00f2fe, 1.1, 120);
  key.position.set(8, 16, 10);
  scene.add(key);
  const fill = new THREE.PointLight(0x05ffa1, 0.35, 100);
  fill.position.set(-12, -4, -8);
  scene.add(fill);

  // Stars
  {
    const N = 250;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.35, transparent: true, opacity: 0.55 });
    scene.add(new THREE.Points(geo, mat));
  }

  // Orbit guide rings
  [14, 22, 36].forEach((r) => {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      dashSize: 0.35,
      gapSize: 0.55,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    scene.add(line);
  });

  // Core galaxy
  const coreGroup = new THREE.Group();
  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 })
  );
  coreGroup.add(coreGlow);
  const coreBall = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88aacc, emissiveIntensity: 0.65, roughness: 0.2 })
  );
  coreGroup.add(coreBall);
  // Particle shell
  {
    const N = 120;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const rad = 2.2 + t * 2.4;
      const a = t * Math.PI * 6;
      pos[i * 3] = Math.cos(a) * rad;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
      pos[i * 3 + 2] = Math.sin(a) * rad;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    coreGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x00f2fe, size: 0.12, transparent: true, opacity: 0.85 })));
  }
  // Wordmark sprite
  const loader = new THREE.TextureLoader();
  loader.load('assets/apos-wordmark.png', (tex) => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(5.2, 1.35, 1);
    spr.position.y = 0.15;
    coreGroup.add(spr);
  });
  scene.add(coreGroup);
  meshes.set(graph.core.id, { mesh: coreGroup, node: graph.core });

  // Nodes
  graph.nodes.forEach((n) => {
    if (n.type === 'enterprise') return;
    const geo = new THREE.SphereGeometry(n.r, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: n.color,
      emissive: n.color,
      emissiveIntensity: n.alert ? 0.55 : 0.22,
      metalness: 0.15,
      roughness: 0.45,
      transparent: true,
      opacity: n.status === 'future' ? 0.35 : 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(n.pos);
    mesh.userData.nodeId = n.id;
    scene.add(mesh);
    // Label sprite (canvas)
    const label = makeLabelSprite(n.label, n.depth <= 1);
    label.position.copy(n.pos).add(new THREE.Vector3(0, n.r + 0.55, 0));
    scene.add(label);
    meshes.set(n.id, { mesh, label, node: n });
  });

  // Links
  const corePos = new THREE.Vector3(0, 0, 0);
  graph.links.forEach((L) => {
    const a = graph.byId.get(L.source);
    const b = graph.byId.get(L.target);
    if (!a || !b) return;
    const pts = curvePoints(a.pos.clone(), b.pos.clone(), corePos, L.kind === 'signal' ? 32 : 20);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: L.alert ? COLORS.magenta : L.kind === 'spine' ? 0x8899aa : a.color || 0x88aacc,
      transparent: true,
      opacity: L.kind === 'signal' ? 0.55 : 0.28,
    });
    const line = new THREE.Line(geo, mat);
    line.userData = { ...L, pts };
    scene.add(line);
    linkLines.push(line);
    if (L.kind === 'signal') {
      const pkt = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: COLORS.magenta })
      );
      scene.add(pkt);
      signalPackets.push({ mesh: pkt, line, t: Math.random() });
    }
  });

  // Bloom (subtle)
  let composer = null;
  function buildComposer() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.6, 0.85);
    composer.addPass(bloom);
  }

  function resize() {
    const w = stage.clientWidth || 1200;
    const h = stage.clientHeight || 800;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    else buildComposer();
  }
  resize();
  window.addEventListener('resize', resize);

  function makeLabelSprite(text, hub) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = hub ? '600 28px IBM Plex Sans, sans-serif' : '500 22px IBM Plex Sans, sans-serif';
    ctx.fillStyle = hub ? '#e8f7ff' : '#8fa8c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 4;
    ctx.strokeText(String(text).toUpperCase(), 128, 32);
    ctx.fillText(String(text).toUpperCase(), 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(hub ? 4.2 : 2.6, hub ? 1.05 : 0.65, 1);
    return spr;
  }

  function applyLod() {
    const dist = camera.position.distanceTo(controls.target);
    const z = THREE.MathUtils.clamp(55 / dist, 0.4, 4);
    meshes.forEach(({ mesh, label, node }) => {
      if (node.type === 'enterprise') return;
      const onPath = expanded.has(node.id) || focusPath().has(node.id);
      const show = node.depth <= 2 || onPath || z > 1.2;
      mesh.visible = show;
      if (label) {
        let op = 0;
        if (node.depth <= 1) op = 1;
        else if (z < 1.4) op = 0;
        else if (z < 2.0) op = (z - 1.4) / 0.6;
        else op = 1;
        if (!onPath && node.depth > 2 && z > 2.6) op *= 0.08;
        label.material.opacity = show ? op : 0;
        label.visible = show && op > 0.05;
      }
      if (!onPath && focusId !== graph.core.id && node.depth > 1) {
        mesh.material.opacity = THREE.MathUtils.clamp(0.1, 0.08, 0.95);
      } else {
        mesh.material.opacity = node.status === 'future' ? 0.35 : 0.95;
      }
    });
    linkLines.forEach((line) => {
      const s = graph.byId.get(line.userData.source);
      const t = graph.byId.get(line.userData.target);
      const hot = focusPath().has(line.userData.source) && focusPath().has(line.userData.target);
      line.visible = !!(meshes.get(s?.id)?.mesh.visible && meshes.get(t?.id)?.mesh.visible);
      line.material.opacity = hot ? 0.7 : line.userData.kind === 'signal' ? 0.45 : 0.18;
    });
  }

  function focusPath() {
    const set = new Set();
    let n = graph.byId.get(focusId);
    while (n) {
      set.add(n.id);
      n = n.parentId ? graph.byId.get(n.parentId) : null;
    }
    set.add(graph.core.id);
    return set;
  }

  function setExpandedTo(id) {
    expanded = new Set([graph.core.id]);
    let n = graph.byId.get(id);
    const stack = [];
    while (n) {
      stack.push(n.id);
      n = n.parentId ? graph.byId.get(n.parentId) : null;
    }
    stack.reverse().forEach((x) => expanded.add(x));
    // include children of focus
    graph.nodes.forEach((c) => {
      if (c.parentId === id) expanded.add(c.id);
    });
    // always show L1/L2
    graph.nodes.forEach((c) => {
      if (c.depth <= 2) expanded.add(c.id);
    });
  }

  function flyTo(id) {
    const n = graph.byId.get(id) || graph.core;
    focusId = n.id;
    setExpandedTo(n.id);
    const target = n.pos.clone();
    const dist = n.type === 'enterprise' ? 48 : Math.max(10, 28 - n.depth * 3);
    const endCam = target.clone().add(new THREE.Vector3(dist * 0.35, dist * 0.45, dist * 0.85));
    const startCam = camera.position.clone();
    const startTarget = controls.target.clone();
    flying = true;
    const dur = reduceMotion ? 0 : n.type === 'enterprise' ? 550 : 900;
    const t0 = performance.now();
    function step(now) {
      const u = dur === 0 ? 1 : Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - u, 3);
      camera.position.lerpVectors(startCam, endCam, e);
      controls.target.lerpVectors(startTarget, target, e);
      controls.update();
      if (u < 1) requestAnimationFrame(step);
      else {
        flying = false;
        renderBreadcrumb();
        openInspectorFor(n);
      }
    }
    requestAnimationFrame(step);
    applyLod();
  }

  function openInspectorFor(n) {
    const d = document.getElementById('inspector-drawer');
    if (!d) return;
    document.getElementById('insp-kicker').textContent = n.type;
    document.getElementById('insp-title').textContent = n.label;
    const grid = document.getElementById('insp-grid');
    grid.innerHTML = '';
    const rows = [
      ['Id', n.id],
      ['Depth', String(n.depth)],
      ['Status', n.status || (n.alert ? 'alert' : 'ok')],
    ];
    if (n.revenue) {
      rows.push(['Today', `${n.revenue.today} KWD`]);
      rows.push(['Monthly', `${n.revenue.monthly} KWD`]);
    }
    rows.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'insp-row';
      row.innerHTML = `<span>${k}</span><span>${v}</span>`;
      grid.appendChild(row);
    });
    d.classList.add('is-open');
  }

  function renderBreadcrumb() {
    const ol = document.getElementById('crumb-list');
    if (!ol) return;
    ol.innerHTML = '';
    const path = [];
    let n = graph.byId.get(focusId);
    while (n) {
      path.unshift(n);
      n = n.parentId ? graph.byId.get(n.parentId) : null;
    }
    path.forEach((p, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.type === 'enterprise' ? 'APOS' : p.label;
      if (i === path.length - 1) btn.classList.add('is-current');
      btn.addEventListener('click', () => flyTo(p.id));
      li.appendChild(btn);
      ol.appendChild(li);
    });
  }

  // Picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const objs = [...meshes.values()].map((m) => m.mesh).filter((m) => m.visible && m.isMesh);
    const hits = raycaster.intersectObjects(objs, false);
    if (hits[0]) {
      const id = hits[0].object.userData.nodeId;
      if (id) flyTo(id);
    }
  });

  // UI
  document.querySelectorAll('.zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'reset') flyTo(graph.core.id);
      else if (a === 'zoom-in') camera.position.multiplyScalar(0.85);
      else if (a === 'zoom-out') camera.position.multiplyScalar(1.18);
    });
  });
  document.querySelector('[data-dir="prev"]')?.addEventListener('click', () => {
    const n = graph.byId.get(focusId);
    if (n?.parentId) flyTo(n.parentId);
    else flyTo(graph.core.id);
  });
  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      hudMode = btn.dataset.view === 'hud';
      document.getElementById('map3d-app').classList.toggle('hud-mode', hudMode);
      ['hud-left', 'hud-right', 'hud-bottom'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = !hudMode;
      });
    });
  });
  document.querySelector('.insp-close')?.addEventListener('click', () => {
    document.getElementById('inspector-drawer')?.classList.remove('is-open');
  });

  // Terminal
  const term = document.getElementById('terminal-overlay');
  document.getElementById('map3d-task-btn')?.addEventListener('click', () => {
    const n = graph.byId.get(focusId);
    document.getElementById('term-assignee').textContent = n?.label || 'field ops';
    term.hidden = false;
  });
  document.getElementById('terminal-close')?.addEventListener('click', () => { term.hidden = true; });
  document.getElementById('term-send')?.addEventListener('click', () => {
    const desc = document.getElementById('term-task').value.trim();
    document.getElementById('term-log').textContent = desc ? `queued · ${desc.slice(0, 48)}` : 'empty task';
  });

  // HUD lists
  const clients = graph.nodes.filter((n) => n.type === 'client');
  const ul = document.getElementById('hud-clients');
  if (ul) {
    clients.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c.label + (c.comingSoon ? ' · soon' : '');
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => flyTo(c.id));
      ul.appendChild(li);
    });
  }
  const alerts = graph.nodes.filter((n) => n.alert).slice(0, 8);
  const ua = document.getElementById('hud-alerts');
  if (ua) {
    alerts.forEach((a) => {
      const li = document.createElement('li');
      li.textContent = `${a.label} · alert`;
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => flyTo(a.id));
      ua.appendChild(li);
    });
    if (!alerts.length) {
      const li = document.createElement('li');
      li.textContent = 'No active alerts';
      ua.appendChild(li);
    }
  }

  const clock = new THREE.Clock();
  function tick() {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    if (!flying) controls.update();
    coreGroup.rotation.y = t * 0.08;
    signalPackets.forEach((p) => {
      p.t = (p.t + dt * 0.35) % 1;
      const pts = p.line.userData.pts;
      if (!pts?.length) return;
      const i = Math.floor(p.t * (pts.length - 1));
      const a = pts[i];
      const b = pts[Math.min(i + 1, pts.length - 1)];
      const f = p.t * (pts.length - 1) - i;
      p.mesh.position.lerpVectors(a, b, f);
      p.mesh.visible = p.line.visible;
    });
    applyLod();
    if (composer) composer.render();
    else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  renderBreadcrumb();
  applyLod();
  requestAnimationFrame(tick);

  const api = {
    getFocus: () => {
      const n = graph.byId.get(focusId);
      return {
        id: focusId,
        type: n?.type,
        level: n?.depth ?? 0,
        overview: focusId === graph.core.id,
        machineId: n?.type === 'machine' ? n.id : undefined,
        locationId: n?.type === 'location' ? n.id : n?.parentId,
        hubId: n?.countryId,
        countryId: n?.countryId,
        clientId: n?.clientId,
      };
    },
    flyTo: (id) => flyTo(id),
    reset: () => flyTo(graph.core.id),
    goBack: () => {
      const n = graph.byId.get(focusId);
      flyTo(n?.parentId || graph.core.id);
    },
    waitForIdle: () =>
      new Promise((resolve) => {
        const check = () => {
          if (!flying) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    isFlying: () => flying,
    isHudMode: () => hudMode,
    setHudMode: (on) => {
      hudMode = !!on;
      document.querySelector(`.toggle-btn[data-view="${on ? 'hud' : 'graph'}"]`)?.click();
    },
    isTerminalOpen: () => !term.hidden,
    openTerminal: () => { term.hidden = false; },
    closeTerminal: () => { term.hidden = true; },
    nodeCount: () => graph.nodes.length,
    getTransform: () => ({
      k: 55 / camera.position.distanceTo(controls.target),
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    }),
  };

  window.APOS_3D_MAP = api;
  window.__APOS_3D_READY__ = true;
  window.__APOS_MAP_READY__ = true;
  return api;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
