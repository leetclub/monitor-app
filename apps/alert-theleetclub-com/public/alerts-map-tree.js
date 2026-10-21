/**
 * r22 — adapt LEET_ALERTS_DATA → skilltree TREE shape
 * department → functions → jobs  ≡  category → subtypes → sites (capped)
 */
(function () {
  const L = (name, desc, skills, tools, level) => ({
    name,
    desc,
    skills: skills || [],
    tools: tools || [],
    level: level || 'autonomous',
  });
  const F = (name, jobs) => ({ name, jobs });

  function levelForAlert(alert) {
    if (!alert) return 'manual';
    if (alert.state === 'CRITICAL') return 'autonomous';
    if (alert.state === 'WARNING') return 'assisted';
    return 'manual';
  }

  function addJob(jobs, name, desc, skills, level, meta) {
    // unique names (PLAYBOOK / node keys)
    let jobName = name;
    let n = 2;
    while (jobs.some((j) => j.name === jobName)) jobName = `${name} ·${n++}`;
    const job = L(jobName, desc, skills.map((s) => s.label || s), [], level);
    job._leet = meta || null;
    jobs.push(job);
    if (!window.PLAYBOOK) window.PLAYBOOK = {};
    window.PLAYBOOK[jobName] = {
      files: skills,
      human: 'Ops owns assignment; technicians close the site.',
      notes: desc,
    };
  }

  function jobsFromSubtype(subNode) {
    const jobs = [];
    const sites = [];
    const machinesFlat = [];
    (subNode.children || []).forEach((area) => {
      (area.children || []).forEach((site) => {
        sites.push({ area, site });
        (site.children || []).forEach((m) => machinesFlat.push({ area, site, m }));
      });
    });

    // Prefer sites as jobs (skilltree density ≈ 3–5 / function). If sparse, promote machines.
    const siteCap = 5;
    if (sites.length >= 3) {
      sites.slice(0, siteCap).forEach(({ area, site }) => {
        const machines = site.children || [];
        const hot = machines.filter((x) => x.alert && x.alert.hot);
        const sample = hot[0] || machines[0];
        const alert = sample && sample.alert;
        const skills = machines.slice(0, 3).map((m) => ({
          label: m.label,
          path: `leet/${m.id || m.label}`,
        }));
        const desc = alert
          ? `${alert.title} · ${area.label}`
          : `${machines.length} machine${machines.length === 1 ? '' : 's'} at ${site.label} (${area.label})`;
        addJob(jobs, site.label, desc, skills, levelForAlert(alert), {
          area: area.label, site: site.label, machines, alert,
        });
      });
    } else {
      const pool = machinesFlat.length ? machinesFlat : [];
      const picked = pool.slice(0, 5);
      if (!picked.length) {
        addJob(jobs, subNode.label, `${subNode.label} · no sites yet`, [], 'manual', null);
        return jobs;
      }
      // pad to at least 3 rings when fleet is thin
      const target = Math.max(3, Math.min(5, picked.length));
      for (let i = 0; i < target; i++) {
        const { area, site, m } = picked[i % picked.length];
        const alert = m.alert;
        const skills = [{ label: m.label, path: `leet/${m.id || m.label}` }];
        const name = m.label;
        const desc = alert
          ? `${alert.title} · ${site.label}`
          : `${m.label} at ${site.label} (${area.label})`;
        addJob(jobs, name, desc, skills, levelForAlert(alert), {
          area: area.label, site: site.label, machines: [m], alert,
        });
      }
    }
    return jobs;
  }

  function categoryToDept(cat) {
    const tree = cat.tree;
    const functions = (tree.children || []).map((sub) => F(sub.label, jobsFromSubtype(sub)));
    return {
      name: cat.label,
      sub: (cat.subtitle || '').toLowerCase().replace(/\s*·\s*/g, ' · '),
      color: cat.color,
      intro:
        `${cat.label} covers ${cat.subtitle}. ` +
        `${cat.count} open alert${cat.count === 1 ? '' : 's'} across the Leet fleet. ` +
        (cat.action || ''),
      functions,
    };
  }

  function build() {
    if (!window.LEET_ALERTS_DATA) {
      window.LEET_SKILLTREE_TREE = [];
      return;
    }
    const snap = window.LEET_ALERTS_DATA.buildSnapshot();
    window.LEET_ALERTS_SNAPSHOT = snap;
    window.PLAYBOOK = window.PLAYBOOK || {};
    window.LEET_SKILLTREE_TREE = snap.categories.map(categoryToDept);
  }

  build();
})();
