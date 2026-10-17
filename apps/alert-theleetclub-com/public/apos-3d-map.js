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
const LEVEL_ORBIT = { 1: 22, 2: 40, 3: 54, 4: 66, 5: 78 };
const HEALTH_HEX = { healthy: 0x5ed6b0, warning: 0xe8c078, critical: 0xff6b7a, offline: 0xff6b7a, unknown: 0x94a3b8, planned: 0x9aa8bc };

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
      id: c.id, type: 'country',       label: c.code || c.label,
      fullLabel: c.label || c.code,
      subtitle: c.status === 'future' ? 'planned' : 'live', status: c.status,
      depth: 1, angle: a, orbit: LEVEL_ORBIT[1], color: RING[c.id] || COLORS.indigo, r: 0.55, parentId: core.id,
      planned: !!c.planned,
    });
    links.push({ source: core.id, target: country.id, kind: 'spine' });

    (c.clients || []).forEach((cl, ci, arr) => {
      // At least ~58° between the outer brands so screen labels do not stack on the hub.
      const span = Math.max((58 * Math.PI) / 180, 1.01);
      const fan = arr.length <= 1 ? 0 : (ci / (arr.length - 1) - 0.5) * span;
      const brand = add({
        id: cl.id, type: 'client', label: cl.label || cl.brand, depth: 2,
        angle: a + fan, orbit: LEVEL_ORBIT[2], color: country.color, r: 0.28,
        parentId: country.id, countryId: country.id, comingSoon: !!cl.comingSoon,
      });
      links.push({ source: country.id, target: brand.id, kind: 'tree' });

      (cl.areas || []).forEach((area, ai, aarr) => {
        const af = ((ai + 0.5) / Math.max(aarr.length, 1) - 0.5) * 0.55;
        const an = add({
          id: area.id, type: 'area', label: area.label, depth: 3,
          angle: brand.angle + af, orbit: LEVEL_ORBIT[3], color: country.color, r: 0.22,
          parentId: brand.id, countryId: country.id, clientId: brand.id,
        });
        links.push({ source: brand.id, target: an.id, kind: 'tree' });

        (area.locations || []).forEach((loc, li, larr) => {
          const lf = ((li + 0.5) / Math.max(larr.length, 1) - 0.5) * 0.4;
          const ln = add({
            id: loc.id, type: 'location', label: loc.label, depth: 4,
            angle: an.angle + lf, orbit: LEVEL_ORBIT[4], color: COLORS.white, r: 0.18,
            parentId: an.id, countryId: country.id, clientId: brand.id,
            alert: !!(loc.machines || []).some((m) => m.alert),
          });
          links.push({ source: an.id, target: ln.id, kind: 'tree' });

          (loc.machines || []).forEach((m, mi, marr) => {
            const mf = ((mi + 0.5) / Math.max(marr.length, 1) - 0.5) * 0.32;
            const mn = add({
              id: m.id, type: 'machine', label: m.label, depth: 5,
              angle: ln.angle + mf, orbit: LEVEL_ORBIT[5],
              color: COLORS.white, r: 0.15,
              parentId: ln.id, countryId: country.id, clientId: brand.id,
              status: m.status || 'active', revenue: m.revenue, stock: m.stock,
              technical: m.technical, operators: m.operators, contract: m.contract,
              operatorId: m.operatorId, technicianId: m.technicianId,
              offlineHours: m.offlineHours || 0, lastSeen: m.lastSeen || null, stale: !!m.stale,
              model: m.model,
            });
            mn.alert = window.APOS_MAP_UTILS?.computeAlert(mn) || null;
            links.push({ source: ln.id, target: mn.id, kind: 'tree' });
          });
        });
      });
    });
  });

  const byOrbit = new Map();
  nodes.forEach((n) => {
    if (n.type === 'enterprise') return;
    const key = String(n.orbit);
    if (!byOrbit.has(key)) byOrbit.set(key, []);
    byOrbit.get(key).push(n);
  });
  byOrbit.forEach((list) => {
    list.sort((a, b) => a.angle - b.angle);
    const min = 0.09;
    for (let i = 1; i < list.length; i++) {
      if (list[i].angle - list[i - 1].angle < min) list[i].angle = list[i - 1].angle + min;
    }
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
  let idleOrbit = false;
  let lastInteract = performance.now();
  let composer = null;
  let starPointsRef = null;
  let hoverId = null;
  let filterMode = 'all';
  let filterHot = new Set();
  let pageHidden = false;
  let inspectorSig = '';
  let rafId = 0;
  let hiddenTimer = 0;
  function scheduleTick() {
    if (rafId || hiddenTimer) return;
    if (pageHidden) {
      hiddenTimer = setTimeout(() => {
        hiddenTimer = 0;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          tick();
        });
      }, 200);
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      tick();
    });
  }
  let pointerNX = 0;
  let pointerNY = 0;
  let orbitBase = null;
  let flyGen = 0;
  const viewStack = [];
  const flyQuery = Number(new URLSearchParams(location.search).get('fly') || 0);
  const frameSamples = [];
  let frameWarm = 0;
  let slowStreak = 0;
  const flowPackets = [];

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !navigator.webdriver,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !!navigator.webdriver,
  });
  renderer.setPixelRatio(navigator.webdriver ? 1 : Math.min(window.devicePixelRatio || 1, 2));
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
    geo.userData.base = pos.slice();
    starPointsRef = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xaaccff, size: 0.32, transparent: true, opacity: 0.5, sizeAttenuation: true,
    }));
    scene.add(starPointsRef);
  }

  const ringGroup = new THREE.Group();
  ringGroup.rotation.x = ORBIT_TILT;
  Object.values(LEVEL_ORBIT).forEach((r) => {
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
  const galaxySpin = new THREE.Group();
  {
    const arms = 3;
    const N = 4200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const arm = i % arms;
      const along = Math.pow(Math.random(), 0.78);
      const theta = arm * ((Math.PI * 2) / arms) + along * Math.PI * 3.6;
      const rad = 0.2 + along * 6.6;
      const thick = (0.16 + along * 0.72) * (Math.random() + Math.random() + Math.random() - 1.5);
      pos[i * 3] = Math.cos(theta) * rad - Math.sin(theta) * thick;
      pos[i * 3 + 1] = Math.sin(theta) * rad + Math.cos(theta) * thick;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.22 * (1 - along * 0.65);
      const hot = Math.exp(-rad / 1.55);
      const fade = 0.28 + 0.72 * Math.exp(-rad / 3.8);
      col[i * 3] = (0.92 * hot + 0.02 * (1 - hot)) * fade;
      col[i * 3 + 1] = (0.96 * hot + 0.78 * (1 - hot)) * fade;
      col[i * 3 + 2] = (1.0 * hot + 0.92 * (1 - hot)) * fade;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const armPts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.095, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true,
    }));
    armPts.renderOrder = 1;
    galaxySpin.add(armPts);
    const nCore = 780;
    const cpos = new Float32Array(nCore * 3);
    const ccol = new Float32Array(nCore * 3);
    for (let i = 0; i < nCore; i++) {
      const rad = Math.pow(Math.random(), 0.45) * 1.15;
      const ang = Math.random() * Math.PI * 2;
      cpos[i * 3] = Math.cos(ang) * rad;
      cpos[i * 3 + 1] = Math.sin(ang) * rad;
      cpos[i * 3 + 2] = (Math.random() - 0.5) * 0.18;
      const hot = 1 - rad / 1.15;
      ccol[i * 3] = 0.85 + 0.15 * hot;
      ccol[i * 3 + 1] = 0.92 + 0.08 * hot;
      ccol[i * 3 + 2] = 1;
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    cgeo.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    const nucleus = new THREE.Points(cgeo, new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true,
    }));
    nucleus.renderOrder = 2;
    galaxySpin.add(nucleus);
  }
  coreGroup.add(galaxySpin);
  const backingCanvas = document.createElement('canvas');
  backingCanvas.width = 256;
  backingCanvas.height = 128;
  {
    const g = backingCanvas.getContext('2d');
    const grd = g.createRadialGradient(128, 64, 10, 128, 64, 124);
    grd.addColorStop(0, 'rgba(2, 6, 12, 0.96)');
    grd.addColorStop(0.38, 'rgba(2, 6, 12, 0.86)');
    grd.addColorStop(0.68, 'rgba(2, 6, 12, 0.4)');
    grd.addColorStop(1, 'rgba(2, 6, 12, 0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
  }
  const wordmarkBacking = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(backingCanvas),
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  wordmarkBacking.scale.set(8.4, 4.2, 1);
  wordmarkBacking.renderOrder = 8;
  const labelScene = new THREE.Scene();
  labelScene.add(wordmarkBacking);
  const wordmarkCanvas = document.createElement('canvas');
  wordmarkCanvas.width = 640;
  wordmarkCanvas.height = 180;
  {
    const g = wordmarkCanvas.getContext('2d');
    g.clearRect(0, 0, 640, 180);
    g.fillStyle = '#ffffff';
    g.font = '700 132px "IBM Plex Sans", Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('apos', 320, 96);
  }
  const wordmarkTex = new THREE.CanvasTexture(wordmarkCanvas);
  wordmarkTex.colorSpace = THREE.SRGBColorSpace;
  const wordmark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: wordmarkTex,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 1,
  }));
  wordmark.scale.set(10, 2.6, 1);
  wordmark.renderOrder = 12;
  labelScene.add(wordmark);
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

  function shapeFor(n) {
    const r = n.r;
    if (n.type === 'country') return new THREE.OctahedronGeometry(r, 0);
    if (n.type === 'client') return new THREE.TetrahedronGeometry(r * 1.2, 0);
    if (n.type === 'area') return new THREE.BoxGeometry(r * 1.5, r * 1.5, r * 1.5);
    if (n.type === 'location') return new THREE.CylinderGeometry(r * 0.9, r * 0.9, r * 0.55, 6);
    return new THREE.SphereGeometry(r, 16, 16);
  }
  graph.nodes.forEach((n) => {
    if (n.type === 'enterprise') return;
    const planned = n.status === 'future' || n.planned;
    const health = window.APOS_MAP_UTILS?.healthOf(n) || 'healthy';
    const mat = planned
      ? new THREE.MeshBasicMaterial({ color: 0x9aa8bc, wireframe: true, transparent: true, opacity: 0.9 })
      : new THREE.MeshStandardMaterial({
        color: n.color, emissive: n.color,
        emissiveIntensity: n.alert ? 0.55 : 0.12,
        metalness: 0.08, roughness: 0.4, transparent: true, opacity: 0.96,
      });
    const mesh = new THREE.Mesh(shapeFor(n), mat);
    mesh.position.copy(n.pos);
    mesh.userData.nodeId = n.id;
    scene.add(mesh);
    let halo = null;
    if (n.alert) {
      halo = new THREE.Mesh(
        new THREE.SphereGeometry(n.r * 2.1, 16, 16),
        new THREE.MeshBasicMaterial({
          color: 0xff6b7a, transparent: true, opacity: 0.18, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      halo.position.copy(n.pos);
      scene.add(halo);
    }
    const statusRing = new THREE.Mesh(
      new THREE.TorusGeometry(n.r * 1.85, planned ? 0.012 : 0.018, 6, 28),
      new THREE.MeshBasicMaterial({ color: HEALTH_HEX[health] || HEALTH_HEX.healthy, transparent: true, opacity: 0.95 })
    );
    statusRing.position.copy(n.pos);
    scene.add(statusRing);
    const el = document.createElement('div');
    el.className = `m3d-label depth-${n.depth}`;
    el.dataset.nid = n.id;
    el.textContent = n.label;
    el.style.display = 'none';
    labelLayer.appendChild(el);
    labelEls.set(n.id, el);
    const badge = document.createElement('div');
    badge.className = 'm3d-badge';
    badge.style.display = 'none';
    labelLayer.appendChild(badge);
    n._badgeEl = badge;
    n._baseAlert = !!n.alert;
    n._baseStatus = n.status;
    if (n.stock) n._baseFill = n.stock.fillPct;
    meshes.set(n.id, { mesh, halo, statusRing, node: n });
  });

  graph.links.forEach((L) => {
    const a = graph.byId.get(L.source);
    const b = graph.byId.get(L.target);
    if (!a || !b) return;
    const pts = curvePoints(a.pos, b.pos, 18);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const depth = Math.min(a.depth || 0, b.depth || 0);
    const opacities = [0.78, 0.58, 0.4, 0.28, 0.18, 0.12];
    const mat = new THREE.LineBasicMaterial({
      color: depth <= 1 ? 0xd5e4f5 : (a.color || 0x88aacc),
      transparent: true, opacity: opacities[Math.min(depth, opacities.length - 1)],
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

  function viewportInsets(opts = {}) {
    const w = stage.clientWidth || 1200;
    const h = stage.clientHeight || 800;
    const drawer = document.getElementById('inspector-drawer');
    const drawerOpen = !!(drawer?.classList.contains('is-open')
      || document.body.classList.contains('inspector-open')
      || opts.reserveDrawer);
    const right = drawerOpen ? ((drawer?.getBoundingClientRect().width || 300) + 16) : 0;
    const left = hudMode ? 220 : 0;
    const bottom = hudMode ? 110 : 28;
    return { w, h, left, right, bottom, top: 96 };
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
    // Always fit focus + children
    box.expandByPoint(root.pos);
    childrenOf(id).forEach((c) => box.expandByPoint(c.pos));
    const deep = root.type === 'area' || root.type === 'location'
      || root.type === 'machine' || root.type === 'branch';
    if (root.type === 'enterprise') {
      graph.nodes.forEach((n) => {
        if (n.depth <= 2) box.expandByPoint(n.pos);
      });
      box.expandByScalar(6);
      return box;
    }
    if (!deep) {
      // Hub/country/client: include ancestor chain toward APOS
      let a = root.parentId ? graph.byId.get(root.parentId) : null;
      while (a) {
        box.expandByPoint(a.pos);
        a = a.parentId ? graph.byId.get(a.parentId) : null;
      }
      box.expandByScalar(2.2);
      return box;
    }
    // Deep: at most 1–2 nearby ancestors; rest trails to edge APOS chip
    const localSize = new THREE.Vector3();
    box.getSize(localSize);
    const localSpan = Math.max(localSize.x, localSize.y, localSize.z, 1.5);
    let a = root.parentId ? graph.byId.get(root.parentId) : null;
    let added = 0;
    while (a && added < 2 && a.type !== 'enterprise') {
      const probe = box.clone();
      probe.expandByPoint(a.pos);
      const sz = new THREE.Vector3();
      probe.getSize(sz);
      if (Math.max(sz.x, sz.y, sz.z) > localSpan * 2.4) break;
      box.copy(probe);
      added += 1;
      a = a.parentId ? graph.byId.get(a.parentId) : null;
    }
    box.expandByScalar(1.6);
    return box;
  }

  function flyTo(id, opts) {
    const n = graph.byId.get(id) || graph.core;
    const restoring = !!(opts && opts.restore);
    if (opts && opts.fresh) viewStack.length = 0;
    if (!restoring && !(opts && opts.fresh)) {
      const snap = {
        focusId,
        px: camera.position.x, py: camera.position.y, pz: camera.position.z,
        tx: controls.target.x, ty: controls.target.y, tz: controls.target.z,
      };
      const top = viewStack[viewStack.length - 1];
      const moved = !top || top.focusId !== snap.focusId
        || Math.hypot(top.px - snap.px, top.py - snap.py, top.pz - snap.pz) > 0.15;
      if (moved && [snap.px, snap.py, snap.pz, snap.tx, snap.ty, snap.tz].every(Number.isFinite)) {
        viewStack.push(snap);
        if (viewStack.length > 32) viewStack.shift();
      }
    }
    focusId = n.id;
    setExpandedTo(n.id);
    idleOrbit = n.type === 'enterprise';
    lastInteract = performance.now();

    // Reserve drawer width on drill — inspector opens as the flight settles
    const insets = viewportInsets({ reserveDrawer: n.type !== 'enterprise' });
    const box = subtreeBounds(n.id);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (n.type === 'enterprise') {
      center.set(0, 0.8, 0);
      // Fit full constellation (core + KW/AE/SA + KW brands) in ~70% of view
      size.set(90, 42, 90);
    } else {
      // Look at the focus itself. Distance still covers its children.
      const kids = graph.nodes.filter((c) => c.parentId === n.id);
      let reach = 4;
      kids.forEach((c) => { reach = Math.max(reach, n.pos.distanceTo(c.pos) + (c.r || 1) * 2); });
      center.copy(n.pos);
      size.set(reach * 2, reach * 2, reach * 2);
    }

    const fitFrac = n.type === 'enterprise' ? 0.68 : 0.62;
    const maxDim = Math.max(size.x, size.y, size.z, n.type === 'enterprise' ? 90 : 4);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    let dist = (maxDim / fitFrac) / (2 * Math.tan(fov / 2));
    dist = THREE.MathUtils.clamp(dist, n.type === 'enterprise' ? 72 : 8, 140);

    // Shift look-target into the usable centre (viewport minus drawer/HUD)
    const usableW = Math.max(1, insets.w - insets.left - insets.right);
    const usableH = Math.max(1, insets.h - insets.top - insets.bottom);
    const ndcShiftX = ((insets.left + usableW / 2) - insets.w / 2) / (insets.w / 2);
    const ndcShiftY = -(((insets.top + usableH / 2) - insets.h / 2) / (insets.h / 2));
    const endTarget = center.clone();
    // Slightly higher camera so hubs read as spheres (not flat discs) and SA stays in frame.
    // Orbit controls keep the target at the viewport centre, so a drawer offset has to
    // pan the target (and the camera with it), not just slide the camera sideways.
    const endCam = center.clone().add(new THREE.Vector3(
      dist * 0.38,
      dist * (n.type === 'enterprise' ? 0.48 : 0.42),
      dist * 0.72
    ));
    if (n.type !== 'enterprise') {
      const offset = endCam.clone().sub(endTarget);
      const forward = offset.clone().negate().normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      const camUp = new THREE.Vector3().crossVectors(forward, right).normalize();
      const halfH = Math.tan(fov / 2) * offset.length();
      const halfW = halfH * (insets.w / Math.max(insets.h, 1));
      const pan = right.multiplyScalar(ndcShiftX * halfW).add(camUp.multiplyScalar(ndcShiftY * halfH));
      endTarget.add(pan);
      endCam.add(pan);
    }
    if (restoring && opts.snap) {
      endCam.set(opts.snap.px, opts.snap.py, opts.snap.pz);
      endTarget.set(opts.snap.tx, opts.snap.ty, opts.snap.tz);
    }

    const startCam = camera.position.clone();
    const startTarget = controls.target.clone();
    flying = true;
    const myGen = ++flyGen;
    const dur = reduceMotion ? 0 : (flyQuery > 0 ? flyQuery : (n.type === 'enterprise' ? 550 : 900));
    const t0 = performance.now();
    function step(now) {
      if (myGen !== flyGen) return;
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

  function pathText(n) {
    const parts = [];
    let c = n;
    while (c) {
      if (c.type !== 'enterprise') parts.unshift(c.fullLabel || c.label || c.id);
      c = c.parentId ? graph.byId.get(c.parentId) : null;
    }
    return parts.join(' · ');
  }

  function incidentDetail(m, kind) {
    const mins = Math.max(30, Math.round(((m && m.offlineHours) || 0.5) * 60));
    return {
      kind,
      machineId: m?.id,
      title: m?.label || '',
      path: m ? pathText(m) : '',
      severity: kind === 'offline' ? 'critical' : kind === 'lowstock' ? 'warning' : 'info',
      happened: kind === 'offline' ? `Offline >${mins}m` : kind === 'lowstock' ? 'Low stock' : kind === 'task' ? 'Task assigned' : 'Sale recorded',
      at: Date.now(),
      label: m?.label || kind,
    };
  }

  function nodeFacts(id) {
    const n = graph.byId.get(id);
    if (!n) return null;
    const alerts = n.type === 'machine' ? (n.alert ? 1 : 0) : (n.alertCount || 0);
    const offline = n.type === 'machine' ? (n.status === 'offline' ? 1 : 0) : (n.rollup?.offline || 0);
    const revenueToday = n.type === 'machine'
      ? (n.revenue?.today ?? null)
      : (n.rollup?.revenueToday ?? null);
    const stockPct = n.stock?.fillPct ?? null;
    return {
      id: n.id, label: n.label || '', type: n.type,
      status: window.APOS_MAP_UTILS?.healthOf(n) || n.status || (n.alert ? 'alert' : 'ok'),
      alerts, offline, revenueToday, stockPct, badge: n.alertCount || 0,
      health: window.APOS_MAP_UTILS?.healthOf(n) || 'healthy',
      lastSeen: n.lastSeen || n.operators?.lastVisit || null,
      path: pathText(n),
      sections: window.APOS_MAP_UTILS?.inspectorSections(n, DATA.people) || [],
    };
  }

  function audit3d() {
    const issues = [];
    const sumOf = (n, key) => {
      if (n.type === 'machine') {
        if (key === 'revenueToday') return n.revenue?.today || 0;
        if (key === 'alerts') return n.alert ? 1 : 0;
        if (key === 'offline') return n.status === 'offline' ? 1 : 0;
        return 0;
      }
      return graph.nodes
        .filter((c) => c.parentId === n.id && c.type !== 'branch')
        .reduce((s, c) => s + sumOf(c, key), 0);
    };
    graph.nodes.forEach((n) => {
      if (!n.label) issues.push(`${n.id}: empty label`);
      if (n.type === 'machine') {
        const fill = n.stock?.fillPct;
        if (fill != null && (!(fill >= 0) || fill > 100)) issues.push(`${n.id}: fill ${fill}`);
        const rev = n.revenue?.today;
        if (rev != null && (!Number.isFinite(rev) || rev < 0)) issues.push(`${n.id}: revenue ${rev}`);
      }
      if (n.type === 'branch' || n.type === 'machine') return;
      const alerts = sumOf(n, 'alerts');
      const offline = sumOf(n, 'offline');
      const rev = Math.round(sumOf(n, 'revenueToday') * 10) / 10;
      if ((n.alertCount || 0) !== alerts) issues.push(`${n.id}: badge ${n.alertCount} != ${alerts}`);
      if (!n.rollup) { issues.push(`${n.id}: missing rollup`); return; }
      if ((n.rollup.alerts || 0) !== alerts) issues.push(`${n.id}: rollup alerts`);
      if ((n.rollup.offline || 0) !== offline) issues.push(`${n.id}: rollup offline`);
      if (Math.abs((n.rollup.revenueToday || 0) - rev) > 0.15) issues.push(`${n.id}: rollup revenue`);
    });
    return issues;
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
    const facts = nodeFacts(n.id);
    if (facts) {
      rows.push(['Alerts', String(facts.alerts)]);
      rows.push(['Offline', String(facts.offline)]);
      if (facts.revenueToday != null) rows.push(['Today', `${facts.revenueToday} KWD`]);
      if (facts.stockPct != null) rows.push(['Stock', `${facts.stockPct}%`]);
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
      btn.textContent = p.type === 'enterprise' ? 'APOS' : (p.fullLabel || p.label);
      const issues = p.type === 'machine' ? (p.alert ? 1 : 0) : (p.rollup?.alerts || p.alertCount || 0);
      if (issues > 0) {
        const mark = document.createElement('em');
        mark.className = 'crumb-count';
        mark.textContent = String(issues);
        btn.appendChild(mark);
      }
      if (i === path.length - 1) btn.classList.add('is-current');
      btn.addEventListener('click', () => {
        let idx = -1;
        for (let i = viewStack.length - 1; i >= 0; i--) {
          if (viewStack[i].focusId === p.id) { idx = i; break; }
        }
        if (idx >= 0) {
          const s = viewStack[idx];
          viewStack.length = idx;
          flyTo(s.focusId, { restore: true, snap: s });
        } else if (p.type === 'enterprise') {
          viewStack.length = 0;
          flyTo(graph.core.id, { fresh: true });
        } else flyTo(p.id);
      });
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
        const liveOff = node.type === 'machine' && node.status === 'offline' && node._offlineUntil;
        show = node.depth <= 2 || !!liveOff;
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
      if (show && filterMode !== 'all' && !filterHot.has(node.id)) op *= 0.22;
      mesh.visible = show;
      if (show) mesh.material.opacity = op;
      if (halo) {
        halo.visible = show && node.depth <= 3;
        if (halo.visible) {
          halo.position.copy(mesh.position);
          halo.material.opacity = Math.min(0.16, op * 0.18);
        }
      }
    });

    // Core always visible when drilled (edge chip if projected off-screen)
    coreGroup.visible = true;
    wordmark.visible = overview;
    wordmarkBacking.visible = overview;
    if (overview) {
      const vFOV = THREE.MathUtils.degToRad(camera.fov);
      const distCore = camera.position.distanceTo(controls.target) || camera.position.length();
      const aspect = camera.aspect || 1.7;
      const worldH = 2 * Math.tan(vFOV / 2) * distCore;
      const worldW = worldH * aspect;
      const targetW = worldW * 0.078;
      wordmark.scale.set(targetW, targetW / 3.9, 1);
      wordmark.material.opacity = wordmark.material.map ? 1 : 0;
      wordmarkBacking.scale.set(targetW * 1.08, targetW * 0.5, 1);
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
    const offlineChip = new Set();
    graph.nodes.forEach((n) => {
      if (n.type !== 'machine' || n.status !== 'offline' || !n._offlineUntil) return;
      let c = n;
      while (c) {
        if (c.type !== 'enterprise') offlineChip.add(c.id);
        c = c.parentId ? graph.byId.get(c.parentId) : null;
      }
    });
    if (focusId === graph.core.id) {
      graph.nodes.forEach((n) => {
        if (n.depth === 1 || n.depth === 2 || (n.type === 'machine' && offlineChip.has(n.id))) want.add(n.id);
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
      el.textContent = n.label || '';
      el.style.display = 'block';
      const health = window.APOS_MAP_UTILS?.healthOf(n) || 'healthy';
      let pill = '';
      if (n.type === 'machine') {
        if (health === 'offline') pill = 'OFFLINE';
        else if (health === 'unknown') pill = 'UNKNOWN';
        else if (health === 'warning') pill = 'LOW';
        else if (health === 'critical') pill = 'ALERT';
      } else if (health === 'planned' && (n.type === 'country' || n.type === 'hub') && (focusId === graph.core.id || id === focusId)) pill = 'Planned';
      else if ((n.alertCount || 0) > 0) pill = String(n.alertCount);
      const coreV = graph.core.pos.clone().project(camera);
      const cx = (coreV.x * 0.5 + 0.5) * w;
      const cy = (-coreV.y * 0.5 + 0.5) * h;
      const nx = (v.x * 0.5 + 0.5) * w;
      const ny = (-v.y * 0.5 + 0.5) * h;
      let ox = nx - cx;
      let oy = ny - cy;
      const olen = Math.hypot(ox, oy) || 1;
      ox /= olen;
      oy /= olen;
      const tx = -oy;
      const ty = ox;
      const boxW = Math.max(48, el.offsetWidth + 10);
      const boxH = Math.max(16, el.offsetHeight + 4);
      const push0 = n.depth <= 1 ? 22 : 28;
      let x = nx + ox * push0;
      let y = ny + oy * push0;
      const hits = (px, py) => {
        const L = px - boxW / 2;
        const R = px + boxW / 2;
        const T = py;
        const B = py + boxH;
        return placed.some((p) => L < p.r + 4 && R > p.l - 4 && T < p.b + 3 && B > p.t - 3);
      };
      let tries = 0;
      while (tries < 20 && hits(x, y)) {
        const step = push0 + 16 + tries * 11;
        const side = (tries % 2 === 0 ? 1 : -1) * (tries > 4 ? 8 + tries * 2 : 0);
        x = nx + ox * step + tx * side;
        y = ny + oy * step + ty * side;
        tries += 1;
      }
      const minX = insets.left + boxW / 2 + 8;
      const maxX = w - insets.right - boxW / 2 - 8;
      const minY = insets.top + 8;
      const maxY = h - insets.bottom - boxH - 8;
      x = Math.min(maxX, Math.max(minX, x));
      y = Math.min(maxY, Math.max(minY, y));
      el.style.visibility = 'visible';
      el.style.opacity = path.has(id) || id === focusId || n.parentId === focusId ? '1' : '0.45';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.classList.toggle('is-focus', id === focusId);
      el.classList.toggle('is-hub', n.depth <= 1);
      el.classList.toggle('is-child', n.parentId === focusId);
      const labelBox = {
        x, y, id, w: boxW, h: boxH,
        l: x - boxW / 2, r: x + boxW / 2, t: y, b: y + boxH,
      };
      placed.push(labelBox);
      const badgeEl = n._badgeEl;
      if (badgeEl) {
        if (!pill) {
          badgeEl.style.display = 'none';
        } else {
          badgeEl.textContent = pill;
          badgeEl.className = `m3d-badge is-${health}`;
          badgeEl.style.display = 'block';
          const bw = Math.max(18, pill.length * 7 + 8);
          const bh = 14;
          let bx = nx + 12;
          let by = ny - 22;
          const hitsB = (px, py) => placed.some((p) => px < p.r + 3 && px + bw > p.l - 3 && py < p.b + 3 && py + bh > p.t - 3);
          let guard = 0;
          while (guard < 8 && hitsB(bx, by)) { by -= bh + 2; guard += 1; }
          badgeEl.style.left = `${bx}px`;
          badgeEl.style.top = `${by}px`;
          placed.push({ l: bx, r: bx + bw, t: by, b: by + bh, id: `${id}:badge` });
        }
      }
      visible.push({ id, label: n.label, x, y });
    });
    // Hide unused
    labelEls.forEach((el, id) => {
      if (!want.has(id)) {
        el.style.display = 'none';
        const n = graph.byId.get(id);
        if (n?._badgeEl) n._badgeEl.style.display = 'none';
      }
    });
    return visible;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tip = document.createElement('div');
  tip.className = 'map3d-tooltip';
  tip.hidden = true;
  stage.appendChild(tip);
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    pointerNX = pointer.x;
    pointerNY = -pointer.y;
    raycaster.setFromCamera(pointer, camera);
    const objs = [...meshes.values()].map((m) => m.mesh).filter((m) => m.visible && m.isMesh && m.userData.nodeId);
    return raycaster.intersectObjects(objs, false);
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    idleOrbit = false; orbitBase = null; lastInteract = performance.now();
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    lastInteract = performance.now();
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const id = pick(e)[0]?.object.userData.nodeId;
    if (!id) return;
    const n = graph.byId.get(id);
    if (n) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.22, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.position.copy(n.pos);
      ring.lookAt(camera.position);
      scene.add(ring);
      const t0 = performance.now();
      const grow = (now) => {
        const u = Math.min(1, (now - t0) / 480);
        ring.scale.setScalar(1 + u * 5);
        ring.material.opacity = 0.65 * (1 - u);
        if (u < 1) requestAnimationFrame(grow);
        else { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); }
      };
      if (!reduceMotion) requestAnimationFrame(grow);
    }
    flyTo(id);
  });
  canvas.addEventListener('pointermove', (e) => {
    const id = pick(e)[0]?.object.userData.nodeId || null;
    hoverId = id;
    const n = id ? graph.byId.get(id) : null;
    if (!n) { tip.hidden = true; return; }
    const facts = nodeFacts(n.id);
    tip.hidden = false;
    tip.innerHTML = '<strong>' + (facts?.label || n.label) + '</strong><span>' + [
      facts?.revenueToday == null ? null : facts.revenueToday + ' KWD today',
      facts?.stockPct == null ? null : 'stock ' + facts.stockPct + '%',
      facts ? ('alerts ' + facts.alerts) : null,
      facts ? ('offline ' + facts.offline) : null,
    ].filter((x) => x != null).join(' · ') + '</span>';
    const box = stage.getBoundingClientRect();
    tip.style.left = (e.clientX - box.left + 12) + 'px';
    tip.style.top = (e.clientY - box.top + 12) + 'px';
  });
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const id = pick(e)[0]?.object.userData.nodeId || focusId;
    const kid = graph.nodes.find((c) => c.parentId === id && c.type !== 'branch');
    flyTo(kid?.id || id);
  });
  function goBack() {
    if (viewStack.length) {
      const s = viewStack.pop();
      flyTo(s.focusId, { restore: true, snap: s });
      return;
    }
    flyTo(graph.byId.get(focusId)?.parentId || graph.core.id);
  }
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    goBack();
  });
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { goBack(); return; }
    if (e.key === 'Enter') {
      const kid = graph.nodes.find((c) => c.parentId === focusId && c.type !== 'branch');
      if (kid) flyTo(kid.id);
      return;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const cur = graph.byId.get(focusId);
      const sibs = graph.nodes.filter((c) => c.parentId === cur?.parentId && c.type === cur?.type);
      const i = sibs.findIndex((s) => s.id === cur?.id);
      if (i < 0 || sibs.length < 2) return;
      const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      flyTo(sibs[(i + dir + sibs.length) % sibs.length].id);
    }
  });
  document.addEventListener('visibilitychange', () => {
    pageHidden = document.hidden;
    if (!pageHidden) {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = 0; }
      scheduleTick();
    }
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
      if (hudMode) animateHud();
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
  function animateHud() {
    const coreFacts = graph.byId.get(graph.core.id);
    const revenue = Math.round(coreFacts?.rollup?.revenueToday || 0);
    const alerts = coreFacts?.alertCount || 0;
    const live = document.getElementById('hud-live-stat');
    if (live) live.textContent = revenue + ' KWD today · ' + alerts + ' alerts';
    const host = document.querySelector('#hud-left h4');
    if (!host) return;
    let stat = document.getElementById('hud-live-stat');
    if (!stat) {
      stat = document.createElement('p');
      stat.id = 'hud-live-stat';
      stat.className = 'hud-stat';
      host.insertAdjacentElement('afterend', stat);
    }
    stat.textContent = revenue + ' KWD today · ' + alerts + ' alerts';
  }
  const hudLog = document.getElementById('hud-term-log');
  if (hudLog) {
    hudLog.innerHTML = '<div>&gt; link secure · constellation online</div><div>&gt; portfolio watching</div><div>&gt; ready for task relay_</div>';
  }

  setExpandedTo(graph.core.id);
  const packetDots = [];
  for (let i = 0; i < 5; i++) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.95 })
    );
    dot.visible = false;
    scene.add(dot);
    packetDots.push(dot);
  }
  function linkEndpoint(node) {
    if (!node || !Number.isFinite(node.pos?.x)) return null;
    if (node.type === 'enterprise') return coreGroup.position;
    const entry = meshes.get(node.id);
    const p = entry?.mesh?.position || node.pos;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    return p;
  }

  function syncLinkEndpoints() {
    linkLines.forEach((line) => {
      if (!line.visible) return;
      const a = graph.byId.get(line.userData.source);
      const b = graph.byId.get(line.userData.target);
      const pa = linkEndpoint(a);
      const pb = linkEndpoint(b);
      if (!pa || !pb) return;
      const pts = curvePoints(pa, pb, 18);
      const attr = line.geometry.attributes.position;
      if (!attr || attr.count !== pts.length) {
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        return;
      }
      for (let i = 0; i < pts.length; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
      attr.needsUpdate = true;
    });
  }

  function recompute3dAlerts() {
    const now = performance.now();
    graph.nodes.forEach((n) => {
      if (n.type !== 'machine') return;
      if (n._offlineUntil && now >= n._offlineUntil) {
        n.status = n._baseStatus || 'active';
        n._offlineUntil = 0;
      }
      if (n._lowUntil && now >= n._lowUntil && n.stock && n._baseFill != null) {
        n.stock.fillPct = n._baseFill;
        n._lowUntil = 0;
      }
      const low = (n.stock?.fillPct ?? 100) < 15;
      const task = (n._taskUntil || 0) > now;
      n.alert = window.APOS_MAP_UTILS?.computeAlert(n) || (task ? 'amber' : null);
      n.alertCount = n.alert ? 1 : 0;
      const entry = meshes.get(n.id);
      const health = window.APOS_MAP_UTILS?.healthOf(n) || 'healthy';
      if (entry?.statusRing?.material?.color) entry.statusRing.material.color.setHex(HEALTH_HEX[health] || HEALTH_HEX.healthy);
      if (entry?.mesh?.material?.emissive && !entry.mesh.material.wireframe) {
        entry.mesh.material.emissive.setHex(n.status === 'offline' || n.alert === 'red' ? 0xff3355 : (n.color || 0xffffff));
        entry.mesh.material.emissiveIntensity = n.alert ? 0.55 : 0.12;
      }
    });
    const roll = (id) => {
      let total = 0;
      let online = 0;
      let alerts = 0;
      let offline = 0;
      let unknown = 0;
      let maintenance = 0;
      let planned = 0;
      let low = 0;
      let revenueToday = 0;
      graph.nodes.forEach((c) => {
        if (c.parentId !== id || c.type === 'branch') return;
        if (c.type === 'machine') {
          total += 1;
          if (c.status === 'active') online += 1;
          alerts += c.alertCount || 0;
          const stale = c.status === 'unknown' || c.stale;
          if (stale) unknown += 1;
          else if (c.status === 'offline') offline += 1;
          else if (c.status === 'maintenance') maintenance += 1;
          else if (c.status === 'planned' || c.status === 'future') planned += 1;
          else if ((c.stock?.fillPct ?? 100) < 15) low += 1;
          revenueToday += c.revenue?.today || 0;
        } else {
          const sub = roll(c.id);
          total += sub.total;
          online += sub.online;
          alerts += sub.alerts;
          offline += sub.offline;
          unknown += sub.unknown;
          maintenance += sub.maintenance;
          planned += sub.planned;
          low += sub.low;
          revenueToday += sub.revenueToday;
        }
      });
      const n = graph.byId.get(id);
      revenueToday = Math.round(revenueToday * 10) / 10;
      if (n && n.type !== 'machine') {
        n.alertCount = alerts;
        n.rollup = { total, online, alerts, offline, unknown, maintenance, planned, low, revenueToday, tint: alerts > 0 };
      }
      return { total, online, alerts, offline, unknown, maintenance, planned, low, revenueToday };
    };
    roll(graph.core.id);
    const focus = graph.byId.get(focusId);
    if (focus && focus.type !== 'enterprise') {
      const sig = `${focus.alertCount}|${focus.rollup?.offline ?? 0}|${focus.rollup?.low ?? 0}|${focus.rollup?.revenueToday ?? 0}|${focus.status || ''}|${focus.alert || ''}`;
      if (sig !== inspectorSig) {
        inspectorSig = sig;
        window.APOS_3D_MAP?.refreshInspector?.();
      }
    }
    const hudStat = document.getElementById('hud-live-stat');
    if (hudStat) {
      const coreRoll = graph.byId.get(graph.core.id);
      hudStat.textContent = `${Math.round(coreRoll?.rollup?.revenueToday || 0)} KWD today · ${coreRoll?.alertCount || 0} alerts`;
    }
    if (filterMode !== 'all') {
      filterHot = new Set();
      graph.nodes.forEach((n) => {
        const stock = n.stock?.fillPct ?? 100;
        const hit = filterMode === 'alerts' ? !!n.alert
          : filterMode === 'offline' ? n.status === 'offline'
          : filterMode === 'unknown' ? (n.status === 'unknown' || n.stale)
          : filterMode === 'critical' ? (n.status === 'offline' || n.alert === 'red')
          : n.type === 'machine' && n.status !== 'unknown' && stock < 15;
        if (!hit) return;
        let c = n;
        while (c) { filterHot.add(c.id); c = c.parentId ? graph.byId.get(c.parentId) : null; }
      });
    }
  }

  function spawn3dFlow(fromId, kind) {
    const path = [];
    let n = graph.byId.get(fromId);
    while (n) { path.push(n); n = n.parentId ? graph.byId.get(n.parentId) : null; }
    if (path.length < 2) return;
    if (flowPackets.length > 5) flowPackets.shift();
    const color = (kind === 'offline' || kind === 'alert') ? 0xff6b7a : (kind === 'lowstock' || kind === 'task') ? 0xe8c078 : 0x00d2c8;
    flowPackets.push({ path, u: 0, color });
  }
  const clock = new THREE.Clock();
  function tick() {
    if (pageHidden) {
      scheduleTick();
      return;
    }
    const workT0 = performance.now();
    recompute3dAlerts();
    const t = clock.elapsedTime;
    if (!flying) controls.update();
    galaxySpin.quaternion.copy(camera.quaternion);
    if (!reduceMotion) {
      galaxySpin.rotateZ(t * 0.16);
      coreGroup.scale.setScalar(1 + Math.sin(t * 0.7) * 0.03);
      ringGroup.children.forEach((line, i) => { line.rotation.y = t * (i % 2 ? -0.04 : 0.03); });
    } else {
      coreGroup.scale.setScalar(1);
    }
    if (starPointsRef) {
      const base = starPointsRef.geometry.userData.base;
      const arr = starPointsRef.geometry.attributes.position.array;
      const ox = camera.position.x * 0.025 + pointerNX * 1.2;
      const oy = camera.position.y * 0.015 + pointerNY * 0.7;
      if (base) {
        for (let i = 0; i < base.length; i += 3) {
          const layer = 0.35 + ((i / 3) % 5) * 0.1;
          arr[i] = base[i] + ox * layer;
          arr[i + 1] = base[i + 1] + oy * layer;
          arr[i + 2] = base[i + 2];
        }
        starPointsRef.geometry.attributes.position.needsUpdate = true;
      }
    }
    meshes.forEach(({ mesh, node }) => {
      if (!mesh.isMesh || node.type === 'enterprise' || !mesh.material) return;
      const baseE = node.type === 'country' ? 0.55 : node.type === 'client' ? 0.42 : 0.28;
      const wantE = hoverId === node.id ? baseE + 0.45 : baseE;
      if (mesh.material.emissiveIntensity != null) {
        mesh.material.emissiveIntensity += (wantE - mesh.material.emissiveIntensity) * (reduceMotion ? 1 : 0.16);
      }
      const wantS = hoverId === node.id ? 1.12 : 1;
      mesh.scale.setScalar(reduceMotion ? wantS : mesh.scale.x + (wantS - mesh.scale.x) * 0.18);
      if (!reduceMotion) {
        const ph = (node.id.length % 17) * 0.37;
        mesh.position.x = node.pos.x;
        mesh.position.z = node.pos.z;
        mesh.position.y = node.pos.y + Math.sin(t * 0.85 + ph) * 0.06;
        const entry = meshes.get(node.id);
        if (entry?.halo) entry.halo.position.copy(mesh.position);
        if (entry?.statusRing) entry.statusRing.position.copy(mesh.position);
        if (node.alert || node.status === 'offline') {
          mesh.material.emissiveIntensity = Math.max(mesh.material.emissiveIntensity, 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.1 + ph)));
        }
      } else {
        mesh.position.copy(node.pos);
      }
    });
    syncLinkEndpoints();
    packetDots.forEach((d) => { d.visible = false; });
    for (let i = flowPackets.length - 1; i >= 0; i--) {
      const ev = flowPackets[i];
      ev.u += reduceMotion ? 1 : 0.008;
      if (ev.u >= 1) { flowPackets.splice(i, 1); continue; }
      const hops = ev.path.length - 1;
      const f = ev.u * hops;
      const hi = Math.min(hops - 1, Math.floor(f));
      const pa = linkEndpoint(ev.path[hi]);
      const pb = linkEndpoint(ev.path[hi + 1]);
      if (!pa || !pb) continue;
      const dot = packetDots[i % packetDots.length];
      dot.visible = true;
      dot.position.lerpVectors(pa, pb, f - hi);
      dot.material.color.setHex(ev.color);
    }
    if (!flying && !reduceMotion && focusId === graph.core.id) {
      if (performance.now() - lastInteract > 5000) idleOrbit = true;
      if (idleOrbit) {
        if (!orbitBase) {
          orbitBase = {
            ang: Math.atan2(camera.position.z, camera.position.x),
            r: Math.hypot(camera.position.x, camera.position.z) || 48,
            y: camera.position.y,
            t0: t,
          };
        }
        const elapsed = Math.max(0, t - orbitBase.t0);
        const ease = Math.min(1, elapsed / 1.4);
        const smooth = ease * ease * (3 - 2 * ease);
        const ang = orbitBase.ang + elapsed * 0.04 * smooth;
        camera.position.x = Math.cos(ang) * orbitBase.r;
        camera.position.z = Math.sin(ang) * orbitBase.r;
        camera.position.y = orbitBase.y;
      } else orbitBase = null;
    } else if (!idleOrbit) orbitBase = null;
    applyLod();
    syncLinkEndpoints();
    syncLabels();
    if (composer && !window.__APOS_3D_NO_BLOOM__) composer.render();
    else renderer.render(scene, camera);
    if (wordmark.visible) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(labelScene, camera);
      renderer.autoClear = true;
    }
    const work = performance.now() - workT0;
    frameWarm += 1;
    if (work > 18) slowStreak += 1;
    else slowStreak = 0;
    if (slowStreak >= 4) window.__APOS_3D_NO_BLOOM__ = true;
    if (frameWarm > 24 && work > 0 && work < 400) {
      frameSamples.push(work);
      if (frameSamples.length > 90) frameSamples.shift();
    }
    scheduleTick();
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
  let liveTimer = 0;
  if (!reduceMotion) {
    const dest = camera.position.clone();
    const destT = controls.target.clone();
    const startCam = dest.clone().multiplyScalar(1.18).add(new THREE.Vector3(0, 6, 0));
    camera.position.copy(startCam);
    flying = true;
    const introGen = ++flyGen;
    const t0 = performance.now();
    const intro = (now) => {
      if (introGen !== flyGen) return;
      const u = Math.min(1, (now - t0) / 1600);
      const e = 1 - Math.pow(1 - u, 3);
      camera.position.lerpVectors(startCam, dest, e);
      controls.target.copy(destT);
      controls.update();
      if (u < 1) requestAnimationFrame(intro);
      else {
        flying = false;
        lastInteract = performance.now();
        idleOrbit = false;
        orbitBase = null;
      }
    };
    requestAnimationFrame(intro);
    const machines = graph.nodes.filter((n) => n.type === 'machine' && n.status !== 'future');
    liveTimer = setInterval(() => {
      if (pageHidden || !machines.length) return;
      const m = machines[Math.floor(Math.random() * machines.length)];
      const kinds = ['sale', 'lowstock', 'offline', 'task'];
      const kind = m.alert && Math.random() < 0.5 ? 'offline' : kinds[Math.floor(Math.random() * kinds.length)];
      if (m.revenue && kind === 'sale') m.revenue.today = Math.round((m.revenue.today + 2 + Math.random() * 4) * 10) / 10;
      if (kind === 'offline') {
        if (!m._baseStatus) m._baseStatus = m.status || 'active';
        m.status = 'offline';
        m._offlineUntil = performance.now() + 9000;
      } else if (kind === 'lowstock' && m.stock) {
        if (m._baseFill == null) m._baseFill = m.stock.fillPct;
        m.stock.fillPct = Math.min(m.stock.fillPct ?? 100, 12);
        m._lowUntil = performance.now() + 9000;
      } else if (kind === 'task') {
        m._taskUntil = performance.now() + 8000;
      }
      recompute3dAlerts();
      spawn3dFlow(m.id, kind);
      stage.dispatchEvent(new CustomEvent('apos-live', { detail: incidentDetail(m, kind) }));
    }, 3600);
  }
  scheduleTick();
  recompute3dAlerts();

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
      viewStack.length = 0;
      flyTo(graph.core.id, { fresh: true });
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
    goBack: () => goBack(),
    viewDepth: () => viewStack.length,
    listNodes: () => graph.nodes
      .filter((n) => n.type !== 'artic')
      .map((n) => ({ id: n.id, type: n.type, label: n.label || '', parentId: n.parentId || null, depth: n.depth })),
    nodeFacts: (id) => nodeFacts(id),
    auditData: () => audit3d(),
    getUsableFrame: () => {
      const stageEl = stage;
      const W = stageEl.clientWidth;
      const H = stageEl.clientHeight;
      const drawer = document.getElementById('inspector-drawer');
      const open = !!drawer?.classList.contains('is-open');
      const right = open ? (drawer.getBoundingClientRect().width || 320) + 16 : 12;
      const left = 16, top = 72, bottom = 72;
      const w = Math.max(200, W - left - right);
      const h = Math.max(160, H - top - bottom);
      return { x: left, y: top, w, h, cx: left + w / 2, cy: top + h / 2, W, H };
    },
    waitForIdle: () => new Promise((resolve) => {
      const t0 = performance.now();
      let settled = false;
      const finish = () => { if (settled) return; settled = true; flying = false; resolve(); };
      const check = () => {
        if (!flying || performance.now() - t0 > 4000) finish();
        else requestAnimationFrame(check);
      };
      setTimeout(finish, 4200);
      requestAnimationFrame(check);
    }),
    isFlying: () => flying,
    isHudMode: () => hudMode,
    setHudMode: (on) => { document.querySelector(`.toggle-btn[data-view="${on ? 'hud' : 'graph'}"]`)?.click(); },
    isTerminalOpen: () => !term.hidden,
    openTerminal: () => { term.hidden = false; },
    closeTerminal: () => { term.hidden = true; },
    nodeCount: () => graph.nodes.length,
    isNodeDrawn: (id) => {
      const n = graph.byId.get(id);
      if (!n) return false;
      if (n.type === 'enterprise') return !!coreGroup.visible;
      const m = meshes.get(id);
      return !!(m && m.mesh.visible && (m.mesh.material?.opacity ?? 1) > 0.05);
    },
    getNodeAlpha: (id) => {
      const n = graph.byId.get(id);
      if (!n) return 0;
      if (n.type === 'enterprise') return coreGroup.visible ? 1 : 0;
      const m = meshes.get(id);
      if (!m?.mesh.visible) return 0;
      return m.mesh.material?.opacity ?? 0;
    },
    countLinkCrossings: () => {
      const pts = [];
      linkLines.forEach((line) => {
        if (!line.visible) return;
        const a = graph.byId.get(line.userData.source);
        const b = graph.byId.get(line.userData.target);
        if (!a?.pos || !b?.pos) return;
        pts.push({ s: line.userData.source, t: line.userData.target, a: a.pos, b: b.pos });
      });
      const share = (p, q) => p.s === q.s || p.s === q.t || p.t === q.s || p.t === q.t;
      const cross = (p, q) => {
        const ax = p.a.x, ay = p.a.z, bx = p.b.x, by = p.b.z;
        const cx = q.a.x, cy = q.a.z, dx = q.b.x, dy = q.b.z;
        const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
        const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
      };
      let n = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (share(pts[i], pts[j])) continue;
          if (cross(pts[i], pts[j])) n += 1;
        }
      }
      return n;
    },
    prefersReducedMotion: () => reduceMotion,
    getMotionState: () => ({
      reduceMotion: !!reduceMotion, running: !pageHidden, hidden: pageHidden,
      filter: filterMode, bobAmp: reduceMotion ? 0 : 2.4, packets: flowPackets.length,
    }),
    getFrameStats: () => {
      const s = frameSamples.slice().sort((a, b) => a - b);
      const mid = s.length ? s[Math.floor(s.length / 2)] : 0;
      const p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
      return { median: Math.round(mid * 10) / 10, p95: Math.round(p95 * 10) / 10, n: s.length };
    },
    setFilter: (mode) => {
      filterMode = ['alerts', 'offline', 'lowstock', 'unknown', 'critical'].includes(mode) ? mode : 'all';
      filterHot = new Set();
      if (filterMode !== 'all') {
        graph.nodes.forEach((n) => {
          const stock = n.stock?.fillPct ?? 100;
          const hit = filterMode === 'alerts' ? !!n.alert
            : filterMode === 'offline' ? n.status === 'offline'
            : filterMode === 'unknown' ? (n.status === 'unknown' || n.stale)
            : filterMode === 'critical' ? (n.status === 'offline' || n.alert === 'red')
            : n.type === 'machine' && n.status !== 'unknown' && stock < 15;
          if (!hit) return;
          let c = n;
          while (c) { filterHot.add(c.id); c = c.parentId ? graph.byId.get(c.parentId) : null; }
        });
      }
      applyLod();
      return filterMode;
    },
    getFilter: () => filterMode,
    getFilterDimmedCount: () => {
      if (filterMode === 'all') return 0;
      let n = 0;
      meshes.forEach(({ mesh, node }) => {
        if (mesh.visible && node.type !== 'enterprise' && !filterHot.has(node.id)) n += 1;
      });
      return n;
    },
    fleetKpis: () => Object.assign(
      window.APOS_MAP_UTILS?.fleetOf(graph.nodes.filter((n) => n.type === 'machine')) || {},
      { refreshedAt: Date.now() }
    ),
    searchNodes: (q) => {
      const s = String(q || '').trim().toLowerCase();
      if (!s) return [];
      return graph.nodes.filter((n) => n.type !== 'branch' && ((n.label || '') + ' ' + pathText(n)).toLowerCase().includes(s))
        .slice(0, 8).map((n) => ({ id: n.id, label: n.label, type: n.type, path: pathText(n) }));
    },
    getTransform: () => ({
      k: 55 / camera.position.distanceTo(controls.target),
      x: camera.position.x, y: camera.position.y, z: camera.position.z,
      tx: controls.target.x, ty: controls.target.y, tz: controls.target.z,
    }),
    nodeScreenPos: (id) => {
      const n = graph.byId.get(id);
      if (!n) return null;
      const src = n.type === 'enterprise' ? coreGroup.position : (meshes.get(id)?.mesh.position || n.pos);
      if (!src) return null;
      const v = src.clone().project(camera);
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 };
    },
    setLive: (on) => {
      if (!on) {
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = 0;
        return false;
      }
      return !!liveTimer;
    },
    emitTestEvent: (machineId, kind) => {
      const m = graph.byId.get(machineId) || graph.nodes.find((n) => n.type === 'machine' && n.status !== 'future');
      if (!m || m.type !== 'machine') return null;
      const k = kind || 'sale';
      if (m.revenue && k === 'sale') m.revenue.today = Math.round((m.revenue.today + 2.5) * 10) / 10;
      if (k === 'offline') {
        m._baseStatus = m._baseStatus || m.status || 'active';
        m.status = 'offline';
        m._offlineUntil = performance.now() + 9000;
      } else if (k === 'lowstock' && m.stock) {
        if (m._baseFill == null) m._baseFill = m.stock.fillPct;
        m.stock.fillPct = Math.min(m.stock.fillPct ?? 100, 12);
        m._lowUntil = performance.now() + 9000;
      }
      recompute3dAlerts();
      spawn3dFlow(m.id, k);
      stage.dispatchEvent(new CustomEvent('apos-live', { detail: incidentDetail(m, k) }));
      return { id: m.id, status: m.status, alert: !!m.alert, kw: graph.byId.get('country-kw')?.alertCount || 0, leet: graph.byId.get('client-leet')?.alertCount || 0 };
    },
  };
  window.APOS_3D_MAP = api;
  window.__APOS_3D_READY__ = true;
  window.__APOS_MAP_READY__ = true;
  return api;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
