/**
 * APOS Space Map — mock hierarchy (stable string IDs).
 * Shape is API-ready: live endpoints can replace this module later.
 */
window.APOS_SPACE_DATA = {
  meta: {
    version: 1,
    generatedAt: '2026-10-15T12:00:00Z',
    currency: 'KWD',
  },
  thresholds: {
    stockLowPct: 15,
    offlineHours: 2,
    revenueBelowBaselinePct: 70,
  },
  people: {
    'person-ops-kw': {
      id: 'person-ops-kw',
      name: 'Noura Al-Enezi',
      role: 'operations_manager',
      email: 'noura.ops@leetclub.com',
      phone: '+965 9001 1001',
    },
    'person-am-shad': {
      id: 'person-am-shad',
      name: 'Fahad Al-Sabah',
      role: 'area_manager',
      email: 'fahad.am@leetclub.com',
      phone: '+965 9002 2002',
    },
    'person-am-zahra': {
      id: 'person-am-zahra',
      name: 'Sara Al-Mutairi',
      role: 'area_manager',
      email: 'sara.am@leetclub.com',
      phone: '+965 9002 2003',
    },
    'person-op-ahmed': {
      id: 'person-op-ahmed',
      name: 'Ahmed Al-Rashid',
      role: 'operator',
      email: 'ahmed.op@leetclub.com',
      phone: '+965 5001 3001',
    },
    'person-op-yousef': {
      id: 'person-op-yousef',
      name: 'Yousef Al-Kandari',
      role: 'operator',
      email: 'yousef.op@leetclub.com',
      phone: '+965 5001 3002',
    },
    'person-tech-khaled': {
      id: 'person-tech-khaled',
      name: 'Khaled Al-Ajmi',
      role: 'technician',
      email: 'khaled.tech@leetclub.com',
      phone: '+965 5002 4001',
    },
    'person-tech-bader': {
      id: 'person-tech-bader',
      name: 'Bader Al-Shammari',
      role: 'technician',
      email: 'bader.tech@leetclub.com',
      phone: '+965 5002 4002',
    },
  },
  enterprise: {
    id: 'ent-apos',
    label: 'APOS',
    name: 'Alert Platform Operating System',
  },
  countries: [
    {
      id: 'country-kw',
      label: 'Kuwait',
      code: 'KW',
      status: 'active',
      opsManagerId: 'person-ops-kw',
      clients: [
        {
          id: 'client-leet',
          label: 'Leet',
          brand: 'Leet Club',
          status: 'active',
          areas: [
            {
              id: 'area-shadadiya',
              label: 'Shadadiya',
              areaManagerId: 'person-am-shad',
              locations: [
                {
                  id: 'loc-ku-coba',
                  label: 'KU COBA',
                  address: 'Kuwait University, College of Business Administration, Shadadiya',
                  lat: 29.3265,
                  lng: 47.9201,
                  machines: [
                    {
                      id: 'm-ku-1',
                      label: 'KU-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 245.5, dailyAvg: 210, monthly: 5200, cashPct: 38, digitalPct: 62, baseline: 200 },
                      stock: { fillPct: 72, topProducts: ['Spanish Latte', 'Cappuccino', 'Americano'], peakHours: '09:00–11:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-03-15' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-08', history: ['Filter swap', 'Boiler check'] },
                      operators: { lastVisit: '2026-10-14 16:20', log: ['Restock OK', 'Cleaned hopper'] },
                    },
                    {
                      id: 'm-ku-2',
                      label: 'KU-2',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 188.0, dailyAvg: 195, monthly: 4100, cashPct: 42, digitalPct: 58, baseline: 190 },
                      stock: { fillPct: 12, topProducts: ['Mocha', 'Flat White', 'Water'], peakHours: '12:00–14:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-03-15' },
                      technical: { openTickets: 1, lastMaintenance: '2026-09-22', history: ['Jam clear'] },
                      operators: { lastVisit: '2026-10-13 11:05', log: ['Low milk flagged'] },
                    },
                    {
                      id: 'm-ku-3',
                      label: 'KU-3 Engineering',
                      model: 'Vendon Compact',
                      status: 'maintenance',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 0, dailyAvg: 140, monthly: 2800, cashPct: 50, digitalPct: 50, baseline: 130 },
                      stock: { fillPct: 45, topProducts: ['Espresso', 'Tea'], peakHours: '08:00–10:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2026-12-01' },
                      technical: { openTickets: 2, lastMaintenance: '2026-10-15', history: ['Board replace in progress'] },
                      operators: { lastVisit: '2026-10-12 09:40', log: ['Machine offline for tech'] },
                    },
                    {
                      id: 'm-ku-4',
                      label: 'KU-4',
                      model: 'Vendon Compact',
                      status: 'unknown',
                      stale: true,
                      lastSeen: '2026-10-11T03:40:00Z',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 0, dailyAvg: 90, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 90 },
                      stock: { fillPct: 48, topProducts: ['Latte'], peakHours: '—' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-03-15' },
                      technical: { openTickets: 0, lastMaintenance: '2026-09-02', history: ['No heartbeat'] },
                      operators: { lastVisit: '2026-10-11 03:40', log: ['No recent telemetry'] },
                    },
                  ],
                },
                {
                  id: 'loc-ku-science',
                  label: 'KU Science',
                  address: 'Kuwait University Science Campus, Shadadiya',
                  lat: 29.3312,
                  lng: 47.9155,
                  machines: [
                    {
                      id: 'm-ku-sci-1',
                      label: 'KU-SCI-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 156.25, dailyAvg: 160, monthly: 3400, cashPct: 35, digitalPct: 65, baseline: 155 },
                      stock: { fillPct: 68, topProducts: ['Cold Brew', 'Latte'], peakHours: '10:00–12:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-06-01' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-01', history: ['Routine'] },
                      operators: { lastVisit: '2026-10-14 14:00', log: ['Restock'] },
                    },
                  ],
                },
              ],
            },
            {
              id: 'area-zahra',
              label: 'Zahra',
              areaManagerId: 'person-am-zahra',
              locations: [
                {
                  id: 'loc-mew-zahra',
                  label: 'MEW Zahra',
                  address: 'Ministry of Electricity & Water, Zahra',
                  lat: 29.278,
                  lng: 48.045,
                  machines: [
                    {
                      id: 'm-mew-1',
                      label: 'MEW-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 312.0, dailyAvg: 280, monthly: 6800, cashPct: 28, digitalPct: 72, baseline: 270 },
                      stock: { fillPct: 81, topProducts: ['Spanish Latte', 'Cappuccino'], peakHours: '07:00–09:00' },
                      contract: { vendor: 'Vendon', lease: '48 mo', renewal: '2028-01-10' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-10', history: ['OK'] },
                      operators: { lastVisit: '2026-10-15 07:30', log: ['AM restock'] },
                    },
                    {
                      id: 'm-mew-2',
                      label: 'MEW-2',
                      model: 'Vendon Compact',
                      status: 'offline',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      offlineHours: 3.5,
                      revenue: { today: 12.0, dailyAvg: 95, monthly: 1900, cashPct: 40, digitalPct: 60, baseline: 90 },
                      stock: { fillPct: 55, topProducts: ['Americano'], peakHours: '11:00–13:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-02-01' },
                      technical: { openTickets: 1, lastMaintenance: '2026-09-15', history: ['Network drop'] },
                      operators: { lastVisit: '2026-10-14 18:00', log: ['Reported offline'] },
                    },
                    {
                      id: 'm-mew-3',
                      label: 'MEW-3',
                      model: 'Vendon Compact',
                      status: 'unknown',
                      stale: true,
                      lastSeen: '2026-10-09T22:15:00Z',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 0, dailyAvg: 70, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 70 },
                      stock: { fillPct: 61, topProducts: ['Tea'], peakHours: '—' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-02-01' },
                      technical: { openTickets: 0, lastMaintenance: '2026-08-30', history: ['Telemetry lost'] },
                      operators: { lastVisit: '2026-10-09 22:15', log: ['No heartbeat'] },
                    },
                  ],
                },
                {
                  id: 'loc-jaber-g2',
                  label: 'Jaber Gate 2',
                  address: 'Jaber Al-Ahmad Hospital, Gate 2',
                  lat: 29.2895,
                  lng: 48.012,
                  machines: [
                    {
                      id: 'm-jg2-1',
                      label: 'JG2-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 98.5, dailyAvg: 110, monthly: 2400, cashPct: 45, digitalPct: 55, baseline: 105 },
                      stock: { fillPct: 40, topProducts: ['Espresso', 'Water'], peakHours: '14:00–16:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-08-20' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-05', history: ['OK'] },
                      operators: { lastVisit: '2026-10-13 15:20', log: ['Visit'] },
                    },
                  ],
                },
                {
                  id: 'loc-jaber-g6',
                  label: 'Jaber Gate 6',
                  address: 'Jaber Al-Ahmad Hospital, Gate 6',
                  lat: 29.291,
                  lng: 48.018,
                  machines: [
                    {
                      id: 'm-jg6-1',
                      label: 'JG6-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 42.0, dailyAvg: 120, monthly: 2100, cashPct: 33, digitalPct: 67, baseline: 115 },
                      stock: { fillPct: 22, topProducts: ['Latte', 'Tea'], peakHours: '08:00–10:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-08-20' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-02', history: ['OK'] },
                      operators: { lastVisit: '2026-10-15 08:10', log: ['Partial restock'] },
                    },
                    {
                      id: 'm-jg6-2',
                      label: 'JG6-2',
                      model: 'Vendon Compact',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 67.75, dailyAvg: 80, monthly: 1600, cashPct: 50, digitalPct: 50, baseline: 75 },
                      stock: { fillPct: 90, topProducts: ['Hot Chocolate'], peakHours: '16:00–18:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2026-11-30' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-11', history: ['OK'] },
                      operators: { lastVisit: '2026-10-14 17:00', log: ['Full'] },
                    },
                  ],
                },
              ],
            },
            {
              id: 'area-salmiya',
              label: 'Salmiya',
              areaManagerId: 'person-am-shad',
              locations: [
                {
                  id: 'loc-marina',
                  label: 'Marina Walk',
                  address: 'Marina Crescent, Salmiya',
                  lat: 29.339,
                  lng: 48.075,
                  machines: [
                    {
                      id: 'm-mar-1',
                      label: 'MAR-1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 410.0, dailyAvg: 380, monthly: 9200, cashPct: 20, digitalPct: 80, baseline: 360 },
                      stock: { fillPct: 64, topProducts: ['Spanish Latte', 'Iced Latte'], peakHours: '18:00–21:00' },
                      contract: { vendor: 'Vendon', lease: '48 mo', renewal: '2028-05-01' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-09', history: ['OK'] },
                      operators: { lastVisit: '2026-10-15 10:00', log: ['Peak prep'] },
                    },
                  ],
                },
                {
                  id: 'loc-360',
                  label: '360 Mall',
                  address: '360 Mall, South Surra',
                  lat: 29.311,
                  lng: 47.998,
                  machines: [
                    {
                      id: 'm-360-1',
                      label: '360-L1',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 275.0, dailyAvg: 260, monthly: 6100, cashPct: 25, digitalPct: 75, baseline: 250 },
                      stock: { fillPct: 58, topProducts: ['Cappuccino', 'Cookie'], peakHours: '15:00–19:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-09-12' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-07', history: ['OK'] },
                      operators: { lastVisit: '2026-10-14 13:30', log: ['OK'] },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'client-ee',
          label: 'EE',
          brand: 'EE Retail',
          status: 'active',
          areas: [
            {
              id: 'area-ee-hawally',
              label: 'Hawally',
              areaManagerId: 'person-am-zahra',
              locations: [
                {
                  id: 'loc-ee-hawally',
                  label: 'EE Hawally',
                  address: 'Tunis St, Hawally',
                  lat: 29.333,
                  lng: 48.028,
                  machines: [
                    {
                      id: 'm-ee-1',
                      label: 'EE-1',
                      model: 'Vendon Compact',
                      status: 'active',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 134.0, dailyAvg: 125, monthly: 2900, cashPct: 55, digitalPct: 45, baseline: 120 },
                      stock: { fillPct: 70, topProducts: ['Tea', 'Water'], peakHours: '09:00–11:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-01-15' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-03', history: ['OK'] },
                      operators: { lastVisit: '2026-10-13 12:00', log: ['OK'] },
                    },
                    {
                      id: 'm-ee-2',
                      label: 'EE-2',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 88.5, dailyAvg: 140, monthly: 3100, cashPct: 48, digitalPct: 52, baseline: 135 },
                      stock: { fillPct: 14, topProducts: ['Espresso', 'Water'], peakHours: '12:00–14:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-01-15' },
                      technical: { openTickets: 1, lastMaintenance: '2026-09-28', history: ['Low stock'] },
                      operators: { lastVisit: '2026-10-14 10:20', log: ['Flagged fill'] },
                    },
                  ],
                },
                {
                  id: 'loc-ee-salwa',
                  label: 'EE Salwa',
                  address: 'Salwa Block 7',
                  lat: 29.295,
                  lng: 48.055,
                  machines: [
                    {
                      id: 'm-ee-3',
                      label: 'EE-3',
                      model: 'Vendon Compact',
                      status: 'offline',
                      offlineHours: 4.2,
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 8.0, dailyAvg: 95, monthly: 1800, cashPct: 60, digitalPct: 40, baseline: 90 },
                      stock: { fillPct: 48, topProducts: ['Tea'], peakHours: '08:00–10:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2026-12-20' },
                      technical: { openTickets: 2, lastMaintenance: '2026-09-10', history: ['Modem swap pending'] },
                      operators: { lastVisit: '2026-10-12 16:00', log: ['Offline reported'] },
                    },
                  ],
                },
              ],
            },
            {
              id: 'area-ee-farwaniya',
              label: 'Farwaniya',
              areaManagerId: 'person-am-shad',
              locations: [
                {
                  id: 'loc-ee-farwaniya',
                  label: 'EE Farwaniya',
                  address: 'Farwaniya Co-op',
                  lat: 29.277,
                  lng: 47.958,
                  machines: [
                    {
                      id: 'm-ee-4',
                      label: 'EE-4',
                      model: 'Vendon Pro 360',
                      status: 'active',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 198.0, dailyAvg: 175, monthly: 4200, cashPct: 40, digitalPct: 60, baseline: 170 },
                      stock: { fillPct: 66, topProducts: ['Latte', 'Cookie'], peakHours: '17:00–20:00' },
                      contract: { vendor: 'Vendon', lease: '36 mo', renewal: '2027-11-01' },
                      technical: { openTickets: 0, lastMaintenance: '2026-10-06', history: ['OK'] },
                      operators: { lastVisit: '2026-10-15 09:00', log: ['Restock'] },
                    },
                    {
                      id: 'm-ee-5',
                      label: 'EE-5',
                      model: 'Vendon Compact',
                      status: 'maintenance',
                      operatorId: 'person-op-yousef',
                      technicianId: 'person-tech-bader',
                      revenue: { today: 0, dailyAvg: 70, monthly: 1400, cashPct: 50, digitalPct: 50, baseline: 65 },
                      stock: { fillPct: 35, topProducts: ['Americano'], peakHours: '11:00–13:00' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-04-01' },
                      technical: { openTickets: 1, lastMaintenance: '2026-10-15', history: ['Pump service'] },
                      operators: { lastVisit: '2026-10-14 11:30', log: ['Tech on site'] },
                    },
                    {
                      id: 'm-ee-6',
                      label: 'EE-6',
                      model: 'Vendon Compact',
                      status: 'unknown',
                      stale: true,
                      lastSeen: '2026-10-08T18:05:00Z',
                      operatorId: 'person-op-ahmed',
                      technicianId: 'person-tech-khaled',
                      revenue: { today: 0, dailyAvg: 55, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 55 },
                      stock: { fillPct: 33, topProducts: ['Water'], peakHours: '—' },
                      contract: { vendor: 'Vendon', lease: '24 mo', renewal: '2027-04-01' },
                      technical: { openTickets: 0, lastMaintenance: '2026-09-01', history: ['Silent'] },
                      operators: { lastVisit: '2026-10-08 18:05', log: ['Last seen'] },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'client-park',
          label: 'Park',
          brand: 'Park Mall',
          status: 'future',
          comingSoon: true,
          areas: [
            {
              id: 'area-park-mall',
              label: 'Park Mall',
              areaManagerId: null,
              locations: [
                {
                  id: 'loc-park-l1',
                  label: 'Park L1 Food Court',
                  address: 'The Park Mall, Level 1',
                  lat: 29.305,
                  lng: 48.02,
                  machines: [
                    {
                      id: 'm-park-1',
                      label: 'PARK-1',
                      model: 'Vendon Pro 360',
                      status: 'planned',
                      operatorId: null,
                      technicianId: null,
                      revenue: { today: 0, dailyAvg: 0, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 200 },
                      stock: { fillPct: 0, topProducts: ['TBD'], peakHours: 'TBD' },
                      contract: { vendor: 'Vendon', lease: 'pending', renewal: 'TBD' },
                      technical: { openTickets: 0, lastMaintenance: '—', history: [] },
                      operators: { lastVisit: '—', log: [] },
                    },
                    {
                      id: 'm-park-2',
                      label: 'PARK-2',
                      model: 'Vendon Compact',
                      status: 'planned',
                      operatorId: null,
                      technicianId: null,
                      revenue: { today: 0, dailyAvg: 0, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 120 },
                      stock: { fillPct: 0, topProducts: ['TBD'], peakHours: 'TBD' },
                      contract: { vendor: 'Vendon', lease: 'pending', renewal: 'TBD' },
                      technical: { openTickets: 0, lastMaintenance: '—', history: [] },
                      operators: { lastVisit: '—', log: [] },
                    },
                  ],
                },
                {
                  id: 'loc-park-cinema',
                  label: 'Park Cinema Lobby',
                  address: 'The Park Mall, Cinema wing',
                  lat: 29.306,
                  lng: 48.021,
                  machines: [
                    {
                      id: 'm-park-3',
                      label: 'PARK-3',
                      model: 'Vendon Pro 360',
                      status: 'planned',
                      operatorId: null,
                      technicianId: null,
                      revenue: { today: 0, dailyAvg: 0, monthly: 0, cashPct: 0, digitalPct: 100, baseline: 180 },
                      stock: { fillPct: 0, topProducts: ['TBD'], peakHours: 'TBD' },
                      contract: { vendor: 'Vendon', lease: 'pending', renewal: 'TBD' },
                      technical: { openTickets: 0, lastMaintenance: '—', history: [] },
                      operators: { lastVisit: '—', log: [] },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'country-sa',
      label: 'Saudi Arabia',
      code: 'SA',
      status: 'future',
      planned: true,
      opsManagerId: null,
      clients: [],
    },
    {
      id: 'country-ae',
      label: 'UAE',
      code: 'AE',
      status: 'future',
      planned: true,
      opsManagerId: null,
      clients: [],
    },
  ],
};

window.APOS_SPACE_BRANCHES = [
  { id: 'revenue', label: 'Revenue', key: 'revenue' },
  { id: 'operators', label: 'Operators', key: 'operators' },
  { id: 'technical', label: 'Technical Support', key: 'technical' },
  { id: 'stock', label: 'Stock', key: 'stock' },
  { id: 'contract', label: 'Contract', key: 'contract' },
];

/** Shared accents + rollup helpers for tree-map and space-map */
window.APOS_MAP_UTILS = (function () {
  const THRESH = () => window.APOS_SPACE_DATA.thresholds;
  const ACCENTS = {
    teal: { key: 'teal', stroke: '#6ed4d0', fill: 'rgba(110, 212, 208, 0.92)', soft: 'rgba(110, 212, 208, 0.28)' },
    violet: { key: 'violet', stroke: '#b8a0e8', fill: 'rgba(184, 160, 232, 0.92)', soft: 'rgba(184, 160, 232, 0.28)' },
    rose: { key: 'rose', stroke: '#e8a0b8', fill: 'rgba(232, 160, 184, 0.92)', soft: 'rgba(232, 160, 184, 0.28)' },
    amber: { key: 'amber', stroke: '#e8c078', fill: 'rgba(232, 192, 120, 0.92)', soft: 'rgba(232, 192, 120, 0.28)' },
    sky: { key: 'sky', stroke: '#7ec8e8', fill: 'rgba(126, 200, 232, 0.92)', soft: 'rgba(126, 200, 232, 0.28)' },
  };
  const HUB_ACCENT = {
    'client-leet': 'teal',
    'client-ee': 'violet',
    'client-park': 'rose',
    'country-sa': 'amber',
    'country-ae': 'sky',
  };
  const ALERT = '#ff6b7a';

  function accentFor(hubId) {
    return ACCENTS[HUB_ACCENT[hubId] || 'teal'];
  }

  function computeAlert(m) {
    if (!m || m.status === 'planned' || m.status === 'future') return null;
    if (m.status === 'unknown' || m.stale) return null;
    const t = THRESH();
    const stockLow = (m.stock?.fillPct ?? 100) < t.stockLowPct;
    const offlineLong = m.status === 'offline' && (m.offlineHours || 0) > t.offlineHours;
    const revBase = m.revenue?.baseline || 1;
    const revLow = ((m.revenue?.today ?? revBase) / revBase) * 100 < t.revenueBelowBaselinePct;
    if (offlineLong || m.status === 'offline') return 'red';
    if (stockLow || revLow || m.status === 'maintenance') return 'amber';
    return null;
  }

  function walkMachines(node, childrenOf) {
    const out = [];
    const walk = (id) => {
      (childrenOf.get(id) || []).forEach((c) => {
        if (c.type === 'machine') out.push(c);
        else if (c.type !== 'branch') walk(c.id);
      });
    };
    if (node.type === 'machine') out.push(node);
    else walk(node.id);
    return out;
  }

  function rollup(node, childrenOf) {
    const ms = walkMachines(node, childrenOf);
    const total = ms.length;
    const t = THRESH();
    const online = ms.filter((m) => m.status === 'active').length;
    const alerts = ms.filter((m) => computeAlert(m)).length;
    const offline = ms.filter((m) => m.status === 'offline').length;
    const unknown = ms.filter((m) => m.status === 'unknown' || m.stale).length;
    const maintenance = ms.filter((m) => m.status === 'maintenance').length;
    const planned = ms.filter((m) => m.status === 'planned' || m.status === 'future' || m.planned).length;
    const low = ms.filter((m) => m.status !== 'unknown' && !m.stale && (m.stock?.fillPct ?? 100) < t.stockLowPct).length;
    const revenueToday = ms.reduce((s, m) => s + (m.revenue?.today || 0), 0);
    const productCounts = {};
    ms.forEach((m) => {
      (m.stock?.topProducts || []).forEach((p) => {
        productCounts[p] = (productCounts[p] || 0) + 1;
      });
    });
    const topProduct =
      Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    return {
      total,
      online,
      alerts,
      offline,
      unknown,
      maintenance,
      planned,
      low,
      revenueToday: Math.round(revenueToday * 10) / 10,
      topProduct,
      tint: alerts > 0,
    };
  }

  function kpiRows(rollupData, currency) {
    const cur = currency || window.APOS_SPACE_DATA.meta.currency || 'KWD';
    return [
      ['Revenue today', `${rollupData.revenueToday} ${cur}`],
      ['Machines online', `${rollupData.online} / ${rollupData.total}`],
      ['Open alerts', String(rollupData.alerts)],
      ['Top product', rollupData.topProduct],
    ];
  }

  function healthOf(n) {
    if (!n) return 'unknown';
    if (n.planned || n.status === 'future' || n.status === 'planned') return 'planned';
    if (n.status === 'unknown' || n.stale) return 'unknown';
    if (n.status === 'offline') return 'offline';
    if (n.alert === 'red') return 'critical';
    if (n.alert === 'amber' || n.status === 'maintenance') return 'warning';
    if (n.type === 'machine' && (n.stock?.fillPct ?? 100) < THRESH().stockLowPct) return 'warning';
    if (n.type !== 'machine' && (n.rollup?.offline || 0) > 0) return 'critical';
    if (n.type !== 'machine' && (n.alertCount || 0) > 0) return 'warning';
    return 'healthy';
  }

  function fleetOf(machines) {
    const ops = (machines || []).filter((m) => m && m.status !== 'planned' && m.status !== 'future' && !m.planned);
    const offline = ops.filter((m) => m.status === 'offline').length;
    const unknown = ops.filter((m) => m.status === 'unknown' || m.stale).length;
    const low = ops.filter((m) => m.status !== 'offline' && m.status !== 'unknown' && !m.stale && (m.stock?.fillPct ?? 100) < THRESH().stockLowPct).length;
    const critical = ops.filter((m) => m.status === 'offline' || computeAlert(m) === 'red').length;
    const online = ops.length - offline - unknown - low;
    const revenueToday = Math.round(ops.reduce((s, m) => s + (m.revenue?.today || 0), 0) * 10) / 10;
    const availability = ops.length ? Math.round(((ops.length - offline - unknown) / ops.length) * 1000) / 10 : 100;
    return { total: ops.length, online: Math.max(0, online), offline, unknown, low, critical, revenueToday, availability };
  }

  function inspectorSections(n, people) {
    const person = (id) => (people && people[id] && people[id].name) || '—';
    const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${v} KWD`);
    const health = healthOf(n);
    if (!n) return [];
    if (n.type === 'machine') {
      const seen = (n.status === 'unknown' || n.stale)
        ? (n.lastSeen || 'no heartbeat')
        : (n.operators?.lastVisit || 'live');
      const alerts = n.alert ? 1 : 0;
      const offline = n.status === 'offline' ? 1 : 0;
      return [
        { title: 'Overview', rows: [['Status', health], ['Last heartbeat', String(seen)], ['Alerts', String(alerts)], ['Offline', String(offline)]] },
        { title: 'Performance', rows: [['Revenue today', money(n.revenue?.today ?? 0)]] },
        { title: 'Stock', rows: [['Fill', `${n.stock?.fillPct ?? '—'}%`], ['Top product', (n.stock?.topProducts || [])[0] || '—']] },
        { title: 'Support', rows: [['Operator', person(n.operatorId)], ['Technician', person(n.technicianId)]] },
        { title: 'Contract', rows: [['Vendor', n.contract?.vendor || '—'], ['Renewal', n.contract?.renewal || '—']] },
      ];
    }
    const r = n.rollup || {};
    return [
      { title: 'Overview', rows: [['Status', health], ['Machines', String(r.total || 0)], ['Online', String(r.online || 0)], ['Offline', String(r.offline || 0)], ['Unknown', String(r.unknown || 0)], ['Maintenance', String(r.maintenance || 0)], ['Planned', String(r.planned || 0)], ['Alerts', String(r.alerts || 0)]] },
      { title: 'Performance', rows: [['Revenue today', money(r.revenueToday || 0)]] },
      { title: 'Stock', rows: [['Low stock', String(r.low || 0)]] },
      { title: 'Support', rows: [['Open alerts', String(r.alerts || 0)], ['Offline machines', String(r.offline || 0)]] },
    ];
  }

  return {
    ACCENTS,
    HUB_ACCENT,
    ALERT,
    accentFor,
    computeAlert,
    walkMachines,
    rollup,
    kpiRows,
    healthOf,
    fleetOf,
    inspectorSections,
  };
})();
