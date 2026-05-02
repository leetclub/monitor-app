/**
 * Reads google.creds (Client ID / Client secret blocks) and patches people-analytics-secrets + ConfigMap.
 * Usage: node scripts/apply-google-creds-to-k8s.mjs [path/to/google.creds]
 */
import fs from 'fs';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'child_process';
import path from 'path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const credPath = process.argv[2] || path.join(root, 'google.creds');

const text = fs.readFileSync(credPath, 'utf8');
const lines = text.split(/\r?\n/).map((l) => l.trim());
let clientId = '';
let clientSecret = '';
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === 'Client ID' && lines[i + 1]) {
    clientId = lines[i + 1];
  }
  if (lines[i] === 'Client secret' && lines[i + 1]) {
    clientSecret = lines[i + 1];
  }
}
if (!clientId || !clientSecret) {
  console.error('Could not parse Client ID and Client secret from', credPath);
  process.exit(1);
}

const patch = {
  stringData: {
    'google-client-id': clientId,
    'google-client-secret': clientSecret,
  },
};
const tmp = path.join(tmpdir(), `google-k8s-patch-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify(patch));
const ns = process.env.NS || 'leet-monitor';

let r = spawnSync(
  'kubectl',
  [
    'patch',
    'secret',
    'people-analytics-secrets',
    '-n',
    ns,
    '--type',
    'merge',
    '--patch-file',
    tmp,
  ],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const cmPatch = {
  data: {
    GOOGLE_CLIENT_ID: Buffer.from(clientId, 'utf8').toString('base64'),
  },
};
fs.writeFileSync(tmp, JSON.stringify(cmPatch), 'utf8');
r = spawnSync(
  'kubectl',
  [
    'patch',
    'configmap',
    'monitoring-app-v2-public',
    '-n',
    ns,
    '--type',
    'merge',
    '--patch-file',
    tmp,
  ],
  { stdio: 'inherit' },
);
fs.unlinkSync(tmp);
if (r.status !== 0) process.exit(r.status ?? 1);

spawnSync(
  'kubectl',
  ['rollout', 'restart', 'deployment/people-analytics-api', '-n', ns],
  { stdio: 'inherit' },
);
spawnSync(
  'kubectl',
  ['rollout', 'restart', 'deployment/monitoring-app-v2', '-n', ns],
  { stdio: 'inherit' },
);
console.log('Patched google-client-id, google-client-secret, GOOGLE_CLIENT_ID; restarted people-analytics-api and monitoring-app-v2.');
