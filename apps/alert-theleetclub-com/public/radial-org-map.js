// APOS Radial Organizational Map
// Flat 2D radial layout inspired by skilltree.ai — NOT 3D galaxy

const APOS_ORG_DATA = {
  core: {
    id: 'apos-core',
    label: 'APOS',
    subtitle: 'Alert Platform Operating System',
  },
  departments: [
    {
      id: 'ingestion',
      label: 'Ingestion',
      subtitle: 'Data collection & sync',
      color: '#00d4ff',
      jobs: [
        {
          id: 'vendon-sync',
          label: 'Vendon Events Sync',
          replaces: 'Manual CSV downloads from Vendon portal',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/vendon/events/cache',
          instructions: 'Polls Vendon API hourly; caches sales/dispense/telemetry in PostgreSQL.',
        },
        {
          id: 'remote-credits-sync',
          label: 'Remote Credits Preload',
          replaces: 'Operator manual credit-sent tracking',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/remote-credits/preload',
          instructions: 'Pre-caches remote credit data; reduces real-time load on Vendon APIs.',
        },
        {
          id: 'footfall-sync',
          label: 'Camera Footfall Sync',
          replaces: 'Manual daily footfall spreadsheets',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/footfall/commercial/cache',
          instructions: 'Syncs camera data from cloud; enriches with location metadata.',
        },
        {
          id: 'task-manager-sync',
          label: 'Task Manager Ingestion',
          replaces: 'Paper logs for cleaning & tech schedules',
          autonomy: 'human-assisted',
          endpoint: 'GET /api/alert/task-manager/*',
          instructions: 'Pulls operator attendance, cleaning schedules, tech visits from Workflow API.',
        },
      ],
    },
    {
      id: 'rules-engine',
      label: 'Rules Engine',
      subtitle: 'Alert detection & criteria',
      color: '#ec4899',
      jobs: [
        {
          id: 'red-flags-detector',
          label: 'Red Flags Detector',
          replaces: '24/7 manual operator monitoring',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/red-flags/snapshot',
          instructions: 'Evaluates ~12 criteria (stale sales, dispense fails, off events); generates real-time alerts.',
        },
        {
          id: 'downtime-analyzer',
          label: 'Downtime Analyzer',
          replaces: 'End-of-day revenue loss calculations',
          autonomy: 'fully-autonomous',
          endpoint: 'POST /api/alert/downtime/calculate',
          instructions: 'Projects lost revenue with 5-min grace + peak band adjustments.',
        },
        {
          id: 'qa-issue-tracker',
          label: 'QA Issue Frequency',
          replaces: 'Manual audit report review',
          autonomy: 'human-assisted',
          endpoint: 'GET /api/alert/qa-visits/{id}/issues',
          instructions: 'Cross-inspection analysis: counts repeat issues, surfaces trend.',
        },
      ],
    },
    {
      id: 'dispatch',
      label: 'Dispatch',
      subtitle: 'Workflow & operator routing',
      color: '#10b981',
      jobs: [
        {
          id: 'workflow-proxy',
          label: 'Workflow API Proxy',
          replaces: 'Direct Workflow integration per client app',
          autonomy: 'fully-autonomous',
          endpoint: 'POST /api/alert/workflow/dispatch',
          instructions: 'Proxies GO CHECK / DM / cleaning tasks to Task Manager via OAuth.',
        },
        {
          id: 'operator-schedule',
          label: 'Operator Schedule Resolver',
          replaces: 'Manual operator assignment lookup',
          autonomy: 'human-assisted',
          endpoint: 'GET /api/alert/operators/{id}/schedule',
          instructions: 'Maps machine → live operator from Task Manager + local config.',
        },
        {
          id: 'attendance-badges',
          label: 'Attendance Badge Engine',
          replaces: 'Phone call to confirm operator presence',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/operators/attendance',
          instructions: 'Real-time WEB cashless last-access + schedule presence → "At Machine" badge.',
        },
      ],
    },
    {
      id: 'storage',
      label: 'Storage',
      subtitle: 'Cache & persistence',
      color: '#f59e0b',
      jobs: [
        {
          id: 'postgres-cache',
          label: 'PostgreSQL Cache Layer',
          replaces: 'Repeated slow Vendon API calls',
          autonomy: 'fully-autonomous',
          endpoint: 'Direct DB: people_analytics schema',
          instructions: 'Caches vendon_events, remote_credits, footfall_raw, red_alert_snapshot.',
        },
        {
          id: 'session-store',
          label: 'Session Store',
          replaces: 'Re-authentication on every page',
          autonomy: 'fully-autonomous',
          endpoint: 'Internal: Flask session / Redis',
          instructions: 'Google OAuth sessions; dashboard_access rules from PostgreSQL.',
        },
      ],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      subtitle: 'Performance & trends',
      color: '#a855f7',
      jobs: [
        {
          id: 'performance-aggregator',
          label: 'Performance Aggregator',
          replaces: 'Manual weekly sales reports',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/performance/weekly',
          instructions: 'Combines machine sales + WEB cashless + product mix for PDF export.',
        },
        {
          id: 'target-calculator',
          label: 'Target Calculator',
          replaces: 'Spreadsheet target tracking',
          autonomy: 'human-assisted',
          endpoint: 'GET /api/alert/targets/{locationId}',
          instructions: 'Daily/weekly revenue targets (KD or cups); compares actual vs target.',
        },
        {
          id: 'footfall-converter',
          label: 'Footfall Converter',
          replaces: 'Manual camera data → conversion spreadsheets',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /api/alert/footfall/conversion',
          instructions: 'Camera traffic + sales → conversion rate + hourly heatmaps.',
        },
      ],
    },
    {
      id: 'reporting',
      label: 'Reporting',
      subtitle: 'Exports & dashboards',
      color: '#fb923c',
      jobs: [
        {
          id: 'pdf-exporter',
          label: 'Weekly PDF Exporter',
          replaces: 'Manual PowerPoint deck creation',
          autonomy: 'human-led',
          endpoint: 'POST /api/alert/performance/export-pdf',
          instructions: 'Generates weekly product performance PDF with jsPDF + html-to-image.',
        },
        {
          id: 'excel-workbook',
          label: 'Excel Workbook Generator',
          replaces: 'Manual data copy-paste to Excel',
          autonomy: 'human-led',
          endpoint: 'Client-side: SheetJS (XLSX)',
          instructions: 'Exports Red Flags / Overall / Performance tables to .xlsx on demand.',
        },
      ],
    },
    {
      id: 'watchdogs',
      label: 'Watchdogs',
      subtitle: 'Health & monitoring',
      color: '#6366f1',
      jobs: [
        {
          id: 'api-health',
          label: 'API Health Monitor',
          replaces: 'Manual service availability checks',
          autonomy: 'fully-autonomous',
          endpoint: 'GET /health',
          instructions: 'Heartbeat endpoint; checks DB connection + cache freshness.',
        },
        {
          id: 'stale-data-alert',
          label: 'Stale Data Detector',
          replaces: 'Users reporting "old data"',
          autonomy: 'fully-autonomous',
          endpoint: 'Internal: snapshot age check',
          instructions: 'Flags red-flags snapshot older than 15 min; triggers re-cache.',
        },
      ],
    },
    {
      id: 'ui-shell',
      label: 'UI Shell',
      subtitle: 'Frontend & routing',
      color: '#0ff',
      jobs: [
        {
          id: 'react-app',
          label: 'React SPA',
          replaces: 'Legacy Google Apps Script HTML service',
          autonomy: 'human-led',
          endpoint: 'Static build: Vite + React Router',
          instructions: 'Client-side routing for /red-flags, /overall, /performance, /footfall, /admin.',
        },
        {
          id: 'auth-context',
          label: 'Auth Context',
          replaces: 'Per-page auth checks',
          autonomy: 'fully-autonomous',
          endpoint: 'React Context + /api/alert/session',
          instructions: 'Wraps app; enforces Google sign-in + dashboard_access rules.',
        },
      ],
    },
  ],
};

class RadialOrgMap {
  constructor(containerId) {
    this.svg = d3.select(`#${containerId}`);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    this.currentDepartmentIndex = null;
    this.selectedJobId = null;
    this.redFlagsData = null;

    this.defs = this.svg.append('defs');
    this.setupFilters();

    this.container = this.svg.append('g').attr('class', 'map-container');

    this.zoom = d3
      .zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        this.container.attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    this.drawDotGrid();
    this.drawOrbitalGuides();
    this.drawCore();
    this.drawDepartments();
    this.drawJobs();
    this.drawConnectors();
    this.animateSignals();

    this.setupControls();
    this.setupDrawer();
    this.fetchRedFlags();

    window.addEventListener('resize', () => this.handleResize());
  }

  setupFilters() {
    const glowFilter = this.defs.append('filter').attr('id', 'glow');
    glowFilter
      .append('feGaussianBlur')
      .attr('stdDeviation', 4)
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
  }

  drawDotGrid() {
    const dotSpacing = 30;
    const dotRadius = 1;
    const gridGroup = this.container.append('g').attr('class', 'dot-grid');

    for (let x = 0; x < this.width; x += dotSpacing) {
      for (let y = 0; y < this.height; y += dotSpacing) {
        gridGroup
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', dotRadius)
          .attr('fill', 'rgba(100, 116, 139, 0.15)');
      }
    }
  }

  drawOrbitalGuides() {
    const orbitalGroup = this.container.append('g').attr('class', 'orbital-guides');
    const radii = [180, 280, 450];

    radii.forEach((r) => {
      orbitalGroup
        .append('circle')
        .attr('cx', this.centerX)
        .attr('cy', this.centerY)
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(100, 116, 139, 0.15)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4');
    });
  }

  drawCore() {
    const coreGroup = this.container.append('g').attr('class', 'core-group');

    const coreGradient = this.defs
      .append('radialGradient')
      .attr('id', 'core-gradient')
      .attr('cx', '50%')
      .attr('cy', '50%');
    coreGradient.append('stop').attr('offset', '0%').attr('stop-color', '#00d4ff').attr('stop-opacity', 0.8);
    coreGradient.append('stop').attr('offset', '50%').attr('stop-color', '#7c3aed').attr('stop-opacity', 0.5);
    coreGradient.append('stop').attr('offset', '100%').attr('stop-color', '#ec4899').attr('stop-opacity', 0.2);

    coreGroup
      .append('circle')
      .attr('cx', this.centerX)
      .attr('cy', this.centerY)
      .attr('r', 80)
      .attr('fill', 'url(#core-gradient)')
      .attr('filter', 'url(#glow)')
      .style('animation', 'pulse-glow 3s ease-in-out infinite');

    coreGroup
      .append('circle')
      .attr('cx', this.centerX)
      .attr('cy', this.centerY)
      .attr('r', 95)
      .attr('fill', 'none')
      .attr('stroke', '#00d4ff')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4);

    coreGroup
      .append('text')
      .attr('x', this.centerX)
      .attr('y', this.centerY - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .attr('font-size', '32px')
      .attr('font-weight', '800')
      .attr('letter-spacing', '0.15em')
      .text('APOS');

    coreGroup
      .append('text')
      .attr('x', this.centerX)
      .attr('y', this.centerY + 20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text('Alert Platform OS');
  }

  drawDepartments() {
    const deptGroup = this.container.append('g').attr('class', 'departments-group');
    const radius = 280;
    const count = APOS_ORG_DATA.departments.length;

    APOS_ORG_DATA.departments.forEach((dept, i) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      const x = this.centerX + radius * Math.cos(angle);
      const y = this.centerY + radius * Math.sin(angle);

      dept._x = x;
      dept._y = y;
      dept._angle = angle;

      const deptNode = deptGroup.append('g').attr('class', 'department-node').attr('data-dept-id', dept.id);

      deptNode
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 50)
        .attr('fill', 'none')
        .attr('stroke', dept.color)
        .attr('stroke-width', 3)
        .attr('filter', 'url(#glow)')
        .style('cursor', 'pointer');

      deptNode
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 45)
        .attr('fill', `${dept.color}22`)
        .style('cursor', 'pointer');

      deptNode
        .append('text')
        .attr('x', x)
        .attr('y', y - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', '13px')
        .attr('font-weight', '700')
        .attr('text-transform', 'uppercase')
        .attr('letter-spacing', '0.05em')
        .text(dept.label)
        .style('cursor', 'pointer')
        .style('pointer-events', 'none');

      deptNode
        .append('text')
        .attr('x', x)
        .attr('y', y + 10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#94a3b8')
        .attr('font-size', '9px')
        .text(dept.subtitle)
        .style('pointer-events', 'none');

      deptNode.on('click', () => this.zoomToDepartment(i));
    });
  }

  drawJobs() {
    const jobsGroup = this.container.append('g').attr('class', 'jobs-group');

    APOS_ORG_DATA.departments.forEach((dept, deptIdx) => {
      const jobCount = dept.jobs.length;
      const deptRadius = 280;
      const branchLength = 120;
      const jobRadius = 12;

      dept.jobs.forEach((job, jobIdx) => {
        const branchAngle = dept._angle + ((jobIdx - (jobCount - 1) / 2) * Math.PI) / (jobCount * 1.2);

        const branchStartX = dept._x;
        const branchStartY = dept._y;
        const branchEndX = dept._x + branchLength * Math.cos(branchAngle);
        const branchEndY = dept._y + branchLength * Math.sin(branchAngle);

        job._x = branchEndX;
        job._y = branchEndY;
        job._deptId = dept.id;
        job._deptColor = dept.color;

        const jobNode = jobsGroup.append('g').attr('class', 'job-node').attr('data-job-id', job.id);

        jobNode
          .append('circle')
          .attr('cx', branchEndX)
          .attr('cy', branchEndY)
          .attr('r', jobRadius)
          .attr('fill', dept.color)
          .attr('stroke', '#0a0f1e')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('mouseover', function () {
            d3.select(this).transition().duration(150).attr('r', jobRadius * 1.3);
          })
          .on('mouseout', function () {
            d3.select(this).transition().duration(150).attr('r', jobRadius);
          })
          .on('click', () => this.openJobDrawer(job));

        if (jobIdx === Math.floor(jobCount / 2)) {
          const labelOffset = 25;
          const labelX = branchEndX + labelOffset * Math.cos(branchAngle);
          const labelY = branchEndY + labelOffset * Math.sin(branchAngle);

          jobNode
            .append('text')
            .attr('x', labelX)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('fill', '#94a3b8')
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .text(job.label.split(' ')[0])
            .style('pointer-events', 'none');
        }
      });
    });
  }

  drawConnectors() {
    const connectorGroup = this.container.append('g').attr('class', 'connectors-group');

    APOS_ORG_DATA.departments.forEach((dept) => {
      const deptCenterX = dept._x;
      const deptCenterY = dept._y;

      connectorGroup
        .append('line')
        .attr('x1', this.centerX)
        .attr('y1', this.centerY)
        .attr('x2', deptCenterX)
        .attr('y2', deptCenterY)
        .attr('stroke', dept.color)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.3);

      dept.jobs.forEach((job) => {
        const path = d3.path();
        path.moveTo(deptCenterX, deptCenterY);

        const cpX = (deptCenterX + job._x) / 2 + (Math.random() - 0.5) * 20;
        const cpY = (deptCenterY + job._y) / 2 + (Math.random() - 0.5) * 20;

        path.quadraticCurveTo(cpX, cpY, job._x, job._y);

        connectorGroup
          .append('path')
          .attr('d', path.toString())
          .attr('stroke', dept.color)
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.4)
          .attr('fill', 'none')
          .attr('stroke-dasharray', '3 3');
      });
    });
  }

  animateSignals() {
    const signalsGroup = this.container.append('g').attr('class', 'signals-group');

    APOS_ORG_DATA.departments.forEach((dept) => {
      dept.jobs.forEach((job) => {
        const signal = signalsGroup
          .append('circle')
          .attr('cx', dept._x)
          .attr('cy', dept._y)
          .attr('r', 3)
          .attr('fill', dept.color)
          .attr('filter', 'url(#glow)')
          .style('opacity', 0.8);

        const animate = () => {
          signal
            .attr('cx', dept._x)
            .attr('cy', dept._y)
            .transition()
            .duration(2000 + Math.random() * 2000)
            .ease(d3.easeLinear)
            .attr('cx', job._x)
            .attr('cy', job._y)
            .style('opacity', 0)
            .on('end', () => {
              signal.style('opacity', 0.8);
              setTimeout(animate, Math.random() * 3000);
            });
        };

        setTimeout(animate, Math.random() * 5000);
      });
    });
  }

  zoomToDepartment(index) {
    this.currentDepartmentIndex = index;
    const dept = APOS_ORG_DATA.departments[index];

    document.getElementById('current-department').textContent = dept.label;

    const scale = 1.8;
    const translateX = this.width / 2 - dept._x * scale;
    const translateY = this.height / 2 - dept._y * scale;

    this.svg
      .transition()
      .duration(800)
      .call(
        this.zoom.transform,
        d3.zoomIdentity.translate(translateX, translateY).scale(scale)
      );
  }

  resetView() {
    this.currentDepartmentIndex = null;
    document.getElementById('current-department').textContent = 'All Departments';

    this.svg
      .transition()
      .duration(800)
      .call(this.zoom.transform, d3.zoomIdentity);
  }

  cycleDepartment(direction) {
    const count = APOS_ORG_DATA.departments.length;
    if (this.currentDepartmentIndex === null) {
      this.zoomToDepartment(direction === 'next' ? 0 : count - 1);
    } else {
      const nextIndex =
        direction === 'next'
          ? (this.currentDepartmentIndex + 1) % count
          : (this.currentDepartmentIndex - 1 + count) % count;
      this.zoomToDepartment(nextIndex);
    }
  }

  openJobDrawer(job) {
    this.selectedJobId = job.id;
    const drawer = document.getElementById('detail-drawer');

    document.getElementById('job-title').textContent = job.label;
    document.getElementById('job-department').textContent = job._deptId.toUpperCase();
    document.getElementById('replaces-text').textContent = job.replaces;
    document.getElementById('endpoint-info').textContent = `Endpoint: ${job.endpoint}`;
    document.getElementById('code-block').textContent = job.instructions;

    document.querySelectorAll('.ladder-item').forEach((el) => el.classList.remove('active'));
    const activeLevel = document.querySelector(`.ladder-item[data-level="${job.autonomy}"]`);
    if (activeLevel) activeLevel.classList.add('active');

    drawer.classList.add('open');

    const isAlert = this.redFlagsData && this.redFlagsData.rows && this.redFlagsData.rows.length > 0;
    const jobNode = d3.select(`.job-node[data-job-id="${job.id}"] circle`);
    if (isAlert && job.id === 'red-flags-detector') {
      jobNode.attr('fill', '#ef4444');
    }
  }

  closeDrawer() {
    document.getElementById('detail-drawer').classList.remove('open');
    this.selectedJobId = null;
  }

  setupControls() {
    document.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 1.3);
    });

    document.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 0.7);
    });

    document.querySelector('[data-action="reset"]').addEventListener('click', () => {
      this.resetView();
    });

    document.querySelector('[data-dir="prev"]').addEventListener('click', () => {
      this.cycleDepartment('prev');
    });

    document.querySelector('[data-dir="next"]').addEventListener('click', () => {
      this.cycleDepartment('next');
    });

    document.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const view = e.target.dataset.view;
        if (view === 'dashboards') {
          window.location.href = '/';
        }
      });
    });

    this.svg.on('dblclick.zoom', () => this.resetView());
  }

  setupDrawer() {
    document.querySelector('.drawer-close').addEventListener('click', () => {
      this.closeDrawer();
    });

    document.getElementById('run-skill-btn').addEventListener('click', () => {
      alert('Run Skill: Feature not yet wired to backend automation.');
    });

    document.getElementById('view-payload-btn').addEventListener('click', () => {
      if (this.selectedJobId) {
        const allJobs = APOS_ORG_DATA.departments.flatMap((d) => d.jobs);
        const job = allJobs.find((j) => j.id === this.selectedJobId);
        if (job) {
          alert(`Payload preview:\n\n${JSON.stringify({ job: job.label, endpoint: job.endpoint }, null, 2)}`);
        }
      }
    });

    document.getElementById('workflow-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const description = document.getElementById('task-description').value;
      const recipient = document.getElementById('task-recipient').value;
      const priority = document.getElementById('task-priority').value;

      console.log('TODO Workflow stub called:', { description, recipient, priority });
      alert(`Task created:\nRecipient: ${recipient}\nPriority: ${priority}\n\n"${description}"\n\n(Workflow integration pending)`);

      document.getElementById('task-description').value = '';
      document.getElementById('task-recipient').value = '';
      document.getElementById('task-priority').value = 'medium';
    });
  }

  async fetchRedFlags() {
    try {
      const response = await fetch('/api/alert/red-flags/snapshot', {
        credentials: 'include',
      });
      if (response.ok) {
        this.redFlagsData = await response.json();
        this.updateAlertPulse();
      } else {
        console.warn('Red flags API returned non-OK; falling back to mock.');
        this.redFlagsData = { rows: [] };
      }
    } catch (err) {
      console.warn('Red flags API unavailable (CORS or auth); using mock fallback.', err);
      this.redFlagsData = { rows: [] };
    }

    setInterval(() => this.fetchRedFlags(), 60000);
  }

  updateAlertPulse() {
    const hasAlerts = this.redFlagsData && this.redFlagsData.rows && this.redFlagsData.rows.length > 0;

    const redFlagsNode = d3.select('.job-node[data-job-id="red-flags-detector"] circle');
    if (hasAlerts) {
      redFlagsNode
        .attr('fill', '#ef4444')
        .style('animation', 'pulse-glow 1.5s ease-in-out infinite');
    } else {
      redFlagsNode.attr('fill', '#ec4899').style('animation', 'none');
    }
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    this.svg.selectAll('*').remove();
    this.defs = this.svg.append('defs');
    this.setupFilters();
    this.container = this.svg.append('g').attr('class', 'map-container');
    this.svg.call(this.zoom);

    this.drawDotGrid();
    this.drawOrbitalGuides();
    this.drawCore();
    this.drawDepartments();
    this.drawJobs();
    this.drawConnectors();
    this.animateSignals();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new RadialOrgMap('org-map-svg');
});
