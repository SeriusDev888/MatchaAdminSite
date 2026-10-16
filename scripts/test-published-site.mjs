// A disposable local Studio and a separate Next server; never edits real Supabase content.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { convertLegacy } from './import-legacy-content.mjs';

await mkdir('output', { recursive: true });
const state = await mkdtemp(resolve('output/published-site-'));
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const siteRoot = resolve('../Golden-Ray-Matcha');
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: resolve('output/wrangler-logs'),
};
const configuration = ['--config', 'dist/server/wrangler.json', '--persist-to', state];
const reserve = createServer();
await new Promise((accept) => reserve.listen(0, '127.0.0.1', accept));
const sitePort = reserve.address().port;
await new Promise((accept) => reserve.close(accept));
const site = `http://127.0.0.1:${sitePort}`;
const processes = [];
function launch(args, cwd, childEnv) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);
  return child;
}
function ready(child, pattern) {
  return new Promise((accept, reject) => {
    let logs = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timed out: ' + logs)), 30000);
    function read(chunk) {
      logs = (logs + chunk).slice(-10000);
      const match = logs.match(pattern);
      if (match) {
        clearTimeout(timeout);
        accept(match);
      }
    }
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${logs}`));
    });
  });
}
function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else child.kill('SIGTERM');
}
try {
  execFileSync(
    process.execPath,
    [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...configuration],
    { env, windowsHide: true, stdio: 'pipe', timeout: 30000 },
  );
  const adminProcess = launch(
    [
      cli,
      'dev',
      '--local',
      ...configuration,
      '--ip',
      '127.0.0.1',
      '--port',
      '0',
      '--var',
      'STUDIO_DATABASE:local',
      '--var',
      'LOCAL_AUTH_SETUP:true',
      '--var',
      `SITE_ORIGIN:${site}`,
    ],
    process.cwd(),
    env,
  );
  const [, admin] = await ready(adminProcess, /Ready on (http:\/\/127\.0\.0\.1:\d+)/);
  const credentials = {
    email: 'published-browser@example.test',
    password: 'Published-browser-test-2026',
  };
  let cookie = '';
  async function api(path, method = 'GET', body) {
    const response = await fetch(admin + path, {
      method,
      headers: {
        origin: admin,
        'x-editor-request': '1',
        'content-type': 'application/json',
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return data;
  }
  await api('/api/auth/setup', 'POST', credentials);
  const imported = convertLegacy({
    brand_settings: [{ brand_name: 'Imported Matcha Brand' }],
    home_content: [{ hero: { mainTitle: 'Imported Matcha headline' } }],
    user_guide_content: [{ header: { title: 'Imported guide' }, steps: [], guide: {} }],
    about_content: [
      {
        header: { title: 'Imported about' },
        sourcing: {},
        commitments: [],
        quality_control: { items: [] },
      },
    ],
    catalog_content: [
      {
        header: { title: 'Imported catalog' },
        product_catalog: { file: { fileName: '', fileUrl: '' } },
      },
    ],
  });
  const draft = await api('/api/editor/draft');
  const saved = await api('/api/editor/draft', 'PUT', {
    document: imported,
    revision: draft.revision,
  });
  await api('/api/editor/publish', 'POST', {
    revision: saved.revision,
    publishedRevision: (await api('/api/content')).revision,
  });
  const next = launch(
    [
      resolve(siteRoot, 'node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(sitePort),
    ],
    siteRoot,
    {
      ...env,
      MATCHA_CONTENT_ORIGIN: admin,
      NEXT_PUBLIC_SUPABASE_URL: 'https://legacy-must-not-be-used.invalid',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
    },
  );
  await ready(next, /Ready in/);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(site + '/api/content/studio');
      const data = await response.json();
      if (response.ok && data.document?.brand?.name === 'Imported Matcha Brand') break;
      if (attempt === 9) throw new Error('Next did not load imported published content');
    } catch (error) {
      if (attempt === 9) throw error;
    }
    await delay(200);
  }
  const browserTest = launch(['--test', 'tests/matcha-browser.cjs'], process.cwd(), {
    ...env,
    STUDIO_TEST_ORIGIN: admin,
    STUDIO_TEST_SITE: site,
    STUDIO_TEST_EMAIL: credentials.email,
    STUDIO_TEST_PASSWORD: credentials.password,
  });
  browserTest.stdout.pipe(process.stdout);
  browserTest.stderr.pipe(process.stderr);
  const code = await new Promise((accept) => browserTest.once('exit', accept));
  if (code !== 0) throw new Error(`Browser verification failed (${code})`);
  stop(adminProcess);
  await delay(250);
  for (const path of ['/api/content/studio', '/api/content/site', '/api/content/home']) {
    const response = await fetch(site + path, { signal: AbortSignal.timeout(10000) });
    if (response.status !== 503) throw new Error(`${path} served content after Studio stopped`);
  }
  console.log(
    'Verified imported content, private drafts, publishing, all public pages, empty catalogs and no legacy fallback during outages.',
  );
} finally {
  for (const child of processes.reverse()) stop(child);
}
