// Disposable Wrangler/D1 state: never creates an account in .wrangler/state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

test(
  'setup, login, logout and mobile layout work in the real Worker runtime',
  { timeout: 120000 },
  async () => {
    await mkdir('output', { recursive: true });
    const state = await mkdtemp(resolve('output/login-browser-'));
    const cli = resolve('node_modules/wrangler/bin/wrangler.js');
    const configuration = ['--config', 'dist/server/wrangler.json', '--persist-to', state];
    const processEnv = {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: resolve('output/wrangler-logs'),
    };
    execFileSync(
      process.execPath,
      [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...configuration],
      { env: processEnv, windowsHide: true, stdio: 'pipe', timeout: 30000 },
    );
    const server = spawn(
      process.execPath,
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
        'LOCAL_AUTH_SETUP:true',
        '--var',
        'STUDIO_DATABASE:local',
        '--var',
        'SITE_ORIGIN:http://127.0.0.1:9',
      ],
      { env: processEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let logs = '';
    let browser;
    try {
      const origin = await new Promise((accept, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Wrangler startup timed out: ' + logs)),
          25000,
        );
        const read = (chunk) => {
          logs += chunk;
          const match = logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) {
            clearTimeout(timeout);
            accept(match[1]);
          }
        };
        server.stdout.on('data', read);
        server.stderr.on('data', read);
        server.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        server.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Wrangler exited ${code}: ${logs}`));
        });
      });
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/editor.html#home');
      await page.waitForURL('**/login?next=**');
      await page.getByRole('heading', { name: 'ตั้งค่าบัญชี superadmin' }).waitFor();
      await page.screenshot({ path: 'output/login-setup-desktop.png', fullPage: true });
      const credentials = { email: 'browser@example.test', password: 'Browser-test-password-2026' };
      await page.locator('#email').fill(credentials.email);
      await page.locator('#password').fill(credentials.password);
      await page.locator('#confirm-password').fill('mismatched-password');
      await page.locator('#submit').click();
      await page.getByRole('alert').filter({ hasText: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }).waitFor();
      await page.locator('#confirm-password').fill(credentials.password);
      await page.locator('#submit').click();
      await page.locator('#studio').waitFor({ state: 'visible' });
      // Exercise the existing draft/publish/restore/media suite with a real login cookie.
      execFileSync(process.execPath, ['--test', 'tests/editor-api.test.mjs'], {
        env: {
          ...processEnv,
          STUDIO_TEST_ORIGIN: origin,
          STUDIO_TEST_EMAIL: credentials.email,
          STUDIO_TEST_PASSWORD: credentials.password,
        },
        windowsHide: true,
        stdio: 'pipe',
        timeout: 30000,
      });
      const cookie = (await context.cookies()).find((c) => c.name.endsWith('_studio_session'));
      assert.ok(cookie?.httpOnly);
      assert.equal(cookie.sameSite, 'Strict');
      assert.equal((await context.request.get(origin + '/api/editor/draft')).status(), 200);
      // Public registration stays pending until superadmin approves the member.
      const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const memberPage = await memberContext.newPage();
      await memberPage.goto(origin + '/register');
      await memberPage.getByRole('heading', { name: 'สมัครเป็นผู้ดูแลเว็บไซต์' }).waitFor();
      await memberPage.locator('#display-name').fill('ทีมดูแลสินค้า');
      await memberPage.locator('#email').fill('member-browser@example.test');
      await memberPage.locator('#password').fill('Member-browser-password-2026');
      await memberPage.locator('#confirm-password').fill('Member-browser-password-2026');
      await memberPage.screenshot({ path: 'output/register-mobile.png', fullPage: true });
      await memberPage.locator('#submit').click();
      await memberPage.waitForURL(origin + '/pending');
      await memberPage.getByRole('heading', { name: 'รออนุมัติจากผู้ดูแล', exact: true }).waitFor();
      await memberPage.screenshot({ path: 'output/pending-mobile.png', fullPage: true });
      await memberPage.setViewportSize({ width: 1440, height: 960 });
      await memberPage.screenshot({ path: 'output/pending-desktop.png', fullPage: true });
      await memberPage.setViewportSize({ width: 390, height: 844 });
      assert.equal((await memberContext.request.get(origin + '/api/editor/draft')).status(), 403);
      assert.equal((await memberContext.request.get(origin + '/api/logs')).status(), 200);
      await page.locator('#users-link').click();
      await page.getByRole('heading', { name: 'ผู้ใช้และสิทธิ์', exact: true }).waitFor();
      await page.locator('#pending-count').filter({ hasText: '1' }).waitFor();
      await page.screenshot({ path: 'output/users-desktop.png', fullPage: true });
      await page.getByRole('button', { name: 'ตรวจและอนุมัติ' }).click();
      await page.screenshot({ path: 'output/users-permissions.png', fullPage: true });
      await page.locator('#save-user').click();
      await page.locator('#toast').filter({ hasText: 'อนุมัติแล้ว' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/users-mobile.png', fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.setViewportSize({ width: 1440, height: 960 });
      await memberPage.bringToFront();
      await memberPage.locator('#studio').waitFor({ state: 'visible' });
      assert.equal(await memberPage.locator('#users-link').isVisible(), false);
      assert.equal(await memberPage.locator('#logs-link').isVisible(), true);
      assert.equal(await memberPage.locator('#publish').isDisabled(), true);
      const memberCookie = (await memberContext.cookies()).find((c) =>
        c.name.endsWith('_studio_session'),
      );
      assert.equal((await memberContext.request.get(origin + '/api/users')).status(), 403);
      await page.getByRole('button', { name: 'จัดการสิทธิ์' }).click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#delete-user').click();
      await page.locator('#toast').filter({ hasText: 'ลบผู้ใช้' }).waitFor();
      assert.equal(
        (
          await memberContext.request.get(origin + '/api/editor/draft', {
            headers: { cookie: memberCookie.name + '=' + memberCookie.value },
          })
        ).status(),
        403,
      );
      await memberPage.bringToFront();
      await memberPage.waitForURL(origin + '/pending');
      await memberPage.getByRole('heading', { name: 'คุณถูกนำออกจากทีม', exact: true }).waitFor();
      await memberPage.screenshot({ path: 'output/removed-mobile.png', fullPage: true });
      await memberPage.locator('#request-access').click();
      await memberPage.getByRole('heading', { name: 'รออนุมัติจากผู้ดูแล', exact: true }).waitFor();
      assert.equal(await memberPage.locator('#request-access').isVisible(), false);
      assert.equal((await memberContext.request.get(origin + '/api/editor/draft')).status(), 403);
      await page.locator('#reload').click();
      await page.getByRole('button', { name: 'ตรวจและอนุมัติ' }).click();
      await page.locator('#save-user').click();
      await page.locator('#toast').filter({ hasText: 'อนุมัติแล้ว' }).waitFor();
      await memberPage.bringToFront();
      await memberPage.locator('#studio').waitFor({ state: 'visible' });
      await memberPage.locator('#logs-link').click();
      await memberPage.locator('#log-table').waitFor({ state: 'visible' });
      assert.equal(await memberPage.locator('#manage-users').isVisible(), false);
      await memberContext.close();
      await page.goto(origin + '/');
      await page.locator('#studio').waitFor({ state: 'visible' });
      await page.locator('#logs-link').click();
      await page.getByRole('heading', { name: 'ประวัติการใช้งาน', exact: true }).waitFor();
      await page.locator('#log-table').waitFor({ state: 'visible' });
      await page.locator('#category').selectOption('users');
      await page.locator('#apply').click();
      await page.locator('#list-status').filter({ hasText: 'รายการ' }).waitFor();
      await page
        .locator('#log-list tr')
        .filter({ hasText: 'ลบสมาชิก' })
        .getByRole('button')
        .click();
      await page.locator('#log-dialog[open]').waitFor();
      assert.ok(
        (await page.locator('#log-detail').innerText()).includes('member-browser@example.test'),
      );
      await page.screenshot({ path: 'output/logs-detail.png', fullPage: true });
      await page.locator('#close-dialog').click();
      await page.screenshot({ path: 'output/logs-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/logs-mobile.png', fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('#search').fill('not-found@example.test');
      await page.locator('#apply').click();
      await page.locator('#empty-state').waitFor({ state: 'visible' });
      await page.route('**/api/logs?**', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'โหลดประวัติไม่สำเร็จ ทดสอบการลองใหม่' }),
        }),
      );
      await page.locator('#reload').click();
      await page.locator('#log-error').filter({ hasText: 'ลองใหม่' }).waitFor();
      await page.unroute('**/api/logs?**');
      await page.locator('#search').fill('');
      await page.locator('#category').selectOption('');
      await page.locator('#apply').click();
      await page.locator('#log-table').waitFor({ state: 'visible' });
      await page.goto(origin + '/');
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('#studio').waitFor({ state: 'visible' });
      const markupName = '<img src=x onerror=alert(1)> Log test';
      const markupContext = await browser.newContext();
      const registration = await markupContext.request.post(origin + '/api/auth/register', {
        headers: { origin, 'x-editor-request': '1' },
        data: {
          name: markupName,
          email: 'log-markup@example.test',
          password: 'Markup-log-test-password-2026',
        },
      });
      assert.equal(registration.status(), 201);
      await markupContext.close();
      await page.locator('#logs-link').click();
      await page.locator('#log-list').getByText(markupName, { exact: true }).first().waitFor();
      assert.equal(
        await page.locator('#log-list img').count(),
        0,
        'log actor names are plain text',
      );
      await page.goto(origin + '/');
      await page.locator('#studio').waitFor({ state: 'visible' });
      // A failed logout request must not discard the editor or the session.
      await page.route('**/api/auth/logout', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'ลองใหม่อีกครั้ง' }),
        }),
      );
      await page.locator('#logout').click();
      await page.locator('#toast').filter({ hasText: 'ลองใหม่อีกครั้ง' }).waitFor();
      assert.equal((await context.request.get(origin + '/api/editor/draft')).status(), 200);
      await page.unroute('**/api/auth/logout');
      await page.locator('#logout').click();
      await page.waitForURL(origin + '/login');
      await page.getByRole('heading', { name: 'เข้าสู่ระบบ', exact: true }).waitFor();
      assert.equal((await context.request.get(origin + '/api/editor/draft')).status(), 401);
      const replay = await context.request.get(origin + '/api/editor/draft', {
        headers: { cookie: cookie.name + '=' + cookie.value },
      });
      assert.equal(replay.status(), 401);
      await page.screenshot({ path: 'output/login-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/login-mobile.png', fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('#email').fill(credentials.email);
      await page.locator('#password').fill('wrong-password');
      await page.locator('#toggle-password').click();
      assert.equal(await page.locator('#password').getAttribute('type'), 'text');
      await page.locator('#submit').click();
      await page.getByRole('alert').filter({ hasText: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }).waitFor();
      await page.locator('#password').fill(credentials.password);
      await page.locator('#submit').click();
      await page.locator('#studio').waitFor({ state: 'visible' });
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser?.close();
      server.kill();
    }
  },
);
