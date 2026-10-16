// Run against this project's local fixtures, never against production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { chromium } = require('playwright');
const admin = process.env.STUDIO_TEST_ORIGIN || 'http://127.0.0.1:4321';
const site = process.env.STUDIO_TEST_SITE || 'http://127.0.0.1:3000';
let cookie = '';

async function api(path, method = 'GET', body) {
  const response = await fetch(admin + path, {
    method,
    headers: { origin: admin, 'x-editor-request': '1', 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

test(
  'Matcha Studio edits the real Next pages, keeps drafts private, and publishes to the website',
  {
    timeout: 180000,
    skip:
      !process.env.STUDIO_TEST_EMAIL || !process.env.STUDIO_TEST_PASSWORD
        ? 'Set STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD for the test account'
        : false,
  },
  async () => {
    const login = await fetch(admin + '/api/auth/login', {
      method: 'POST',
      headers: { origin: admin, 'x-editor-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify({
        email: process.env.STUDIO_TEST_EMAIL,
        password: process.env.STUDIO_TEST_PASSWORD,
      }),
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    const initialDraft = await api('/api/editor/draft');
    const initialPublished = await api('/api/content');
    const browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const [cookieName, cookieValue] = cookie.split('=');
    await context.addCookies([
      { name: cookieName, value: cookieValue, url: admin, httpOnly: true, sameSite: 'Strict' },
    ]);
    const errors = [];
    const page = await context.newPage();
    async function previewReady(route) {
      await page.waitForFunction((route) => {
        const frame = document.getElementById('preview');
        const path = route === 'home' ? '/preview/' : '/preview/' + route;
        try {
          return (
            frame.contentWindow.location.pathname === path &&
            frame.contentDocument.body.classList.contains('ve-editable') &&
            !!frame.contentDocument.querySelector('main h1[data-ve-id]')
          );
        } catch {
          return false;
        }
      }, route);
    }
    page.on('pageerror', (error) => errors.push(error.message));
    mkdirSync('output', { recursive: true });
    try {
      await page.goto(admin, { waitUntil: 'domcontentloaded' });
      await page.locator('#studio').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#page-select option').count(), 9);
      let frame = page.frameLocator('#preview');
      await previewReady('home');
      await frame.locator('body.ve-editable main h1[data-ve-id]').first().waitFor();
      await page.screenshot({ path: 'output/studio-desktop.png', fullPage: true });
      const heading = frame.locator('main h1').first();
      await heading.click();
      await page.locator('#text-value').waitFor({ state: 'visible' });
      const title = 'Matcha Studio — Browser verification';
      await page.locator('#text-value').fill(title);
      await heading.filter({ hasText: title }).waitFor();
      await page.locator('#save').click();
      await page.waitForFunction(() =>
        document.getElementById('save-state').textContent.includes('บันทึกฉบับร่างแล้ว'),
      );
      assert.ok(JSON.stringify((await api('/api/editor/draft')).document).includes(title));
      assert.ok(
        !JSON.stringify((await api('/api/content')).document).includes(title),
        'drafts stay private',
      );
      const publicDraftCheck = await context.newPage();
      await publicDraftCheck.goto(site, { waitUntil: 'domcontentloaded' });
      await publicDraftCheck.waitForFunction(() => !!window.MatchaStudioRuntime);
      assert.ok(
        !(await publicDraftCheck.locator('main h1').first().innerText()).includes(title),
        'saving a draft leaves the public heading unchanged',
      );
      await publicDraftCheck.close();
      await page.locator('#publish').click();
      await page.locator('#confirm-publish').click();
      await page.waitForFunction(() => !document.getElementById('publish-dialog').open);
      assert.ok(JSON.stringify((await api('/api/content')).document).includes(title));

      const live = await context.newPage();
      live.on('pageerror', (error) => errors.push(error.message));
      await live.goto(site, { waitUntil: 'domcontentloaded' });
      await live.locator('main h1').filter({ hasText: title }).waitFor();
      // Public Next navigation must keep working after applying visual changes.
      await live.locator('header a[href="/products"]').first().click();
      await live.waitForURL('**/products');
      await live.locator('section#ceremonial').waitFor();
      await live.close();

      await page.locator('[data-manager="products"]').first().click();
      await page.locator('#matcha-origin').fill('Uji · Browser verification');
      await page.locator('#matcha-origin').blur();
      assert.equal(
        (await page.evaluate(() => EditorAPI.document())).catalog[0].origin,
        'Uji · Browser verification',
      );
      await page.locator('#manager-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'output/studio-products.png', fullPage: true });
      await page.locator('#manager-back').click();
      await page.locator('#page-select').selectOption('products');
      await previewReady('products');
      frame = page.frameLocator('#preview');
      await frame
        .locator('section#ceremonial')
        .filter({ hasText: 'Uji · Browser verification' })
        .waitFor();
      await page.locator('#save').click();
      await page.waitForFunction(() =>
        document.getElementById('save-state').textContent.includes('บันทึกฉบับร่างแล้ว'),
      );

      for (const route of ['guide', 'about', 'catalog', 'contact']) {
        await page.locator('#page-select').selectOption(route);
        await previewReady(route);
        await page.waitForFunction(
          (route) => document.querySelector('#preview').src.includes('/preview/' + route + '?'),
          route,
        );
        await page
          .frameLocator('#preview')
          .locator('body.ve-editable main h1[data-ve-id]')
          .first()
          .waitFor();
      }
      await page.locator('[data-manager="contact"]').first().click();
      assert.ok(await page.locator('#contact-email').inputValue());
      await page.locator('#manager-back').click();
      await page.locator('#page-select').selectOption('home');
      await previewReady('home');
      await page
        .frameLocator('#preview')
        .locator('body.ve-editable main h1[data-ve-id]')
        .first()
        .waitFor();
      await page.locator('[data-width="390"]').click();
      await page.screenshot({ path: 'output/studio-mobile-preview.png', fullPage: true });
      // An intentionally empty catalog must never resurrect fallback products.
      let draft = await api('/api/editor/draft');
      const hidden = structuredClone(initialPublished.document);
      hidden.catalog = [];
      draft = await api('/api/editor/draft', 'PUT', { document: hidden, revision: draft.revision });
      await api('/api/editor/publish', 'POST', {
        revision: draft.revision,
        publishedRevision: (await api('/api/content')).revision,
      });
      const emptySite = await context.newPage();
      await emptySite.goto(site + '/products', { waitUntil: 'domcontentloaded' });
      await emptySite.waitForFunction(
        () =>
          typeof window.MatchaStudioRuntime === 'function' &&
          !!document.querySelector('main[data-ve-id]'),
      );
      assert.equal(
        await emptySite
          .locator('section#grade-a:visible,section#grade-b:visible,section#grade-c:visible')
          .count(),
        0,
      );
      await emptySite.goto(site, { waitUntil: 'domcontentloaded' });
      await emptySite.waitForFunction(
        () =>
          typeof window.MatchaStudioRuntime === 'function' &&
          !!document.querySelector('main[data-ve-id]'),
      );
      assert.equal(await emptySite.locator('main a[href^="/products#"]:visible').count(), 0);
      await emptySite.close();
      assert.deepEqual(errors, [], 'no JavaScript errors in editor, previews or public site');
    } catch (error) {
      console.error('Browser errors:', errors);
      console.error(
        'Preview:',
        await page
          .frameLocator('#preview')
          .locator('body')
          .innerText()
          .catch(() => 'No preview body'),
      );
      await page.screenshot({ path: 'output/studio-failure.png', fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await browser.close();
      // Restore local published content and draft exactly; revisions remain monotonic.
      let draft = await api('/api/editor/draft');
      draft = await api('/api/editor/draft', 'PUT', {
        document: initialPublished.document,
        revision: draft.revision,
      });
      const published = await api('/api/content');
      await api('/api/editor/publish', 'POST', {
        revision: draft.revision,
        publishedRevision: published.revision,
      });
      await api('/api/editor/draft', 'PUT', {
        document: initialDraft.document,
        revision: draft.revision,
      });
    }
  },
);
