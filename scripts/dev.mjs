import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
mkdirSync(resolve(root, '.wrangler/logs'), { recursive: true });
const vars = [
  '--var',
  'SITE_ORIGIN:' + (process.env.SITE_ORIGIN || 'http://127.0.0.1:3000'),
  '--var',
  'LOCAL_AUTH_SETUP:' + (process.env.LOCAL_AUTH_SETUP === 'false' ? 'false' : 'true'),
];
if (process.env.ADMIN_SETUP_TOKEN)
  vars.push('--var', 'ADMIN_SETUP_TOKEN:' + process.env.ADMIN_SETUP_TOKEN);
for (const key of [
  'STUDIO_DATABASE',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
]) {
  if (process.env[key]) vars.push('--var', key + ':' + process.env[key]);
}
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'dev',
    '--local',
    '--config',
    'dist/server/wrangler.json',
    '--persist-to',
    '.wrangler/state',
    '--ip',
    '127.0.0.1',
    '--port',
    process.env.PORT || '4321',
    ...vars,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve(root, '.wrangler/logs'),
      WRANGLER_SEND_METRICS: 'false',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
