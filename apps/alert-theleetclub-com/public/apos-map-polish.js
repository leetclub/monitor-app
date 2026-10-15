/**
 * Shared camera, signals, and label helpers for APOS tree-map + space-map.
 */
window.APOS_MAP_POLISH = (function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Interruptible d3.interpolateZoom camera.
   * A new fly mid-flight redirects from the current mid-position (no snap to old target).
   */
  function createFlyCamera(opts) {
    const {
      svg,
      zoomBehavior,
      getStageSize,
      onFrame,
      onSettled,
      duration = reduceMotion ? 0 : 900,
    } = opts;
    let flying = false;
    let flyGen = 0;
    let transform = d3.zoomIdentity;

    function setTransform(t, syncZoom) {
      transform = t;
      if (syncZoom !== false) svg.call(zoomBehavior.transform, transform);
    }

    function getTransform() {
      return transform;
    }

    function isFlying() {
      return flying;
    }

    function viewFromTransform(t) {
      const { W } = getStageSize();
      return [(W / 2 - t.x) / t.k, ((getStageSize().H / 2) - t.y) / t.k, W / t.k];
    }

    function transformFromView(v) {
      const { W, H } = getStageSize();
      const k = W / v[2];
      return d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-v[0], -v[1]);
    }

    function flyTo(target, done) {
      flyGen += 1;
      const myGen = flyGen;
      svg.interrupt('fly');

      if (duration === 0) {
        setTransform(target, true);
        flying = false;
        if (onFrame) onFrame(transform);
        if (onSettled) onSettled(transform);
        if (done) done();
        return;
      }

      flying = true;
      const startView = viewFromTransform(transform);
      const endView = viewFromTransform(target);
      const iZoom = d3.interpolateZoom(startView, endView);

      svg
        .transition('fly')
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .tween('cam', () => (t) => {
          if (myGen !== flyGen) return;
          transform = transformFromView(iZoom(t));
          // Apply without re-entering zoom behavior mid-tween
          svg.select('g.viewport').attr('transform', transform);
          if (onFrame) onFrame(transform);
        })
        .on('interrupt', () => {
          // Leave transform where the last frame put it — next fly continues from here
          flying = false;
        })
        .on('end', () => {
          if (myGen !== flyGen) return;
          setTransform(target, true);
          flying = false;
          if (onFrame) onFrame(transform);
          if (onSettled) onSettled(transform);
          if (done) done();
        });
    }

    function syncFromZoomEvent(t) {
      transform = t;
    }

    return { flyTo, getTransform, setTransform, isFlying, syncFromZoomEvent, duration };
  }

  /** Pulses that travel along a node path (machine → … → root) */
  function createSignalRunner(opts) {
    const { getNode, worldToScreen, canvas, reduceMotion: rm } = opts;
    const pulses = [];
    let ctx = null;

    function resize() {
      const stage = canvas.parentElement;
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnSegment(fromId, toId, color, bright, delayMs) {
      const a = getNode(fromId);
      const b = getNode(toId);
      if (!a || !b) return;
      const startAt = performance.now() + (delayMs || 0);
      pulses.push({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        t: 0,
        speed: bright ? 0.016 : 0.006,
        color,
        bright: !!bright,
        startAt,
      });
    }

    function spawnPath(pathIds, color, bright) {
      for (let i = 0; i < pathIds.length - 1; i++) {
        spawnSegment(pathIds[i], pathIds[i + 1], color, bright, i * 90);
      }
    }

    function tick(now) {
      if (!ctx) return;
      const stage = canvas.parentElement;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (rm) return;
      const dt = 16;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        if (now < p.startAt) continue;
        p.t += p.speed * (dt / 16);
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const x = p.x0 + (p.x1 - p.x0) * p.t;
        const y = p.y0 + (p.y1 - p.y0) * p.t;
        const s = worldToScreen(x, y);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.bright ? 12 : 5;
        ctx.arc(s.x, s.y, p.bright ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    return { resize, spawnSegment, spawnPath, tick, pulses };
  }

  /** Screen-space label collision — returns true if any pair overlaps */
  function labelBBoxOverlaps(labelEls, pad) {
    const boxes = [];
    labelEls.forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || Number(st.opacity) < 0.15) return;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      boxes.push(b);
    });
    const p = pad || 2;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (
          a.left < b.right + p &&
          a.right + p > b.left &&
          a.top < b.bottom + p &&
          a.bottom + p > b.top
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function staggerGrow(selection, reduceMot) {
    if (reduceMot) {
      selection.style('opacity', null).attr('transform', (d) => `translate(${d.x},${d.y})`);
      return;
    }
    selection
      .style('opacity', 0)
      .attr('transform', (d) => `translate(${d.x},${d.y}) scale(0.35)`)
      .transition()
      .delay((_, i) => i * 40)
      .duration(280)
      .ease(d3.easeCubicOut)
      .style('opacity', (d) => d.lodAlpha ?? 1)
      .attr('transform', (d) => `translate(${d.x},${d.y}) scale(1)`);
  }

  return {
    reduceMotion,
    createFlyCamera,
    createSignalRunner,
    labelBBoxOverlaps,
    staggerGrow,
  };
})();
