/**
 * APOS 3D Constellation — marketing-grade radial org (Gemini-inspired).
 * Core galaxy + tilted orbits + Bézier tree links + screen-space labels + HUD.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const DATA = window.APOS_SPACE_DATA;
const BRANCHES = window.APOS_SPACE_BRANCHES || [];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = {
  core: 0xffffff,
  teal: 0x00f2fe,
  mint: 0x05ffa1,
  amber: 0xffaa00,
  magenta: 0xff2a85,
  indigo: 0x9d4edd,
  sky: 0x7ec8e8,
  white: 0xe8f4ff,
};

const RING = { 'country-kw': COLORS.teal, 'country-sa': COLORS.amber, 'country-ae': COLORS.sky };
const ORBIT_TILT = THREE.MathUtils.degToRad(24);

function buildGraph() {
  const nodes = [];
  const links = [];
  const byId = new Map();
  const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };

  const core = add({
    id: DATA.enterprise.id, type: 'enterprise', label: 'APOS', depth: 0, color: COLORS.core, r: 2.2,
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
      id: c.id, type: 'country', label: c.code || c.label,
      subtitle: c.status === 'future' ? 'planned' : 'live', status: c.status,
      depth: 1, angle: a, orbit: 16, color: RING[c.id] || COLORS.indigo, r: 1.15, parentId: core.id,
    });
    links.push({ source: core.id, target: country.id, kind: 'spine' });

    (c.clients || []).forEach((cl, ci, arr) => {
      const fan = ((ci + 0.5) / Math.max(arr.length, 1) - 0.5) * 0.95;
      const brand = add({
        id: cl.id, type: 'client', label: cl.label || cl.brand, depth: 2,
        angle: a + fan, orbit: 26, color: country.color, r: 0.72,
        parentId: country.id, countryId: country.id, comingSoon: !!cl.comingSoon,
      });
      links.push({ source: country.id, target: brand.id, kind: 'tree' });

      (cl.areas || []).forEach((area, ai, aarr) => {
        const af = ((ai + 0.5) / Math.max(aarr.length, 1) - 0.5) * 0.55;
        const an = add({
          id: area.id, type: 'area', label: area.label, depth: 3,
          angle: brand.angle + af, orbit: 34, color: country.color, r: 0.48,
          parentId: brand.id, countryId: country.id, clientId: brand.id,
        });
        links.push({ source: brand.id, target: an.id, kind: 'tree' });

        (area.locations || []).forEach((loc, li, larr) => {
          const lf = ((li + 0.5) / Math.max(larr.length, 1) - 0.5) * 0.4;
          const ln = add({
            id: loc.id, type: 'location', label: loc.label, depth: 4,
            angle: an.angle + lf, orbit: 40, color: COLORS.white, r: 0.36,
            parentId: an.id, countryId: country.id, clientId: brand.id,
            alert: !!(loc.machines || []).some((m) => m.alert),
          });
          links.push({ source: an.id, target: ln.id, kind: 'tree' });

          (loc.machines || []).forEach((m, mi, marr) => {
            const mf = ((mi + 0.5) / Math.max(marr.length, 1) - 0.5) * 0.32;
            const mn = add({
              id: m.id, type: 'machine', label: m.label, depth: 5,
              angle: ln.angle + mf, orbit: 45,
              color: m.alert ? COLORS.magenta : COLORS.white, r: 0.28,
              parentId: ln.id, countryId: country.id, clientId: brand.id,
              alert: !!m.alert, revenue: m.revenue, stock: m.stock,
              technical: m.technical, operators: m.operators, contract: m.contract,
            });
            links.push({ source: ln.id, target: mn.id, kind: 'tree' });

            BRANCHES.forEach((b, bi) => {
              const ba = mn.angle + ((bi + 0.5) / BRANCHES.length - 0.5) * 0.85;
              add({
                id: `${m.id}::${b.id}`, type: 'branch', branchId: b.id, label: b.label, depth: 6,
                angle: ba, orbit: 49, color: COLORS.mint, r: 0.18,
                parentId: mn.id, countryId: country.id, clientId: brand.id, machineId: m.id,
              });
              links.push({ source: mn.id, target: `${m.id}::${b.id}`, kind: 'tree' });
            });
          });
        });
      });
    });
  });

  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ORBIT_TILT);
  nodes.forEach((n) => {
    if (n.type === 'enterprise') { n.pos = new THREE.Vector3(0, 0, 0); return; }
    const ang = n.angle || 0;
    const orbit = n.orbit || 12;
    const yLift = (n.depth - 1) * 0.15 + (n.type === 'branch' ? 0.45 : 0);
    const local = new THREE.Vector3(Math.cos(ang) * orbit, yLift, Math.sin(ang) * orbit);
    local.applyQuaternion(qTilt);
    n.pos = local;
  });

  return { nodes, links, byId, core };
}

function curvePoints(a, b, segments = 20) {
  const p0 = a.clone();
  const p3 = b.clone();
  const dir = p3.clone().sub(p0);
  const dist = dir.length() || 1;
  // Mild perpendicular bow — never origin-based (avoids loops on local rings)
  let perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (perp.lengthSq() < 1e-8) perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0));
  perp.normalize().multiplyScalar(Math.min(1.4, dist * 0.22));
  const p1 = p0.clone().lerp(p3, 0.33).add(perp);
  const p2 = p0.clone().lerp(p3, 0.66).add(perp);
  return new THREE.CubicBezierCurve3(p0, p1, p2, p3).getPoints(segments);
}

function mount() {
  const stage = document.getElementById('map3d-stage');
  const canvas = document.getElementById('map3d-canvas');
  const labelLayer = document.createElement('div');
  labelLayer.className = 'map3d-labels';
  labelLayer.id = 'map3d-labels';
  stage.appendChild(labelLayer);

  const graph = buildGraph();
  const meshes = new Map();
  const linkLines = [];
  const labelEls = new Map();

  let focusId = graph.core.id;
  let expanded = new Set();
  let flying = false;
  let hudMode = false;
  let idleOrbit = true;
  let lastInteract = performance.now();
  let composer = null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x04080e, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
  camera.position.set(22, 18, 38);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 6;
  controls.maxDistance = 140;
  controls.target.set(0, 0, 0);
  controls.addEventListener('start', () => { idleOrbit = false; lastInteract = performance.now(); });
  controls.addEventListener('end', () => { lastInteract = performance.now(); });

  scene.add(new THREE.AmbientLight(0x6688aa, 0.5));
  const key = new THREE.PointLight(0x00f2fe, 1.2, 160);
  key.position.set(10, 20, 12);
  scene.add(key);
  const fill = new THREE.PointLight(0x05ffa1, 0.4, 120);
  fill.position.set(-14, -2, -10);
  scene.add(fill);

  {
    const N = 280;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 220;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 140;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xaaccff, size: 0.32, transparent: true, opacity: 0.5, sizeAttenuation: true,
    })));
  }

  const ringGroup = new THREE.Group();
  ringGroup.rotation.x = ORBIT_TILT;
  [16, 26, 40].forEach((r) => {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.11, dashSize: 0.4, gapSize: 0.55,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    ringGroup.add(line);
  });
  scene.add(ringGroup);

  const coreGroup = new THREE.Group();
  {
    const N = 4200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const arm = (i % 3) * ((Math.PI * 2) / 3);
      const spiral = arm + t * Math.PI * 5.5;
      const rad = Math.pow(Math.random(), 0.55) * 5.8;
      const y = (Math.random() - 0.5) * 1.6 * (1 - t);
      pos[i * 3] = Math.cos(spiral) * rad;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(spiral) * rad;
      const cyan = Math.random() > 0.28;
      if (cyan) { col[i * 3] = 0.0; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 1.0; }
      else { col[i * 3] = 0.15; col[i * 3 + 1] = 1.0; col[i * 3 + 2] = 0.65; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    coreGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.085, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })));
    coreGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.06, depthWrite: false })
    ));
  }
  const wordmark = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, opacity: 0 }));
  wordmark.scale.set(10, 2.6, 1);
  coreGroup.add(wordmark);
  new THREE.TextureLoader().load('assets/apos-wordmark.png', (tex) => {
    const img = tex.image;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      // invert RGB, keep alpha
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
    ctx.putImageData(id, 0, 0);
    const inv = new THREE.CanvasTexture(c);
    inv.colorSpace = THREE.SRGBColorSpace;
    wordmark.material.map = inv;
    wordmark.material.opacity = 1;
    wordmark.material.needsUpdate = true;
  });
  scene.add(coreGroup);
  meshes.set(graph.core.id, { mesh: coreGroup, node: graph.core, halo: null });

  graph.nodes.forEach((n) => {
    if (n.type === 'enterprise') return;
    const mat = new THREE.MeshStandardMaterial({
      color: n.color, emissive: n.color,
      emissiveIntensity: n.type === 'country' || n.type === 'client' ? 0.45 : 0.22,
      metalness: 0.12, roughness: 0.4, transparent: true,
      opacity: n.status === 'future' || n.comingSoon ? 0.4 : 0.95,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(n.r, 20, 20), mat);
    mesh.position.copy(n.pos);
    mesh.userData.nodeId = n.id;
    scene.add(mesh);
    let halo = null;
    if (n.depth <= 2) {
      halo = new THREE.Mesh(
        new THREE.SphereGeometry(n.r * 2.2, 16, 16),
        new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.12, depthWrite: false })
      );
      halo.position.copy(n.pos);
      scene.add(halo);
    }
    const el = document.createElement('div');
    el.className = `m3d-label depth-${n.depth}`;
    el.dataset.nid = n.id;
    el.textContent = n.label;
    el.style.display = 'none';
    labelLayer.appendChild(el);
    labelEls.set(n.id, el);
    meshes.set(n.id, { mesh, halo, node: n });
  });

  graph.links.forEach((L) => {
    const a = graph.byId.get(L.source);
    const b = graph.byId.get(L.target);
    if (!a || !b) return;
    const pts = curvePoints(a.pos, b.pos, 18);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: L.kind === 'spine' ? 0x6a7a8a : a.color || 0x88aacc,
      transparent: true, opacity: L.kind === 'spine' ? 0.35 : 0.32,
    });
    const line = new THREE.Line(geo, mat);
    line.userData = { ...L };
    scene.add(line);
    linkLines.push(line);
  });

  function buildComposer() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.55, 0.82));
  }

  function viewportInsets() {
    const w = stage.clientWidth || 1200;
    const h = stage.clientHeight || 800;
    const drawer = document.getElementById('inspector-drawer');
    const drawerOpen = drawer?.classList.contains('is-open');
    const right = drawerOpen ? (drawer.getBoundingClientRect().width || 300) : 0;
    const left = hudMode ? 220 : 0;
    const bottom = hudMode ? 110 : 0;
    return { w, h, left, right, bottom, top: 56 };
  }

  function resize() {
    const { w, h } = viewportInsets();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    else buildComposer();
  }
  resize();
  window.addEventListener('resize', resize);

  function focusPath() {
    const set = new Set();
    let n = graph.byId.get(focusId);
    while (n) { set.add(n.id); n = n.parentId ? graph.byId.get(n.parentId) : null; }
    set.add(graph.core.id);
    return set;
  }

  function childrenOf(id) {
    return graph.nodes.filter((n) => n.parentId === id);
  }

  function setExpandedTo(id) {
    expanded = new Set([graph.core.id]);
    let n = graph.byId.get(id);
    const stack = [];
    while (n) { stack.push(n.id); n = n.parentId ? graph.byId.get(n.parentId) : null; }
    stack.reverse().forEach((x) => expanded.add(x));
    graph.nodes.forEach((c) => {
      if (c.parentId === id) expanded.add(c.id);
      if (c.depth <= 2) expanded.add(c.id);
    });
  }

  function subtreeBounds(id) {
    const box = new THREE.Box3();
    const root = graph.byId.get(id);
    if (!root) return box;
    // Fit focused node + direct children only (not the whole path to core)
    box.expandByPoint(root.pos);
    childrenOf(id).forEach((c) => box.expandByPoint(c.pos));
    if (root.type === 'enterprise') {
      graph.nodes.forEach((n) => {
        if (n.depth <= 2) box.expandByPoint(n.pos);
      });
    }
    return box;
  }

  function flyTo(id) {
    const n = graph.byId.get(id) || graph.core;
    focusId = n.id;
    setExpandedTo(n.id);
    idleOrbit = n.type === 'enterprise';
    lastInteract = performance.now();
    // Bloom machine children in a local ring around the machine
    if (n.type === 'machine') {
      const kids = graph.nodes.filter((c) => c.parentId === n.id && c.type === 'branch');
      kids.forEach((c, i) => {
        const a = -Math.PI / 2 + (i / Math.max(kids.length, 1)) * Math.PI * 2;
        const ring = 2.8;
        c.pos = n.pos.clone().add(new THREE.Vector3(Math.cos(a) * ring, 0.35, Math.sin(a) * ring));
        const entry = meshes.get(c.id);
        if (entry) {
          entry.mesh.position.copy(c.pos);
          // rebuild link geometry parent→child
        }
      });
      linkLines.forEach((line) => {
        if (line.userData.source !== n.id) return;
        const a = graph.byId.get(line.userData.source);
        const b = graph.byId.get(line.userData.target);
        if (!a || !b) return;
        const pts = curvePoints(a.pos, b.pos, 16);
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      });
    }

    const insets = viewportInsets();
    const box = subtreeBounds(n.id);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (n.type === 'enterprise') { center.set(0, 0, 0); size.set(40, 20, 40); }

    const fitFrac = 0.65;
    const maxDim = Math.max(size.x, size.y, size.z, n.type === 'enterprise' ? 36 : 8);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    let dist = (maxDim / fitFrac) / (2 * Math.tan(fov / 2));
    dist = THREE.MathUtils.clamp(dist, n.type === 'enterprise' ? 36 : 10, 90);

    const ndcShiftX = (insets.left - insets.right) / Math.max(insets.w, 1);
    const endTarget = center.clone();
    const endCam = center.clone().add(new THREE.Vector3(
      dist * 0.42 + ndcShiftX * dist * 0.55,
      dist * 0.38,
      dist * 0.78
    ));

    const startCam = camera.position.clone();
    const startTarget = controls.target.clone();
    flying = true;
    const dur = reduceMotion ? 0 : n.type === 'enterprise' ? 550 : 900;
    const t0 = performance.now();
    function step(now) {
      const u = dur === 0 ? 1 : Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - u, 3);
      camera.position.lerpVectors(startCam, endCam, e);
      controls.target.lerpVectors(startTarget, endTarget, e);
      controls.update();
      if (u < 1) requestAnimationFrame(step);
      else {
        flying = false;
        renderBreadcrumb();
        openInspectorFor(n);
        applyLod();
        syncLabels();
      }
    }
    requestAnimationFrame(step);
    applyLod();
  }

  function openInspectorFor(n) {
    const d = document.getElementById('inspector-drawer');
    if (!d) return;
    if (n.type === 'enterprise') { d.classList.remove('is-open'); return; }
    document.getElementById('insp-kicker').textContent = n.type;
    document.getElementById('insp-title').textContent = n.label;
    const grid = document.getElementById('insp-grid');
    grid.innerHTML = '';
    const rows = [
      ['Id', n.id], ['Depth', String(n.depth)],
      ['Status', n.status || (n.alert ? 'alert' : n.comingSoon ? 'soon' : 'ok')],
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
    resize();
  }

  function renderBreadcrumb() {
    const ol = document.getElementById('crumb-list');
    if (!ol) return;
    ol.innerHTML = '';
    const path = [];
    let n = graph.byId.get(focusId);
    while (n) { path.unshift(n); n = n.parentId ? graph.byId.get(n.parentId) : null; }
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

  function applyLod() {
    const path = focusPath();
    const focus = graph.byId.get(focusId);
    meshes.forEach(({ mesh, halo, node }) => {
      if (node.type === 'enterprise') return;
      const onPath = path.has(node.id) || expanded.has(node.id);
      const isChild = node.parentId === focusId;
      let show = node.depth <= 2 || onPath || isChild;
      if (node.type === 'branch') show = focus?.type === 'machine' && node.parentId === focusId;
      else if (focus?.type === 'machine') show = onPath || isChild || node.depth <= 1;
      else if (focus?.type === 'location') show = onPath || isChild || node.depth <= 2;
      else if (node.depth >= 5 && !onPath && !isChild) show = false;
      mesh.visible = show;
      if (halo) halo.visible = show && node.depth <= 2;
      if (show && focusId !== graph.core.id && !onPath && !isChild && node.depth > 1) mesh.material.opacity = 0.12;
      else mesh.material.opacity = node.status === 'future' || node.comingSoon ? 0.4 : 0.95;
    });
    linkLines.forEach((line) => {
      const s = graph.byId.get(line.userData.source);
      const t = graph.byId.get(line.userData.target);
      const sm = meshes.get(s?.id);
      const tm = meshes.get(t?.id);
      const hot = path.has(line.userData.source) && path.has(line.userData.target);
      const childLink = line.userData.source === focusId || line.userData.target === focusId;
      line.visible = !!(sm?.mesh.visible && tm?.mesh.visible);
      if (focusId !== graph.core.id && !hot && !childLink) line.material.opacity = 0.08;
      else line.material.opacity = hot ? 0.65 : line.userData.kind === 'spine' ? 0.35 : 0.3;
    });
    if (focusId === graph.core.id) {
      wordmark.visible = true;
      coreGroup.visible = true;
      const vFOV = THREE.MathUtils.degToRad(camera.fov);
      const distCore = camera.position.distanceTo(controls.target) || camera.position.length();
      const worldH = 2 * Math.tan(vFOV / 2) * distCore;
      const targetH = worldH * 0.22;
      wordmark.scale.set(targetH * 3.85, targetH, 1);
      wordmark.material.opacity = 1;
    } else {
      // Keep a faint core presence but don't dominate the frame
      const deep = (graph.byId.get(focusId)?.depth || 0) >= 4;
      wordmark.visible = !deep;
      wordmark.material.opacity = deep ? 0 : 0.25;
      coreGroup.visible = true;
    }
  }

  function syncLabels() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const want = new Set();
    if (focusId === graph.core.id) {
      graph.nodes.forEach((n) => { if (n.depth === 1) want.add(n.id); });
    } else {
      want.add(focusId);
      childrenOf(focusId).forEach((c) => want.add(c.id));
    }
    const placed = [];
    labelEls.forEach((el, id) => {
      const entry = meshes.get(id);
      if (!entry || !want.has(id) || !entry.mesh.visible) { el.style.display = 'none'; return; }
      const n = entry.node;
      const v = n.pos.clone().project(camera);
      if (v.z > 1) { el.style.display = 'none'; return; }
      let x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h + 14;
      let tries = 0;
      while (tries < 8 && placed.some((p) => Math.abs(p.x - x) < 72 && Math.abs(p.y - y) < 18)) {
        y += 16; tries += 1;
      }
      if (x < 8 || x > w - 8 || y < 40 || y > h - 40) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.classList.toggle('is-focus', id === focusId);
      el.classList.toggle('is-hub', n.depth <= 1);
      placed.push({ x, y });
    });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    idleOrbit = false; lastInteract = performance.now();
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const objs = [...meshes.values()].map((m) => m.mesh).filter((m) => m.visible && m.isMesh);
    const hits = raycaster.intersectObjects(objs, false);
    if (hits[0]?.object.userData.nodeId) flyTo(hits[0].object.userData.nodeId);
  });

  document.querySelectorAll('.zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      idleOrbit = false; lastInteract = performance.now();
      const a = btn.dataset.action;
      if (a === 'reset') flyTo(graph.core.id);
      else if (a === 'zoom-in') camera.position.multiplyScalar(0.85);
      else if (a === 'zoom-out') camera.position.multiplyScalar(1.18);
    });
  });
  document.querySelector('[data-dir="prev"]')?.addEventListener('click', () => {
    const n = graph.byId.get(focusId);
    flyTo(n?.parentId || graph.core.id);
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
      resize();
      if (!flying) flyTo(focusId);
    });
  });
  document.querySelector('.insp-close')?.addEventListener('click', () => {
    document.getElementById('inspector-drawer')?.classList.remove('is-open');
    resize();
  });

  const term = document.getElementById('terminal-overlay');
  document.getElementById('map3d-task-btn')?.addEventListener('click', () => {
    document.getElementById('term-assignee').textContent = graph.byId.get(focusId)?.label || 'field ops';
    term.hidden = false;
  });
  document.getElementById('terminal-close')?.addEventListener('click', () => { term.hidden = true; });
  document.getElementById('term-send')?.addEventListener('click', () => {
    const desc = document.getElementById('term-task').value.trim();
    document.getElementById('term-log').textContent = desc ? `queued · ${desc.slice(0, 48)}` : 'empty task';
  });

  const people = DATA.people || {};
  const clients = graph.nodes.filter((n) => n.type === 'client');
  const ul = document.getElementById('hud-clients');
  if (ul) {
    ul.innerHTML = '';
    clients.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c.label + (c.comingSoon ? ' · soon' : '');
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => flyTo(c.id));
      ul.appendChild(li);
    });
  }
  const ua = document.getElementById('hud-alerts');
  if (ua) {
    ua.innerHTML = '';
    const alerts = graph.nodes.filter((n) => n.alert).slice(0, 6);
    if (alerts.length) {
      alerts.forEach((a) => {
        const li = document.createElement('li');
        li.textContent = `${a.label} · alert`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => flyTo(a.id));
        ua.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.textContent = 'No machine alerts';
      ua.appendChild(li);
    }
    Object.values(people).slice(0, 4).forEach((p) => {
      const li = document.createElement('li');
      li.textContent = `${p.name || p.id} · ${p.role || 'ops'}`;
      li.className = 'hud-team';
      ua.appendChild(li);
    });
  }
  const hudLog = document.getElementById('hud-term-log');
  if (hudLog) {
    hudLog.innerHTML = '<div>&gt; link secure · constellation online</div><div>&gt; portfolio watching</div><div>&gt; ready for task relay_</div>';
  }

  setExpandedTo(graph.core.id);
  const clock = new THREE.Clock();
  function tick() {
    const t = clock.elapsedTime;
    if (!flying) controls.update();
    coreGroup.rotation.y = t * 0.06;
    if (!flying && !reduceMotion && focusId === graph.core.id) {
      if (performance.now() - lastInteract > 2200) idleOrbit = true;
      if (idleOrbit) {
        const ang = t * 0.08;
        const r = Math.hypot(camera.position.x, camera.position.z) || 42;
        camera.position.x = Math.cos(ang) * r;
        camera.position.z = Math.sin(ang) * r;
        camera.position.y = 18;
        controls.target.set(0, 0, 0);
        camera.lookAt(0, 0, 0);
      }
    }
    applyLod();
    syncLabels();
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
        id: focusId, type: n?.type, level: n?.depth ?? 0, overview: focusId === graph.core.id,
        machineId: n?.type === 'machine' ? n.id : n?.machineId,
        locationId: n?.type === 'location' ? n.id : undefined,
        hubId: n?.countryId, countryId: n?.countryId, clientId: n?.clientId,
      };
    },
    flyTo: (id) => flyTo(id),
    reset: () => flyTo(graph.core.id),
    goBack: () => flyTo(graph.byId.get(focusId)?.parentId || graph.core.id),
    waitForIdle: () => new Promise((resolve) => {
      const check = () => { if (!flying) resolve(); else requestAnimationFrame(check); };
      requestAnimationFrame(check);
    }),
    isFlying: () => flying,
    isHudMode: () => hudMode,
    setHudMode: (on) => { document.querySelector(`.toggle-btn[data-view="${on ? 'hud' : 'graph'}"]`)?.click(); },
    isTerminalOpen: () => !term.hidden,
    openTerminal: () => { term.hidden = false; },
    closeTerminal: () => { term.hidden = true; },
    nodeCount: () => graph.nodes.length,
    getTransform: () => ({ k: 55 / camera.position.distanceTo(controls.target), x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  };
  window.APOS_3D_MAP = api;
  window.__APOS_3D_READY__ = true;
  window.__APOS_MAP_READY__ = true;
  return api;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
