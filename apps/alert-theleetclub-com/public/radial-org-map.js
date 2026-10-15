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
    this.activePath = new Set();

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

    // Build full tree world
    this.buildWorld();

    this.setupControls();
    this.setupCard();
    this.fetchRedFlags();

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

    document.getElementById('dept-name').textContent = 'APOS';
    document.getElementById('dept-subtitle').textContent = 'organizational map';

    this.drawParticleCore();

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

      // Layered orb
      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 50)
        .attr('fill', `url(#grad-${dept.id})`)
        .attr('class', 'dept-orb-outer')
        .style('pointer-events', 'none');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 36)
        .attr('fill', dept.color)
        .attr('fill-opacity', 0.15)
        .attr('class', 'dept-orb-mid')
        .style('pointer-events', 'none');

      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 26)
        .attr('fill', dept.color)
        .attr('fill-opacity', 0.4)
        .attr('class', 'dept-orb-core')
        .style('pointer-events', 'none');

      // Orbit ring
      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 52)
        .attr('fill', 'none')
        .attr('stroke', dept.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.3)
        .attr('class', 'dept-orbit')
        .style('pointer-events', 'none');

      // Icon
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

      // Invisible clickable overlay
      deptGroup
        .append('circle')
        .attr('cx', deptX)
        .attr('cy', deptY)
        .attr('r', 55)
        .attr('fill', 'transparent')
        .attr('class', 'dept-click-target')
        .style('cursor', 'pointer')
        .on('click', (event) => {
          event.stopPropagation();
          this.zoomToNode({ ...dept, isDept: true }, i);
        })
        .on('mouseover', () => {
          deptGroup.select('.dept-orb-core').transition().duration(200).attr('fill-opacity', 0.6);
        })
        .on('mouseout', () => {
          deptGroup.select('.dept-orb-core').transition().duration(200).attr('fill-opacity', 0.4);
        });

      this.renderLargeDenseTree(this.container, dept, deptX, deptY, angle);
    });

    this.svg.transition().duration(800).call(this.zoom.transform, d3.zoomIdentity);
  }

  renderLargeDenseTree(group, dept, centerX, centerY, baseAngle) {
    const allNodes = flattenTree(dept.tree);
    const rng = new SeededRandom(dept.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));

    const angleSpread = (Math.PI * 2) / APOS_DATA.departments.length * 0.85;
    const startAngle = baseAngle - angleSpread / 2;

    const innerRadius = 60;
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

      node._x = x;
      node._y = y;
      node._deptColor = dept.color;
      node._deptId = dept.id;

      if (level > 1) {
        const parent = allNodes.find((n) => n.id === node.path[node.path.length - 2]);
        if (parent && parent._x !== undefined) {
          group
            .append('line')
            .attr('x1', parent._x)
            .attr('y1', parent._y)
            .attr('x2', x)
            .attr('y2', y)
            .attr('stroke', 'rgba(245, 245, 247, 0.2)')
            .attr('stroke-width', 0.8)
            .attr('class', 'connector-group')
            .attr('data-parent-id', parent.id)
            .attr('data-child-id', node.id);
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
          .attr('class', 'connector-group')
          .attr('data-parent-id', dept.id)
          .attr('data-child-id', node.id);
      }

      const nodeRadius = level === 1 ? 8 : level === 2 ? 5 : 3;
      const nodeGroup = group.append('g').attr('class', 'node-group').attr('data-node-id', node.id);

      const nodeCircle = nodeGroup
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', nodeRadius)
        .attr('fill', level === 1 ? dept.color : level === 2 ? '#f5f5f7' : '#f5f5f7')
        .attr('fill-opacity', level === 1 ? 0.6 : level === 2 ? 0.4 : 0.7)
        .attr('stroke', level === 1 ? dept.color : 'none')
        .attr('stroke-width', level === 1 ? 1.5 : 0)
        .attr('filter', level === 3 ? 'url(#glow-soft)' : 'none')
        .style('cursor', 'pointer');

      // Status dot
      if (node.metrics?.status) {
        const statusColor = node.metrics.status === 'green' ? '#10b981' : node.metrics.status === 'amber' ? '#f59e0b' : '#ef4444';
        nodeGroup
          .append('circle')
          .attr('cx', x + nodeRadius * 0.7)
          .attr('cy', y - nodeRadius * 0.7)
          .attr('r', 3)
          .attr('fill', statusColor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1)
          .attr('class', 'status-dot');
      }

      // Icon for mid-level
      if (level <= 2 && node.icon && ICON_PATHS[node.icon]) {
        const iconSize = level === 1 ? 14 : 10;
        nodeGroup
          .append('path')
          .attr('d', ICON_PATHS[node.icon])
          .attr('transform', `translate(${x - iconSize / 2}, ${y - iconSize / 2}) scale(${iconSize / 24})`)
          .attr('fill', 'none')
          .attr('stroke', level === 1 ? '#fff' : 'rgba(45, 45, 58, 0.6)')
          .attr('stroke-width', 1.5)
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
        .on('mouseover', (event) => {
          nodeCircle.transition().duration(150).attr('r', nodeRadius * 1.4);
          if (node.label) {
            const label = nodeGroup
              .append('text')
              .attr('x', x)
              .attr('y', y - nodeRadius - 8)
              .attr('text-anchor', 'middle')
              .attr('fill', 'rgba(255, 255, 255, 0.9)')
              .attr('font-size', '11px')
              .attr('font-weight', '600')
              .attr('letter-spacing', '0.05em')
              .attr('text-transform', 'uppercase')
              .attr('class', 'hover-label')
              .text(node.label);
          }
        })
        .on('mouseout', (event) => {
          nodeCircle.transition().duration(150).attr('r', nodeRadius);
          nodeGroup.select('.hover-label').remove();
        });
    });
  }

  drawParticleCore() {
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

    const children = node.tree?.length || (node.children?.length) || 0;
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

  async fetchRedFlags() {
    try {
      const response = await fetch('/api/alert/red-flags/snapshot', { credentials: 'include' });
      if (response.ok) {
        this.redFlagsData = await response.json();
        this.updateAlertPulse();
      } else {
        this.redFlagsData = { rows: [] };
      }
    } catch (err) {
      this.redFlagsData = { rows: [] };
    }

    setInterval(() => this.fetchRedFlags(), 60000);
  }

  updateAlertPulse() {
    const hasAlerts = this.redFlagsData && this.redFlagsData.rows && this.redFlagsData.rows.length > 0;
    const redFlagsNode = d3.select('.node-group[data-node-id="red-flags-detector"] circle');
    if (hasAlerts) {
      redFlagsNode.attr('fill', '#ef4444').style('animation', 'pulse-alert 1.5s ease-in-out infinite');
    } else {
      redFlagsNode.attr('fill', null).style('animation', 'none');
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
