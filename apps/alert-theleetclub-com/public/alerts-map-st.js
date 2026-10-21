/* r22 — skilltree engine port (https://skilltree.altari.ai/map.html)
 * Overrides vs upstream:
 *  1) plain wheel zooms toward cursor (never rotates the sky wheel)
 *  2) named function groups fade in on sky as you zoom (body.sky-lod-groups)
 * Data: LEET_SKILLTREE_TREE from alerts-map-tree.js (Leet categories).
 */
window.stTrack = window.stTrack || function () {};
window.stUnlock = window.stUnlock || function (e) { if (e) e.preventDefault(); return false; };
const PLAYBOOK = window.PLAYBOOK || {};
const FOUNDATION = window.FOUNDATION || new Set();
window.SKILL_META = window.SKILL_META || {};
const HUB = 'Leet';
const HUB_ENTRY = window.HUB_ENTRY || {
  desc: 'Leet ops hub · every alert category reads fleet state from here. Machines, stock, revenue, tickets, and cleaning windows share one centre.',
  components: ['fleet', 'alerts', 'ops board', 'sites', 'machines'],
  replaces: 'Scattered Slack threads and spreadsheet boards for the same machines.',
  ladder: {
    manual: 'Operators scan boards and call sites by hand.',
    assisted: 'Alerts surface with context; humans assign and close.',
    autonomous: 'Rules open and route work; humans handle exceptions.',
  },
  notes: 'Centre of the Leet alerts map. Dive a category to work its fan.',
  human: 'Ops lead owns the hub; technicians own the leaves.',
  files: [],
};
function isPaidNow() { return true; }

/* ============ ICONS ============ */
const ICONS = {
  'trend-up': '<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  play: '<path d="M8 5l12 7-12 7V5z"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  dollar: '<path d="M12 3v18"/><path d="M17 7c-1-1.5-2.5-2-5-2-3 0-4.5 1.5-4.5 3.5S9 12 12 12s4.5 1.5 4.5 3.5S15 19 12 19c-2.5 0-4-.5-5-2"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5"/>',
  funnel: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  pen: '<path d="M12 19l7-7-3-3-7 7-1 4 4-1z"/><path d="M15 6l3 3"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14l3 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3-7z"/>',
  phone: '<path d="M5 3h4l2 5-3 2a13 13 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  file: '<path d="M6 2h8l6 6v14H6V2z"/><path d="M14 2v6h6"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M2 20h20"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.2 8.5a5 5 0 0 1 0 7"/><path d="M7.8 15.5a5 5 0 0 1 0-7"/><path d="M19.1 5.6a9 9 0 0 1 0 12.8"/><path d="M4.9 18.4a9 9 0 0 1 0-12.8"/>',
  rocket: '<path d="M12 2c3 2 5 6 5 10l-5 5-5-5c0-4 2-8 5-10z"/><circle cx="12" cy="9" r="2"/><path d="M7 14l-3 5 5-1"/><path d="M17 14l3 5-5-1"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  chat: '<path d="M4 5h16v11h-9l-5 4v-4H4V5z"/>',
  book: '<path d="M4 4a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2V4z"/><path d="M6 2v16"/>',
  building: '<path d="M5 21V5a1 1 0 0 1 1-1h7v17"/><path d="M13 9h6v12"/><path d="M3 21h18"/><path d="M8 8h2M8 12h2M16 13h1M16 17h1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18-3-3-3-15 0-18z"/>',
  'doc-check': '<path d="M6 2h8l6 6v14H6V2z"/><path d="M14 2v6h6"/><path d="M9 14l2 2 4-4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
  tag: '<path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11z"/><circle cx="8" cy="8" r="1.6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16.5 14.6c3 .3 5 2.1 5 5"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5L21.5 7v10l-6-3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-4 4 3 4-4 5 5"/>',
  activity: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
  percent: '<path d="M5 19L19 5"/><circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="17" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 11h6M9 15h6"/>',
  route: '<circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M7.2 6H15a4 4 0 0 1 4 4v5.5"/>',
  scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6L20 19M8.2 16.4L20 5"/>',
  magnet: '<path d="M5 3v8a7 7 0 0 0 14 0V3"/><path d="M5 8h4M15 8h4"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.5 11.5L20 3M16 7l3 3"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l2.5-2.5a5 5 0 0 0-7-7L11 6"/><path d="M14 10a5 5 0 0 0-7 0L4.5 12.5a5 5 0 0 0 7 7L13 18"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 9v12"/>',
  zap: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7L3 5z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.sparkle}</svg>`;
const DOM_ICON = {
  'OFFLINE': 'activity', 'LOW STOCK': 'box', 'REVENUE': 'dollar', 'TASKS': 'clipboard',
  'SUPPORT': 'chat', 'CLEANING': 'sparkle', 'UNKNOWN': 'search',
  'Sales': 'trend-up', 'Deals': 'briefcase', 'Marketing': 'play', 'Operations': 'box',
  'Intelligence': 'search', 'Customer': 'user', 'Back Office': 'dollar'
};
const FN_ICON = {
  'Targeting': 'target', 'Lead Sourcing': 'funnel', 'Enrichment': 'layers', 'Outreach Writing': 'pen', 'Sequencing & Send': 'send',
  'Reply Handling': 'inbox', 'Inbound': 'zap', 'Call Cycle': 'phone', 'Deal Artifacts': 'file', 'Pipeline Ops': 'chart',
  'Insights': 'eye', 'Creation': 'sparkle', 'Repurposing': 'refresh', 'Distribution': 'broadcast', 'Brand Deals': 'briefcase',
  'Onboarding': 'rocket', 'Build Ops': 'gear', 'Client Comms': 'chat', 'Knowledge': 'book',
  'Companies': 'building', 'People': 'user', 'Markets': 'globe', 'Synthesis': 'doc-check',
  'Support': 'chat', 'Success': 'trend-up', 'Community': 'broadcast',
  'Money In': 'dollar', 'Reporting': 'chart', 'Records': 'database', 'Office': 'calendar', 'Talent': 'users',
};
const JOB_ICON = {
  'ICP Definition': 'target', 'Market Mapping': 'globe', 'Trigger Detection': 'bell',
  'Database Mining': 'database', 'Web & Maps Scraping': 'funnel', 'Social Mining': 'users', 'List Building': 'list',
  'Contact Enrichment': 'layers', 'Email Verification': 'check-circle', 'Account Enrichment': 'building', 'Fit Scoring': 'chart',
  'Personalization Research': 'search', 'Cold Email Drafting': 'pen', 'LinkedIn Messaging': 'chat', 'Proof Matching': 'doc-check',
  'Campaign Orchestration': 'route', 'Campaign Launch': 'rocket', 'Deliverability': 'shield', 'Send Optimization': 'clock',
  'Reply Classification': 'tag', 'Objection Response': 'chat', 'Hot-Lead Routing': 'route', 'Meeting Booking': 'calendar',
  'Speed-to-Lead': 'zap', 'Lead Qualification': 'filter', 'Comment-CTA Fulfillment': 'inbox', 'Inbox Triage': 'inbox',
  'Pre-Call Briefing': 'clipboard', 'Call Capture': 'mic', 'Post-Call Debrief': 'doc-check', 'Follow-Up Drafting': 'pen',
  'Demo Prototyping': 'box', 'Proposal Generation': 'file', 'Deal Room Assembly': 'briefcase', 'Agreement Drafting': 'file', 'Pricing Support': 'dollar',
  'CRM Hygiene': 'database', 'Pipeline Reporting': 'chart', 'Forecasting': 'trend-up', 'Reactivation': 'refresh', 'Win/Loss Analysis': 'percent',
  'Performance Mining': 'chart', 'Trend Monitoring': 'activity', 'Competitor Analysis': 'eye', 'Audience Analysis': 'users',
  'Hook Writing': 'zap', 'Script Writing': 'pen', 'Caption Writing': 'pen', 'Carousel Production': 'image',
  'Video Production': 'video', 'Image Generation': 'image', 'Deck Production': 'layout',
  'Cross-Platform Adaptation': 'route', 'Clip Extraction': 'scissors', 'Lead-Magnet Builds': 'magnet',
  'Publishing': 'send', 'Newsletter & Broadcast': 'mail', 'SEO & GEO': 'globe', 'OG & Share Surface': 'link',
  'Deal Scripting': 'pen', 'Approval Docs': 'check-circle',
  'Kickoff Pack': 'rocket', 'Access Collection': 'key', 'Project Scaffolding': 'box',
  'Document Extraction': 'file', 'Integration Builds': 'link', 'Portal Provisioning': 'layout', 'QA & Verification': 'check-circle',
  'Status Updates': 'bell', 'Meeting Follow-Ups': 'calendar', 'Portal Sync': 'refresh',
  'Transcript Processing': 'mic', 'Context Maintenance': 'book', 'SOP Generation': 'book', 'Handoff Docs': 'clipboard',
  'Company Deep-Dive': 'building', 'Tech-Stack Detection': 'layers', 'Person Research': 'user', 'Network Mapping': 'route',
  'Competitor Teardown': 'eye', 'Vertical Analysis': 'chart', 'Pricing Research': 'dollar',
  'Research Reports': 'file', 'Adversarial Verification': 'shield',
  'Ticket Triage': 'tag', 'FAQ & Self-Serve': 'chat', 'Escalations': 'bell',
  'Onboarding Journeys': 'rocket', 'Health Scoring': 'activity', 'Renewals & Expansion': 'trend-up', 'QBR Prep': 'clipboard',
  'Engagement & Replies': 'chat', 'Moderation': 'shield', 'Member Spotlights': 'sparkle',
  'Invoice Generation': 'file', 'Payment Tracking': 'dollar', 'Collections': 'bell',
  'Revenue Reporting': 'chart', 'Goal Pacing': 'target',
  'CRM Sync': 'database', 'Expense Categorization': 'tag', 'Entity Compliance': 'shield',
  'Calendar Management': 'calendar', 'Email Triage': 'inbox',
  'Candidate Sourcing': 'users', 'Screening & Scheduling': 'filter', 'Onboarding & Training': 'book',
};
const jobIcon = name => icon(JOB_ICON[name] || 'sparkle');

/* ============ SIGILS (set A + extensions) ============ */
const SIGILS = {
  'Sales': `
    <path d="M 100 168 L 100 62"/><path d="M 74 92 L 100 58 L 126 92"/><path d="M 80 116 L 100 92 L 120 116"/>
    <path d="M 48 172 A 58 58 0 0 1 152 172"/><path d="M 30 184 A 78 78 0 0 1 170 184"/>
    <circle class="sd" cx="100" cy="58" r="3.5"/><circle class="sd" cx="48" cy="172" r="2.5"/>
    <circle class="sd" cx="152" cy="172" r="2.5"/><circle class="sd" cx="100" cy="168" r="2.5"/>`,
  'Deals': `
    <circle cx="100" cy="92" r="42"/><path d="M 82 92 L 96 106 L 122 76"/>
    <circle cx="100" cy="92" r="56" stroke-dasharray="2 8"/>
    <path d="M 56 152 L 144 152"/><path d="M 64 164 L 120 164"/>
    <circle class="sd" cx="100" cy="36" r="3"/><circle class="sd" cx="144" cy="152" r="2.5"/><circle class="sd" cx="56" cy="152" r="2.5"/>`,
  'Marketing': `
    <path d="M 64 64 L 64 136 L 122 100 Z"/>
    <path d="M 134 76 A 34 34 0 0 1 134 124"/><path d="M 148 60 A 56 56 0 0 1 148 140"/><path d="M 162 44 A 80 80 0 0 1 162 156"/>
    <circle class="sd" cx="64" cy="64" r="3"/><circle class="sd" cx="64" cy="136" r="3"/>
    <circle class="sd" cx="122" cy="100" r="3.5"/><circle class="sd" cx="162" cy="44" r="2.5"/><circle class="sd" cx="162" cy="156" r="2.5"/>`,
  'Operations': `
    <path d="M 100 50 L 150 78 L 100 106 L 50 78 Z"/>
    <path d="M 50 78 L 50 132 L 100 160 L 100 106"/><path d="M 150 78 L 150 132 L 100 160"/>
    <ellipse cx="100" cy="104" rx="88" ry="26" transform="rotate(-10 100 104)"/>
    <circle class="sd" cx="100" cy="50" r="3.5"/><circle class="sd" cx="50" cy="78" r="3"/>
    <circle class="sd" cx="150" cy="78" r="3"/><circle class="sd" cx="100" cy="160" r="3"/>`,
  'Intelligence': `
    <path d="M 28 100 Q 100 38 172 100 Q 100 162 28 100 Z"/>
    <circle cx="100" cy="100" r="27"/><circle class="sd" cx="100" cy="100" r="6"/>
    <path d="M 100 46 L 100 30"/><path d="M 56 58 L 45 46"/><path d="M 144 58 L 155 46"/><path d="M 100 154 L 100 170"/>
    <circle class="sd" cx="100" cy="30" r="2.5"/><circle class="sd" cx="45" cy="46" r="2.5"/><circle class="sd" cx="155" cy="46" r="2.5"/>`,
  'Customer': `
    <circle cx="100" cy="84" r="16"/>
    <path d="M 68 138 c 0 -18 14 -30 32 -30 s 32 12 32 30"/>
    <circle cx="100" cy="100" r="62" stroke-dasharray="2 8"/>
    <circle class="sd" cx="100" cy="36" r="3"/><circle class="sd" cx="45" cy="132" r="3"/><circle class="sd" cx="155" cy="132" r="3"/>`,
  'Back Office': `
    <path d="M 100 44 L 100 152"/><path d="M 78 158 L 122 158"/><path d="M 52 68 L 148 68"/>
    <circle cx="100" cy="40" r="6"/>
    <path d="M 52 68 L 38 106 M 52 68 L 66 106"/><path d="M 32 106 A 20 20 0 0 0 72 106"/>
    <path d="M 148 68 L 134 106 M 148 68 L 162 106"/><path d="M 128 106 A 20 20 0 0 0 168 106"/>
    <circle class="sd" cx="52" cy="68" r="3"/><circle class="sd" cx="148" cy="68" r="3"/><circle class="sd" cx="100" cy="40" r="2.5"/>`,
};

/* Leet category sigils · reuse upstream department shapes */
SIGILS['OFFLINE'] = SIGILS['Operations'];
SIGILS['LOW STOCK'] = SIGILS['Back Office'];
SIGILS['REVENUE'] = SIGILS['Sales'];
SIGILS['TASKS'] = SIGILS['Deals'];
SIGILS['SUPPORT'] = SIGILS['Customer'];
SIGILS['CLEANING'] = SIGILS['Marketing'];
SIGILS['UNKNOWN'] = SIGILS['Intelligence'];

/* ============ DATA ============ */
const L = (name, desc, skills, tools, level) => ({ name, desc, skills, tools: tools || [], level: level || 'autonomous' });
const F = (name, jobs) => ({ name, jobs });

const TREE = (window.LEET_SKILLTREE_TREE && window.LEET_SKILLTREE_TREE.length)
  ? window.LEET_SKILLTREE_TREE
  : [{ name: 'OFFLINE', sub: 'machines · heartbeat', color: '#ff6b8a', intro: '', functions: [] }];
const N = TREE.length;
const LEVEL_LABEL = { autonomous: 'fully autonomous', assisted: 'human-assisted', manual: 'human-led' };

/* ============ YOUR TREE (self-assessment, saved locally) ============ */
const MY_KEY = 'skilltree-my';
let MY = {};
try { MY = JSON.parse(localStorage.getItem(MY_KEY) || '{}'); } catch (e) {}
const myKey = (dom, job) => `${dom.name}::${job.name}`;
const myOf = (dom, job) => MY[myKey(dom, job)] || '';
function setMy(dom, job, v) {
  if (v) MY[myKey(dom, job)] = v; else delete MY[myKey(dom, job)];
  try { localStorage.setItem(MY_KEY, JSON.stringify(MY)); } catch (e) {}
}
const myTotal = () => Object.values(MY).filter(v => v === 'live').length;

/* per-job notes · the member's operating manual (their prompts, tools, how they set it up) · saved to their tree */
const NOTES_KEY = 'skilltree-notes';
let NOTES = {}; try { NOTES = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch (e) {}
const noteOf = (dom, job) => NOTES[myKey(dom, job)] || '';
function setNote(dom, job, v) { v = (v || '').trim(); if (v) NOTES[myKey(dom, job)] = v; else delete NOTES[myKey(dom, job)]; try { localStorage.setItem(NOTES_KEY, JSON.stringify(NOTES)); } catch (e) {} }
const notesTotal = () => Object.keys(NOTES).length;

/* ============ STARFIELD ============ */
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
(() => {
  const sky = document.getElementById('stars');
  // mobile keeps a lighter, static starfield · fewer DOM nodes, no continuous twinkle
  // (the twinkle animation is switched off under the 700px media query — see below)
  const STAR_N = innerWidth < 700 ? 70 : 220;
  for (let i = 0; i < STAR_N; i++) {
    const s = document.createElement('div');
    const size = rand() < 0.85 ? 1.5 : 2.5;
    s.className = 'bgstar';
    s.style.cssText = `left:${rand() * 100}%; top:${rand() * 100}%;
      width:${size}px; height:${size}px; opacity:${0.08 + rand() * 0.25};
      animation-delay:${(rand() * 6).toFixed(1)}s; animation-duration:${(5 + rand() * 5).toFixed(1)}s;`;
    sky.appendChild(s);
  }
})();

/* ============ BUILD: SKY ============ */
const skyEl = document.getElementById('sky');
const fanWrap = document.getElementById('fanwrap');
const TEAM_W = 132, FN_Y = 560, ROOT_Y = 790, JOB_STEP = 56, TREE_PAD = 150;
const treeMeta = [];   // {cx, w, di}

/* the sky is a WHEEL · seven fans on a circle, branches radiating out, the company brain at the centre */
const W_STEP = 360 / N, R_ROOT = 310;   /* even spacing for any tree size (identical for the canonical N=7) */
let wheelA = 180, wheelT = 180;
let spokesEl = null;

function buildSky() {
  // LOWFX = phones/small screens · drop the continuous SVG animations and thin the dot
  // counts. Hundreds of forever-animating nodes were crashing mobile Safari on a spin.
  const LOWFX = innerWidth < 700;
  skyEl.innerHTML = '';
  treeMeta.length = 0;
  const SPAN = 140 * Math.PI / 180;
  const r0 = 80, rb = 146, rstep = 56;
  const P = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];

  // spokes + the connective tissue between the brain and the departments (rotates with the wheel)
  spokesEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spokesEl.id = 'spokes';
  // tight to content (rings r<=236, spokes to ~270, motes to ~288) · was 800x800, ~2x oversized
  spokesEl.setAttribute('viewBox', '-300 -300 600 600');
  spokesEl.setAttribute('width', 600); spokesEl.setAttribute('height', 600);
  spokesEl.style.cssText = 'left:-300px; top:-300px;';
  let sp = '';
  // instrument rings filling the annulus
  [168, 236].forEach((r, k) => {
    sp += `<circle r="${r}" style="stroke:rgb(var(--lnrgb)); stroke-opacity:.07" fill="none" stroke-width="1" stroke-dasharray="${k ? '1 6' : '2 9'}"/>`;
  });
  for (let i = 0; i < N; i++) {
    const a = i * W_STEP * Math.PI / 180;
    const [x0, y0] = P(115, a), [x1, y1] = P(R_ROOT - 40, a);
    sp += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" style="stroke:rgb(var(--lnrgb)); stroke-opacity:.14" stroke-width="1.5" stroke-dasharray="2 6" fill="none"/>`;
    // junctions where the spoke crosses the rings
    [168, 236].forEach(r => {
      sp += `<circle cx="${(r * Math.sin(a)).toFixed(1)}" cy="${(-r * Math.cos(a)).toFixed(1)}" r="1.8" style="fill:rgb(var(--lnrgb))" opacity=".3"/>`;
    });
    // energy flowing brain → department and back · SMIL is a memory sink on mobile Safari,
    // so the flowing particles are desktop-only (the static spokes/junctions still read fine)
    if (!LOWFX) {
      sp += `<circle r="2.4" style="fill:var(--copper)" opacity=".9"><animateMotion dur="${(2.6 + (i % 3) * 0.7).toFixed(1)}s" begin="${(i * 0.43).toFixed(2)}s" repeatCount="indefinite" path="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}"/></circle>`;
      sp += `<circle r="1.7" style="fill:rgb(var(--lnrgb))" opacity=".5"><animateMotion dur="${(3.5 + (i % 2) * 0.9).toFixed(1)}s" begin="${(i * 0.61 + 1.3).toFixed(2)}s" repeatCount="indefinite" path="M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x0.toFixed(1)} ${y0.toFixed(1)}"/></circle>`;
    }
  }
  // scattered data motes so the space never reads as void
  for (let k = 0; k < 30; k++) {
    const a = rand() * Math.PI * 2, r = 132 + rand() * 156;
    sp += `<circle cx="${(r * Math.sin(a)).toFixed(1)}" cy="${(-r * Math.cos(a)).toFixed(1)}" r="${(0.9 + rand() * 1.2).toFixed(1)}" style="fill:rgb(var(--lnrgb))" opacity="${(0.1 + rand() * 0.18).toFixed(2)}"/>`;
  }
  spokesEl.innerHTML = sp;
  skyEl.appendChild(spokesEl);

  // the company brain · an organic memory graph (force-graph energy, our palette)
  const hub = document.createElement('div');
  hub.id = 'hub';
  const DCOL = TREE.map(d => d.color);
  const pickC = () => rand() < 0.32 ? 'var(--ivory)' : DCOL[Math.floor(rand() * DCOL.length)];
  const dotEl = (x, y, r, fill, op, pulse) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${op.toFixed(2)}"${pulse ? ` class="bn" style="animation-delay:-${(rand() * 4).toFixed(1)}s"` : ''}/>`;
  const edgeEl = (x0, y0, x1, y1, op, dash) =>
    `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" style="stroke:rgb(var(--lnrgb));stroke-opacity:${op.toFixed(2)}" stroke-width=".85"${dash ? ' stroke-dasharray="1.5 3"' : ''} fill="none"/>`;

  // brain density scales to tree size · the core of a smaller company is lighter (identical at N=7)
  const HUBF = Math.min(1, N / 7);
  // sprinkle of free-floating memories, denser toward the centre
  let freeDots = '';
  for (let k = 0; k < Math.round((LOWFX ? 55 : 130) * HUBF); k++) {
    const a = rand() * Math.PI * 2, r = 112 * Math.sqrt(rand());
    freeDots += dotEl(r * Math.cos(a), r * Math.sin(a), 0.8 + rand() * 1.2, pickC(), 0.25 + rand() * 0.5, !LOWFX && rand() < 0.25);
  }
  // denser rim band · the silhouette IS the circle, no stroke needed
  for (let k = 0; k < Math.round((LOWFX ? 24 : 55) * HUBF); k++) {
    const a = rand() * Math.PI * 2, r = 96 + rand() * 17;
    freeDots += dotEl(r * Math.cos(a), r * Math.sin(a), 0.7 + rand() * 1, pickC(), 0.3 + rand() * 0.45, !LOWFX && rand() < 0.2);
  }

  // two dense burst hubs · everything radiates from the cores
  const burst = (cx, cy, n, spread) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = spread * (0.35 + rand() * 0.65);
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      s += edgeEl(cx, cy, x, y, 0.16 + rand() * 0.1);
      s += dotEl(x, y, 1.1 + rand() * 1.3, pickC(), 0.55 + rand() * 0.4, !LOWFX && rand() < 0.4);
      if (rand() < 0.32) {
        const a2 = a + (rand() - 0.5) * 0.9, r2 = 8 + rand() * 11;
        const x2 = x + r2 * Math.cos(a2), y2 = y + r2 * Math.sin(a2);
        s += edgeEl(x, y, x2, y2, 0.12) + dotEl(x2, y2, 0.9 + rand() * 0.8, pickC(), 0.35 + rand() * 0.35, false);
      }
    }
    return s;
  };
  let bursts = burst(-20, -15, Math.round((LOWFX ? 15 : 28) * HUBF), 52) + burst(17, 19, Math.round((LOWFX ? 18 : 35) * HUBF), 58);
  bursts += edgeEl(-20, -15, 17, 19, 0.16);
  bursts += `<circle class="nucleus" cx="-20" cy="-15" r="4.5" style="fill:var(--copper)"/>`;
  bursts += `<circle cx="17" cy="19" r="3.4" fill="var(--ivory)" opacity=".9"/>`;

  // satellite constellations · small clusters of related memories, gently adrift
  let clusters = '';
  const cCenters = [];
  const NCL = Math.max(4, Math.round(11 * HUBF));
  for (let k = 0; k < NCL; k++) {
    const a = (k / NCL) * Math.PI * 2 + rand() * 0.5, R = 54 + rand() * 42;
    const cx = R * Math.cos(a), cy = R * Math.sin(a);
    cCenters.push([cx, cy]);
    let g = dotEl(cx, cy, 1.7 + rand(), pickC(), 0.85, false);
    const m = 5 + Math.floor(rand() * 7), base = rand() * Math.PI * 2, span = Math.PI * (0.7 + rand() * 1.3);
    for (let i = 0; i < m; i++) {
      const aa = base + span * (i / m) + (rand() - 0.5) * 0.2, rr = 6.5 + rand() * 9;
      const x = cx + rr * Math.cos(aa), y = cy + rr * Math.sin(aa);
      g += edgeEl(cx, cy, x, y, 0.18) + dotEl(x, y, 0.9 + rand() * 1, pickC(), 0.45 + rand() * 0.4, !LOWFX && rand() < 0.3);
    }
    // no drift animation on mobile · the cluster is rendered static
    clusters += LOWFX
      ? `<g>${g}</g>`
      : `<g class="drift" style="animation-duration:${(9 + rand() * 8).toFixed(1)}s; animation-delay:-${(rand() * 9).toFixed(1)}s">${g}</g>`;
  }
  // faint long-range links between distant clusters · the graph is one brain
  let xlinks = '';
  for (let k = 0; k < 6; k++) {
    const [x0, y0] = cCenters[Math.floor(rand() * cCenters.length)];
    const [x1, y1] = cCenters[Math.floor(rand() * cCenters.length)];
    if (x0 !== x1) xlinks += edgeEl(x0, y0, x1, y1, 0.07 + rand() * 0.06, true);
  }

  // the slow rotation of the whole core is a compositor killer on mobile · static there
  hub.innerHTML = `
    <svg class="core" viewBox="-122 -122 244 244" width="310" height="310">
      <g class="${LOWFX ? '' : 'spinslow'}">${freeDots}${xlinks}${clusters}${bursts}</g>
    </svg>
    <img class="leet-mark" src="leet.png" alt="Leet" width="72" height="72" draggable="false"/>
    <div class="hname"><div class="hz">NODE ZERO</div>LEET</div>
    <div class="hubhit" title="Leet · ops hub"></div>`;
  skyEl.appendChild(hub);
  hub.querySelector('.hubhit').addEventListener('click', e => {
    e.stopPropagation();
    if (dragDist >= 8) return;
    selectHub();
  });

  TREE.forEach((dom, di) => {
    const totalJobs = dom.functions.reduce((s, f) => s + f.jobs.length, 0);

    const tree = document.createElement('div');
    tree.className = 'tree mini';
    tree.dataset.i = di;
    tree.style.cssText = `--d:${(di * 0.12).toFixed(2)}s; --c:${dom.color};`;
    const rot = document.createElement('div');
    rot.className = 'rot';
    rot.style.cssText = 'position:absolute; left:0; top:0;';
    tree.appendChild(rot);
    const sc = document.createElement('div');
    sc.className = 'scaler';
    sc.style.cssText = 'position:absolute; left:0; top:0;';
    rot.appendChild(sc);
    const hit = document.createElement('div');
    hit.className = 'hit';
    rot.appendChild(hit);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lines');
    // tight to the actual branch content (spans ~x±300, y[-314,+40]) · the old 1400x800 box
    // was ~4x oversized, and at 3x retina that made the per-tree GPU layer/raster huge (a
    // memory risk on mobile). 720x460 keeps 1 unit = 1px so the branch coords are unchanged.
    svg.setAttribute('viewBox', '-360 -370 720 460');
    svg.setAttribute('width', 720); svg.setAttribute('height', 460);
    svg.style.cssText = 'left:-360px; top:-370px;';
    let paths = '';
    const line = (x0, y0, x1, y1, op) =>
      `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" style="stroke:rgb(var(--lnrgb)); stroke-opacity:${op}" stroke-width="2" fill="none" stroke-linecap="round"/>`;

    const nf = dom.functions.length;
    const litOf = j => j.level === 'autonomous' ? .42 : j.level === 'assisted' ? .26 : .12;
    const place = (jx, jy, job, px, py2, op) => {
      paths += line(px, py2, jx, jy, op);
      const d = document.createElement('div');
      d.className = `jdot${job.level === 'assisted' ? ' dev' : job.level === 'manual' ? ' plan' : ''}`;
      d.style.cssText = `left:${jx.toFixed(1)}px; top:${jy.toFixed(1)}px;`;
      sc.appendChild(d);
    };
    // every function gets an equal wedge, and every branch ends at the same outer
    // radius (longer functions just space their nodes tighter) · keeps the organic
    // tree look but gives the wheel a clean, uniform silhouette.
    const Rmax = rb + 3 * rstep;
    let cursor = -SPAN / 2;
    dom.functions.forEach(fn => {
      const jobs = fn.jobs.length;
      const span = SPAN / nf;
      const aC = cursor + span / 2;
      const [ex, ey] = P(r0, aC);
      const [sx2, sy2] = P(36, aC);
      paths += line(sx2, sy2, ex, ey, .2);
      paths += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="${dom.color}"/>`;
      let px = ex, py2 = ey;
      fn.jobs.forEach((job, ji) => {
        const zig = (ji % 2 ? 1 : -1) * Math.min(span * 0.22, 0.075) * (ji ? 1 : 0.45);
        const r = rb + (jobs > 1 ? ji * (Rmax - rb) / (jobs - 1) : 0);
        const [jx, jy] = P(r, aC + zig);
        place(jx, jy, job, px, py2, litOf(job)); px = jx; py2 = jy;
      });
      cursor += span;
    });

    svg.innerHTML = paths;
    sc.insertBefore(svg, sc.firstChild);

    const rb2 = document.createElement('div');
    rb2.className = 'rootb';
    rb2.style.cssText = 'left:0; top:0;';
    rb2.innerHTML = icon(DOM_ICON[dom.name]);
    sc.appendChild(rb2);

    const wn = document.createElement('div');
    wn.className = 'wname';
    wn.innerHTML = `<div class="nm">${dom.name}</div><div class="sb">${dom.sub}</div>`;
    tree.appendChild(wn);

    /* LOD group names · appear when body.sky-lod-groups (zoom-in override) */
    const fl = document.createElement('div');
    fl.className = 'fn-labels';
    let flCursor = -SPAN / 2;
    const nfl = dom.functions.length || 1;
    dom.functions.forEach(fn => {
      const span = SPAN / nfl;
      const aC = flCursor + span / 2;
      const [lx, ly] = P(rb + rstep * 1.15, aC);
      const el = document.createElement('div');
      el.className = 'fl';
      el.style.cssText = `left:${lx.toFixed(1)}px; top:${ly.toFixed(1)}px;`;
      el.textContent = fn.name;
      fl.appendChild(el);
      flCursor += span;
    });
    sc.appendChild(fl);

    tree.addEventListener('click', e => { if (dragDist < 8 && state === 'sky') { e.stopPropagation(); dive(di); } });
    skyEl.appendChild(tree);
    treeMeta.push({ di, el: tree, rot, wn });
  });
  layoutWheel();
  return 1600;
}

function layoutWheel() {
  treeMeta.forEach((m, i) => {
    const deg = wheelA + i * W_STEP;
    const a = deg * Math.PI / 180;
    const x = R_ROOT * Math.sin(a), y = -R_ROOT * Math.cos(a);
    m.el.style.left = x.toFixed(1) + 'px';
    m.el.style.top = y.toFixed(1) + 'px';
    m.rot.style.transform = `rotate(${deg.toFixed(2)}deg)`;
    const D = 470;
    m.wn.style.left = (D * Math.sin(a)).toFixed(1) + 'px';
    m.wn.style.top = (-D * Math.cos(a)).toFixed(1) + 'px';
  });
  if (spokesEl) spokesEl.style.transform = `rotate(${wheelA.toFixed(2)}deg)`;
}
function focusedIdx() {
  return ((Math.round((180 - wheelA) / W_STEP)) % N + N) % N;
}
function setSkyFocus(i) {
  // default state darkens NOTHING · the bottom department just gets a gentle lift
  document.querySelectorAll('.mini').forEach((el, idx) => {
    el.classList.toggle('focused', idx === i);
  });
}

/* ============ BUILD: FAN ============ */
const FAN_SPAN = 182 * Math.PI / 180;
const R0 = 248, R_BASE = 410, R_STEP = 214;
let currentDept = 0, selectedEl = null, fanEl = null;
let fanBounds = { minX: -800, maxX: 800, minY: -900, maxY: 140 };

function buildFan(di, dir = 0, animate = true) {
  const old = fanEl;
  currentDept = di;
  const dom = TREE[di];
  const fan = document.createElement('div');
  fan.className = 'fan';
  fan.style.setProperty('--c', dom.color);
  selectedEl = null;
  hideCard();

  const totalJobs = dom.functions.reduce((s, f) => s + f.jobs.length, 0);
  const P = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];

  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.style.cssText = 'left:0px; top:-430px;';
  ghost.textContent = dom.name;
  fan.appendChild(ghost);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'under');
  let paths = '';
  const arcPath = (r, a0, a1) => {
    const [x0, y0] = P(r, a0), [x1, y1] = P(r, a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  [R0, R_BASE + R_STEP * 0.5, R_BASE + R_STEP * 2, R_BASE + R_STEP * 3.6].forEach((r, i) => {
    paths += `<path class="${animate ? 'draw' : ''}" style="--d:${(0.1 + i * 0.07).toFixed(2)}s; stroke:rgb(var(--lnrgb)); stroke-opacity:.06" pathLength="1" d="${arcPath(r, -FAN_SPAN / 2 - 0.06, FAN_SPAN / 2 + 0.06)}" stroke-width="1" fill="none"/>`;
  });

  let maxR = 0;
  let cursor = -FAN_SPAN / 2;
  const line = (x0, y0, x1, y1, op, d) =>
    `<path class="${animate ? 'draw' : ''}" style="--d:${d.toFixed(2)}s; stroke:rgb(var(--lnrgb)); stroke-opacity:${op}" pathLength="1" d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;

  dom.functions.forEach((fn, fi) => {
    const span = FAN_SPAN * fn.jobs.length / totalJobs;
    const aC = cursor + span / 2;
    const [ex, ey] = P(R0, aC);
    const [rx, ry] = P(64, aC);
    paths += line(rx, ry, ex, ey, .22, 0.15);
    paths += `<circle class="${animate ? 'popdot' : ''}" style="--d:.3s" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="${dom.color}"/>`;

    let px = ex, py2 = ey;
    fn.jobs.forEach((job, ji) => {
      const zig = (ji % 2 ? 1 : -1) * Math.min(span * 0.22, 0.075) * (ji ? 1 : 0.45);
      const a = aC + zig;
      const r = R_BASE + ji * R_STEP;
      maxR = Math.max(maxR, r);
      const [x, y] = P(r, a);
      const lit = job.level === 'autonomous' ? .5 : job.level === 'assisted' ? .3 : .14;
      const delay = 0.32 + ji * 0.12;
      paths += line(px, py2, x, y, lit, delay);
      px = x; py2 = y;

      const n = document.createElement('div');
      const my = myOf(dom, job);
      n.className = `node ${job.level === 'autonomous' ? 'deployed' : job.level === 'assisted' ? 'dev' : 'plan'}`
        + (my === 'live' ? ' mine' : my === 'dev' ? ' minedev' : '');
      n.style.cssText = `left:${x.toFixed(1)}px; top:${y.toFixed(1)}px; --d:${(delay + 0.18).toFixed(2)}s;`;
      if (!animate) n.style.animation = 'none', n.style.opacity = 1;
      /* alveoli: this job's downloadable skill files as terminal leaves · one dot per real file */
      let lsvg = '', lhtml = '';
      const pbFiles = (typeof PLAYBOOK !== 'undefined' && PLAYBOOK[job.name] && PLAYBOOK[job.name].files) || [];
      /* leaves sit perpendicular to the branch — clear of the chain lines in both directions */
      const side = job.name.length % 2 ? 1 : -1;
      const spreads = pbFiles.length === 1 ? [1.42 * side] : pbFiles.length === 2 ? [-1.42, 1.42] : [-1.5, 1.5, Math.PI];
      pbFiles.slice(0, 3).forEach((f, k) => {
        const th = a + spreads[k] + (rand() - 0.5) * 0.22;
        const dd = 74 + rand() * 12;
        const lx = dd * Math.sin(th), ly2 = -dd * Math.cos(th);
        lsvg += `<path d="M ${(32 * Math.sin(th)).toFixed(1)} ${(-32 * Math.cos(th)).toFixed(1)} L ${lx.toFixed(1)} ${ly2.toFixed(1)}" style="stroke:rgb(var(--lnrgb));stroke-opacity:.4" stroke-width="2" stroke-linecap="round" fill="none"/>`;
        lhtml += `<div class="leaf" data-file="${f.path}" data-sk="${f.label}" style="left:${lx.toFixed(1)}px; top:${ly2.toFixed(1)}px; --lc:${dom.color};"></div>`;
      });
      n.innerHTML = `${jobIcon(job.name)}<span class="nlabel">${job.name}</span>`
        + (typeof FOUNDATION !== 'undefined' && FOUNDATION.has(job.name) ? `<span class="ftag">START HERE</span>` : '')
        + `<span class="mybadge"><svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>`
        + `<div class="leaves"><svg width="200" height="200" viewBox="-100 -100 200 200">${lsvg}</svg>${lhtml}</div>`;
      n._chain = fi;
      n._job = job.name;
      n._sel = () => select(n, dom, fn, job, x, y);
      const lvlLabel = job.level === 'autonomous' ? 'fully autonomous' : job.level === 'assisted' ? 'human-assisted' : 'human-led';
      n.setAttribute('tabindex', '0');
      n.setAttribute('role', 'button');
      n.setAttribute('aria-label', `${job.name} · ${lvlLabel}${my === 'live' ? ' · live in your stack' : ''}`);
      n.addEventListener('click', e => {
        e.stopPropagation();
        if (dragDist >= 8) return;
        n._sel();
      });
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); n._sel(); }
      });
      n.querySelectorAll('.leaf').forEach(lf => lf.addEventListener('click', e => {
        e.stopPropagation();
        if (dragDist >= 8) return;
        openReader(lf.dataset.file, lf.dataset.sk);
      }));
      fan.appendChild(n);
    });

    const [tx2, ty2] = P(R_BASE + fn.jobs.length * R_STEP + 64, aC);
    const tl = document.createElement('div');
    tl.className = 'team-label';
    tl.style.cssText = `left:${tx2.toFixed(1)}px; top:${ty2.toFixed(1)}px; --d:${(0.55 + fi * 0.07).toFixed(2)}s;`;
    tl.innerHTML = `<div class="t">${fn.name}</div><div class="tc">${fn.jobs.length} jobs</div>`;
    tl.setAttribute('tabindex', '0');
    tl.setAttribute('role', 'button');
    tl.setAttribute('aria-label', `${fn.name} · ${fn.jobs.length} jobs · focus this sub-tree`);
    const tlFocus = () => focusPoint(tx2, ty2 + 120, 0.9);
    tl.addEventListener('click', e => { e.stopPropagation(); if (dragDist < 8) tlFocus(); });
    tl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tlFocus(); } });
    fan.appendChild(tl);

    cursor += span;
  });

  svg.innerHTML = paths;
  svg.setAttribute('width', 2400); svg.setAttribute('height', 1600);
  svg.setAttribute('viewBox', '-1200 -1400 2400 1600');
  svg.style.left = '-1200px'; svg.style.top = '-1400px';
  fan.insertBefore(svg, fan.firstChild);

  const root = document.createElement('div');
  root.className = 'root-badge';
  root.style.cssText = 'left:0px; top:0px; cursor:pointer;';
  root.innerHTML = icon(DOM_ICON[dom.name]);
  const rootDi = di;
  root.setAttribute('tabindex', '0');
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', `${dom.name} · department root`);
  root.addEventListener('click', e => { e.stopPropagation(); if (dragDist < 8) selectDept(rootDi); });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectDept(rootDi); } });
  fan.appendChild(root);

  const rname = document.createElement('div');
  rname.className = 'fan-dname';
  rname.style.cursor = 'pointer';
  rname.innerHTML = `${dom.name}<div class="fan-dsub">${dom.sub}</div>`;
  rname.addEventListener('click', e => { e.stopPropagation(); if (dragDist < 8) selectDept(rootDi); });
  fan.appendChild(rname);

  fanWrap.appendChild(fan);
  fanEl = fan;
  if (old && dir !== 0) {
    fan.classList.add(dir >= 0 ? 'enter-r' : 'enter-l');
    requestAnimationFrame(() => requestAnimationFrame(() => fan.classList.remove('enter-r', 'enter-l')));
    old.classList.add(dir >= 0 ? 'exit-l' : 'exit-r');
    setTimeout(() => old.remove(), 480);
  } else if (old) { old.remove(); }

  updateProgress();
  document.querySelectorAll('#domnav button').forEach((b, i) => b.classList.toggle('active', i === currentDept));
  const prev = TREE[(di - 1 + N) % N], next = TREE[(di + 1) % N];
  const chevL = '<svg class="echev" viewBox="0 0 14 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M 11 3 L 4 11 L 11 19"/><circle cx="4" cy="11" r="1.8" fill="currentColor" stroke="none"/></svg>';
  const chevR = '<svg class="echev" viewBox="0 0 14 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M 3 3 L 10 11 L 3 19"/><circle cx="10" cy="11" r="1.8" fill="currentColor" stroke="none"/></svg>';
  document.getElementById('edge-l').innerHTML = `${chevL}<span class="et">${prev.name}</span>`;
  document.getElementById('edge-r').innerHTML = `<span class="et">${next.name}</span>${chevR}`;

  fanBounds = { minX: -(maxR + 280), maxX: maxR + 280, minY: -(maxR + 260), maxY: 180 };
}

/* ============ CAMERA ============ */
const world = document.getElementById('world');
let tx = 0, ty = 0, scale = 0.8;
let txT = 0, tyT = 0, scaleT = 0.8;
let dragging = false, dragDist = 0, lastX = 0, lastY = 0;
let state = 'sky';            // sky | diving | fan | rising
let skyW = 1000;
let zoomIntent = 0, zoomLock = 0;

const clampZFan = v => Math.max(isMobile() ? Math.min(0.42, fanFit()) : 0.42, Math.min(1.9, v));
const clampZSky = v => Math.max(0.12, Math.min(isMobile() ? 0.56 : 0.42, v));

const isMobile = () => innerWidth < 700;
function skyFit() {
  const mx = isMobile() ? 30 : 150, my = isMobile() ? 130 : 170;
  return Math.min((innerWidth - mx) / 1640, (innerHeight - my) / 1640);
}
function fanFit() {
  const mx = isMobile() ? 56 : 160, my = isMobile() ? 150 : 230;
  return Math.min((innerWidth - mx) / (fanBounds.maxX - fanBounds.minX), (innerHeight - my) / (fanBounds.maxY - fanBounds.minY));
}
function fitCurrent(instant) {
  if (state === 'fan') {
    if (isMobile()) {
      // mobile home: fit the tree to the narrow screen · root near the bottom (clear of the
      // zoom controls), the first rings reading cleanly, deeper rings a pan/zoom away.
      // 0.58 was too tight — first-ring labels clipped off both sides and the deep nodes
      // collided with the top bar.
      scaleT = 0.42;
      txT = 0;
      tyT = innerHeight * 0.31;
    } else {
      scaleT = fanFit();
      txT = 0;
      tyT = -((fanBounds.minY + fanBounds.maxY) / 2 + 0.06 * innerHeight / scaleT) * scaleT;
    }
  } else {
    if (isMobile()) {
      // mobile wheel: frame the WHOLE 7-department wheel centered so every label reads.
      // label ring sits at R≈470; reserve room for the text, then fit the diameter to the
      // narrower axis with margins, centered on the root.
      const ringSpan = (470 + 130) * 2;   // label-outer diameter incl. text
      const fit = Math.min((innerWidth - 24) / ringSpan, (innerHeight - 150) / ringSpan);
      scaleT = Math.max(0.34, Math.min(0.62, fit));
      txT = 0;
      tyT = innerHeight * 0.04;            // center on the wheel root (root is at world 0,0)
    } else {
      scaleT = skyFit();
      txT = 0;
      tyT = -innerHeight * 0.04;
    }
    setSkyFocus(focusedIdx());
  }
  if (instant) { scale = scaleT; tx = txT; ty = tyT; }
  if (selectedEl) { selectedEl.classList.remove('selected'); selectedEl = null; }
  document.querySelectorAll('.node.faded').forEach(n => n.classList.remove('faded'));
  hideCard();
}
function focusPoint(wx, wy, z) {
  scaleT = z;
  txT = -wx * z;
  tyT = -(wy - 30 / z) * z;
}
let selCtx = null;   // {dom, fn, job} of the open card
let lastSelectArgs = null;   // for re-render once paid status resolves

function isPaidNow() { return !!(window.STSkills && window.STSkills.paid === true); }

/* High-up, obvious cue that this job ships a runnable, downloadable skill. */
function skillCueHtml(files) {
  if (!files || !files.length) return '';
  const n = files.length, s = n > 1 ? 's' : '';
  if (isPaidNow()) {
    return `<div class="skillcue paid"><span class="sc-ic">⤓</span><span class="sc-tx"><b>${n} runnable skill file${s}</b> · yours to download</span><span class="sc-go">Take it ↓</span></div>`;
  }
  return `<div class="skillcue locked" data-cue-first="${files[0].path}" data-cue-label="${files[0].label}"><span class="sc-ic">⤓</span><span class="sc-tx"><b>${n} runnable skill file${s}</b> ships with this job</span><span class="sc-lock"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Preview</span></div>`;
}

/* The "take the skill" section — locked rows + unlock CTA for non-paid. */
function skillFilesHtml(files) {
  if (!files || !files.length) return '';
  const paid = isPaidNow();
  const rows = files.map(f => {
    const sm = (window.SKILL_META && window.SKILL_META[f.path]) || null;
    const what = sm ? `<span class="dld">${sm.what}</span>` : '';
    if (paid) {
      return `<a class="dl" href="#" data-skill="${f.path}" data-label="${f.label}"><span class="dla">⤢</span>${f.label}<span class="dlt">READ · SKILL.MD</span>${what}</a>`;
    }
    return `<a class="dl locked" data-skill="${f.path}" data-label="${f.label}"><span class="dla"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>${f.label}<span class="dlt">LOCKED · TAP TO PREVIEW</span>${what}</a>`;
  }).join('');
  const head = paid ? 'TAKE THE SKILL' : 'THE SKILLS · LOCKED';
  const cta = paid ? '' : `<div class="skcta"><a class="skbuy" href="/login" onclick="return stUnlock(event)">Join the Waitlist</a><a class="skbook" href="https://cal.com/altari/30min" target="_blank" rel="noopener" onclick="window.stTrack&&stTrack('map_bookcall_click',{spot:'card'})">Book a call</a></div>`;
  return `<div class="c-sec">${head}</div><div class="files${paid ? '' : ' locked'}">${rows}${cta}</div>`;
}

/* When paid status resolves after a card is already open, re-render it. */
window.__stPaidResolved = function () {
  const paid = window.STSkills && window.STSkills.paid === true;
  if (!paid) return;
  const c = document.getElementById('card');
  if (c.classList.contains('open') && lastSelectArgs) {
    select.apply(null, lastSelectArgs);
  }
  // the deep-link / reader opens before the token arrives — re-fetch it now that
  // we're a confirmed member so the full file shows instead of the locked preview
  const reader = document.getElementById('reader');
  if (reader.classList.contains('open') && lastReaderArgs) {
    openReader.apply(null, lastReaderArgs);
  }
};

function select(el, dom, fn, job, wx, wy) {
  if (selectedEl) selectedEl.classList.remove('selected');
  selectedEl = el; el.classList.add('selected');
  selCtx = { dom, fn, job };
  lastSelectArgs = [el, dom, fn, job, wx, wy];
  fanEl.querySelectorAll('.node').forEach(n => n.classList.toggle('faded', n._chain !== el._chain && n !== el));
  if (isMobile()) {
    // bottom sheet covers 44%→bottom · centre the node in the visible strip above it
    const z = 1.1;
    scaleT = z;
    txT = -wx * z;
    tyT = -wy * z - innerHeight * 0.34;
  } else {
    focusPoint(wx, wy, 1.35);
  }
  const card = document.getElementById('card');
  card.style.setProperty('--c', dom.color);
  card.querySelector('.c-state').textContent = LEVEL_LABEL[job.level] || job.level;
  card.querySelector('.c-name').innerHTML = job.name
    + (typeof FOUNDATION !== 'undefined' && FOUNDATION.has(job.name) ? '<span class="c-found">START HERE</span>' : '');
  card.querySelector('.c-crumb').textContent = `${dom.name} · ${fn.name}`;
  card.querySelector('.c-desc').textContent = job.desc;
  card.querySelector('.c-skills').innerHTML =
    `<div class="c-sec">BREAKS INTO</div><div class="skills">${job.skills.map(s => `<span class="skill" title="a sub-skill of this job · the runnable role file is under TAKE THE SKILL">${s}</span>`).join('')}</div>` +
    (job.tools.length ? `<div class="c-sec">WIRED INTO</div><div class="tools">${job.tools.join(' · ')}</div>` : '');
  if (nudgeStep === 2) nudge(3);

  /* playbook layer */
  const pb = (typeof PLAYBOOK !== 'undefined' && PLAYBOOK[job.name]) || null;
  card.querySelector('.c-skillcue').innerHTML = skillCueHtml(pb && pb.files);
  // warm the cache for this job's skill on card open so the first read is instant (members)
  if (window.STSkills && window.STSkills.paid === true && pb && pb.files && pb.files.length) {
    const _sg = pb.files[0].path.replace(/^skills\//, '').replace(/\.md$/, '');
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => { try { window.STSkills.getSkill(_sg); } catch (e) {} });
  }
  /* the member's workspace first · their status + operating-manual notes, prominent (this is what they come back for) */
  const my = myOf(dom, job);
  let deep = `<div class="c-sec">YOUR STATUS</div><div class="my">`
    + [['', 'Not started'], ['dev', 'In development'], ['live', 'Live']].map(([v, lbl]) =>
      `<button data-my="${v}" class="${my === v ? 'on' : ''}">${lbl}</button>`).join('')
    + `</div><div class="c-sec">YOUR NOTES</div><textarea class="c-note-in" placeholder="Your prompt, your tools, how you set this up — saved to your tree."></textarea>`;
  if (pb && pb.req && pb.req.length) {
    deep += `<div class="c-sec">BUILDS ON</div><div class="reqs">` + pb.req.map(r =>
      r === HUB
        ? `<span class="req hubchip">⌂ ${r}</span>`
        : `<span class="req" data-job="${r}">${r}</span>`
    ).join('') + `</div>`;
  }
  if (pb && pb.replaces) deep += `<div class="c-sec">WHAT IT REPLACES</div><div class="c-replaces">${pb.replaces}</div>`;
  if (pb && pb.ladder) {
    deep += `<div class="c-sec">THE LADDER</div><div class="ladder">` +
      ['manual', 'assisted', 'autonomous'].map(k =>
        `<div class="lrow${job.level === k ? ' cur' : ''}"><span class="lk">${LEVEL_LABEL[k]}</span><span class="lv">${pb.ladder[k]}</span></div>`
      ).join('') + `</div>`;
  }
  const humanLine = (pb && pb.human) || (typeof HUMAN_DEFAULT !== 'undefined' && HUMAN_DEFAULT[job.level]);
  if (humanLine) deep += `<div class="c-sec">THE HUMAN</div><div class="c-notes">${humanLine}</div>`;
  if (pb && pb.notes) deep += `<div class="c-sec">BUILD NOTES</div><div class="c-notes">${pb.notes}</div>`;
  if (pb && pb.files && pb.files.length) {
    deep += skillFilesHtml(pb.files);
  }
  card.querySelector('.c-deep').innerHTML = deep;
  const _nt = card.querySelector('.c-note-in'); if (_nt) _nt.value = noteOf(dom, job); // set via value, never innerHTML (no injection)
  card.scrollTop = 0;
  card.classList.add('open');
  stTrack('skill_viewed', { job: job.name, dept: dom.name });
}
function hideCard() {
  document.getElementById('card').classList.remove('open');
  const f = document.querySelector('#card .files'); if (f) f.classList.remove('glow');
  const hd = document.getElementById('helpdlg'); if (hd) hd.classList.remove('open');
  selCtx = null;
  skyEl.classList.remove('hubfocus');
}
/* "Need help building this?" → Altari done-for-you dialog */
(function () {
  const dlg = document.getElementById('helpdlg'), btn = document.getElementById('needhelp');
  if (!dlg || !btn) return;
  const close = () => dlg.classList.remove('open');
  btn.addEventListener('click', (e) => { e.stopPropagation(); dlg.classList.add('open'); });
  dlg.querySelector('.hd-x').addEventListener('click', close);
  // the dialog floats above the map · keep its own clicks from reaching the map's
  // pan / deselect handlers underneath (which would otherwise dismiss it)
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel'].forEach(ev => dlg.addEventListener(ev, e => e.stopPropagation()));
  dlg.addEventListener('click', e => { e.stopPropagation(); if (e.target === dlg) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.classList.contains('open')) close(); });
})();

/* prefetch the dashboards surface in the background so the MAP↔DASH switch is instant */
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => {
  try { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = 'dash/index.html'; document.head.appendChild(l); } catch (e) {}
});

/* node zero · the hub's own card, openable from the wheel or any ⌂ chip */
const HUB_DOM = { name: 'HUB' }, HUB_JOB = { name: 'Company Knowledge Base' };
function selectHub() {
  if (selectedEl) { selectedEl.classList.remove('selected'); selectedEl = null; }
  if (fanEl) fanEl.querySelectorAll('.node.faded').forEach(n => n.classList.remove('faded'));
  selCtx = { dom: HUB_DOM, job: HUB_JOB };
  const card = document.getElementById('card');
  card.style.setProperty('--c', '#C58B5F');
  card.querySelector('.c-state').textContent = 'node zero';
  card.querySelector('.c-name').innerHTML = `Company Knowledge Base<span class="c-found">BEFORE EVERYTHING</span>`;
  card.querySelector('.c-crumb').textContent = 'The hub · every category reads fleet state';
  card.querySelector('.c-desc').textContent = HUB_ENTRY.desc;
  card.querySelector('.c-skillcue').innerHTML = skillCueHtml(HUB_ENTRY.files);
  card.querySelector('.c-skills').innerHTML =
    `<div class="c-sec">WHAT LIVES IN IT</div><div class="skills">${HUB_ENTRY.components.map(s => `<span class="skill">${s}</span>`).join('')}</div>`;
  let deep = '';
  deep += `<div class="c-sec">WHAT IT REPLACES</div><div class="c-replaces">${HUB_ENTRY.replaces}</div>`;
  deep += `<div class="c-sec">THE LADDER</div><div class="ladder">` +
    ['manual', 'assisted', 'autonomous'].map(k =>
      `<div class="lrow"><span class="lk">${LEVEL_LABEL[k]}</span><span class="lv">${HUB_ENTRY.ladder[k]}</span></div>`
    ).join('') + `</div>`;
  deep += `<div class="c-sec">THE HUMAN</div><div class="c-notes">${HUB_ENTRY.human}</div>`;
  deep += `<div class="c-sec">BUILD NOTES</div><div class="c-notes">${HUB_ENTRY.notes}</div>`;
  deep += skillFilesHtml(HUB_ENTRY.files);
  const my = myOf(HUB_DOM, HUB_JOB);
  deep += `<div class="c-sec">YOUR STATUS</div><div class="my">`
    + [['', 'Not started'], ['dev', 'In development'], ['live', 'Live']].map(([v, lbl]) =>
      `<button data-my="${v}" class="${my === v ? 'on' : ''}">${lbl}</button>`).join('')
    + `</div>`;
  card.querySelector('.c-deep').innerHTML = deep;
  card.scrollTop = 0;
  card.classList.add('open');
  if (state === 'sky') skyEl.classList.add('hubfocus');
}

function updateProgress() {
  const dom = TREE[currentDept];
  if (!dom) return;
  const totalJobs = dom.functions.reduce((s, f) => s + f.jobs.length, 0) || 1;
  const live = dom.functions.reduce((s, f) => s + f.jobs.filter(j => myOf(dom, j) === 'live').length, 0);
  const dev = dom.functions.reduce((s, f) => s + f.jobs.filter(j => myOf(dom, j) === 'dev').length, 0);
  const pNum = document.querySelector('#progress .p-num');
  const pLbl = document.querySelector('#progress .p-lbl');
  if (pNum) pNum.textContent = live;
  if (pLbl) pLbl.innerHTML = `OF ${totalJobs} LIVE${dev ? ` · ${dev} IN DEV` : ''}`;
  const liveBar = document.querySelector('#progress .bar i.live');
  const devBar = document.querySelector('#progress .bar i.dev');
  if (liveBar && devBar) {
    liveBar.style.background = dom.color;
    const liveW = live / totalJobs * 100, devW = dev / totalJobs * 100;
    setTimeout(() => {
      liveBar.style.width = liveW.toFixed(1) + '%';
      devBar.style.left = liveW.toFixed(1) + '%';
      devBar.style.width = devW.toFixed(1) + '%';
    }, 60);
  }
  try { updateCounts(); } catch (e) {}
}

function jumpToJob(name) {
  let di = -1;
  TREE.forEach((d, i) => d.functions.forEach(f => f.jobs.forEach(j => { if (j.name === name) di = i; })));
  if (di < 0) return;
  if (di !== currentDept) { buildFan(di, 0, false); }
  const n = [...fanEl.querySelectorAll('.node')].find(x => x._job === name);
  if (n) n._sel();
}

/* skill card · drag the right edge to widen it; width is remembered */
(function () {
  const cardEl = document.getElementById('card');
  const handle = document.getElementById('cresize');
  if (!cardEl || !handle) return;
  function place() {
    if (!cardEl.classList.contains('open')) { handle.style.display = 'none'; return; }
    const r = cardEl.getBoundingClientRect();
    handle.style.display = 'block';
    handle.style.left = r.right + 'px';
    handle.style.top = r.top + 'px';
    handle.style.height = r.height + 'px';
  }
  let rz = false, sx = 0, sw = 0;
  handle.addEventListener('pointerdown', e => {
    rz = true; sx = e.clientX; sw = cardEl.getBoundingClientRect().width;
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (x) {}
    document.body.style.userSelect = 'none'; e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!rz) return;
    const left = cardEl.getBoundingClientRect().left;
    const max = Math.min(860, window.innerWidth - left - 16);
    const w = Math.max(320, Math.min(max, sw + (e.clientX - sx)));
    cardEl.style.width = w + 'px';
    place();
  });
  window.addEventListener('pointerup', () => {
    if (!rz) return; rz = false; handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    try { localStorage.setItem('st_cardw', cardEl.style.width); } catch (x) {}
  });
  window.addEventListener('resize', place);
  // restore saved width + (re)position the handle whenever the card opens or closes
  new MutationObserver(() => {
    if (cardEl.classList.contains('open')) {
      try { const w = localStorage.getItem('st_cardw'); if (w) cardEl.style.width = w; } catch (x) {}
      requestAnimationFrame(place);
    } else { handle.style.display = 'none'; }
  }).observe(cardEl, { attributes: true, attributeFilter: ['class'] });
})();

/* card interactions: prerequisite jumps + status marking + skill reading */
document.getElementById('card').addEventListener('click', e => {
  if (e.target.closest('.c-x')) {
    hideCard();
    if (selectedEl) { selectedEl.classList.remove('selected'); selectedEl = null; }
    if (fanEl) fanEl.querySelectorAll('.node.faded').forEach(n => n.classList.remove('faded'));
    return;
  }
  const cue = e.target.closest('.skillcue');
  if (cue) {
    if (cue.dataset.cueFirst) { openReader(cue.dataset.cueFirst, cue.dataset.cueLabel); return; }
    const files = document.querySelector('#card .files');
    if (files) {
      files.scrollIntoView({ behavior: 'smooth', block: 'center' });
      files.classList.remove('glow'); void files.offsetWidth; files.classList.add('glow');
    }
    return;
  }
  const d = e.target.closest('.dl[data-skill]');
  if (d) { e.preventDefault(); openReader(d.dataset.skill, d.dataset.label); return; }
  const sb = e.target.closest('.skbuy');
  if (sb) { e.preventDefault(); window.stUnlock(e); return; }
  const h = e.target.closest('.req.hubchip');
  if (h) { selectHub(); return; }
  const r = e.target.closest('.req[data-job]');
  if (r) { jumpToJob(r.dataset.job); return; }
  const b = e.target.closest('.my button');
  if (b && selCtx) {
    setMy(selCtx.dom, selCtx.job, b.dataset.my);
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (selectedEl) {
      selectedEl.classList.toggle('mine', b.dataset.my === 'live');
      selectedEl.classList.toggle('minedev', b.dataset.my === 'dev');
    }
    updateProgress();
  }
});
/* notes save as they type · their operating manual accumulates on their own tree */
document.getElementById('card').addEventListener('input', e => {
  const t = e.target.closest('.c-note-in');
  if (t && selCtx) setNote(selCtx.dom, selCtx.job, t.value);
});

/* ============ DIVE / RISE · the constellation unfolds into the maze ============ */
function dive(di) {
  if (nudgeStep === 0 || nudgeStep === 1) { document.getElementById('nudge').classList.remove('show'); setTimeout(() => nudge(2), 2300); }
  if (state !== 'sky') return;
  state = 'aligning';
  document.body.classList.add('transitioning');
  hideCard();
  // the wheel takes the shortest path to seat the chosen department at the bottom
  let t = 180 - di * W_STEP;
  while (t - wheelT > 180) t -= 360;
  while (t - wheelT < -180) t += 360;
  wheelT = t;
  const wait = Math.min(800, 180 + Math.abs(t - wheelA) * 5);
  setTimeout(() => {
  state = 'diving';
  focusPoint(0, R_ROOT + 150, Math.min(0.95, skyFit() * 2));
  document.querySelectorAll('.tree').forEach(t2 => { if (+t2.dataset.i !== di) t2.classList.add('dim'); });
  setTimeout(() => {
    skyEl.style.display = 'none';
    document.body.classList.add('fanmode');
    (function(){const el=document.getElementById('state-name'); if(el) el.textContent='NAVIGATION';})();
    buildFan(di, 0, true);
    state = 'fan';
    scale = 0.5; tx = 0; ty = 120;       // rise out of the root
    fitCurrent();
    (function(){
      const fb = document.getElementById('focus-bar');
      const ft = document.getElementById('focus-title');
      const fs = document.getElementById('focus-sub');
      if (fb && ft && fs && TREE[di]) {
        ft.textContent = TREE[di].name;
        fs.textContent = TREE[di].sub || '';
        fb.hidden = false;
      }
    })();
    setTimeout(() => document.body.classList.remove('transitioning'), 1250);   // wait out the branching animation
  }, 520);
  }, wait);
}
/* department overview · clicking the root node zooms in + opens the side card, same as any node */
function selectDept(di) {
  const dom = TREE[di];
  if (selectedEl) { selectedEl.classList.remove('selected'); selectedEl = null; }
  if (fanEl) fanEl.querySelectorAll('.node.faded').forEach(n => n.classList.remove('faded'));
  selCtx = { dom, job: { name: dom.name } };
  const jobs = dom.functions.reduce((s, f) => s + f.jobs.length, 0);
  const files = new Set();
  dom.functions.forEach(f => f.jobs.forEach(j => (PLAYBOOK[j.name]?.files || []).forEach(x => files.add(x.path))));
  const startHere = [];
  dom.functions.forEach(f => f.jobs.forEach(j => { if (typeof FOUNDATION !== 'undefined' && FOUNDATION.has(j.name)) startHere.push(j.name); }));

  /* same camera treatment as a node · zoom toward the root */
  if (isMobile()) { scaleT = 1.0; txT = 0; tyT = -innerHeight * 0.30; }
  else focusPoint(0, -120, 0.92);

  const card = document.getElementById('card');
  card.style.setProperty('--c', dom.color);
  card.querySelector('.c-state').textContent = 'department';
  card.querySelector('.c-name').innerHTML = dom.name;
  card.querySelector('.c-crumb').textContent = dom.sub;
  card.querySelector('.c-desc').textContent = dom.intro || '';
  card.querySelector('.c-skillcue').innerHTML = '';
  card.querySelector('.c-skills').innerHTML =
    `<div class="c-sec">WHAT IT COVERS</div><div class="skills">${dom.functions.map(f => `<span class="skill">${f.name}</span>`).join('')}</div>`;
  let deep = '';
  deep += `<div class="c-sec">THE FUNCTIONS</div><div class="ladder">` +
    dom.functions.map(f => `<div class="lrow"><span class="lk">${f.name}</span><span class="lv">${f.jobs.length} job${f.jobs.length === 1 ? '' : 's'}</span></div>`).join('') + `</div>`;
  if (startHere.length) deep += `<div class="c-sec">START HERE</div><div class="c-notes">Begin with <b>${startHere[0]}</b> · the foundation job the rest of this department builds on.</div>`;
  deep += `<div class="c-sec">THE NUMBERS</div><div class="c-notes"><b>${jobs}</b> jobs across <b>${dom.functions.length}</b> functions · <b>${files.size}</b> downloadable skill file${files.size === 1 ? '' : 's'}. Click any node to open its playbook and take the skill.</div>`;
  card.querySelector('.c-deep').innerHTML = deep;
  card.scrollTop = 0;
  card.classList.add('open');
}
function rise() {
  if (state !== 'fan') return;
  state = 'rising';
  document.body.classList.add('transitioning');
  hideCard();
  if (fanEl) fanEl.classList.add('collapse');
  document.body.classList.remove('fanmode');
  setTimeout(() => {
    if (fanEl) { fanEl.remove(); fanEl = null; }
    skyEl.style.display = '';
    document.querySelectorAll('.tree').forEach(t => t.classList.remove('dim'));
    (function(){const el=document.getElementById('state-name'); if(el) el.textContent='';})();
    state = 'sky';
    scale = 0.5; tx = 0; ty = -(R_ROOT + 100) * 0.5;
    layoutWheel();
    fitCurrent();
    const fb2 = document.getElementById('focus-bar'); if (fb2) fb2.hidden = true;
    setTimeout(() => document.body.classList.remove('transitioning'), 450);
  }, 380);
}

/* ============ LOOP + INPUT ============ */
/* the design can never be dragged out of sight · a margin of it always stays on screen */
function clampPan() {
  // locked small embeds are non-interactive: the computed fit IS the camera · never re-clamp it
  if (document.documentElement.classList.contains('fanlock') && innerWidth < 700) return;
  if (state === 'diving' || state === 'rising' || state === 'aligning' || state === 'intro') return;
  if (state === 'sky') {
    // the wheel rotates · the camera stays put
    const homeY = -innerHeight * 0.04;
    tx = Math.max(-40, Math.min(40, tx)); txT = Math.max(-40, Math.min(40, txT));
    ty = Math.max(homeY - 50, Math.min(homeY + 50, ty)); tyT = Math.max(homeY - 50, Math.min(homeY + 50, tyT));
    return;
  }
  const M = 230;
  const b = fanBounds;
  const ox = innerWidth * 0.5, oy = innerHeight * 0.56;
  const txMin = M - ox - b.maxX * scale, txMax = innerWidth - M - ox - b.minX * scale;
  const tyMin = M - oy - b.maxY * scale, tyMax = innerHeight - M - oy - b.minY * scale;
  tx = Math.max(txMin, Math.min(txMax, tx)); txT = Math.max(txMin, Math.min(txMax, txT));
  ty = Math.max(tyMin, Math.min(tyMax, ty)); tyT = Math.max(tyMin, Math.min(tyMax, tyT));
}

let camSettled = false;
let wheelSpinning = false;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function tick() {
  // reduced motion: snap the camera to its target instead of easing toward it
  const ease = reduceMotion ? 1 : 0.13;
  scale += (scaleT - scale) * ease;
  tx += (txT - tx) * ease;
  ty += (tyT - ty) * ease;
  if (Math.abs(wheelT - wheelA) > 0.01) {
    wheelA += (wheelT - wheelA) * (reduceMotion ? 1 : 0.11);
    if (state !== 'fan') { layoutWheel(); setSkyFocus(focusedIdx()); }
  }
  clampPan();
  // wheelspin: is the wheel genuinely rotating right now? STATELESS (recomputed every frame
   // from the live state) so it can never get stuck "on" and leave the map looking bare — the
   // moment the wheel is at rest this is false again. Used on mobile to GPU-promote the trees
   // while they rotate (see CSS) so the heavy SVGs composite instead of re-rasterizing.
  const spinningNow = state === 'sky' && (Math.abs(wheelT - wheelA) > 0.5 || (dragging && dragDist > 4));
  if (spinningNow !== wheelSpinning) { wheelSpinning = spinningNow; document.body.classList.toggle('wheelspin', spinningNow); }
  // promote to a compositor layer only while moving; release on settle so the
  // browser re-rasterizes text and icons sharp at the final zoom
  const moving = Math.abs(scaleT - scale) > 0.001 * scale || Math.abs(txT - tx) > 0.3 || Math.abs(tyT - ty) > 0.3;
  if (moving === camSettled) { camSettled = !moving; world.style.willChange = moving ? 'transform' : 'auto'; }
  document.body.classList.toggle('zoomedin', state === 'fan' && scale > (isMobile() ? 0.52 : 1.02));
  /* OVERRIDE: named groups appear as you zoom in on the sky */
  document.body.classList.toggle('sky-lod-groups', state === 'sky' && scale > skyFit() * 1.22);
  world.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(4)})`;
  const zpEl = document.getElementById('zoom-pct'); if (zpEl) zpEl.textContent = Math.round(scale * 100) + '%';
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* two-finger pinch (mobile): continuous zoom in the fan, commit-gesture in the sky */
const ptrs = new Map();
let pinchD0 = 0, pinchS0 = 1, pinchRatio = 1, pinchAX = 0, pinchAY = 0;
let flickV = 0, flickT = 0;
const pinchDist = () => {
  const [a, b2] = [...ptrs.values()];
  return Math.hypot(a[0] - b2[0], a[1] - b2[1]);
};
const pinchMid = () => {
  const [a, b2] = [...ptrs.values()];
  return [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
};

addEventListener('pointerdown', e => {
  if (e.target.closest('#card, #controls, #domnav, #topbar, #themetog, #back, .edge-dept, .wchev, #reader, #about')) return;
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) {
    dragging = false; document.body.classList.remove('panning');
    pinchD0 = pinchDist(); pinchS0 = scale; pinchRatio = 1;
    const [mx, my] = pinchMid();
    pinchAX = (mx - innerWidth * 0.5 - tx) / scale;     // the world point between the fingers —
    pinchAY = (my - innerHeight * 0.56 - ty) / scale;   // it stays between the fingers
    dragDist = 99;                       // a pinch is never a click
    return;
  }
  dragging = true; dragDist = 0; lastX = e.clientX; lastY = e.clientY;
  flickV = 0; flickT = performance.now();
  document.body.classList.add('panning');
});
addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size >= 2) {
    if (pinchD0 > 0) {
      pinchRatio = pinchDist() / pinchD0;
      if (state === 'fan') {
        // direct manipulation: zoom about the fingers' midpoint, follow it as it moves
        const s1 = clampZFan(pinchS0 * pinchRatio);
        const [mx, my] = pinchMid();
        scale = scaleT = s1;
        tx = txT = mx - innerWidth * 0.5 - pinchAX * s1;
        ty = tyT = my - innerHeight * 0.56 - pinchAY * s1;
      }
    }
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  dragDist += Math.abs(dx) + Math.abs(dy);
  if (state === 'sky') {
    if (isMobile()) {
      wheelA -= dx * 0.26;                          // thumb-friendly: less travel per department
      const now2 = performance.now();
      flickV = 0.75 * flickV + 0.25 * (dx / Math.max(1, now2 - flickT));
      flickT = now2;
    } else {
      // angular drag: the wheel is a dial · the point you grab stays under the cursor
      const cx = innerWidth / 2 + tx, cy = innerHeight * 0.56 + ty;
      const r0x = lastX - cx, r0y = lastY - cy, r1x = e.clientX - cx, r1y = e.clientY - cy;
      if (Math.hypot(r0x, r0y) > 48 && Math.hypot(r1x, r1y) > 48) {
        let dA = (Math.atan2(r1y, r1x) - Math.atan2(r0y, r0x)) * 180 / Math.PI;
        if (dA > 180) dA -= 360; if (dA < -180) dA += 360;
        wheelA += dA;
      } else {
        wheelA -= dx * 0.12;                        // dead zone at the very centre
      }
    }
    wheelT = wheelA;
    layoutWheel(); setSkyFocus(focusedIdx());
    clearTimeout(wheelIdle); wheelIdle = setTimeout(snapWheel, 260);
    if (nudgeStep === 0 && dragDist > 30) nudge(1);
  } else if (state === 'fan') {
    tx += dx; txT = tx; ty += dy; tyT = ty;
  }
  lastX = e.clientX; lastY = e.clientY;
});
const endPtr = e => {
  if (ptrs.has(e.pointerId)) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2 && pinchD0 > 0) {
      // commit the sky gesture: pinch-out dives into the focused department
      if (state === 'sky' && pinchRatio > 1.35) dive(focusedIdx());
      if (state === 'fan' && pinchRatio < 0.62 && scaleT <= clampZFan(0) + 0.01) rise();
      pinchD0 = 0;
    }
  }
  // flick momentum on the wheel: a brisk swipe carries you to the next department
  if (dragging && state === 'sky' && isMobile() && Math.abs(flickV) > 0.18) {
    const contA = Math.max(-1.6 * W_STEP, Math.min(1.6 * W_STEP, -flickV * 140));
    wheelT = 180 + Math.round((wheelA + contA - 180) / W_STEP) * W_STEP;
    clearTimeout(wheelIdle);
  }
  dragging = false; document.body.classList.remove('panning');
};
addEventListener('pointerup', endPtr);
addEventListener('pointercancel', endPtr);

addEventListener('click', e => {
  if (dragDist >= 8) return;
  if (e.target.closest('#card, #controls, #domnav, #topbar, #themetog, #back, .edge-dept, .node, .team-label, .tree, #hub, #reader, #about')) return;
  if (state === 'fan') {
    if (isMobile()) {
      // on a phone an accidental empty tap shouldn't yank the camera · just dismiss
      hideCard();
      if (selectedEl) { selectedEl.classList.remove('selected'); selectedEl = null; }
      if (fanEl) fanEl.querySelectorAll('.node.faded').forEach(n => n.classList.remove('faded'));
    } else fitCurrent();
  } else hideCard();
});

let wheelIdle = null;
// embeds: a passive listener that touches nothing — the browser chains the scroll
// to the parent page natively (smooth, momentum intact). never forward via postMessage.
const stEmbedScroll = document.documentElement.classList.contains('tour') || document.documentElement.classList.contains('fanlock');
addEventListener('wheel', e => {
  if (stEmbedScroll) return;
  if (e.target.closest('#card, #reader, #about, #search, .alerts-topbar, #focus-bar')) return;
  e.preventDefault();
  const now = performance.now();
  /* OVERRIDE: plain wheel always zooms toward cursor (never rotates the sky). */
  if (now < zoomLock) return;
  if (state === 'sky' || state === 'aligning') {
    const factor = Math.exp(-e.deltaY * 0.0018);
    const zn = Math.max(0.28, Math.min(1.85, scale * factor));
    const cx = innerWidth / 2, cy = innerHeight * 0.56;
    const k = zn / scale;
    tx = (e.clientX - cx) - k * ((e.clientX - cx) - tx);
    ty = (e.clientY - cy) - k * ((e.clientY - cy) - ty);
    scale = zn; txT = tx; tyT = ty; scaleT = scale;
    /* dive only after a decisive zoom-in past fit · click remains primary */
    if (e.deltaY < 0 && scale > skyFit() * 2.05) {
      zoomIntent += -e.deltaY;
      if (zoomIntent > 220) { dive(focusedIdx()); zoomIntent = 0; zoomLock = now + 900; }
    } else if (e.deltaY > 0) {
      zoomIntent = Math.min(0, zoomIntent);
    } else {
      zoomIntent = 0;
    }
    return;
  }
  if (state === 'fan') {
    const zn = clampZFan(scale * Math.exp(-e.deltaY * 0.01));
    if (zn <= 0.43 && e.deltaY > 0) {
      zoomIntent += -e.deltaY;
      if (zoomIntent < -110) { rise(); zoomIntent = 0; zoomLock = now + 900; }
      return;
    }
    const cx = innerWidth / 2, cy = innerHeight * 0.56;
    const k = zn / scale;
    tx = (e.clientX - cx) - k * ((e.clientX - cx) - tx);
    ty = (e.clientY - cy) - k * ((e.clientY - cy) - ty);
    scale = zn; txT = tx; tyT = ty; scaleT = scale;
    zoomIntent = 0;
  }
}, { passive: stEmbedScroll });

function snapWheel() {
  // the wheel always settles with a department at the bottom
  wheelT = 180 + Math.round((wheelT - 180) / W_STEP) * W_STEP;
}

function zoomStep(dir) {
  if (state === 'sky') { if (dir > 0) dive(focusedIdx()); return; }
  scaleT = clampZFan(scaleT * (dir > 0 ? 1.25 : 0.8));
  if (scaleT <= 0.43 && dir < 0) rise();
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('about').classList.contains('open') || document.getElementById('reader').classList.contains('open')) return;
    const s = document.getElementById('search');
    if (s.classList.contains('open')) { s.classList.remove('open'); return; }
    if (state === 'fan') rise(); else hideCard();
  }
  if (e.key === '0') fitCurrent();
  if (state === 'fan') {
    if (e.key === 'ArrowRight') buildFan((currentDept + 1) % N, 1, true) || fitCurrent();
    if (e.key === 'ArrowLeft') buildFan((currentDept - 1 + N) % N, -1, true) || fitCurrent();
  }
});

document.getElementById('back').addEventListener('click', rise);
/* wheel chevrons: seat the neighbouring department */
function stepWheel(d) {
  if (state !== 'sky') return;
  clearTimeout(wheelIdle);
  wheelT = 180 + Math.round((wheelT - 180) / W_STEP) * W_STEP - d * W_STEP;
}
document.getElementById('wchev-l').addEventListener('click', () => stepWheel(-1));
document.getElementById('wchev-r').addEventListener('click', () => stepWheel(1));
document.getElementById('edge-l').addEventListener('click', () => { buildFan((currentDept - 1 + N) % N, -1, true); fitCurrent(); });
document.getElementById('edge-r').addEventListener('click', () => { buildFan((currentDept + 1) % N, 1, true); fitCurrent(); });

/* ============ NAV + COUNTS + INIT ============ */
function updateCounts() {
  let fn = 0, jobs = 0, skills = 0;
  TREE.forEach(d => d.functions.forEach(f => { fn++; jobs += f.jobs.length; f.jobs.forEach(j => skills += j.skills.length); }));
  const mine = myTotal();
  document.getElementById('counts').textContent =
    `${N} departments · ${fn} teams · ${jobs} jobs · ${skills} skills mapped` + (mine ? ` · ${mine} live in your stack` : '');
}
updateCounts();

/* ============ SKILL READER ============ */
/* emojis in skill markdown → greyscale inline icons (inherit text color) */
const MD_ICON_SVG = {
  check:'<path d="M20 6 9 17l-5-5"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  zap:'<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/>',
  warn:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.7-4.5 1-6 0 2 .5 3 2 4 1.5 1 3 2.5 3 5a5 5 0 1 1-10 0c0-1 .2-2 .5-3z"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  star:'<path d="M12 2l3 6.4 7 .9-5.1 4.7 1.3 6.9L12 17.5 5.8 20.9l1.3-6.9L2 9.3l7-.9z"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>'
};
const MD_EMOJI = {'✅':'check','✔':'check','☑':'check','✓':'check','❌':'x','✖':'x','✕':'x','⚡':'zap','⚠':'warn','🔥':'flame','🖼':'image','✉':'mail','📧':'mail','★':'star','✦':'star','⭐':'star','🌟':'star','🔒':'lock','🔐':'lock','➡':'arrow','➤':'arrow'};
function mdIcon(n){ return '<svg class="mdic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+(MD_ICON_SVG[n]||MD_ICON_SVG.star)+'</svg>'; }
const MD_EMOJI_RE = /[✅✔☑✓❌✖✕⚡⚠🔥🖼✉📧★✦⭐🌟🔒🔐➡➤]️?/gu;
function iconifyMd(s){ return s.replace(MD_EMOJI_RE, m => mdIcon(MD_EMOJI[m.replace('️','')] || 'star')); }
function mdRender(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => iconifyMd(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  const lines = esc(src).split('\n');
  let out = '', inCode = false, code = [], list = null, para = [], table = null;
  const flushP = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushL = () => { if (list) { out += `<${list.t}>` + list.items.map(i => `<li>${inline(i)}</li>`).join('') + `</${list.t}>`; list = null; } };
  const flushT = () => { if (table) { out += '<table>' + table.map((r, i) => '<tr>' + r.map(c => `<${i ? 'td' : 'th'}>${inline(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>'; table = null; } };
  for (const l of lines) {
    if (l.trim().startsWith('```')) {
      flushP(); flushL(); flushT();
      if (inCode) { out += `<pre>${code.join('\n')}</pre>`; code = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { code.push(l); continue; }
    if (/^\s*\|/.test(l)) {
      flushP(); flushL();
      if (/^[\s|:\-]+$/.test(l)) continue;
      (table = table || []).push(l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      continue;
    }
    flushT();
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushP(); flushL(); const n = Math.min(h[1].length + 1, 4); out += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
    if (/^(---+|\*\*\*+)\s*$/.test(l.trim())) { flushP(); flushL(); out += '<hr>'; continue; }
    const q = l.match(/^&gt;\s?(.*)/);
    if (q) { flushP(); flushL(); out += `<blockquote><p>${inline(q[1])}</p></blockquote>`; continue; }
    const li = l.match(/^\s*[-*]\s+(.*)/), oli = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (li || oli) {
      flushP();
      const t = li ? 'ul' : 'ol';
      if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
      list.items.push((li || oli)[1]);
      continue;
    }
    if (!l.trim()) { flushP(); flushL(); continue; }
    para.push(l.trim());
  }
  flushP(); flushL(); flushT();
  if (inCode) out += `<pre>${code.join('\n')}</pre>`;
  return out;
}

const readerEl = document.getElementById('reader');
let readerText = '';
/* reverse map: skill file → the jobs it covers on the map */
const SKILL_COVERS = {};
Object.entries(PLAYBOOK || {}).forEach(([job, e]) =>
  (e.files || []).forEach(f => (SKILL_COVERS[f.path] = SKILL_COVERS[f.path] || []).push(job)));
(HUB_ENTRY.files || []).forEach(f => (SKILL_COVERS[f.path] = SKILL_COVERS[f.path] || []).push('Leet hub'));
let lastReaderArgs = null;
async function openReader(path, label) {
  stTrack('skill_file_opened', { skill: label || path });
  lastReaderArgs = [path, label];
  readerEl.querySelector('.rname').textContent = label;
  readerEl.querySelector('.rbody').innerHTML = '<p>loading…</p>';
  readerEl.classList.add('open');
  const slug = path.replace(/^skills\//, '').replace(/\.md$/, '');
  const sm = (window.SKILL_META && window.SKILL_META[path]) || null;
  const covers = SKILL_COVERS[path] || [];
  const glance = sm ? `<div class="rglance">
      <div class="rg-sec">AT A GLANCE</div><p>${sm.what}</p>
      <div class="rg-sec">NEEDS</div><p>${sm.needs}</p>
      ${covers.length ? `<div class="rg-sec">COVERS ON THE MAP</div><div class="rg-covers">${covers.map(c => `<span class="rg-job">${c}</span>`).join('')}</div>` : ''}
    </div>` : '';
  const dl = document.getElementById('rdl');
  try {
    const res = window.STSkills ? await window.STSkills.getSkill(slug) : { locked: true, reason: 'anon' };
    if (res.locked) {
      dl.style.display = 'none';
      readerText = '';
      const pv = (window.SKILL_PREVIEWS && window.SKILL_PREVIEWS[slug]) || '';
      const previewHtml = pv
        ? `<div class="rpreview"><div class="rpreview-body">${mdRender(pv)}</div><div class="rpreview-fade"></div></div>`
        : '';
      readerEl.querySelector('.rbody').innerHTML = glance + previewHtml + lockHtml(res.reason);
      readerEl.querySelector('.rbody').scrollTop = 0;
      return;
    }
    readerText = res.content;
    const blob = new Blob([readerText], { type: 'text/markdown' });
    dl.style.display = '';
    dl.setAttribute('href', URL.createObjectURL(blob));
    dl.setAttribute('download', slug + '.md');
    const display = readerText.replace(/^---\n[\s\S]*?\n---\n+/, '');
    readerEl.querySelector('.rbody').innerHTML = glance + mdRender(display);
    readerEl.querySelector('.rbody').scrollTop = 0;
  } catch (e) {
    dl.style.display = 'none';
    readerEl.querySelector('.rbody').innerHTML = glance + lockHtml('error');
  }
}
function lockHtml(reason) {
  const loggedIn = reason !== 'anon';
  const cta = loggedIn ? '/hub' : '/login';
  const line = loggedIn
    ? 'That is the preview. Unlock the full, runnable skill file · plus all 76.'
    : 'That is the preview. Unlock the full, runnable file and every skill on the map.';
  return `<div class="rlock">
    <div class="rlock-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:5px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Full file locked</div>
    <p class="rlock-line">${line}</p>
    <div class="rlock-ctas"><a class="rlock-cta" href="${cta}" onclick="return stUnlock(event)">Join the Waitlist</a><a class="rlock-cta rl-alt" href="https://cal.com/altari/30min" target="_blank" rel="noopener" onclick="window.stTrack&&stTrack('map_bookcall_click',{spot:'reader'})">Book a call</a></div>
  </div>`;
}
document.getElementById('rx').addEventListener('click', () => readerEl.classList.remove('open'));
readerEl.addEventListener('click', e => { if (e.target === readerEl) readerEl.classList.remove('open'); });
// Clipboard that survives cross-origin iframes (the hub embeds this map): the
// modern API is blocked there, so fall back to execCommand on a temp textarea,
// which works on a user gesture regardless of permissions policy.
function copyText(text) {
  return new Promise(resolve => {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta); resolve(ok);
      } catch (e) { resolve(false); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
      else fallback();
    } catch (e) { fallback(); }
  });
}
document.getElementById('rcopy').addEventListener('click', e => {
  const btn = e.currentTarget;
  copyText(readerText).then(ok => { if (ok) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1400); } });
});
addEventListener('keydown', e => { if (e.key === 'Escape' && readerEl.classList.contains('open')) readerEl.classList.remove('open'); });

/* ============ YOUR TREE · export / import / share ============ */
function treeStats() {
  let live = 0, dev = 0;
  const perDept = TREE.map(d => {
    const total = d.functions.reduce((s, f) => s + f.jobs.length, 0);
    const l = d.functions.reduce((s, f) => s + f.jobs.filter(j => myOf(d, j) === 'live').length, 0);
    const dv = d.functions.reduce((s, f) => s + f.jobs.filter(j => myOf(d, j) === 'dev').length, 0);
    live += l; dev += dv;
    return { name: d.name, live: l, dev: dv, total };
  });
  const hubLive = myOf(HUB_DOM, HUB_JOB) === 'live';
  return { live, dev, perDept, hubLive };
}
function treeSummaryText() {
  const s = treeStats();
  const lines = s.perDept.filter(d => d.live || d.dev).map(d =>
    `${d.name}: ${d.live}/${d.total} live${d.dev ? ` · ${d.dev} in development` : ''}`);
  return `MY SKILLTREE · ${s.live} of 137 AI jobs live${s.dev ? ` · ${s.dev} in development` : ''}\n`
    + `Knowledge base (node zero): ${s.hubLive ? 'LIVE' : 'not yet'}\n`
    + (lines.length ? lines.join('\n') + '\n' : '')
    + `Map your own → skilltree.altari.ai`;
}
function treeJobsByStatus() {
  const live = [], dev = [];
  TREE.forEach(d => d.functions.forEach(f => f.jobs.forEach(j => {
    const st = myOf(d, j);
    if (st === 'live') live.push({ name: j.name, dept: d.name, color: d.color });
    else if (st === 'dev') dev.push({ name: j.name, dept: d.name, color: d.color });
  })));
  return { live, dev };
}
function renderTreeLists() {
  const el = document.getElementById('ab-lists');
  if (!el) return;
  const { live, dev } = treeJobsByStatus();
  const group = (title, items, isDev) => {
    if (!items.length) return '';
    const rows = items.map(it =>
      `<button class="ab-item" data-job="${it.name.replace(/"/g, '&quot;')}"><span class="dot${isDev ? ' devdot' : ''}" style="${isDev ? 'color:' + it.color : 'background:' + it.color}"></span><span class="it-name">${it.name}</span><span class="it-dept">${it.dept}</span></button>`).join('');
    return `<div class="ab-lgroup"><div class="ab-lh${isDev ? ' dev' : ''}">${title} · ${items.length}</div><div class="ab-items">${rows}</div></div>`;
  };
  // in development first, then live
  el.innerHTML = group('IN DEVELOPMENT', dev, true) + group('LIVE', live, false);
}
function refreshAboutStat() {
  const s = treeStats();
  document.getElementById('ab-stat').textContent = (s.live || s.dev)
    ? `${s.live} of 137 jobs live · ${s.dev} in development · saved in this browser. Export to back it up or move it.`
    : 'Nothing marked yet · open any job on the map and set its status. Your tree saves in this browser.';
  renderTreeLists();
}
function refreshTreeUI() {
  updateCounts();
  if (state === 'fan') buildFan(currentDept, 0, false);
  refreshAboutStat();
}
document.getElementById('texport').addEventListener('click', () => {
  const data = { resource: 'skilltree', version: '1.0', exported: new Date().toISOString(), states: MY };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'skilltree-your-tree.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('tcopy').addEventListener('click', e => {
  const btn = e.currentTarget;
  copyText(treeSummaryText()).then(ok => { if (ok) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy summary'; }, 1400); } });
});
document.getElementById('timport').addEventListener('click', () => document.getElementById('tfile').click());
document.getElementById('tfile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(t => {
    try {
      const data = JSON.parse(t);
      const states = data.states || data;
      if (typeof states !== 'object' || Array.isArray(states)) throw new Error('bad shape');
      MY = {};
      for (const [k, v] of Object.entries(states)) if ((v === 'live' || v === 'dev') && k.includes('::')) MY[k] = v;
      localStorage.setItem(MY_KEY, JSON.stringify(MY));
      refreshTreeUI();
    } catch (err) {
      document.getElementById('ab-stat').textContent = 'That file didn’t look like a SkillTree export.';
    }
    e.target.value = '';
  });
});
document.getElementById('treset').addEventListener('click', e => {
  if (e.target.textContent !== 'Sure?') { e.target.textContent = 'Sure?'; setTimeout(() => { e.target.textContent = 'Reset'; }, 2200); return; }
  MY = {};
  localStorage.setItem(MY_KEY, JSON.stringify(MY));
  e.target.textContent = 'Reset';
  refreshTreeUI();
});

/* ============ SEARCH ============ */
const SEARCH_IX = [{ di: -1, dept: 'Node zero', color: '#C58B5F', fn: 'The hub', name: HUB, hay: 'company knowledge base hub brain node zero context memory' }];
TREE.forEach((d, di) => d.functions.forEach(f => f.jobs.forEach(j =>
  SEARCH_IX.push({ di, dept: d.name, color: d.color, fn: f.name, name: j.name,
    hay: `${j.name} ${f.name} ${d.name} ${j.desc} ${j.skills.join(' ')}`.toLowerCase() }))));
const searchEl = document.getElementById('search');
const searchIn = searchEl.querySelector('input');
const searchRes = searchEl.querySelector('.sres');
let sHits = [], sSel = 0;

function renderSearch(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  sHits = !terms.length
    ? SEARCH_IX.slice(0, 9)
    : SEARCH_IX.filter(x => terms.every(t => x.hay.includes(t))).slice(0, 12);
  sSel = 0;
  searchRes.innerHTML = sHits.length
    ? sHits.map((x, i) =>
        `<div class="sit${i === 0 ? ' sel' : ''}" data-i="${i}" style="--c:${x.color}"><span class="sdot"></span><span class="sname">${x.name}</span><span class="scrumb">${x.dept} · ${x.fn}</span></div>`).join('')
    : `<div class="snone">nothing on the map matches · yet. v1.1 is coming.</div>`;
}
function openSearch() { searchEl.classList.add('open'); searchIn.value = ''; renderSearch(''); searchIn.focus(); }
function closeSearch() { searchEl.classList.remove('open'); searchIn.blur(); }
function goSearch(i) {
  const hit = sHits[i];
  if (!hit) return;
  closeSearch();
  if (hit.di < 0) { selectHub(); return; }
  if (state === 'fan') {
    if (hit.di !== currentDept) buildFan(hit.di, 0, false);
    jumpToJob(hit.name);
  } else {
    dive(hit.di);
    setTimeout(() => jumpToJob(hit.name), 2150);
  }
}
searchIn.addEventListener('input', () => renderSearch(searchIn.value));
searchIn.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sSel = (sSel + (e.key === 'ArrowDown' ? 1 : -1) + sHits.length) % Math.max(sHits.length, 1);
    searchRes.querySelectorAll('.sit').forEach((el, i) => el.classList.toggle('sel', i === sSel));
  } else if (e.key === 'Enter') goSearch(sSel);
  else if (e.key === 'Escape') closeSearch();
  e.stopPropagation();
});
searchRes.addEventListener('click', e => { const it = e.target.closest('.sit'); if (it) goSearch(+it.dataset.i); });
searchEl.addEventListener('click', e => { if (e.target === searchEl) closeSearch(); });
{ const ts = document.getElementById('topsearch'); if (ts) ts.addEventListener('click', openSearch); }
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === '/' && !searchEl.classList.contains('open') && document.activeElement !== searchIn) { e.preventDefault(); openSearch(); }
});

/* ============ FIRST-VISIT NUDGE ============ */
const NUDGES = ['tap a department to enter it', 'tap any job · mark what’s live in your stack'];
let nudgeStep = -1;
const nudgeSeen = () => { try { return !!localStorage.getItem('skilltree-seen'); } catch (e) { return true; } };
function nudge(i) {
  if (nudgeSeen()) return;
  const n = document.getElementById('nudge');
  nudgeStep = i;
  if (i >= NUDGES.length) {
    n.classList.remove('show');
    try { localStorage.setItem('skilltree-seen', '1'); } catch (e) {}
    return;
  }
  n.textContent = NUDGES[i];
  n.classList.add('show');
}

/* about panel · stubbed safely for leet shell */
const aboutEl = document.getElementById('about');
const aboutb = document.getElementById('aboutb');
if (aboutb && aboutEl) aboutb.addEventListener('click', () => { try { refreshAboutStat(); } catch (e) {} aboutEl.classList.add('open'); });
const abLists = document.getElementById('ab-lists');
if (abLists && aboutEl) abLists.addEventListener('click', e => {
  const btn = e.target.closest('.ab-item');
  if (!btn) return;
  aboutEl.classList.remove('open');
  jumpToJob(btn.dataset.job);
});
const abx = aboutEl && aboutEl.querySelector('.ab-x');
if (abx) abx.addEventListener('click', () => aboutEl.classList.remove('open'));
if (aboutEl) {
  aboutEl.addEventListener('click', e => { if (e.target === aboutEl) aboutEl.classList.remove('open'); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && aboutEl.classList.contains('open')) aboutEl.classList.remove('open'); });
}

try { if (!document.documentElement.classList.contains('forcedark') && (localStorage.getItem('skilltree-theme') === 'light' || location.hash.includes('light'))) document.body.classList.add('light'); } catch (e) {}
// when embedded in the hub, follow the hub's theme
window.addEventListener('message', function (e) { if (document.documentElement.classList.contains('forcedark')) return; if (e && e.data && e.data.type === 'st-theme') { document.body.classList.toggle('light', e.data.theme === 'light'); } });

skyW = buildSky();
const m0 = location.hash.match(/fan=(\d)/);
if (m0) {
  skyEl.style.display = 'none';
  document.body.classList.add('fanmode');
  (function(){const el=document.getElementById('state-name'); if(el) el.textContent='NAVIGATION';})();
  state = 'fan';
  buildFan(+m0[1], 0, true);
}
fitCurrent(true);
// embeds: the built-in fits assume full-screen phone/desktop chrome. locked embeds
// recompute a true fit from the actual geometry for whatever box they are given,
// at three fixed tiers (mobile <700 · tablet 700-1099 · desktop ≥1100) — and they
// re-fit on EVERY resize, so crossing tiers can never leave a stale crop behind.
function applyEmbedFit() {
  const doc = document.documentElement;
  if (doc.classList.contains('fanlock')) {
    fitCurrent(true);
    if (innerWidth < 700) {
      // mobile: exact bounds fit · the fan hugs the frame with slim margins
      const bw = fanBounds.maxX - fanBounds.minX, bh = fanBounds.maxY - fanBounds.minY;
      scaleT = Math.min((innerWidth - 28) / bw, (innerHeight - 44) / bh);
      // the camera anchor sits at (0.5W, 0.56H) · subtract the 6% so the art centers truly
      txT = -((fanBounds.minX + fanBounds.maxX) / 2) * scaleT;
      tyT = -((fanBounds.minY + fanBounds.maxY) / 2) * scaleT - innerHeight * 0.07;
    } else {
      // tablet + desktop: the desktop fit, pushed in for presence
      const k = innerWidth < 1100 ? 1.35 : 1.75;
      scaleT *= k; txT *= k; tyT *= k;
    }
    scale = scaleT; tx = txT; ty = tyT;
  } else if (doc.classList.contains('tour')) {
    fitCurrent(true);
    if (innerWidth < 700) {
      // mobile: whole wheel, no clamps · label ring (R≈470) plus text, fit to the short axis
      const ringSpan = (470 + 130) * 2;
      scaleT = Math.min((innerWidth - 44) / ringSpan, (innerHeight - 64) / ringSpan);
      txT = 0; tyT = -innerHeight * 0.015;
      scale = scaleT; tx = txT; ty = tyT;
    }
    // tablet + desktop: skyFit already frames the whole wheel
  }
}
if (document.documentElement.classList.contains('tour') || document.documentElement.classList.contains('fanlock')) {
  applyEmbedFit();
  let _eft;
  addEventListener('resize', () => { clearTimeout(_eft); _eft = setTimeout(applyEmbedFit, 120); });
}
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
/* removed: first-visit 'drag to spin the wheel' nudge */
// once ignition finishes, release the animation so hover/focus dimming owns opacity again
setTimeout(() => document.querySelectorAll('.tree').forEach(t => t.classList.add('settled')), 2200);

// Deep-link from the hub's search/drops:
//   ?skill=<slug> → opens that skill's reader
//   ?dept=<name>  → fans straight into that department's section
// (delay lets ignition + the paid-token handshake land first).
(function () {
  const params = new URLSearchParams(location.search);
  const slug = (params.get('skill') || (location.hash.match(/skill=([a-z0-9-]+)/i) || [])[1] || '').trim();
  const dept = (params.get('dept') || '').trim();

  if (slug) {
    const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setTimeout(() => { try { openReader('skills/' + slug + '.md', label); } catch (e) {} }, 850);
    return;
  }
  if (dept) {
    const idx = TREE.findIndex((d) => d.name.toLowerCase() === dept.toLowerCase());
    if (idx < 0) return;
    setTimeout(() => {
      try {
        skyEl.style.display = 'none';
        document.body.classList.add('fanmode');
        const sn = document.getElementById('state-name'); if (sn) sn.textContent = 'NAVIGATION';
        state = 'fan';
        buildFan(idx, 0, true);
        if (typeof fitCurrent === 'function') fitCurrent(true);
      } catch (e) {}
    }, 700);
  }
})();



/* ============ LEET SHELL WIRING ============ */
(function leetShell() {
  document.body.classList.add('alerts-port');
  const snapFocus = () => {
    const di = typeof currentDept === 'number' ? currentDept : focusedIdx();
    const d = TREE[di]; if (!d) return;
    const ft = document.getElementById('focus-title');
    const fs = document.getElementById('focus-sub');
    if (ft) ft.textContent = d.name;
    if (fs) fs.textContent = d.sub || '';
  };
  const prev = () => {
    if (state === 'fan') { buildFan((currentDept - 1 + N) % N, -1, true); fitCurrent(); snapFocus(); }
    else if (typeof stepWheel === 'function') stepWheel(-1);
  };
  const next = () => {
    if (state === 'fan') { buildFan((currentDept + 1) % N, 1, true); fitCurrent(); snapFocus(); }
    else if (typeof stepWheel === 'function') stepWheel(1);
  };
  const cp = document.getElementById('cat-prev'); if (cp) cp.addEventListener('click', prev);
  const cn = document.getElementById('cat-next'); if (cn) cn.addEventListener('click', next);
  const zi = document.getElementById('zoom-in'); if (zi) zi.addEventListener('click', () => zoomStep(1));
  const zo = document.getElementById('zoom-out'); if (zo) zo.addEventListener('click', () => zoomStep(-1));
  const zf = document.getElementById('zoom-fit'); if (zf) zf.addEventListener('click', () => fitCurrent());
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-view');
      document.querySelectorAll('[data-view]').forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      const mv = document.getElementById('map-view');
      const dv = document.getElementById('dash-view');
      if (v === 'dashboards') {
        if (mv) mv.classList.add('is-off');
        if (dv) { dv.hidden = false; dv.classList.add('is-on'); }
      } else {
        if (mv) mv.classList.remove('is-off');
        if (dv) { dv.hidden = true; dv.classList.remove('is-on'); }
      }
    });
  });
  try {
    const snap = window.LEET_ALERTS_DATA && window.LEET_ALERTS_DATA.buildSnapshot();
    const grid = document.getElementById('dash-grid');
    if (snap && grid) {
      grid.innerHTML = snap.categories.map(c =>
        `<article class="dash-card" style="--c:${c.color}"><h3>${c.label}</h3><p>${c.subtitle}</p><strong>${c.count}</strong> open</article>`
      ).join('');
    }
  } catch (e) {}
})();
