// APOS Radial Organizational Map — Video-accurate with large organic trees
// Seeded deterministic layout for stability

const APOS_DATA = {
  core: {
    id: 'apos-core',
    label: 'APOS',
    description: 'Alert Platform Operating System',
  },
  departments: [
    {
      id: 'ingestion',
      label: 'INGESTION',
      subtitle: 'targeting · outreach · sequencing',
      color: '#e94e87',
      tree: [
        {
          id: 'vendon-events-sync',
          label: 'Vendon Events Sync',
          subtitle: 'Hourly sales/dispense/telemetry cache',
          icon: '📊',
          replaces: 'Manual CSV downloads from Vendon portal every morning',
          autonomy: 'fully-autonomous',
          breaksInto: ['sales-cache', 'dispense-cache', 'telemetry-cache'],
          buildsOn: ['Vendon API OAuth', 'PostgreSQL schema'],
          ladderDesc: {
            'human-led': 'Operator downloads CSV, emails it to analyst',
            'human-assisted': 'Cron job runs; analyst reviews import logs daily',
            'fully-autonomous': 'Polls Vendon API hourly; auto-retries on 429; caches in people_analytics.vendon_events'
          },
          children: [
            { id: 'sales-event-parser', label: 'Sales Parser', icon: '💰', children: [
              { id: 'kwd-normalization', label: 'KWD Norm' },
              { id: 'sku-resolver', label: 'SKU Resolver' },
              { id: 'revenue-calc', label: 'Revenue Calc' }
            ]},
            { id: 'dispense-event-parser', label: 'Dispense Parser', icon: '🔧', children: [
              { id: 'dispense-fail-detector', label: 'Fail Detector' },
              { id: 'jam-event-classifier', label: 'Jam Classifier' }
            ]},
            { id: 'telemetry-event-parser', label: 'Telemetry Parser', children: [
              { id: 'off-event-detector', label: 'Off Detector' },
              { id: 'temp-anomaly', label: 'Temp Anomaly' },
              { id: 'stock-low-alert', label: 'Stock Alert' }
            ]},
          ]
        },
        {
          id: 'remote-credits-preload',
          label: 'Remote Credits Preload',
          subtitle: 'WEB cashless credit tracking',
          icon: '💳',
          replaces: 'Operator manual credit-sent tracking in notebooks',
          autonomy: 'fully-autonomous',
          breaksInto: ['credit-fetch', 'credit-cache', 'credit-reconciliation'],
          buildsOn: ['Vendon remote credits API'],
          children: [
            { id: 'credit-fetch-job', label: 'Credit Fetch', children: [
              { id: 'web-cashless-query', label: 'WEB Query' },
              { id: 'test-vend-filter', label: 'Test Filter' },
              { id: 'refund-classifier', label: 'Refund Classifier' }
            ]},
            { id: 'lost-revenue-estimator', label: 'Lost Revenue Est', children: [
              { id: 'unidentified-credit-calc', label: 'Unidentified Calc' }
            ]}
          ]
        },
        {
          id: 'footfall-commercial-sync',
          label: 'Camera Footfall Sync',
          subtitle: 'Daily footfall from cloud cameras',
          icon: '👥',
          replaces: 'Manual daily footfall spreadsheets emailed by area managers',
          autonomy: 'fully-autonomous',
          breaksInto: ['camera-api-poller', 'footfall-enricher', 'location-mapper'],
          buildsOn: ['Camera cloud API', 'Location metadata DB'],
          children: [
            { id: 'camera-api-poller', label: 'Camera Poller', children: [
              { id: 'hourly-traffic-fetch', label: 'Hourly Traffic' },
              { id: 'unique-visitor-count', label: 'Unique Visitors' }
            ]},
            { id: 'footfall-enricher', label: 'Footfall Enricher', children: [
              { id: 'area-mapper', label: 'Area Map (Shadadiya/Zahra)' },
              { id: 'client-tagger', label: 'Client Tag (Leet/EE/Park)' },
              { id: 'conversion-calc', label: 'Conversion Calc' }
            ]}
          ]
        },
        {
          id: 'task-manager-ingestion',
          label: 'Task Manager Ingestion',
          subtitle: 'Operator attendance, cleaning, tech visits',
          icon: '📋',
          replaces: 'Paper logs for cleaning schedules and tech visit records',
          autonomy: 'human-assisted',
          breaksInto: ['attendance-sync', 'cleaning-sync', 'tech-visit-sync'],
          buildsOn: ['Workflow OAuth API'],
          children: [
            { id: 'attendance-sync', label: 'Attendance Sync', children: [
              { id: 'operator-presence', label: 'Operator Presence' },
              { id: 'shift-tracker', label: 'Shift Tracker' }
            ]},
            { id: 'cleaning-sync', label: 'Cleaning Sync', children: [
              { id: 'last-gc-timestamp', label: 'Last GC Time' },
              { id: 'next-window-calc', label: 'Next Window' },
              { id: 'cleaning-overdue-flag', label: '15h Overdue' }
            ]},
            { id: 'tech-visit-sync', label: 'Tech Visit Sync' }
          ]
        }
      ]
    },
    {
      id: 'rules-engine',
      label: 'RULES ENGINE',
      subtitle: 'alert detection · criteria · thresholds',
      color: '#ff6b3d',
      tree: [
        {
          id: 'red-flags-detector',
          label: 'Red Flags Detector',
          subtitle: '~12 criteria real-time evaluation',
          icon: '🚨',
          replaces: '24/7 manual operator monitoring via WhatsApp and phone calls',
          autonomy: 'fully-autonomous',
          breaksInto: ['stale-sales-check', 'dispense-fail-check', 'off-event-check', 'downtime-check'],
          buildsOn: ['Vendon events cache', 'Live Dashboard config'],
          children: [
            { id: 'stale-sales-check', label: 'Stale Sales Check', children: [
              { id: 'no-sales-4h', label: 'No Sales ≥4h' },
              { id: 'wtd-drop-pct', label: 'WTD Drop %' },
              { id: 'same-day-lw-drop', label: 'Same Day LW Drop' }
            ]},
            { id: 'dispense-fail-check', label: 'Dispense Fail Check', children: [
              { id: 'dispense-fail-7d', label: 'Dispense Fails 7d' },
              { id: 'dispense-fail-spike', label: 'Dispense Spike' }
            ]},
            { id: 'off-event-check', label: 'Off Event Check', children: [
              { id: 'off-events-today', label: 'Off Events Today' },
              { id: 'off-event-frequency', label: 'Off Frequency' }
            ]},
            { id: 'downtime-check', label: 'Downtime Check', children: [
              { id: 'projected-loss-5min-grace', label: 'Projected Loss (5min)' },
              { id: 'peak-band-adjust', label: 'Peak Band Adjust' }
            ]}
          ]
        },
        {
          id: 'downtime-analyzer',
          label: 'Downtime Analyzer',
          subtitle: 'Revenue loss projection with grace periods',
          icon: '⏱️',
          replaces: 'End-of-day revenue loss calculations in Excel',
          autonomy: 'fully-autonomous',
          breaksInto: ['grace-period-filter', 'peak-band-logic', 'loss-projection'],
          buildsOn: ['Red flags snapshot', 'Sales targets DB'],
          children: [
            { id: 'grace-period-filter', label: '5-Min Grace' },
            { id: 'peak-band-logic', label: 'Peak Band', children: [
              { id: 'morning-peak', label: 'Morning (8-11)' },
              { id: 'afternoon-peak', label: 'Afternoon (14-16)' }
            ]},
            { id: 'loss-projection', label: 'Loss Projection' }
          ]
        },
        {
          id: 'qa-issue-tracker',
          label: 'QA Issue Frequency',
          subtitle: 'Cross-inspection repeat issue analysis',
          icon: '✓',
          replaces: 'Manual audit report review and repeat-issue tally',
          autonomy: 'human-assisted',
          breaksInto: ['issue-matcher', 'frequency-counter', 'occurrence-dates'],
          buildsOn: ['QA visit DB', 'Findings schema'],
          children: [
            { id: 'issue-matcher', label: 'Issue Matcher' },
            { id: 'frequency-counter', label: 'Frequency Counter' },
            { id: 'occurrence-dates', label: 'Occurrence Dates' }
          ]
        }
      ]
    },
    {
      id: 'dispatch',
      label: 'DISPATCH',
      subtitle: 'workflow · operator routing · task assignment',
      color: '#4a9eff',
      tree: [
        {
          id: 'workflow-proxy',
          label: 'Workflow API Proxy',
          subtitle: 'GO CHECK / DM / cleaning dispatch',
          icon: '🔗',
          replaces: 'Direct Workflow integration per client app (tight coupling)',
          autonomy: 'fully-autonomous',
          breaksInto: ['go-check-dispatcher', 'dm-dispatcher', 'cleaning-overdue-dispatcher'],
          buildsOn: ['Task Manager OAuth', 'Operator schedule DB'],
          children: [
            { id: 'go-check-dispatcher', label: 'GO CHECK', children: [
              { id: 'machine-issue-payload', label: 'Machine Issue Payload' },
              { id: 'operator-resolver', label: 'Operator Resolver' }
            ]},
            { id: 'dm-dispatcher', label: 'DM Dispatcher' },
            { id: 'cleaning-overdue-dispatcher', label: 'Cleaning Overdue' }
          ]
        },
        {
          id: 'operator-schedule-resolver',
          label: 'Operator Schedule Resolver',
          subtitle: 'Machine → live operator mapping',
          icon: '👤',
          replaces: 'Manual operator assignment lookup via phone directory',
          autonomy: 'human-assisted',
          breaksInto: ['machine-operator-map', 'schedule-merge', 'fallback-logic'],
          buildsOn: ['Task Manager attendance', 'Local config overrides'],
          children: [
            { id: 'machine-operator-map', label: 'Machine→Operator Map' },
            { id: 'schedule-merge', label: 'Schedule Merge' },
            { id: 'fallback-logic', label: 'Fallback to Area Owner' }
          ]
        },
        {
          id: 'attendance-badge-engine',
          label: 'Attendance Badge Engine',
          subtitle: '"At Machine" real-time presence badge',
          icon: '🏷️',
          replaces: 'Phone call to confirm operator presence before dispatch',
          autonomy: 'fully-autonomous',
          breaksInto: ['web-cashless-last-access', 'schedule-presence', 'badge-renderer'],
          buildsOn: ['WEB cashless events', 'Task Manager schedule'],
          children: [
            { id: 'web-cashless-last-access', label: 'WEB Last Access' },
            { id: 'schedule-presence', label: 'Schedule Presence' },
            { id: 'badge-renderer', label: 'Badge Renderer' }
          ]
        }
      ]
    },
    {
      id: 'storage',
      label: 'STORAGE',
      subtitle: 'cache · persistence · session',
      color: '#8b5cf6',
      tree: [
        {
          id: 'postgres-cache-layer',
          label: 'PostgreSQL Cache Layer',
          subtitle: 'Vendon events, footfall, red-alert snapshot',
          icon: '🗄️',
          replaces: 'Repeated slow Vendon API calls on every page load',
          autonomy: 'fully-autonomous',
          breaksInto: ['vendon-events-table', 'remote-credits-table', 'footfall-raw-table', 'red-alert-snapshot-table'],
          buildsOn: ['PostgreSQL people_analytics schema'],
          children: [
            { id: 'vendon-events-table', label: 'vendon_events' },
            { id: 'remote-credits-table', label: 'remote_credits' },
            { id: 'footfall-raw-table', label: 'footfall_raw' },
            { id: 'red-alert-snapshot-table', label: 'red_alert_snapshot' }
          ]
        },
        {
          id: 'session-store',
          label: 'Session Store',
          subtitle: 'Google OAuth sessions + dashboard_access rules',
          icon: '🔐',
          replaces: 'Re-authentication on every page',
          autonomy: 'fully-autonomous',
          breaksInto: ['flask-session', 'redis-cache', 'dashboard-access-rules'],
          buildsOn: ['Flask backend', 'Redis (optional)'],
          children: [
            { id: 'flask-session', label: 'Flask Session' },
            { id: 'redis-cache', label: 'Redis Cache' },
            { id: 'dashboard-access-rules', label: 'dashboard_access' }
          ]
        }
      ]
    },
    {
      id: 'analytics',
      label: 'ANALYTICS',
      subtitle: 'performance · trends · aggregation',
      color: '#10b981',
      tree: [
        {
          id: 'performance-aggregator',
          label: 'Performance Aggregator',
          subtitle: 'Weekly sales + WEB cashless + product mix',
          icon: '📈',
          replaces: 'Manual weekly sales reports in Excel',
          autonomy: 'fully-autonomous',
          breaksInto: ['machine-sales-agg', 'web-cashless-agg', 'product-mix-calc'],
          buildsOn: ['Vendon events cache', 'Remote credits cache'],
          children: [
            { id: 'machine-sales-agg', label: 'Machine Sales Agg' },
            { id: 'web-cashless-agg', label: 'WEB Cashless Agg' },
            { id: 'product-mix-calc', label: 'Product Mix', children: [
              { id: 'top-5-skus', label: 'Top 5 SKUs' },
              { id: 'bottom-5-skus', label: 'Bottom 5' }
            ]}
          ]
        },
        {
          id: 'target-calculator',
          label: 'Target Calculator',
          subtitle: 'Daily/weekly revenue targets (KD or cups)',
          icon: '🎯',
          replaces: 'Spreadsheet target tracking with manual daily comparisons',
          autonomy: 'human-assisted',
          breaksInto: ['location-target-loader', 'product-target-loader', 'actual-vs-target'],
          buildsOn: ['Admin target config', 'Sales cache'],
          children: [
            { id: 'location-target-loader', label: 'Location Target' },
            { id: 'product-target-loader', label: 'Product Target (1..N)' },
            { id: 'actual-vs-target', label: 'Actual vs Target Δ' }
          ]
        },
        {
          id: 'footfall-converter',
          label: 'Footfall Converter',
          subtitle: 'Camera traffic → conversion rate + heatmaps',
          icon: '📊',
          replaces: 'Manual camera data → conversion spreadsheets',
          autonomy: 'fully-autonomous',
          breaksInto: ['traffic-aggregator', 'conversion-rate-calc', 'hourly-heatmap'],
          buildsOn: ['Footfall raw cache', 'Sales cache'],
          children: [
            { id: 'traffic-aggregator', label: 'Traffic Agg' },
            { id: 'conversion-rate-calc', label: 'Conversion Calc' },
            { id: 'hourly-heatmap', label: 'Hourly Heatmap' }
          ]
        }
      ]
    },
    {
      id: 'reporting',
      label: 'REPORTING',
      subtitle: 'exports · dashboards · PDF',
      color: '#f59e0b',
      tree: [
        {
          id: 'pdf-exporter',
          label: 'Weekly PDF Exporter',
          subtitle: 'jsPDF + html-to-image weekly product report',
          icon: '📄',
          replaces: 'Manual PowerPoint deck creation for weekly reviews',
          autonomy: 'human-led',
          breaksInto: ['chart-renderer', 'pdf-generator', 'download-trigger'],
          buildsOn: ['Performance aggregator', 'jsPDF lib', 'html-to-image lib'],
          children: [
            { id: 'chart-renderer', label: 'Chart Renderer (ECharts)' },
            { id: 'pdf-generator', label: 'PDF Generator' },
            { id: 'download-trigger', label: 'Download Trigger' }
          ]
        },
        {
          id: 'excel-workbook',
          label: 'Excel Workbook Generator',
          subtitle: 'SheetJS export for Red Flags / Overall',
          icon: '📊',
          replaces: 'Manual data copy-paste to Excel',
          autonomy: 'human-led',
          breaksInto: ['table-to-array', 'xlsx-writer', 'download-trigger-xlsx'],
          buildsOn: ['SheetJS (XLSX)', 'Table data models'],
          children: [
            { id: 'table-to-array', label: 'Table→Array' },
            { id: 'xlsx-writer', label: 'XLSX Writer' },
            { id: 'download-trigger-xlsx', label: 'Download' }
          ]
        }
      ]
    },
    {
      id: 'watchdogs',
      label: 'WATCHDOGS',
      subtitle: 'health · monitoring · stale-data alerts',
      color: '#ec4899',
      tree: [
        {
          id: 'api-health-monitor',
          label: 'API Health Monitor',
          subtitle: 'Heartbeat endpoint + DB connection check',
          icon: '💓',
          replaces: 'Manual service availability checks via ping',
          autonomy: 'fully-autonomous',
          breaksInto: ['heartbeat-endpoint', 'db-connection-check', 'cache-freshness-check'],
          buildsOn: ['Flask /health route', 'PostgreSQL pool'],
          children: [
            { id: 'heartbeat-endpoint', label: '/health Endpoint' },
            { id: 'db-connection-check', label: 'DB Connection' },
            { id: 'cache-freshness-check', label: 'Cache Freshness' }
          ]
        },
        {
          id: 'stale-data-detector',
          label: 'Stale Data Detector',
          subtitle: 'Flags snapshot older than 15 min',
          icon: '⚠️',
          replaces: 'Users reporting "old data" after manual inspection',
          autonomy: 'fully-autonomous',
          breaksInto: ['snapshot-age-check', 're-cache-trigger'],
          buildsOn: ['Red alert snapshot', 'Cronjob scheduler'],
          children: [
            { id: 'snapshot-age-check', label: 'Snapshot Age Check' },
            { id: 're-cache-trigger', label: 'Re-Cache Trigger' }
          ]
        }
      ]
    },
    {
      id: 'ui-shell',
      label: 'UI SHELL',
      subtitle: 'frontend · routing · auth context',
      color: '#06b6d4',
      tree: [
        {
          id: 'react-spa',
          label: 'React SPA',
          subtitle: 'Vite + React Router',
          icon: '⚛️',
          replaces: 'Legacy Google Apps Script HTML service',
          autonomy: 'human-led',
          breaksInto: ['routing', 'component-tree', 'state-management'],
          buildsOn: ['Vite build', 'React Router', 'TanStack Query'],
          children: [
            { id: 'routing', label: 'React Router' },
            { id: 'component-tree', label: 'Component Tree', children: [
              { id: 'red-flags-page', label: 'RedFlagsPage' },
              { id: 'overall-page', label: 'OverallPage' },
              { id: 'performance-page', label: 'PerformancePage' },
              { id: 'footfall-page', label: 'FootfallPage' },
              { id: 'admin-page', label: 'AdminPage' }
            ]},
            { id: 'state-management', label: 'TanStack Query' }
          ]
        },
        {
          id: 'auth-context',
          label: 'Auth Context',
          subtitle: 'Google sign-in + dashboard_access wrapper',
          icon: '🔒',
          replaces: 'Per-page auth checks scattered across components',
          autonomy: 'fully-autonomous',
          breaksInto: ['gsi-loader', 'session-api', 'access-guard'],
          buildsOn: ['Google GSI client', 'people-api /session'],
          children: [
            { id: 'gsi-loader', label: 'Google GSI Loader' },
            { id: 'session-api', label: 'Session API' },
            { id: 'access-guard', label: 'Access Guard' }
          ]
        }
      ]
    }
  ]
};

// Seeded RNG for deterministic layout
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

function flattenTree(tree, parentPath = []) {
  const nodes = [];
  tree.forEach((node) => {
    const nodePath = [...parentPath, node.id];
    nodes.push({ ...node, path: nodePath });
    if (node.children) {
      nodes.push(...flattenTree(node.children, nodePath));
    }
  });
  return nodes;
}

class RadialOrgMapRebuilt {
  constructor(containerId) {
    this.svg = d3.select(`#${containerId}`);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    this.currentView = 'single';
    this.currentDeptIndex = 0;
    this.selectedNodeId = null;
    this.redFlagsData = null;

    this.defs = this.svg.append('defs');
    this.setupFilters();

    this.container = this.svg.append('g').attr('class', 'map-container');

    this.zoom = d3
      .zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        this.container.attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    this.renderSingleDepartment(this.currentDeptIndex);

    this.setupControls();
    this.setupPanel();
    this.fetchRedFlags();

    window.addEventListener('resize', () => this.handleResize());
  }

  setupFilters() {
    const glowFilter = this.defs.append('filter').attr('id', 'glow-white');
    glowFilter
      .append('feGaussianBlur')
      .attr('stdDeviation', 2)
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
  }

  renderSingleDepartment(deptIndex) {
    this.currentView = 'single';
    this.currentDeptIndex = deptIndex;
    const dept = APOS_DATA.departments[deptIndex];

    this.container.selectAll('*').remove();

    document.getElementById('dept-name').textContent = dept.label;
    document.getElementById('dept-subtitle').textContent = dept.subtitle;

    const fanGroup = this.container.append('g').attr('class', 'fan-group');

    const hubX = this.centerX;
    const hubY = this.height - 120;

    fanGroup
      .append('circle')
      .attr('cx', hubX)
      .attr('cy', hubY)
      .attr('r', 40)
      .attr('fill', dept.color)
      .attr('fill-opacity', 0.3)
      .attr('stroke', dept.color)
      .attr('stroke-width', 3)
      .style('cursor', 'pointer')
      .on('click', () => this.renderFullMap());

    this.renderDepartmentTreeLarge(fanGroup, dept, hubX, hubY, 'upward');

    this.svg
      .transition()
      .duration(800)
      .call(this.zoom.transform, d3.zoomIdentity);
  }

  renderDepartmentTreeLarge(group, dept, hubX, hubY, direction) {
    const allNodes = flattenTree(dept.tree);
    const maxLevel = Math.max(...allNodes.map((n) => n.path.length));

    const rng = new SeededRandom(dept.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));

    const angleSpread = Math.PI * 1.1;
    const startAngle = direction === 'upward' ? -Math.PI / 2 - angleSpread / 2 : 0;

    const baseRadius = this.height * 0.15;
    const radiusStep = this.height * 0.12;

    allNodes.forEach((node) => {
      const level = node.path.length;
      const radiusJitter = (rng.next() - 0.5) * radiusStep * 0.4;
      const radius = baseRadius + level * radiusStep + radiusJitter;

      const siblingsAtLevel = allNodes.filter((n) => n.path.length === level);
      const indexAtLevel = siblingsAtLevel.indexOf(node);
      const angleStep = angleSpread / (siblingsAtLevel.length + 1);
      const angleJitter = (rng.next() - 0.5) * angleStep * 0.3;
      const angle = startAngle + angleStep * (indexAtLevel + 1) + angleJitter;

      const x = hubX + radius * Math.cos(angle);
      const y = hubY + radius * Math.sin(angle);

      node._x = x;
      node._y = y;

      if (level > 1) {
        const parent = allNodes.find((n) => n.id === node.path[node.path.length - 2]);
        if (parent && parent._x !== undefined) {
          group
            .append('line')
            .attr('x1', parent._x)
            .attr('y1', parent._y)
            .attr('x2', x)
            .attr('y2', y)
            .attr('stroke', 'rgba(245, 245, 247, 0.25)')
            .attr('stroke-width', level === 2 ? 1.5 : 1)
            .attr('class', 'connector-group');
        }
      } else {
        group
          .append('line')
          .attr('x1', hubX)
          .attr('y1', hubY)
          .attr('x2', x)
          .attr('y2', y)
          .attr('stroke', 'rgba(245, 245, 247, 0.4)')
          .attr('stroke-width', 2)
          .attr('class', 'connector-group');
      }

      const nodeRadius = level === 1 ? 10 : level === 2 ? 7 : 5;
      const nodeColor = level === 1 ? dept.color : '#f5f5f7';

      const nodeCircle = group
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', nodeRadius)
        .attr('fill', nodeColor)
        .attr('fill-opacity', level === 1 ? 0.6 : 0.85)
        .attr('stroke', level === 1 ? dept.color : 'none')
        .attr('stroke-width', level === 1 ? 2 : 0)
        .attr('class', 'node-group job-node-group')
        .attr('data-node-id', node.id)
        .style('cursor', 'pointer')
        .on('mouseover', function () {
          d3.select(this).transition().duration(150).attr('r', nodeRadius * 1.4);
        })
        .on('mouseout', function () {
          d3.select(this).transition().duration(150).attr('r', nodeRadius);
        })
        .on('click', () => this.openNodePanel(node, dept));

      if (level === 1 && node.label && node.icon) {
        const labelY = y > hubY ? y + 24 : y - 18;
        group
          .append('text')
          .attr('x', x)
          .attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('fill', 'rgba(45, 45, 58, 0.7)')
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .text(`${node.icon} ${node.label.split(' ')[0]}`)
          .attr('class', 'faint-label');
      }
    });
  }

  renderFullMap() {
    this.currentView = 'full';
    this.container.selectAll('*').remove();

    document.getElementById('dept-name').textContent = 'ALL DEPARTMENTS';
    document.getElementById('dept-subtitle').textContent = 'company knowledge base';

    this.drawParticleCoreLarge();

    const count = APOS_DATA.departments.length;
    const innerRadius = 180;
    const outerRadius = Math.min(this.width, this.height) * 0.42;

    APOS_DATA.departments.forEach((dept, i) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      const deptX = this.centerX + innerRadius * Math.cos(angle);
      const deptY = this.centerY + innerRadius * Math.sin(angle);

      dept._x = deptX;
      dept._y = deptY;
      dept._angle = angle;

      const faintLabelRadius = outerRadius + 80;
      const faintLabelX = this.centerX + faintLabelRadius * Math.cos(angle);
      const faintLabelY = this.centerY + faintLabelRadius * Math.sin(angle);

      this.container
        .append('text')
        .attr('x', faintLabelX)
        .attr('y', faintLabelY)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(45, 45, 58, 0.08)')
        .attr('font-size', '56px')
        .attr('font-weight', '300')
        .attr('letter-spacing', '0.25em')
        .attr('text-transform', 'uppercase')
        .text(dept.label)
        .attr('class', 'faint-label');

      const deptGroup = this.container.append('g').attr('class', 'department-node-group');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 28)
        .attr('fill', dept.color)
        .attr('fill-opacity', 0.3)
        .attr('stroke', dept.color)
        .attr('stroke-width', 3)
        .style('cursor', 'pointer')
        .on('click', () => this.renderSingleDepartment(i));

      this.renderLargeDenseTree(deptGroup, dept, deptX, deptY, angle);
    });

    this.svg
      .transition()
      .duration(800)
      .call(this.zoom.transform, d3.zoomIdentity);
  }

  renderLargeDenseTree(group, dept, centerX, centerY, baseAngle) {
    const allNodes = flattenTree(dept.tree);
    const rng = new SeededRandom(dept.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));

    const angleSpread = (Math.PI * 2) / APOS_DATA.departments.length * 0.85;
    const startAngle = baseAngle - angleSpread / 2;

    const innerRadius = 35;
    const maxRadius = Math.min(this.width, this.height) * 0.20;

    allNodes.forEach((node) => {
      const level = node.path.length;
      const radiusJitter = (rng.next() - 0.5) * 15;
      const radiusBase = innerRadius + (level / 4) * maxRadius;
      const radius = radiusBase + radiusJitter;

      const siblingsAtLevel = allNodes.filter((n) => n.path.length === level);
      const indexAtLevel = siblingsAtLevel.indexOf(node);
      const angleStep = angleSpread / (siblingsAtLevel.length + 1);
      const angleJitter = (rng.next() - 0.5) * angleStep * 0.4;
      const angle = startAngle + angleStep * (indexAtLevel + 1) + angleJitter;

      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      node._miniX = x;
      node._miniY = y;

      if (level > 1) {
        const parent = allNodes.find((n) => n.id === node.path[node.path.length - 2]);
        if (parent && parent._miniX !== undefined) {
          group
            .append('line')
            .attr('x1', parent._miniX)
            .attr('y1', parent._miniY)
            .attr('x2', x)
            .attr('y2', y)
            .attr('stroke', 'rgba(245, 245, 247, 0.2)')
            .attr('stroke-width', 0.8)
            .attr('class', 'connector-group');
        }
      } else {
        group
          .append('line')
          .attr('x1', centerX)
          .attr('y1', centerY)
          .attr('x2', x)
          .attr('y2', y)
          .attr('stroke', 'rgba(245, 245, 247, 0.3)')
          .attr('stroke-width', 1.2)
          .attr('class', 'connector-group');
      }

      const nodeRadius = level === 1 ? 4 : level === 2 ? 3 : 2;

      group
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', nodeRadius)
        .attr('fill', level === 1 ? dept.color : '#f5f5f7')
        .attr('fill-opacity', level === 1 ? 0.7 : 0.6)
        .attr('class', 'node-group');
    });
  }

  drawParticleCoreLarge() {
    const particleGroup = this.container.append('g').attr('class', 'particle-group');
    const particleCount = 1500;
    const coreRadius = 120;

    const rng = new SeededRandom(12345);

    for (let i = 0; i < particleCount; i++) {
      const angle = rng.next() * Math.PI * 2;
      const r = Math.pow(rng.next(), 0.7) * coreRadius;
      const x = this.centerX + r * Math.cos(angle);
      const y = this.centerY + r * Math.sin(angle);
      const size = rng.next() * 2.5 + 0.5;
      const colors = ['#e94e87', '#ff6b3d', '#4a9eff'];
      const color = colors[Math.floor(rng.next() * colors.length)];

      particleGroup
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', size)
        .attr('fill', color)
        .attr('fill-opacity', rng.next() * 0.5 + 0.3);
    }

    particleGroup
      .transition()
      .duration(20000)
      .ease(d3.easeLinear)
      .attrTween('transform', () => {
        return (t) => `rotate(${t * 360}, ${this.centerX}, ${this.centerY})`;
      })
      .on('end', function repeat() {
        d3.select(this)
          .transition()
          .duration(20000)
          .ease(d3.easeLinear)
          .attrTween('transform', () => {
            return (t) => `rotate(${t * 360}, ${this.centerX}, ${this.centerY})`;
          })
          .on('end', repeat);
      });
  }

  openNodePanel(node, dept) {
    this.selectedNodeId = node.id;
    const panel = document.getElementById('detail-panel');

    document.getElementById('job-category').textContent = (node.autonomy || 'fully-autonomous').replace(/-/g, ' ').toUpperCase();
    document.getElementById('job-title-panel').textContent = node.label;
    document.getElementById('job-subtitle-panel').textContent = node.subtitle || '—';

    if (node.breaksInto) {
      document.getElementById('breaks-into').innerHTML = node.breaksInto
        .map((t) => `<span class="pill-tag">${t}</span>`)
        .join('');
    }

    if (node.buildsOn) {
      document.getElementById('builds-on').innerHTML = node.buildsOn
        .map((t) => `<span class="pill-tag">${t}</span>`)
        .join('');
    }

    document.getElementById('replaces-text-panel').textContent = node.replaces || '—';

    document.querySelectorAll('.ladder-item').forEach((el) => el.classList.remove('active'));
    const activeLevel = document.querySelector(`.ladder-item[data-level="${node.autonomy || 'fully-autonomous'}"]`);
    if (activeLevel) {
      activeLevel.classList.add('active');
      if (node.ladderDesc) {
        document.getElementById('ladder-human-led').textContent = node.ladderDesc['human-led'] || '';
        document.getElementById('ladder-human-assisted').textContent = node.ladderDesc['human-assisted'] || '';
        document.getElementById('ladder-fully-autonomous').textContent = node.ladderDesc['fully-autonomous'] || '';
      }
    }

    panel.classList.add('open');
  }

  closePanel() {
    document.getElementById('detail-panel').classList.remove('open');
    this.selectedNodeId = null;
  }

  cycleDepartment(direction) {
    const count = APOS_DATA.departments.length;
    if (direction === 'next') {
      this.currentDeptIndex = (this.currentDeptIndex + 1) % count;
    } else {
      this.currentDeptIndex = (this.currentDeptIndex - 1 + count) % count;
    }
    this.renderSingleDepartment(this.currentDeptIndex);
  }

  setupControls() {
    document.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 1.3);
    });

    document.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 0.7);
    });

    document.querySelector('[data-action="reset"]').addEventListener('click', () => {
      if (this.currentView === 'single') {
        this.renderFullMap();
      } else {
        this.renderSingleDepartment(this.currentDeptIndex);
      }
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
  }

  setupPanel() {
    document.querySelector('.panel-close').addEventListener('click', () => {
      this.closePanel();
    });

    document.getElementById('run-skill-cta').addEventListener('click', () => {
      alert('Run Skill: Feature not yet wired to backend automation.');
    });

    document.getElementById('take-skill').addEventListener('click', () => {
      alert('Skill file download: Feature not yet implemented.');
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
        console.warn('Red flags API returned non-OK; using mock fallback.');
        this.redFlagsData = { rows: [] };
      }
    } catch (err) {
      console.warn('Red flags API unavailable; using mock fallback.', err);
      this.redFlagsData = { rows: [] };
    }

    setInterval(() => this.fetchRedFlags(), 60000);
  }

  updateAlertPulse() {
    const hasAlerts = this.redFlagsData && this.redFlagsData.rows && this.redFlagsData.rows.length > 0;

    const redFlagsNode = d3.select('.job-node-group[data-node-id="red-flags-detector"],circle[data-node-id="red-flags-detector"]');
    if (hasAlerts) {
      redFlagsNode
        .attr('fill', '#ef4444')
        .style('animation', 'pulse-alert 1.5s ease-in-out infinite');
    } else {
      redFlagsNode.attr('fill', null).style('animation', 'none');
    }
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    if (this.currentView === 'single') {
      this.renderSingleDepartment(this.currentDeptIndex);
    } else {
      this.renderFullMap();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new RadialOrgMapRebuilt('org-map-svg');
});
