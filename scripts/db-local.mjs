import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, '.wrangler/logs'), { recursive: true });
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    'dist/server/wrangler.json',
    '--persist-to',
    '.wrangler/state',
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
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
