import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { fixture } from './auth-fixture.mjs';

test('admin preview retains Next scripts, uses admin styles and strips legacy renderers', async (t) => {
  const f = fixture('https://admin.test');
  t.after(() => f.sql.close());
  f.env.ADMIN_SETUP_TOKEN = 'preview-test-setup-token';
  const setup = await f.post('/api/auth/setup', {
    email: 'admin@example.test',
    password: 'preview-password-2026',
    setupToken: f.env.ADMIN_SETUP_TOKEN,
  });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  let seen;
  const env = {
    ...f.env,
    SITE_ORIGIN: 'https://site.test',
    SITE_SERVICE: {
      async fetch(request) {
        seen = request;
        return new Response(
          '<!doctype html><html><head><title>Site</title><link rel="stylesheet" href="content-runtime.css"></head><body><script src="app.js"></script><script src="content-runtime.js"></script></body></html>',
          {
            headers: { 'content-type': 'text/html', etag: 'stale' },
          },
        );
      },
    },
    ASSETS: {
      fetch() {
        return new Response('admin');
      },
    },
  };
  assert.equal(
    await (
      await worker.fetch(new Request('https://admin.test/', { headers: { cookie } }), env)
    ).text(),
    'admin',
  );
  const preview = await worker.fetch(
    new Request('https://admin.test/preview/?editor-preview=1', {
      headers: { cookie, 'oai-authenticated-user-email': 'owner@example.test' },
    }),
    env,
  );
  assert.equal(seen.url, 'https://site.test/?editor-preview=1');
  assert.equal([...seen.headers].length, 0);
  const html = await preview.text();
  assert.ok(html.includes('<base href="/preview/">'));
  assert.ok(html.includes('src="app.js"'));
  assert.ok(html.includes('href="/preview-runtime.css"'));
  assert.ok(
    !html.includes('src="/preview-runtime.js"'),
    'React mounts the renderer after hydration',
  );
  assert.ok(!html.includes('content-runtime.js'));
  assert.ok(!html.includes('content-runtime.css'));
  assert.equal(preview.headers.get('etag'), null);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  const link = await worker.fetch(new Request('https://admin.test/site/'), env);
  assert.equal(link.headers.get('location'), 'https://site.test/');
  assert.equal(
    (
      await worker.fetch(
        new Request('https://admin.test/preview/api/editor/draft', { headers: { cookie } }),
        env,
      )
    ).status,
    404,
  );
});

test('preview errors are handled and writes are rejected', async (t) => {
  const f = fixture('https://admin.test');
  t.after(() => f.sql.close());
  f.env.ADMIN_SETUP_TOKEN = 'preview-test-setup-token';
  const setup = await f.post('/api/auth/setup', {
    email: 'admin@example.test',
    password: 'preview-password-2026',
    setupToken: f.env.ADMIN_SETUP_TOKEN,
  });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await worker.fetch(new Request('https://admin.test/preview/', { headers: { cookie } }), f.env))
      .status,
    503,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://admin.test/preview/', { method: 'POST', headers: { cookie } }),
        f.env,
      )
    ).status,
    405,
  );
});

test('Next preview proxies dev fonts and authenticated stack lookups without identity headers', async (t) => {
  const f = fixture('http://127.0.0.1:4321');
  t.after(() => f.sql.close());
  const cookie = await f.setup();
  const requests = [];
  const env = {
    ...f.env,
    SITE_ORIGIN: 'https://site.test',
    SITE_SERVICE: {
      async fetch(request) {
        requests.push({
          url: request.url,
          method: request.method,
          headers: [...request.headers],
          body: await request.text(),
        });
        return new Response('upstream');
      },
    },
  };
  const font = await worker.fetch(
    new Request('https://admin.test/__nextjs_font/geist-latin.woff2', {
      headers: {
        cookie,
        authorization: 'Bearer private',
        'oai-authenticated-user-email': 'owner@example.test',
      },
    }),
    env,
  );
  assert.equal(await font.text(), 'upstream');
  assert.deepEqual(requests[0], {
    url: 'https://site.test/__nextjs_font/geist-latin.woff2',
    method: 'GET',
    headers: [],
    body: '',
  });
  const endpoint = 'https://admin.test/__nextjs_original-stack-frames';
  const body = JSON.stringify({ frames: [], isAppDirectory: true });
  const stack = await worker.fetch(
    new Request(endpoint, {
      method: 'POST',
      body,
      headers: { origin: 'https://admin.test', cookie, authorization: 'Bearer private' },
    }),
    env,
  );
  assert.equal(await stack.text(), 'upstream');
  assert.deepEqual(requests[1], {
    url: 'https://site.test/__nextjs_original-stack-frames',
    method: 'POST',
    headers: [['content-type', 'application/json']],
    body,
  });
  assert.equal((await worker.fetch(new Request(endpoint), env)).status, 405);
  assert.equal(
    (await worker.fetch(new Request(endpoint, { method: 'POST', body }), env)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(endpoint, {
          method: 'POST',
          body,
          headers: { origin: 'https://other.test', cookie, 'x-editor-request': '1' },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(requests.length, 2);
  const flight = await worker.fetch(
    new Request('https://admin.test/contact?_rsc=test', {
      headers: { cookie, rsc: '1', 'next-router-prefetch': '1', authorization: 'Bearer private' },
    }),
    env,
  );
  assert.equal(await flight.text(), 'upstream');
  assert.deepEqual(requests[2], {
    url: 'https://site.test/contact?_rsc=test',
    method: 'GET',
    headers: [
      ['next-router-prefetch', '1'],
      ['rsc', '1'],
    ],
    body: '',
  });
});
