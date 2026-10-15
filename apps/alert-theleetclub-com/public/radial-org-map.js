// APOS Radial Organizational Map — Single continuous tree world
// Camera navigation with smooth zoom/pan, anchored data cards

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
      subtitle: 'Data collection & sync',
      color: '#e94e87',
      icon: 'database',
      metrics: { today: '2.4K events', alerts: 0, uptime: '99.8%' },
      tree: [
        {
          id: 'vendon-events-sync',
          label: 'Vendon Events Sync',
          subtitle: 'Hourly sales/dispense/telemetry',
          icon: 'activity',
          metrics: { today: '1.2K', status: 'green', uptime: '100%' },
          children: [
            { id: 'sales-event-parser', label: 'Sales Parser', icon: 'dollar-sign', metrics: { today: '450', status: 'green' }, children: [
              { id: 'kwd-normalization', label: 'KWD Norm', metrics: { processed: '450' } },
              { id: 'sku-resolver', label: 'SKU Resolver', metrics: { matched: '98%' } },
              { id: 'revenue-calc', label: 'Revenue Calc', metrics: { total: '₪12.4K' } }
            ]},
            { id: 'dispense-event-parser', label: 'Dispense Parser', icon: 'package', metrics: { today: '380', status: 'green' }, children: [
              { id: 'dispense-fail-detector', label: 'Fail Detector', metrics: { fails: '3' } },
              { id: 'jam-event-classifier', label: 'Jam Classifier', metrics: { jams: '1' } }
            ]},
            { id: 'telemetry-event-parser', label: 'Telemetry Parser', icon: 'thermometer', metrics: { today: '370', status: 'green' }, children: [
              { id: 'off-event-detector', label: 'Off Detector', metrics: { events: '2' } },
              { id: 'temp-anomaly', label: 'Temp Anomaly', metrics: { anomalies: '0' } },
              { id: 'stock-low-alert', label: 'Stock Alert', metrics: { alerts: '1' } }
            ]},
          ]
        },
        {
          id: 'remote-credits-preload',
          label: 'Remote Credits',
          subtitle: 'WEB cashless tracking',
          icon: 'credit-card',
          metrics: { today: '₪890', status: 'green' },
          children: [
            { id: 'credit-fetch-job', label: 'Credit Fetch', icon: 'download', metrics: { today: '23' }, children: [
              { id: 'web-cashless-query', label: 'WEB Query', metrics: { records: '23' } },
              { id: 'test-vend-filter', label: 'Test Filter', metrics: { filtered: '2' } },
              { id: 'refund-classifier', label: 'Refund Class', metrics: { refunds: '1' } }
            ]},
            { id: 'lost-revenue-estimator', label: 'Lost Revenue', icon: 'trending-down', metrics: { est: '₪45' }, children: [
              { id: 'unidentified-credit-calc', label: 'Unidentified', metrics: { count: '1' } }
            ]}
          ]
        },
        {
          id: 'footfall-commercial-sync',
          label: 'Camera Footfall',
          subtitle: 'Daily traffic from cameras',
          icon: 'users',
          metrics: { today: '3.2K visitors', status: 'green' },
          children: [
            { id: 'camera-api-poller', label: 'Camera Poller', icon: 'video', metrics: { locations: '8' }, children: [
              { id: 'hourly-traffic-fetch', label: 'Hourly Traffic', metrics: { last: '420' } },
              { id: 'unique-visitor-count', label: 'Unique Count', metrics: { unique: '2.9K' } }
            ]},
            { id: 'footfall-enricher', label: 'Footfall Enricher', icon: 'map-pin', metrics: { enriched: '3.2K' }, children: [
              { id: 'area-mapper', label: 'Area Map', metrics: { areas: 'Shadadiya, Zahra' } },
              { id: 'client-tagger', label: 'Client Tag', metrics: { clients: 'Leet, EE, Park' } },
              { id: 'conversion-calc', label: 'Conversion', metrics: { rate: '14.2%' } }
            ]}
          ]
        },
        {
          id: 'task-manager-ingestion',
          label: 'Task Manager',
          subtitle: 'Attendance, cleaning, tech',
          icon: 'clipboard',
          metrics: { synced: '45 ops', status: 'green' },
          children: [
            { id: 'attendance-sync', label: 'Attendance', icon: 'user-check', metrics: { online: '38' }, children: [
              { id: 'operator-presence', label: 'Presence', metrics: { present: '38/45' } },
              { id: 'shift-tracker', label: 'Shift Track', metrics: { active: '3 shifts' } }
            ]},
            { id: 'cleaning-sync', label: 'Cleaning', icon: 'wind', metrics: { due: '12' }, children: [
              { id: 'last-gc-timestamp', label: 'Last GC', metrics: { avg: '6.2h ago' } },
              { id: 'next-window-calc', label: 'Next Window', metrics: { next: '2h' } },
              { id: 'cleaning-overdue-flag', label: '15h Overdue', metrics: { count: '2', status: 'amber' } }
            ]},
            { id: 'tech-visit-sync', label: 'Tech Visit', icon: 'wrench', metrics: { today: '3' } }
          ]
        }
      ]
    },
    {
      id: 'rules-engine',
      label: 'RULES ENGINE',
      subtitle: 'Alert detection & criteria',
      color: '#ff6b3d',
      icon: 'alert-triangle',
      metrics: { today: '8 alerts', critical: 2, status: 'amber' },
      tree: [
        {
          id: 'red-flags-detector',
          label: 'Red Flags',
          subtitle: '~12 criteria evaluation',
          icon: 'alert-circle',
          metrics: { today: '8 alerts', status: 'amber' },
          children: [
            { id: 'stale-sales-check', label: 'Stale Sales', icon: 'trending-down', metrics: { flagged: '3' }, children: [
              { id: 'no-sales-4h', label: 'No Sales ≥4h', metrics: { machines: '2' } },
              { id: 'wtd-drop-pct', label: 'WTD Drop', metrics: { machines: '1' } },
              { id: 'same-day-lw-drop', label: 'LW Drop', metrics: { machines: '0' } }
            ]},
            { id: 'dispense-fail-check', label: 'Dispense Fail', icon: 'x-circle', metrics: { flagged: '2' }, children: [
              { id: 'dispense-fail-7d', label: 'Fails 7d', metrics: { total: '14' } },
              { id: 'dispense-fail-spike', label: 'Spike', metrics: { machines: '2', status: 'amber' } }
            ]},
            { id: 'off-event-check', label: 'Off Event', icon: 'power', metrics: { today: '2' }, children: [
              { id: 'off-events-today', label: 'Today', metrics: { events: '2' } },
              { id: 'off-event-frequency', label: 'Frequency', metrics: { avg: '0.3/day' } }
            ]},
            { id: 'downtime-check', label: 'Downtime', icon: 'clock', metrics: { loss: '₪240' }, children: [
              { id: 'projected-loss-5min-grace', label: 'Proj. Loss', metrics: { est: '₪240' } },
              { id: 'peak-band-adjust', label: 'Peak Adjust', metrics: { factor: '1.4x' } }
            ]}
          ]
        },
        {
          id: 'downtime-analyzer',
          label: 'Downtime Analyzer',
          subtitle: 'Revenue loss projection',
          icon: 'bar-chart',
          metrics: { today: '₪240 loss', machines: 3 },
          children: [
            { id: 'grace-period-filter', label: '5-Min Grace', metrics: { filtered: '18' } },
            { id: 'peak-band-logic', label: 'Peak Band', icon: 'sunrise', metrics: { active: '2 bands' }, children: [
              { id: 'morning-peak', label: 'Morning', metrics: { mult: '1.6x' } },
              { id: 'afternoon-peak', label: 'Afternoon', metrics: { mult: '1.3x' } }
            ]},
            { id: 'loss-projection', label: 'Loss Calc', metrics: { total: '₪240' } }
          ]
        },
        {
          id: 'qa-issue-tracker',
          label: 'QA Issue Freq',
          subtitle: 'Repeat issue analysis',
          icon: 'check-circle',
          metrics: { repeat: '4 issues', status: 'green' },
          children: [
            { id: 'issue-matcher', label: 'Issue Matcher', metrics: { matched: '12' } },
            { id: 'frequency-counter', label: 'Freq Counter', metrics: { repeats: '4' } },
            { id: 'occurrence-dates', label: 'Dates', metrics: { span: '14d' } }
          ]
        }
      ]
    },
    {
      id: 'dispatch',
      label: 'DISPATCH',
      subtitle: 'Workflow & routing',
      color: '#4a9eff',
      icon: 'send',
      metrics: { today: '23 tasks', pending: 5 },
      tree: [
        {
          id: 'workflow-proxy',
          label: 'Workflow Proxy',
          subtitle: 'GO CHECK / DM / cleaning',
          icon: 'link',
          metrics: { today: '18 dispatched', status: 'green' },
          children: [
            { id: 'go-check-dispatcher', label: 'GO CHECK', icon: 'flag', metrics: { today: '12' }, children: [
              { id: 'machine-issue-payload', label: 'Issue Payload', metrics: { built: '12' } },
              { id: 'operator-resolver', label: 'Op Resolver', metrics: { resolved: '12/12' } }
            ]},
            { id: 'dm-dispatcher', label: 'DM', icon: 'message-square', metrics: { today: '4' } },
            { id: 'cleaning-overdue-dispatcher', label: 'Cleaning', icon: 'wind', metrics: { today: '2' } }
          ]
        },
        {
          id: 'operator-schedule-resolver',
          label: 'Op Schedule',
          subtitle: 'Machine → operator map',
          icon: 'user',
          metrics: { mapped: '142 machines', status: 'green' },
          children: [
            { id: 'machine-operator-map', label: 'M→Op Map', metrics: { entries: '142' } },
            { id: 'schedule-merge', label: 'Schedule Merge', metrics: { sources: '2' } },
            { id: 'fallback-logic', label: 'Fallback', metrics: { used: '3 times' } }
          ]
        },
        {
          id: 'attendance-badge-engine',
          label: 'Attendance Badge',
          subtitle: 'Real-time presence',
          icon: 'badge',
          metrics: { online: '38/45', status: 'green' },
          children: [
            { id: 'web-cashless-last-access', label: 'WEB Access', metrics: { tracked: '38' } },
            { id: 'schedule-presence', label: 'Schedule Check', metrics: { matched: '35' } },
            { id: 'badge-renderer', label: 'Badge UI', metrics: { rendered: '38' } }
          ]
        }
      ]
    },
    {
      id: 'storage',
      label: 'STORAGE',
      subtitle: 'Cache & persistence',
      color: '#8b5cf6',
      icon: 'hard-drive',
      metrics: { size: '2.4GB', uptime: '99.9%' },
      tree: [
        {
          id: 'postgres-cache-layer',
          label: 'PostgreSQL Cache',
          subtitle: 'Vendon, footfall, snapshot',
          icon: 'database',
          metrics: { tables: 4, rows: '1.2M' },
          children: [
            { id: 'vendon-events-table', label: 'vendon_events', metrics: { rows: '840K' } },
            { id: 'remote-credits-table', label: 'remote_credits', metrics: { rows: '45K' } },
            { id: 'footfall-raw-table', label: 'footfall_raw', metrics: { rows: '280K' } },
            { id: 'red-alert-snapshot-table', label: 'red_alert_snapshot', metrics: { rows: '142' } }
          ]
        },
        {
          id: 'session-store',
          label: 'Session Store',
          subtitle: 'OAuth + access rules',
          icon: 'lock',
          metrics: { active: '24 sessions', status: 'green' },
          children: [
            { id: 'flask-session', label: 'Flask Session', metrics: { backend: 'Redis' } },
            { id: 'redis-cache', label: 'Redis', metrics: { keys: '180' } },
            { id: 'dashboard-access-rules', label: 'Access Rules', metrics: { users: '45' } }
          ]
        }
      ]
    },
    {
      id: 'analytics',
      label: 'ANALYTICS',
      subtitle: 'Performance & trends',
      color: '#10b981',
      icon: 'trending-up',
      metrics: { today: '₪18.4K', trend: '+8%' },
      tree: [
        {
          id: 'performance-aggregator',
          label: 'Performance Agg',
          subtitle: 'Sales + WEB + mix',
          icon: 'bar-chart-2',
          metrics: { today: '₪18.4K', status: 'green' },
          children: [
            { id: 'machine-sales-agg', label: 'Machine Sales', metrics: { today: '₪16.2K' } },
            { id: 'web-cashless-agg', label: 'WEB Cashless', metrics: { today: '₪2.2K' } },
            { id: 'product-mix-calc', label: 'Product Mix', icon: 'pie-chart', metrics: { skus: '45' }, children: [
              { id: 'top-5-skus', label: 'Top 5', metrics: { revenue: '₪12.8K' } },
              { id: 'bottom-5-skus', label: 'Bottom 5', metrics: { revenue: '₪340' } }
            ]}
          ]
        },
        {
          id: 'target-calculator',
          label: 'Target Calc',
          subtitle: 'Daily/weekly targets',
          icon: 'target',
          metrics: { vsTarget: '+6%', status: 'green' },
          children: [
            { id: 'location-target-loader', label: 'Location Target', metrics: { locations: '18' } },
            { id: 'product-target-loader', label: 'Product Target', metrics: { products: '45' } },
            { id: 'actual-vs-target', label: 'Δ Calc', metrics: { delta: '+6%', status: 'green' } }
          ]
        },
        {
          id: 'footfall-converter',
          label: 'Footfall Convert',
          subtitle: 'Traffic → conversion',
          icon: 'percent',
          metrics: { convRate: '14.2%', status: 'green' },
          children: [
            { id: 'traffic-aggregator', label: 'Traffic Agg', metrics: { today: '3.2K' } },
            { id: 'conversion-rate-calc', label: 'Conv Calc', metrics: { rate: '14.2%' } },
            { id: 'hourly-heatmap', label: 'Heatmap', metrics: { generated: '24h' } }
          ]
        }
      ]
    },
    {
      id: 'reporting',
      label: 'REPORTING',
      subtitle: 'Exports & dashboards',
      color: '#f59e0b',
      icon: 'file-text',
      metrics: { thisWeek: '4 reports', status: 'green' },
      tree: [
        {
          id: 'pdf-exporter',
          label: 'PDF Exporter',
          subtitle: 'Weekly product report',
          icon: 'download',
          metrics: { thisWeek: '3 PDFs', status: 'green' },
          children: [
            { id: 'chart-renderer', label: 'Chart Render', metrics: { charts: '8' } },
            { id: 'pdf-generator', label: 'PDF Gen', metrics: { pages: '12' } },
            { id: 'download-trigger', label: 'Download', metrics: { users: '8' } }
          ]
        },
        {
          id: 'excel-workbook',
          label: 'Excel Workbook',
          subtitle: 'Red Flags / Overall',
          icon: 'table',
          metrics: { thisWeek: '1 export', status: 'green' },
          children: [
            { id: 'table-to-array', label: 'Table→Array', metrics: { rows: '142' } },
            { id: 'xlsx-writer', label: 'XLSX Writer', metrics: { sheets: '2' } },
            { id: 'download-trigger-xlsx', label: 'Download', metrics: { size: '84KB' } }
          ]
        }
      ]
    },
    {
      id: 'watchdogs',
      label: 'WATCHDOGS',
      subtitle: 'Health & monitoring',
      color: '#ec4899',
      icon: 'activity',
      metrics: { uptime: '99.8%', status: 'green' },
      tree: [
        {
          id: 'api-health-monitor',
          label: 'API Health',
          subtitle: 'Heartbeat + DB check',
          icon: 'heart',
          metrics: { uptime: '99.9%', status: 'green' },
          children: [
            { id: 'heartbeat-endpoint', label: '/health', metrics: { resp: '45ms avg' } },
            { id: 'db-connection-check', label: 'DB Check', metrics: { latency: '12ms' } },
            { id: 'cache-freshness-check', label: 'Cache Fresh', metrics: { age: '4min' } }
          ]
        },
        {
          id: 'stale-data-detector',
          label: 'Stale Data',
          subtitle: 'Snapshot age check',
          icon: 'clock',
          metrics: { lastCheck: '2min ago', status: 'green' },
          children: [
            { id: 'snapshot-age-check', label: 'Age Check', metrics: { age: '4min' } },
            { id: 're-cache-trigger', label: 'Re-Cache', metrics: { triggered: '0 today' } }
          ]
        }
      ]
    },
    {
      id: 'ui-shell',
      label: 'UI SHELL',
      subtitle: 'Frontend & routing',
      color: '#06b6d4',
      icon: 'layout',
      metrics: { pages: 7, users: '24 online' },
      tree: [
        {
          id: 'react-spa',
          label: 'React SPA',
          subtitle: 'Vite + Router',
          icon: 'cpu',
          metrics: { routes: 7, status: 'green' },
          children: [
            { id: 'routing', label: 'Router', metrics: { routes: '7' } },
            { id: 'component-tree', label: 'Components', icon: 'layers', metrics: { count: '142' }, children: [
              { id: 'red-flags-page', label: 'RedFlags', metrics: { renders: '340' } },
              { id: 'overall-page', label: 'Overall', metrics: { renders: '180' } },
              { id: 'performance-page', label: 'Performance', metrics: { renders: '120' } },
              { id: 'footfall-page', label: 'Footfall', metrics: { renders: '90' } },
              { id: 'admin-page', label: 'Admin', metrics: { renders: '45' } }
            ]},
            { id: 'state-management', label: 'TanStack Query', metrics: { queries: '28' } }
          ]
        },
        {
          id: 'auth-context',
          label: 'Auth Context',
          subtitle: 'Google sign-in + access',
          icon: 'shield',
          metrics: { sessions: '24', status: 'green' },
          children: [
            { id: 'gsi-loader', label: 'Google GSI', metrics: { loaded: 'yes' } },
            { id: 'session-api', label: 'Session API', metrics: { calls: '24' } },
            { id: 'access-guard', label: 'Access Guard', metrics: { checks: '168' } }
          ]
        }
      ]
    }
  ]
};

// Icon mapping for SVG line icons (simple line-art style)
const ICON_PATHS = {
  'database': 'M12,2C6.48,2,2,4.69,2,8v8c0,3.31,4.48,6,10,6s10-2.69,10-6V8C22,4.69,17.52,2,12,2z M12,4c4.41,0,8,1.79,8,4s-3.59,4-8,4 s-8-1.79-8-4S7.59,4,12,4z M12,20c-4.41,0-8-1.79-8-4v-2.29c1.89,1.43,4.79,2.29,8,2.29s6.11-0.86,8-2.29V16 C20,18.21,16.41,20,12,20z M12,14c-4.41,0-8-1.79-8-4V7.71C5.89,9.14,8.79,10,12,10s6.11-0.86,8-2.29V10 C20,12.21,16.41,14,12,14z',
  'activity': 'M22,12h-4l-3,9L9,3l-3,9H2',
  'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  'alert-circle': 'M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M13,17h-2v-2h2V17z M13,13h-2V7h2V13z',
  'send': 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
  'link': 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  'hard-drive': 'M22 12H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01 M10 16h.01',
  'trending-up': 'M23 6 13.5 15.5 8.5 10.5 1 18 M17 6h6v6',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  'layout': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  'credit-card': 'M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM1 10h22',
  'users': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  'clipboard': 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
  'dollar-sign': 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  'package': 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  'thermometer': 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z',
  'download': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  'video': 'M23 7l-7 5 7 5V7z M16 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
  'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'user-check': 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 11l2 2 4-4',
  'wind': 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2',
  'wrench': 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  'trending-down': 'M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6',
  'x-circle': 'M12,2C6.47,2,2,6.47,2,12s4.47,10,10,10s10-4.47,10-10S17.53,2,12,2z M17,15.59L15.59,17L12,13.41L8.41,17L7,15.59 L10.59,12L7,8.41L8.41,7L12,10.59L15.59,7L17,8.41L13.41,12L17,15.59z',
  'power': 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
  'clock': 'M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20c-4.41,0-8-3.59-8-8s3.59-8,8-8s8,3.59,8,8 S16.41,20,12,20z M12.5,7H11v6l5.25,3.15l0.75-1.23l-4.5-2.67V7z',
  'bar-chart': 'M12 20V10 M18 20V4 M6 20v-4',
  'sunrise': 'M17 18a5 5 0 0 0-10 0 M12 2v7 M4.22 10.22l1.42 1.42 M1 18h2 M21 18h2 M18.36 11.64l1.42-1.42 M23 22H1 M8 6l4-4 4 4',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  'flag': 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
  'message-square': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  'user': 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'badge': 'M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z',
  'lock': 'M19 11H5c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM18 11V9c0-3.31-2.69-6-6-6S6 5.69 6 9v2',
  'bar-chart-2': 'M18 20V10 M12 20V4 M6 20v-6',
  'target': 'M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20c-4.41,0-8-3.59-8-8s3.59-8,8-8s8,3.59,8,8 S16.41,20,12,20z M12,8c-2.21,0-4,1.79-4,4s1.79,4,4,4s4-1.79,4-4S14.21,8,12,8z M12,14c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2 S13.1,14,12,14z',
  'percent': 'M19 5 5 19 M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  'table': 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
  'heart': 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  'pie-chart': 'M21.21 15.89A10 10 0 1 1 8 2.83 M22 12A10 10 0 0 0 12 2v10z',
  'layers': 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  'cpu': 'M4 4h16v16H4z M9 9h6v6H9z M9 1v3 M15 1v3 M9 20v3 M15 20v3 M20 9h3 M20 14h3 M1 9h3 M1 14h3',
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};

class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

/** Real APOS domain entities used as leaf detail (not fake filler). */
const DOMAIN = {
  machines: (() => {
    const sites = [
      ['KU', 'COBA Shadadiya'],
      ['KU', 'Engineering'],
      ['KU', 'Science'],
      ['MEW', 'Zahra'],
      ['MOH', 'Jaber Gate 1'],
      ['MOH', 'Jaber Gate 2'],
      ['MOH', 'Jaber Gate 6'],
      ['MOH', 'Jaber Gate 8'],
      ['Park', 'Mall L1'],
      ['Park', 'Mall L2'],
      ['EE', 'Salmiya'],
      ['EE', 'Hawally'],
      ['Leet', 'HQ Lobby'],
      ['Leet', 'Ops Floor'],
      ['AUK', 'Library'],
      ['AUK', 'Cafeteria'],
      ['KFH', 'Branch A'],
      ['KFH', 'Branch B'],
      ['NBK', 'Tower'],
      ['NBK', 'Plaza'],
      ['Gulf', 'Mall'],
      ['Marina', 'Walk'],
      ['360', 'Mall'],
      ['Avenues', 'Phase 3'],
    ];
    const out = [];
    sites.forEach(([owner, place], si) => {
      const n = si < 12 ? 5 : 3;
      for (let i = 1; i <= n; i++) {
        out.push({
          id: `m-${owner.toLowerCase()}-${si}-${i}`,
          label: `${owner}-${i} ${place}`,
          metrics: { owner, site: place, status: i % 7 === 0 ? 'amber' : 'green' },
        });
      }
    });
    return out;
  })(),
  operators: [
    'Ahmed Al-Rashid', 'Sara Al-Mutairi', 'Fahad Al-Sabah', 'Noura Al-Enezi',
    'Yousef Al-Kandari', 'Maryam Al-Dosari', 'Khaled Al-Ajmi', 'Hessa Al-Qallaf',
    'Bader Al-Shammari', 'Laila Al-Hasawi', 'Omar Al-Otaibi', 'Dana Al-Failakawi',
    'Tariq Al-Mutawa', 'Reem Al-Sabeeh', 'Jassim Al-Najjar', 'Fatima Al-Hassan',
    'Saud Al-Barrak', 'Aisha Al-Roumi', 'Nasser Al-Ghanim', 'Mona Al-Saleh',
    'Waleed Al-Husainan', 'Hind Al-Mulla', 'Faisal Al-Qabandi', 'Noor Al-Zamel',
  ],
  redFlagChecks: [
    'NO_RECENT_SALE ≥4h', 'WTD_SALES_DROP', 'SAME_DAY_LW_DROP', 'DISPENSE_FAIL_7D',
    'DISPENSE_FAIL_SPIKE', 'OFF_EVENTS_TODAY', 'OFF_EVENT_FREQ', 'PROJECTED_LOSS',
    'PEAK_BAND_LOSS', 'CLEANING_OVERDUE_15H', 'QA_REPEAT_ISSUE', 'STOCK_LOW',
    'TEMP_ANOMALY', 'JAM_EVENT', 'INACTIVE_TODAY', 'TARGET_MISS', 'SX_ACCEL_DROP',
    'MTD_YOY_DROP', 'WEB_UNIDENTIFIED', 'TEST_VEND_SPIKE', 'REFUND_CLUSTER',
    'OPERATOR_ABSENT', 'TECH_OPEN_TICKET', 'HOURS_MISMATCH',
  ],
  endpoints: [
    'GET /api/alert/machines', 'GET /api/alert/red-flags/snapshot',
    'GET /api/alert/sales/today', 'GET /api/alert/footfall/daily',
    'GET /api/alert/remote-credits', 'POST /api/alert/workflow/go-check',
    'POST /api/alert/workflow/dm-operator', 'GET /api/alert/workflow/operator-schedule',
    'GET /api/alert/attendance', 'GET /api/alert/tech-visits',
    'GET /api/alert/cleaning', 'GET /api/alert/downtime',
    'GET /api/alert/targets', 'GET /health', 'GET /api/session',
    'POST /api/alert/workflow/send-credit', 'GET /api/alert/qa-visits',
    'GET /api/alert/performance', 'GET /api/alert/product-mix',
    'GET /api/alert/export/xlsx',
  ],
  products: [
    'Spanish Latte', 'Cappuccino', 'Americano', 'Flat White', 'Espresso',
    'Mocha', 'Hot Chocolate', 'Green Tea', 'Iced Latte', 'Cold Brew',
    'Caramel Macchiato', 'Vanilla Latte', 'Turkish Coffee', 'Cortado',
    'Matcha Latte', 'Chai Latte', 'Water 500ml', 'Sparkling Water',
    'Orange Juice', 'Apple Juice', 'Energy Drink', 'Protein Shake',
    'Croissant', 'Cookie', 'Muffin',
  ],
  pages: [
    'RedFlags', 'Overall', 'Performance', 'Footfall', 'Admin', 'Targets',
    'Promo', 'Settings', 'Login', 'Session Guard', 'Access Rules',
    'Export PDF', 'Export XLSX', 'Operator Modal', 'Credits Popup',
    'Downtime Popup', 'QA Visit Popup', 'Tech Visit', 'Call Op', 'Call AM',
  ],
  tables: [
    'vendon_events', 'remote_credits', 'footfall_raw', 'red_alert_snapshot',
    'machine_targets', 'product_targets', 'operator_schedule', 'attendance_log',
    'cleaning_events', 'tech_visits', 'qa_findings', 'session_store',
    'dashboard_access', 'downtime_intervals', 'sku_catalog', 'location_hours',
  ],
  reports: [
    'Weekly Product PDF', 'Red Flags XLSX', 'Overall Summary', 'Footfall Heatmap',
    'MTD vs Last MTD', 'YTD vs LY', 'Operator Attendance', 'Cleaning Overdue',
    'Tech Open Tickets', 'QA Issue Frequency', 'Lost Revenue Est', 'Peak Band Loss',
  ],
  watchdogs: [
    'API Heartbeat', 'DB Latency', 'Cache Age', 'Snapshot Freshness',
    'Vendon Sync Lag', 'Footfall Poll Lag', 'Redis Hit Rate', 'Session TTL',
    'Probe /health', 'Probe /api/session', 'Image Pull Check', 'Pod Ready',
    'Ingress 5xx', 'Celery Queue Depth', 'Disk Usage', 'Memory Pressure',
  ],
};

const TARGET_LEAVES_PER_DEPT = 110;

const DEPT_LEAF_KINDS = {
  ingestion: ['machines', 'endpoints', 'products'],
  'rules-engine': ['redFlagChecks', 'machines', 'operators'],
  dispatch: ['operators', 'machines', 'endpoints'],
  storage: ['tables', 'endpoints', 'machines'],
  analytics: ['products', 'machines', 'reports'],
  reporting: ['reports', 'pages', 'products'],
  watchdogs: ['watchdogs', 'endpoints', 'tables'],
  'ui-shell': ['pages', 'endpoints', 'operators'],
};

function flattenTree(tree, parentPath = []) {
  const nodes = [];
  tree.forEach((node) => {
    const nodePath = [...parentPath, node.id];
    const copy = { ...node, path: nodePath, children: node.children ? [...node.children] : undefined };
    nodes.push(copy);
    if (node.children) {
      nodes.push(...flattenTree(node.children, nodePath));
    }
  });
  return nodes;
}

function countLeaves(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function collectDeepParents(nodes) {
  return nodes.filter((n) => {
    const depth = n.path.length;
    const kids = n.children || [];
    return depth >= 2 || (depth === 1 && kids.length > 0 && kids.every((c) => !c.children || c.children.length === 0));
  });
}

function cloneTree(nodes) {
  return nodes.map((n) => ({
    ...n,
    metrics: n.metrics ? { ...n.metrics } : undefined,
    children: n.children ? cloneTree(n.children) : undefined,
  }));
}

function findNodeById(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function listAttachmentPoints(tree) {
  const flat = flattenTree(tree);
  const points = flat.filter((n) => !n.children || n.children.length === 0 || n.path.length >= 2);
  if (points.length === 0) return flat.filter((n) => n.path.length === 1);
  return points;
}

/**
 * Expand department tree with real domain leaves until ~TARGET_LEAVES_PER_DEPT leaves.
 * Inserts branchlet twigs for multi-level organic density. Prefers live machine names.
 */
function expandDepartmentTree(dept, liveMachines = []) {
  const tree = cloneTree(dept.tree || []);
  const kinds = DEPT_LEAF_KINDS[dept.id] || ['machines', 'endpoints'];
  const pools = [];

  kinds.forEach((kind) => {
    if (kind === 'machines' && liveMachines.length) {
      pools.push(
        liveMachines.map((m) => ({
          id: `live-m-${m.id}`,
          label: m.name || m.machineName || String(m.id),
          metrics: {
            id: m.id,
            owner: m.vendon_location_owner || m.owner || '—',
            status: m.inactiveToday ? 'amber' : 'green',
          },
        })),
      );
    } else if (DOMAIN[kind]) {
      pools.push(DOMAIN[kind].map((item) => (typeof item === 'string'
        ? { id: `${kind}-${item}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: item, metrics: { kind } }
        : { ...item, metrics: { ...(item.metrics || {}), kind } })));
    }
  });

  const flatPool = pools.flat();
  const attachPoints = listAttachmentPoints(tree);
  let leafCount = countLeaves({ children: tree });
  let idx = 0;
  const rng = new SeededRandom(dept.id.split('').reduce((a, c) => a + c.charCodeAt(0), 42));

  // Create branchlets under each attach point, then pack domain leaves under them
  const twigs = [];
  attachPoints.forEach((ap) => {
    const parent = findNodeById(tree, ap.id);
    if (!parent) return;
    if (!parent.children) parent.children = [];
    const twigCount = 2 + Math.floor(rng.next() * 2);
    for (let t = 0; t < twigCount; t++) {
      const twig = {
        id: `${parent.id}__twig-${t}`,
        label: `${parent.label || parent.id} · ${t + 1}`,
        metrics: { branch: true },
        children: [],
        _scaffold: true,
      };
      parent.children.push(twig);
      twigs.push(twig);
    }
  });

  leafCount = 0;
  while (leafCount < TARGET_LEAVES_PER_DEPT && flatPool.length > 0 && twigs.length > 0) {
    const item = flatPool[idx % flatPool.length];
    idx++;
    const twig = twigs[Math.floor(rng.next() * twigs.length)];
    const leafId = `${twig.id}__${item.id}-${idx}`;
    twig.children.push({
      id: leafId,
      label: item.label,
      metrics: { ...(item.metrics || {}), parent: twig.label },
      isDomainLeaf: true,
    });
    leafCount = twigs.reduce((s, t) => s + t.children.length, 0);
    if (idx > TARGET_LEAVES_PER_DEPT * 4) break;
  }

  return tree;
}

/**
 * Leaf-weighted radial layout: angles by subtree leaf weight; radii fill the
 * full hub→label span (internals near hub, leaves distributed along the sector).
 */
function layoutRadialTree(tree, hubX, hubY, baseAngle, angleSpread, rMin, rMax, seed) {
  const rng = new SeededRandom(seed);
  const root = { id: '__hub__', children: tree, _angle: baseAngle };

  function assignAngles(node, a0, a1) {
    const kids = node.children || [];
    if (kids.length === 0) {
      node._angle = (a0 + a1) / 2;
      return;
    }
    const weights = kids.map((c) => Math.max(1, countLeaves(c)));
    const total = weights.reduce((s, w) => s + w, 0);
    let cursor = a0;
    kids.forEach((kid, i) => {
      const span = ((a1 - a0) * weights[i]) / total;
      const jitter = (rng.next() - 0.5) * span * 0.1;
      assignAngles(kid, cursor, cursor + span);
      kid._angle = cursor + span / 2 + jitter;
      cursor += span;
    });
    node._angle = kids.reduce((s, k) => s + k._angle, 0) / kids.length;
  }

  const half = angleSpread / 2;
  assignAngles(root, baseAngle - half, baseAngle + half);

  function maxDepth(node, d = 0) {
    if (!node.children || !node.children.length) return d;
    return Math.max(...node.children.map((c) => maxDepth(c, d + 1)));
  }
  const depth = Math.max(4, maxDepth(root));
  const span = rMax - rMin;

  const positioned = [];
  function place(node, d, parent) {
    if (node.id === '__hub__') {
      (node.children || []).forEach((c) => place(c, 1, null));
      return;
    }
    const isLeaf = !node.children || node.children.length === 0;
    let radius;
    if (isLeaf) {
      // Fill nearly the full hub→label span (biased slightly outward)
      const u = rng.next();
      const frac = 0.12 + Math.pow(u, 0.55) * 0.88;
      radius = rMin + frac * span + (rng.next() - 0.5) * span * 0.035;
    } else {
      // Branch hubs stay inward so trunks read continuously
      const t = d / depth;
      radius = rMin + Math.pow(t, 0.85) * span * 0.5 + (rng.next() - 0.5) * span * 0.025;
    }
    const aJitter = (rng.next() - 0.5) * 0.035;
    const angle = node._angle + aJitter;
    node._x = hubX + radius * Math.cos(angle);
    node._y = hubY + radius * Math.sin(angle);
    node._depth = d;
    node._parent = parent;
    positioned.push(node);
    (node.children || []).forEach((c) => place(c, d + 1, node));
  }
  place(root, 0, null);
  return positioned;
}

class RadialOrgMapSingleWorld {
  constructor(containerId) {
    this.svg = d3.select(`#${containerId}`);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;

    this.currentDeptIndex = 0;
    this.selectedNode = null;
    this.redFlagsData = null;
    this.liveMachines = [];
    this.nodeIndex = new Map();
    this.activePath = new Set();
    this._builtOnce = false;

    this.defs = this.svg.append('defs');
    this.setupFilters();

    this.container = this.svg.append('g').attr('class', 'map-container');

    this.zoom = d3
      .zoom()
      .scaleExtent([0.25, 5])
      .on('zoom', (event) => {
        this.container.attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    this.buildWorld();
    this.setupControls();
    this.setupCard();
    this.fetchLiveData();

    window.addEventListener('resize', () => this.handleResize());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeCard();
    });
    this.svg.on('click', (event) => {
      if (event.target === this.svg.node()) this.closeCard();
    });
  }

  setupFilters() {
    const glowFilter = this.defs.append('filter').attr('id', 'glow-soft');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Department orb gradients
    APOS_DATA.departments.forEach((dept) => {
      const grad = this.defs.append('radialGradient').attr('id', `grad-${dept.id}`);
      grad.append('stop').attr('offset', '0%').attr('stop-color', dept.color).attr('stop-opacity', 0.8);
      grad.append('stop').attr('offset', '70%').attr('stop-color', dept.color).attr('stop-opacity', 0.4);
      grad.append('stop').attr('offset', '100%').attr('stop-color', dept.color).attr('stop-opacity', 0.1);
    });
  }

  buildWorld() {
    this.container.selectAll('*').remove();
    this.nodeIndex = new Map();

    document.getElementById('dept-name').textContent = 'APOS';
    document.getElementById('dept-subtitle').textContent = 'organizational map';

    this.drawParticleCore();

    const count = APOS_DATA.departments.length;
    const hubRing = Math.min(this.width, this.height) * 0.14;
    // Faint labels sit near the viewport edge; trees fill almost to them
    const faintLabelRadius = Math.min(this.width, this.height) * 0.49;

    APOS_DATA.departments.forEach((dept, i) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      const deptX = this.centerX + hubRing * Math.cos(angle);
      const deptY = this.centerY + hubRing * Math.sin(angle);

      dept._x = deptX;
      dept._y = deptY;
      dept._angle = angle;

      const faintLabelX = this.centerX + faintLabelRadius * Math.cos(angle);
      const faintLabelY = this.centerY + faintLabelRadius * Math.sin(angle);

      this.container
        .append('text')
        .attr('x', faintLabelX)
        .attr('y', faintLabelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', 'rgba(45, 45, 58, 0.07)')
        .attr('font-size', '52px')
        .attr('font-weight', '300')
        .attr('letter-spacing', '0.22em')
        .attr('text-transform', 'uppercase')
        .text(dept.label)
        .attr('class', 'faint-label');

      const expanded = expandDepartmentTree(dept, this.liveMachines);
      dept._expandedTree = expanded;
      dept._leafCount = countLeaves({ children: expanded });

      const treeGroup = this.container.append('g').attr('class', `tree-${dept.id}`);
      this.renderDenseSectorTree(treeGroup, dept, deptX, deptY, angle, faintLabelRadius - hubRing - 12);

      const deptGroup = this.container.append('g').attr('class', 'department-node-group');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 48)
        .attr('fill', `url(#grad-${dept.id})`)
        .attr('class', 'dept-orb-outer')
        .style('pointer-events', 'none');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 34)
        .attr('fill', dept.color)
        .attr('fill-opacity', 0.18)
        .attr('class', 'dept-orb-mid')
        .style('pointer-events', 'none');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 24)
        .attr('fill', dept.color)
        .attr('fill-opacity', 0.45)
        .attr('class', 'dept-orb-core')
        .style('pointer-events', 'none');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 50)
        .attr('fill', 'none')
        .attr('stroke', dept.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.35)
        .attr('class', 'dept-orbit')
        .style('pointer-events', 'none');

      if (dept.icon && ICON_PATHS[dept.icon]) {
        deptGroup
          .append('path')
          .attr('d', ICON_PATHS[dept.icon])
          .attr('transform', `translate(${deptX - 12}, ${deptY - 12}) scale(1)`)
          .attr('fill', 'none')
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .attr('class', 'dept-icon')
          .style('pointer-events', 'none');
      }

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 52)
        .attr('fill', 'transparent')
        .attr('class', 'dept-click-target')
        .style('cursor', 'pointer')
        .on('click', (event) => {
          event.stopPropagation();
          this.zoomToNode({ ...dept, isDept: true, metrics: { ...(dept.metrics || {}), leaves: dept._leafCount } }, i);
        })
        .on('mouseover', () => {
          deptGroup.select('.dept-orb-core').transition().duration(200).attr('fill-opacity', 0.65);
        })
        .on('mouseout', () => {
          deptGroup.select('.dept-orb-core').transition().duration(200).attr('fill-opacity', 0.45);
        });
    });

    if (!this._builtOnce) {
      this._builtOnce = true;
      this.svg.transition().duration(600).call(this.zoom.transform, d3.zoomIdentity);
    }
  }

  /**
   * Dense organic sector tree: leaf-weighted angles, radius from hub to faint labels,
   * batched SVG paths + circles for performance (~90 leaves/dept).
   */
  renderDenseSectorTree(group, dept, hubX, hubY, baseAngle, reach) {
    const angleSpread = ((Math.PI * 2) / APOS_DATA.departments.length) * 0.97;
    const rMin = 48;
    const rMax = Math.max(rMin + 80, reach);
    const seed = dept.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const tree = dept._expandedTree || expandDepartmentTree(dept, this.liveMachines);
    const positioned = layoutRadialTree(tree, hubX, hubY, baseAngle, angleSpread, rMin, rMax, seed);

    positioned.forEach((n) => {
      n._deptColor = dept.color;
      n._deptId = dept.id;
      this.nodeIndex.set(n.id, n);
    });

    // Batched connectors (single path)
    const edgeParts = [];
    positioned.forEach((n) => {
      const px = n._parent ? n._parent._x : hubX;
      const py = n._parent ? n._parent._y : hubY;
      edgeParts.push(`M${px},${py}L${n._x},${n._y}`);
    });
    group
      .append('path')
      .attr('d', edgeParts.join(''))
      .attr('fill', 'none')
      .attr('stroke', 'rgba(45, 45, 58, 0.18)')
      .attr('stroke-width', 0.75)
      .attr('class', 'connector-group')
      .style('pointer-events', 'none');

    const midNodes = positioned.filter(
      (n) => !n.isDomainLeaf && (n.children?.length > 0 || n._depth <= 2),
    );
    const leafNodes = positioned.filter((n) => n.isDomainLeaf || (!n.children?.length && !n._scaffold));

    // Mid-level frosted discs with icons (incl. branchlets)
    const midG = group.append('g').attr('class', 'mid-nodes');
    midNodes.forEach((node) => {
      const level = node._depth;
      const nodeRadius = level === 1 ? 8 : level === 2 ? 5 : 3.2;
      const nodeGroup = midG.append('g').attr('class', 'node-group').attr('data-node-id', node.id);

      const nodeCircle = nodeGroup
        .append('circle')
        .attr('cx', node._x)
        .attr('cy', node._y)
        .attr('r', nodeRadius)
        .attr('fill', level === 1 ? dept.color : '#f8f6fc')
        .attr('fill-opacity', level === 1 ? 0.75 : 0.85)
        .attr('stroke', level === 1 ? dept.color : 'rgba(45, 45, 58, 0.28)')
        .attr('stroke-width', level === 1 ? 1.8 : 1)
        .style('cursor', 'pointer');

      if (node.metrics?.status) {
        const statusColor =
          node.metrics.status === 'green' ? '#10b981' : node.metrics.status === 'amber' ? '#f59e0b' : '#ef4444';
        nodeGroup
          .append('circle')
          .attr('cx', node._x + nodeRadius * 0.7)
          .attr('cy', node._y - nodeRadius * 0.7)
          .attr('r', 2.5)
          .attr('fill', statusColor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 0.8)
          .attr('class', 'status-dot');
      }

      if (node.icon && ICON_PATHS[node.icon]) {
        const iconSize = level === 1 ? 12 : 9;
        nodeGroup
          .append('path')
          .attr('d', ICON_PATHS[node.icon])
          .attr('transform', `translate(${node._x - iconSize / 2}, ${node._y - iconSize / 2}) scale(${iconSize / 24})`)
          .attr('fill', 'none')
          .attr('stroke', level === 1 ? '#fff' : 'rgba(45, 45, 58, 0.65)')
          .attr('stroke-width', 1.6)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .attr('class', 'node-icon')
          .style('pointer-events', 'none');
      }

      nodeGroup
        .on('click', (event) => {
          event.stopPropagation();
          this.zoomToNode(node);
        })
        .on('mouseover', () => {
          nodeCircle.transition().duration(120).attr('r', nodeRadius * 1.35);
          nodeGroup
            .append('text')
            .attr('x', node._x)
            .attr('y', node._y - nodeRadius - 7)
            .attr('text-anchor', 'middle')
            .attr('fill', 'rgba(45, 45, 58, 0.9)')
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .attr('letter-spacing', '0.06em')
            .attr('text-transform', 'uppercase')
            .attr('class', 'hover-label')
            .text(node.label);
        })
        .on('mouseout', () => {
          nodeCircle.transition().duration(120).attr('r', nodeRadius);
          nodeGroup.select('.hover-label').remove();
        });
    });

    // Batched leaf circles (domain detail)
    const leafG = group.append('g').attr('class', 'leaf-nodes');
    const midIds = new Set(midNodes.map((n) => n.id));
    const uniqueLeaves = leafNodes.filter((n) => n.isDomainLeaf || !midIds.has(n.id));

    leafG
      .selectAll('circle.leaf-dot')
      .data(uniqueLeaves, (d) => d.id)
      .join('circle')
      .attr('class', 'leaf-dot node-group')
      .attr('data-node-id', (d) => d.id)
      .attr('cx', (d) => d._x)
      .attr('cy', (d) => d._y)
      .attr('r', 2.8)
      .attr('fill', (d) => {
        const st = d.metrics?.status;
        if (st === 'amber') return '#f59e0b';
        if (st === 'red') return '#ef4444';
        return dept.color;
      })
      .attr('fill-opacity', 0.72)
      .attr('stroke', 'rgba(255,255,255,0.85)')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        this.zoomToNode(d);
      })
      .on('mouseover', function (event, d) {
        d3.select(this).transition().duration(100).attr('r', 4.5).attr('fill-opacity', 0.95);
        leafG
          .append('text')
          .attr('x', d._x)
          .attr('y', d._y - 8)
          .attr('text-anchor', 'middle')
          .attr('fill', 'rgba(45, 45, 58, 0.88)')
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .attr('letter-spacing', '0.05em')
          .attr('class', 'hover-label')
          .text(d.label);
      })
      .on('mouseout', function () {
        d3.select(this).transition().duration(100).attr('r', 2.8).attr('fill-opacity', 0.72);
        leafG.selectAll('.hover-label').remove();
      });

    // Tiny status dots on amber/red leaves
    const statusLeaves = uniqueLeaves.filter((d) => d.metrics?.status === 'amber' || d.metrics?.status === 'red');
    leafG
      .selectAll('circle.status-leaf')
      .data(statusLeaves, (d) => d.id + '-st')
      .join('circle')
      .attr('class', 'status-dot')
      .attr('cx', (d) => d._x + 2.5)
      .attr('cy', (d) => d._y - 2.5)
      .attr('r', 1.6)
      .attr('fill', (d) => (d.metrics.status === 'amber' ? '#f59e0b' : '#ef4444'))
      .style('pointer-events', 'none');
  }

  drawParticleCore() {
    const particleGroup = this.container.append('g').attr('class', 'particle-group');
    const particleCount = 1500;
    const coreRadius = 130;

    const rng = new SeededRandom(12345);

    for (let i = 0; i < particleCount; i++) {
      const angle = rng.next() * Math.PI * 2;
      const r = Math.pow(rng.next(), 0.7) * coreRadius;
      const x = this.centerX + r * Math.cos(angle);
      const y = this.centerY + r * Math.sin(angle);
      const size = rng.next() * 2.5 + 0.5;
      const colors = ['#e94e87', '#ff6b3d', '#4a9eff', '#8b5cf6'];
      const color = colors[Math.floor(rng.next() * colors.length)];

      particleGroup
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', size)
        .attr('fill', color)
        .attr('fill-opacity', rng.next() * 0.4 + 0.2);
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

  zoomToNode(node, deptIndex) {
    this.selectedNode = node;
    if (deptIndex !== undefined) {
      this.currentDeptIndex = deptIndex;
    }

    const scale = node.isDept ? 1.8 : node.path?.length === 1 ? 2.5 : 3.5;
    const nodeX = node._x || (node.isDept ? node._x : this.centerX);
    const nodeY = node._y || (node.isDept ? node._y : this.centerY);
    const translateX = this.width / 2 - nodeX * scale;
    const translateY = this.height / 2 - nodeY * scale;

    this.svg
      .transition()
      .duration(800)
      .call(this.zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));

    setTimeout(() => this.openCard(node), 850);
  }

  openCard(node) {
    const card = document.getElementById('data-card');
    const cardX = node._x || this.centerX;
    const cardY = node._y || this.centerY;

    const transform = d3.zoomTransform(this.svg.node());
    const screenX = transform.applyX(cardX);
    const screenY = transform.applyY(cardY);

    card.style.left = `${screenX + 60}px`;
    card.style.top = `${screenY - 50}px`;

    document.getElementById('card-title').textContent = node.label || node.id;
    const metricsHtml = node.metrics
      ? Object.entries(node.metrics)
          .map(([k, v]) => `<div class="metric-row"><span class="metric-key">${k}:</span> <span class="metric-value">${v}</span></div>`)
          .join('')
      : '<div class="metric-row"><span class="metric-value">No metrics</span></div>';
    document.getElementById('card-metrics').innerHTML = metricsHtml;

    const children =
      node._leafCount ||
      (node.children ? countLeaves(node) : 0) ||
      node.tree?.length ||
      0;
    document.getElementById('card-children').textContent = children;

    card.classList.add('open');
  }

  closeCard() {
    document.getElementById('data-card').classList.remove('open');
    document.getElementById('task-popover').classList.remove('open');
    this.selectedNode = null;
  }

  cycleDepartment(direction) {
    const count = APOS_DATA.departments.length;
    if (direction === 'next') {
      this.currentDeptIndex = (this.currentDeptIndex + 1) % count;
    } else {
      this.currentDeptIndex = (this.currentDeptIndex - 1 + count) % count;
    }
    const dept = APOS_DATA.departments[this.currentDeptIndex];
    this.zoomToNode(dept, this.currentDeptIndex);
  }

  setupControls() {
    document.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 1.3);
    });

    document.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
      this.svg.transition().call(this.zoom.scaleBy, 0.7);
    });

    document.querySelector('[data-action="reset"]').addEventListener('click', () => {
      this.closeCard();
      this.svg.transition().duration(800).call(this.zoom.transform, d3.zoomIdentity);
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

  setupCard() {
    document.getElementById('card-close').addEventListener('click', () => {
      this.closeCard();
    });

    document.getElementById('new-task-link').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('task-popover').classList.add('open');
    });

    document.getElementById('task-popover-close').addEventListener('click', () => {
      document.getElementById('task-popover').classList.remove('open');
    });

    document.getElementById('task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const description = document.getElementById('task-desc').value;
      const recipient = document.getElementById('task-recipient').value;
      const priority = document.getElementById('task-priority').value;

      console.log('Task created:', { node: this.selectedNode?.id, description, recipient, priority });
      alert(`Task created for ${this.selectedNode?.label || 'node'}:\nRecipient: ${recipient}\nPriority: ${priority}\n\n"${description}"`);

      document.getElementById('task-desc').value = '';
      document.getElementById('task-recipient').value = '';
      document.getElementById('task-priority').value = 'medium';
      document.getElementById('task-popover').classList.remove('open');
    });
  }

  async fetchLiveData() {
    try {
      const [snapRes, machRes] = await Promise.all([
        fetch('/api/alert/red-flags/snapshot', { credentials: 'include' }).catch(() => null),
        fetch('/api/alert/machines', { credentials: 'include' }).catch(() => null),
      ]);
      if (snapRes && snapRes.ok) {
        this.redFlagsData = await snapRes.json();
      } else {
        this.redFlagsData = { rows: [] };
      }
      if (machRes && machRes.ok) {
        const payload = await machRes.json();
        const list = payload.machines || payload.rows || [];
        if (Array.isArray(list) && list.length > 0) {
          const prev = this.liveMachines.length;
          this.liveMachines = list;
          // Rebuild once when live machines first arrive (prefer real names over catalog)
          if (prev === 0) this.buildWorld();
        }
      }
      this.updateAlertPulse();
    } catch (err) {
      this.redFlagsData = { rows: [] };
    }

    if (!this._livePoll) {
      this._livePoll = setInterval(() => this.pollLiveOnly(), 60000);
    }
  }

  async pollLiveOnly() {
    try {
      const snapRes = await fetch('/api/alert/red-flags/snapshot', { credentials: 'include' });
      if (snapRes.ok) {
        this.redFlagsData = await snapRes.json();
        this.updateAlertPulse();
      }
    } catch (_) {
      /* ignore */
    }
  }

  updateAlertPulse() {
    const hasAlerts = this.redFlagsData && this.redFlagsData.rows && this.redFlagsData.rows.length > 0;
    const redFlagsNode = d3.select('.node-group[data-node-id="red-flags-detector"] circle');
    if (!redFlagsNode.empty()) {
      if (hasAlerts) {
        redFlagsNode.attr('fill', '#ef4444').style('animation', 'pulse-alert 1.5s ease-in-out infinite');
      } else {
        redFlagsNode.style('animation', 'none');
      }
    }
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.buildWorld();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new RadialOrgMapSingleWorld('org-map-svg');
});
