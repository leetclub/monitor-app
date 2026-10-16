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
      depth: 1, angle: a, orbit: 16, color: RING[c.id] || COLORS.indigo, r: 0.55, parentId: core.id,
    });
    links.push({ source: core.id, target: country.id, kind: 'spine' });

    (c.clients || []).forEach((cl, ci, arr) => {
      const fan = ((ci + 0.5) / Math.max(arr.length, 1) - 0.5) * 0.95;
      const brand = add({
        id: cl.id, type: 'client', label: cl.label || cl.brand, depth: 2,
        angle: a + fan, orbit: 26, color: country.color, r: 0.28,
        parentId: country.id, countryId: country.id, comingSoon: !!cl.comingSoon,
      });
      links.push({ source: country.id, target: brand.id, kind: 'tree' });

      (cl.areas || []).forEach((area, ai, aarr) => {
        const af = ((ai + 0.5) / Math.max(aarr.length, 1) - 0.5) * 0.55;
        const an = add({
          id: area.id, type: 'area', label: area.label, depth: 3,
          angle: brand.angle + af, orbit: 34, color: country.color, r: 0.22,
          parentId: brand.id, countryId: country.id, clientId: brand.id,
        });
        links.push({ source: brand.id, target: an.id, kind: 'tree' });

        (area.locations || []).forEach((loc, li, larr) => {
          const lf = ((li + 0.5) / Math.max(larr.length, 1) - 0.5) * 0.4;
          const ln = add({
            id: loc.id, type: 'location', label: loc.label, depth: 4,
            angle: an.angle + lf, orbit: 40, color: COLORS.white, r: 0.18,
            parentId: an.id, countryId: country.id, clientId: brand.id,
            alert: !!(loc.machines || []).some((m) => m.alert),
          });
          links.push({ source: an.id, target: ln.id, kind: 'tree' });

          (loc.machines || []).forEach((m, mi, marr) => {
            const mf = ((mi + 0.5) / Math.max(marr.length, 1) - 0.5) * 0.32;
            const mn = add({
              id: m.id, type: 'machine', label: m.label, depth: 5,
              angle: ln.angle + mf, orbit: 45,
              color: m.alert ? COLORS.magenta : COLORS.white, r: 0.15,
              parentId: ln.id, countryId: country.id, clientId: brand.id,
              alert: !!m.alert, revenue: m.revenue, stock: m.stock,
              technical: m.technical, operators: m.operators, contract: m.contract,
            });
            links.push({ source: ln.id, target: mn.id, kind: 'tree' });

            BRANCHES.forEach((b, bi) => {
              const ba = mn.angle + ((bi + 0.5) / BRANCHES.length - 0.5) * 0.85;
              add({
                id: `${m.id}::${b.id}`, type: 'branch', branchId: b.id, label: b.label, depth: 6,
                angle: ba, orbit: 49, color: COLORS.mint, r: 0.11,
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
  camera.position.set(28, 22, 58);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 6;
  controls.maxDistance = 140;
  controls.target.set(0, 0, 0);
  controls.addEventListener('start', () => { idleOrbit = false; lastInteract = performance.now(); });
  controls.addEventListener('end', () => { lastInteract = performance.now(); });

  scene.add(new THREE.AmbientLight(0x6688aa, 0.55));
  const key = new THREE.PointLight(0x00f2fe, 1.35, 160);
  key.position.set(10, 20, 12);
  scene.add(key);
  const fill = new THREE.PointLight(0x05ffa1, 0.45, 120);
  fill.position.set(-14, -2, -10);
  scene.add(fill);
  // Rim light so hubs read as spheres (not flat discs) when drilled
  const rim = new THREE.DirectionalLight(0xa8d8ff, 0.55);
  rim.position.set(-8, 14, 6);
  scene.add(rim);

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
      emissiveIntensity: n.type === 'country' ? 0.55 : n.type === 'client' ? 0.42 : 0.28,
      metalness: 0.08, roughness: 0.35, transparent: true,
      opacity: n.status === 'future' || n.comingSoon ? 0.38 : 0.98,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(n.r, 24, 24), mat);
    mesh.position.copy(n.pos);
    mesh.userData.nodeId = n.id;
    scene.add(mesh);
    // Soft volumetric halo (additive) — restrained glow, sized by level
    let halo = null;
    if (n.depth <= 3) {
      const haloScale = n.depth <= 1 ? 2.6 : n.depth === 2 ? 2.35 : 2.1;
      const haloOp = n.depth <= 1 ? 0.16 : n.depth === 2 ? 0.12 : 0.08;
      halo = new THREE.Mesh(
        new THREE.SphereGeometry(n.r * haloScale, 20, 20),
        new THREE.MeshBasicMaterial({
          color: n.color, transparent: true, opacity: haloOp, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
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
    // Fit focus + children + ancestor path (keep relation to APOS in frame)
    box.expandByPoint(root.pos);
    childrenOf(id).forEach((c) => box.expandByPoint(c.pos));
    let a = root;
    while (a) {
      box.expandByPoint(a.pos);
      a = a.parentId ? graph.byId.get(a.parentId) : null;
    }
    if (root.type === 'enterprise') {
      graph.nodes.forEach((n) => {
        if (n.depth <= 2) box.expandByPoint(n.pos);
      });
      box.expandByScalar(6);
    } else {
      // Soft pad so path links aren't flush to the edge
      box.expandByScalar(2.2);
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
    if (n.type === 'enterprise') {
      center.set(0, 0.8, 0);
      // Fit full constellation (core + KW/AE/SA + KW brands) in ~70% of view
      size.set(58, 32, 58);
    }

    const fitFrac = n.type === 'enterprise' ? 0.68 : 0.65;
    const maxDim = Math.max(size.x, size.y, size.z, n.type === 'enterprise' ? 58 : 6);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    let dist = (maxDim / fitFrac) / (2 * Math.tan(fov / 2));
    dist = THREE.MathUtils.clamp(dist, n.type === 'enterprise' ? 72 : 9, 140);

    const ndcShiftX = (insets.left - insets.right) / Math.max(insets.w, 1);
    const endTarget = center.clone();
    // Slightly higher camera so hubs read as spheres (not flat discs) and SA stays in frame
    const endCam = center.clone().add(new THREE.Vector3(
      dist * 0.38 + ndcShiftX * dist * 0.55,
      dist * (n.type === 'enterprise' ? 0.48 : 0.42),
      dist * 0.72
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
    if (n.type === 'enterprise' || focusId === graph.core.id) {
      d.classList.remove('is-open');
      document.body.classList.remove('inspector-open');
      resize();
      return;
    }
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

  let crumbHoverId = null;
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
      btn.dataset.nid = p.id;
      btn.textContent = p.type === 'enterprise' ? 'APOS' : p.label;
      if (i === path.length - 1) btn.classList.add('is-current');
      btn.addEventListener('click', () => flyTo(p.id));
      btn.addEventListener('mouseenter', () => { crumbHoverId = p.id; applyLod(); });
      btn.addEventListener('mouseleave', () => { crumbHoverId = null; applyLod(); });
      li.appendChild(btn);
      ol.appendChild(li);
    });
  }

  function ensureAposEdgeChip3d() {
    let el = document.getElementById('apos-edge-chip');
    if (el) return el;
    el = document.createElement('button');
    el.id = 'apos-edge-chip';
    el.type = 'button';
    el.className = 'apos-edge-chip';
    el.textContent = 'APOS';
    el.title = 'Fly to APOS';
    el.hidden = true;
    el.addEventListener('click', () => flyTo(graph.core.id));
    stage.appendChild(el);
    return el;
  }

  function applyLod() {
    const path = focusPath();
    const focus = graph.byId.get(focusId);
    const overview = focusId === graph.core.id;
    // Distance-based restore: as camera pulls back, context brightens immediately
    const dist = camera.position.distanceTo(controls.target) || 40;
    const restore = overview ? 1 : THREE.MathUtils.clamp((dist - 14) / 40, 0, 1);
    const dimNode = 0.25 + 0.75 * restore;
    const dimLink = 0.12 + 0.35 * restore;

    meshes.forEach(({ mesh, halo, node }) => {
      if (node.type === 'enterprise') return;
      const isFocus = node.id === focusId;
      const isChild = node.parentId === focusId;
      const onPath = path.has(node.id);
      let show = false;
      let op = 0.98;
      if (overview) {
        show = node.depth <= 2;
        op = node.status === 'future' || node.comingSoon ? 0.38 : 0.98;
      } else if (node.type === 'branch') {
        show = focus?.type === 'machine' && isChild;
        op = 0.98;
      } else if (onPath || isChild) {
        // Ancestor chain + focus children always present
        show = true;
        op = node.status === 'future' || node.comingSoon ? 0.4 : 0.98;
      } else if (node.depth <= 2) {
        // Other hubs/brands — dim, never remove
        show = true;
        op = dimNode * (node.status === 'future' || node.comingSoon ? 0.7 : 1);
      } else if (node.parentId && path.has(node.parentId) && node.parentId !== focusId) {
        // Sibling under an ancestor — dim
        show = true;
        op = dimNode;
      } else {
        show = false;
      }
      mesh.visible = show;
      if (show) mesh.material.opacity = op;
      if (halo) {
        halo.visible = show && node.depth <= 3;
        if (halo.visible) {
          halo.position.copy(node.pos);
          halo.material.opacity = Math.min(0.16, op * 0.18);
        }
      }
    });

    // Core always visible when drilled (edge chip if projected off-screen)
    coreGroup.visible = true;
    wordmark.visible = overview;
    if (overview) {
      const vFOV = THREE.MathUtils.degToRad(camera.fov);
      const distCore = camera.position.distanceTo(controls.target) || camera.position.length();
      const aspect = camera.aspect || 1.7;
      const worldH = 2 * Math.tan(vFOV / 2) * distCore;
      const worldW = worldH * aspect;
      const targetW = worldW * 0.072;
      wordmark.scale.set(targetW, targetW / 3.9, 1);
      wordmark.material.opacity = 1;
    }

    linkLines.forEach((line) => {
      const s = graph.byId.get(line.userData.source);
      const t = graph.byId.get(line.userData.target);
      if (!s || !t) { line.visible = false; return; }
      const hot = path.has(s.id) && path.has(t.id);
      const childLink = (s.id === focusId && t.parentId === focusId)
        || (t.id === focusId && s.parentId === focusId);
      const sm = meshes.get(s.id);
      const tm = meshes.get(t.id);
      const sShow = s.type === 'enterprise' ? coreGroup.visible : !!sm?.mesh.visible;
      const tShow = t.type === 'enterprise' ? coreGroup.visible : !!tm?.mesh.visible;

      // Restore full curve if previously stubbed
      if (line.userData.stubbed) {
        const pts = curvePoints(s.pos, t.pos, 18);
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        line.userData.stubbed = false;
      }

      if (overview) {
        line.visible = s.depth <= 2 && t.depth <= 2;
        line.material.opacity = hot ? 0.45 : line.userData.kind === 'spine' ? 0.28 : 0.3;
        return;
      }

      // Continuous ancestor path (incl. spine to APOS) — never stubbed/hidden
      if (hot) {
        line.visible = true;
        line.material.opacity = 0.78;
        line.material.color.setHex(0x00d4e6);
        return;
      }
      if (childLink) {
        line.visible = true;
        line.material.opacity = 0.45;
        return;
      }
      // Dim context links between visible nodes
      if (sShow && tShow && (s.depth <= 2 || t.depth <= 2)) {
        line.visible = true;
        line.material.opacity = dimLink;
        return;
      }
      line.visible = false;
    });

    ringGroup.visible = overview;

    // Edge indicator when APOS core projects outside the viewport
    const chip = ensureAposEdgeChip3d();
    if (overview) {
      chip.hidden = true;
    } else {
      const v = graph.core.pos.clone().project(camera);
      const w = stage.clientWidth || 1920;
      const h = stage.clientHeight || 1080;
      const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92;
      if (onScreen) {
        chip.hidden = true;
      } else {
        let sx = (v.x * 0.5 + 0.5) * w;
        let sy = (-v.y * 0.5 + 0.5) * h;
        sx = Math.min(w - 48, Math.max(48, sx));
        sy = Math.min(h - 48, Math.max(64, sy));
        chip.hidden = false;
        chip.style.left = `${sx}px`;
        chip.style.top = `${sy}px`;
      }
    }
  }

  function syncLabels() {
    const w = stage.clientWidth || 1920;
    const h = stage.clientHeight || 1080;
    const insets = viewportInsets();
    const want = new Set();
    const path = focusPath();
    if (focusId === graph.core.id) {
      graph.nodes.forEach((n) => {
        if (n.depth === 1 || n.depth === 2) want.add(n.id);
      });
    } else {
      const focus = graph.byId.get(focusId);
      want.add(focusId);
      childrenOf(focusId).forEach((c) => want.add(c.id));
      // Ancestor labels: keep chain readable without crowding machine children
      path.forEach((id) => {
        if (id === graph.core.id) return;
        const n = graph.byId.get(id);
        if (!n) return;
        if ((focus?.type === 'machine' || focus?.type === 'location') && n.depth > 2) return;
        want.add(id);
      });
      graph.nodes.forEach((n) => {
        if (n.depth === 1) want.add(n.id);
      });
    }
    const placed = [];
    const visible = [];
    // Place focus first, then children, then ancestors — reduces overlaps
    const order = [...want].sort((a, b) => {
      const score = (id) => (id === focusId ? 0 : (graph.byId.get(id)?.parentId === focusId ? 1 : 2));
      return score(a) - score(b);
    });
    order.forEach((id) => {
      const el = labelEls.get(id);
      const entry = meshes.get(id);
      if (!el || !entry) return;
      entry.mesh.visible = true;
      if (entry.halo) entry.halo.visible = entry.node.depth <= 3;
      const n = entry.node;
      const v = n.pos.clone().project(camera);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) {
        el.style.display = 'none';
        return;
      }
      const estW = Math.max(40, (n.label || '').length * (id === focusId ? 8.5 : 6.2));
      const estH = id === focusId ? 18 : 14;
      let x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h + (id === focusId ? 32 : (n.parentId === focusId ? -22 : 14));
      // Fan child labels away from focus by screen angle
      if (n.parentId === focusId && focusId) {
        const fp = graph.byId.get(focusId)?.pos;
        if (fp) {
          const dx = n.pos.x - fp.x, dz = n.pos.z - fp.z;
          const ang = Math.atan2(dz, dx);
          x += Math.cos(ang) * 28;
          y += Math.sin(ang) * 10 - 8;
        }
      }
      const minX = insets.left + 28;
      const maxX = w - insets.right - 28;
      const minY = insets.top + 12;
      const maxY = h - insets.bottom - 16;
      let tries = 0;
      const hits = (px, py) => placed.some((p) =>
        Math.abs(p.x - px) < (p.w + estW) * 0.58 && Math.abs(p.y - py) < (p.h + estH) * 0.75
      );
      while (tries < 16 && hits(x, y)) {
        y += (n.parentId === focusId ? -14 : 16);
        if (tries % 3 === 2) x += (tries % 6 === 2 ? 22 : -22);
        tries += 1;
      }
      x = Math.min(maxX, Math.max(minX, x));
      y = Math.min(maxY, Math.max(minY, y));
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = path.has(id) || id === focusId || n.parentId === focusId ? '1' : '0.45';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.classList.toggle('is-focus', id === focusId);
      el.classList.toggle('is-hub', n.depth <= 1);
      el.classList.toggle('is-child', n.parentId === focusId);
      placed.push({ x, y, id, w: estW, h: estH });
      visible.push({ id, label: n.label, x, y });
    });
    // Hide unused
    labelEls.forEach((el, id) => {
      if (!want.has(id)) el.style.display = 'none';
    });
    return visible;
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
  document.getElementById('inspector-drawer')?.classList.remove('is-open');
  renderBreadcrumb();
  applyLod();
  // Settle overview framing (pulled back so SA + brands fit)
  {
    const box = subtreeBounds(graph.core.id);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size); box.getCenter(center);
    center.set(0, 0.8, 0);
    const maxDim = Math.max(size.x, size.y, size.z, 58);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    let dist = (maxDim / 0.68) / (2 * Math.tan(fov / 2));
    dist = THREE.MathUtils.clamp(dist, 72, 140);
    camera.position.set(dist * 0.38, dist * 0.48, dist * 0.72);
    controls.target.copy(center);
    controls.maxDistance = 140;
    controls.update();
    applyLod();
    syncLabels();
  }
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
    reset: () => {
      document.getElementById('inspector-drawer')?.classList.remove('is-open');
      document.body.classList.remove('inspector-open');
      flyTo(graph.core.id);
    },
    visibleLabels: () => {
      const list = [];
      labelEls.forEach((el, id) => {
        if (el.style.display === 'none' || el.style.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        list.push({ id, text: el.textContent, x: r.left, y: r.top, w: r.width, h: r.height });
      });
      return list;
    },
    pathLinksVisible: (fromId) => {
      const start = fromId || focusId;
      const path = [];
      let n = graph.byId.get(start);
      while (n) { path.push(n.id); n = n.parentId ? graph.byId.get(n.parentId) : null; }
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const line = linkLines.find((L) =>
          (L.userData.source === a && L.userData.target === b)
          || (L.userData.source === b && L.userData.target === a)
        );
        if (!line || !line.visible || line.userData.stubbed) return false;
      }
      return true;
    },
    getAposEdgeHint: () => {
      const el = document.getElementById('apos-edge-chip');
      if (!el || el.hidden) return null;
      return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
    },
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
