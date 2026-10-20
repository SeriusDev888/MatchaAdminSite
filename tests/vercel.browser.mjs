import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as reservePort } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { vercelFixture } from './vercel-fixture.mjs';

test(
  'Vercel handler works in Chrome: login, editor preview, save/publish, direct image/PDF uploads and logout',
  { timeout: 120000 },
  async (t) => {
    let browser;
    t.after(async () => {
      await browser?.close();
    });
    // Vercel previews use the production Next server; Next dev's HMR WebSocket
    // belongs to the local Cloudflare workflow and cannot run in a Vercel Function.
    if (!process.env.VERCEL_TEST_SITE) {
      const reserve = reservePort();
      await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
      const port = reserve.address().port;
      await new Promise((done) => reserve.close(done));
      const frontend = spawn(
        process.execPath,
        [
          resolve('../Golden-Ray-Matcha/node_modules/next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        {
          cwd: resolve('../Golden-Ray-Matcha'),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      t.after(() => {
        delete process.env.VERCEL_TEST_SITE;
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill', ['/PID', String(frontend.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {}
        } else frontend.kill();
      });
      await new Promise((done, reject) => {
        let logs = '';
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                'Build Golden-Ray-Matcha first, or set VERCEL_TEST_SITE to a production frontend. ' +
                  logs,
              ),
            ),
          20000,
        );
        const read = (chunk) => {
          logs += chunk;
          if (logs.includes('Ready')) {
            clearTimeout(timeout);
            done();
          }
        };
        frontend.stdout.on('data', read);
        frontend.stderr.on('data', read);
        frontend.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        frontend.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error('Next production server exited: ' + code + ' ' + logs));
        });
      });
      process.env.VERCEL_TEST_SITE = 'http://127.0.0.1:' + port;
    }
    let f;
    const bodies = [],
      errors = [],
      failures = [];
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        bodies.push(bytes.length);
        const response = await f.handler.fetch(
          new Request(origin + incoming.url, {
            method: incoming.method,
            headers: incoming.headers,
            ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: bytes } : {}),
          }),
        );
        const headers = Object.fromEntries(response.headers);
        if (response.headers.getSetCookie().length)
          headers['set-cookie'] = response.headers.getSetCookie();
        outgoing.writeHead(response.status, headers);
        if (response.body) for await (const chunk of response.body) outgoing.write(chunk);
        outgoing.end();
      } catch (error) {
        if (outgoing.destroyed) return;
        errors.push(error.message);
        if (outgoing.headersSent) {
          outgoing.destroy();
          return;
        }
        outgoing.writeHead(500);
        outgoing.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    f = await vercelFixture(t, origin);
    const email = 'browser-vercel@example.test',
      password = 'Browser-vercel-password-2026';
    const setup = await f.post('/api/auth/setup', {
      email,
      password,
      setupToken: f.env.ADMIN_SETUP_TOKEN,
    });
    assert.equal(setup.status, 200, await setup.clone().text());
    const [name, value] = setup.headers.get('set-cookie').split(';')[0].split('=');
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addCookies([{ name, value, url: origin }]);
    await context.route(f.env.SUPABASE_URL + '/**', async (route) => {
      const request = route.request();
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'PUT, GET, OPTIONS',
        'access-control-allow-headers': 'content-type, x-upsert',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (request.method() === 'GET') {
        const key = new URL(request.url()).pathname.split('/editor/')[1];
        return route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'image/png' },
          body: Buffer.from(f.stored.get(key)),
        });
      }
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: request.postDataBuffer(),
      });
      return route.fulfill({ status: response.status, headers: cors, body: await response.text() });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400)
        failures.push([response.status(), new URL(response.url()).pathname]);
    });
    await page.goto(origin);
    await page.locator('#studio').waitFor({ state: 'visible' });
    const frame = page.frameLocator('#preview');
    const heading = frame.locator('body.ve-editable main h1').first();
    await heading.click();
    await page.locator('#text-value').fill('Vercel browser verification');
    await heading.filter({ hasText: 'Vercel browser verification' }).waitFor();
    await page.locator('#clear-bg-color').click();
    assert.equal(await heading.evaluate(el => el.style.backgroundColor), 'transparent');
    await frame.locator('main svg[data-ve-id]').first().click();
    await page.locator('[data-tab="effects"]').click();
    assert.equal(await page.locator('#sticker-grid button:visible').count(), 24);
    const first = await page.locator('#sticker-grid button:visible').first().getAttribute('data-sticker');
    await page.locator('#sticker-next').click();
    assert.notEqual(await page.locator('#sticker-grid button:visible').first().getAttribute('data-sticker'), first);
    await page.locator('#sticker-prev').click();
    assert.equal(await page.locator('#sticker-grid button:visible').first().getAttribute('data-sticker'), first);
    await page.locator('[data-manager="contact"]').first().click();
    await page.locator('#contact-email').fill('matcha-browser@example.test');
    await page.locator('#contact-email').dispatchEvent('change');
    await page.locator('#manager-back').click();
    await page.locator('#save').click();
    await page.waitForFunction(() =>
      document.querySelector('#save-state').textContent.includes('บันทึกฉบับร่างแล้ว'),
    );
    await page.locator('#publish').click();
    await page.locator('#confirm-publish').click();
    await page.waitForFunction(() => !document.querySelector('#publish-dialog').open);
    assert.ok(
      JSON.stringify(await (await f.request('/api/content')).json()).includes(
        'Vercel browser verification',
      ),
    );
    const results = await page.evaluate(async () => {
      const results = [];
      for (const kind of ['image', 'pdf']) {
        const bytes = new Uint8Array(6 * 1024 * 1024);
        if (kind === 'image') bytes.set([137, 80, 78, 71]);
        else {
          bytes.set(new TextEncoder().encode('%PDF-1.7'));
          bytes.set(new TextEncoder().encode('%%EOF'), bytes.length - 5);
        }
        results.push(
          await StudioUpload(
            new File([bytes], kind + '-large', {
              type: kind === 'image' ? 'image/png' : 'application/pdf',
            }),
            kind,
          ),
        );
      }
      return results;
    });
    assert.equal(results.length, 2);
    assert.equal(f.stored.size, 2);
    assert.ok(
      Math.max(...bodies) < 4 * 1024 * 1024,
      'large files bypass the Vercel function request body',
    );
    await page.locator('#logout').click();
    await page.waitForURL('**/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#submit').click();
    await page.locator('#studio').waitFor({ state: 'visible' });
    await frame.locator('body.ve-editable main h1').first().waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
  },
);
