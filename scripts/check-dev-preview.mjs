// Reproduce the real Next dev preview against disposable Studio data.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
await mkdir('output', { recursive: true });
const state = await mkdtemp(resolve('output/dev-preview-'));
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: resolve('output/wrangler-logs'),
};
const config = ['--config', 'dist/server/wrangler.json', '--persist-to', state];
execFileSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...config], {
  env,
  stdio: 'pipe',
  windowsHide: true,
});
const child = spawn(
  process.execPath,
  [
    cli,
    'dev',
    '--local',
    ...config,
    '--ip',
    '127.0.0.1',
    '--port',
    '0',
    '--var',
    'STUDIO_DATABASE:local',
    '--var',
    'LOCAL_AUTH_SETUP:true',
    '--var',
    'SITE_ORIGIN:http://127.0.0.1:3000',
  ],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser;
try {
  const origin = await new Promise((accept, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error(logs)), 30000);
    const read = (chunk) => {
      logs += chunk;
      const match = logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        accept(match[1]);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
  });
  const response = await fetch(origin + '/api/auth/setup', {
    method: 'POST',
    headers: { origin, 'x-editor-request': '1', 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'preview-only@example.test',
      password: 'Preview-only-password-2026',
    }),
  });
  if (!response.ok) throw new Error('Test setup failed');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const [name, value] = cookie.split('=');
  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addCookies([{ name, value, url: origin }]);
  const page = await context.newPage();
  const errors = [],
    failures = [];
  page.on('pageerror', (error) => {
    errors.push(error.stack);
    console.log('PAGE ERROR: ' + error.stack);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/images/'))
      failures.push({ status: r.status(), url: r.url().replace(origin, '') });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#studio').waitFor({ state: 'visible' });
  const frame = page.frameLocator('#preview');
  await frame.locator('body.ve-editable').waitFor();
  // Playwright's "visible" also matches opacity: 0. Check the ancestors too.
  await page.waitForFunction(() => {
    let el = document.querySelector('#preview').contentDocument.querySelector('main h1');
    if (!el) return false;
    while (el) {
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      if (Number(style.opacity) < 0.99 || style.visibility === 'hidden' || style.display === 'none')
        return false;
      el = el.parentElement;
    }
    return true;
  });
  // A ready message may arrive while the parent is still loading the draft.
  await page.evaluate(() => {
    for (const document of [undefined, null, {}, { schema: 1, pages: null }])
      window.document
        .querySelector('#preview')
        .contentWindow.postMessage(
          { source: 'matcha-editor', type: 'state', document },
          location.origin,
        );
  });
  const heading = frame.locator('main h1').first();
  await heading.click();
  await page.locator('#text-value').fill('Visible preview after early state message');
  await heading.filter({ hasText: 'Visible preview after early state message' }).waitFor();
  const font = await context.request.get(origin + '/__nextjs_font/geist-latin.woff2');
  assert.equal(font.status(), 200);
  const stacks = await context.request.post(origin + '/__nextjs_original-stack-frames', {
    headers: { origin },
    data: { frames: [], isAppDirectory: true },
  });
  assert.equal(stacks.status(), 200);
  assert.deepEqual(await stacks.json(), []);
  await page.screenshot({ path: 'output/dev-preview-check.png', fullPage: true });
  await page.locator('#interactive').check();
  await frame.locator('body.ve-interactive').waitFor();
  await page.locator('#interactive').uncheck();
  await frame.locator('body.ve-editable').waitFor();
  for (const route of ['products', 'about', 'contact', 'home']) {
    await page.locator('#page-select').selectOption(route);
    await page.waitForFunction((route) => {
      const win = document.querySelector('#preview').contentWindow;
      if (new URLSearchParams(win.location.search).get('studio-route') !== route) return false;
      let el = win.document.querySelector('main h1[data-ve-id]');
      if (!el || !win.document.body.classList.contains('ve-editable')) return false;
      while (el) {
        if (Number(win.getComputedStyle(el).opacity) < 0.99) return false;
        el = el.parentElement;
      }
      return true;
    }, route);
  }
  await page.locator('[data-width="390"]').click();
  await heading.filter({ hasText: 'Visible preview after early state message' }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'PASS: Matcha preview remains visible and editable after early messages, page changes, interactive mode and mobile resize; Next fonts/stack lookups load without errors',
  );
} finally {
  await browser?.close();
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {}
}
