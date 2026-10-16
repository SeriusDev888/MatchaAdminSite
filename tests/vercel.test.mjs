import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHandler, assets } from '../platform/vercel.js';

import { vercelFixture } from './vercel-fixture.mjs';

test('Vercel keeps private HTML behind auth and retains Supabase sessions, drafts and publication', async (t) => {
  const f = await vercelFixture(t);
  const staticFiles = await readdir(resolve('dist/vercel-public'));
  assert.ok(
    !staticFiles.some((name) => name.endsWith('.html')),
    'private HTML must not enter Vercel static output',
  );
  for (const path of ['/', '/editor.html', '/index.html', '/preview/', '/users', '/logs']) {
    const response = await f.request(path);
    assert.ok([302, 303, 401].includes(response.status), path);
  }
  assert.equal((await f.request('/login')).status, 200);
  for (const path of [
    '/%65ditor.html',
    '/%2565ditor.html',
    '/EDITOR.HTML',
    '/editor.html/',
    '/%75sers.html',
  ])
    assert.equal(
      (await f.request(path)).status,
      404,
      'no encoded or noncanonical private HTML: ' + path,
    );
  const setup = await f.post('/api/auth/setup', {
    email: 'vercel@example.test',
    password: 'Vercel-test-password-2026',
    setupToken: f.env.ADMIN_SETUP_TOKEN,
  });
  assert.equal(setup.status, 200, await setup.clone().text());
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.match(setup.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict.*Secure/);
  const root = await f.request('/', { headers: { cookie } });
  assert.equal(root.status, 200);
  assert.match(await root.text(), /id="studio"/);
  const draft = await (await f.request('/api/editor/draft', { headers: { cookie } })).json();
  draft.document.theme.accent = '#124578';
  const save = await f.request('/api/editor/draft', {
    method: 'PUT',
    headers: {
      origin: 'https://admin.test',
      cookie,
      'x-editor-request': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ document: draft.document, revision: draft.revision }),
  });
  assert.equal(save.status, 200, await save.clone().text());
  assert.notEqual(
    (await (await f.request('/api/content')).json()).document.theme.accent,
    '#124578',
  );
  const published = await f.post(
    '/api/editor/publish',
    { revision: (await save.json()).revision, publishedRevision: draft.publishedRevision },
    cookie,
  );
  assert.equal(published.status, 200, await published.clone().text());
  assert.equal((await (await f.request('/api/content')).json()).document.theme.accent, '#124578');
  assert.equal((await f.request('/logs', { headers: { cookie } })).status, 200);
  assert.equal((await f.request('/users', { headers: { cookie } })).status, 200);
  const blocked = createHandler(
    {},
    { admin: true, environment: () => ({ STUDIO_DATABASE: 'local' }) },
  );
  assert.equal((await blocked.fetch(new Request('https://admin.test/'))).status, 503);
});

test('Vercel removes stale compression headers from decoded upstream preview responses', async () => {
  const handler = createHandler({
    fetch: () =>
      new Response('decoded script', {
        headers: {
          'content-encoding': 'gzip',
          'content-length': '999',
          'transfer-encoding': 'chunked',
        },
      }),
  });
  const response = await handler.fetch(new Request('https://admin.test/script.js'));
  assert.equal(await response.text(), 'decoded script');
  for (const name of ['content-encoding', 'content-length', 'transfer-encoding'])
    assert.equal(response.headers.get(name), null);
});

test('Vercel rate limits use its forwarded IP instead of caller-supplied Cloudflare headers', async () => {
  const handler = createHandler({
    fetch(request) {
      assert.equal(request.headers.get('cf-connecting-ip'), '198.51.100.9');
      return new Response('ok');
    },
  });
  assert.equal(
    (
      await handler.fetch(
        new Request('https://admin.test/', {
          headers: { 'cf-connecting-ip': 'spoofed', 'x-forwarded-for': '198.51.100.9' },
        }),
      )
    ).status,
    200,
  );
});

test('Vercel direct uploads retain 10 MB support, verify actual bytes, reject tampering and log completion once', async (t) => {
  const f = await vercelFixture(t);
  const setup = await f.post('/api/auth/setup', {
    email: 'upload@example.test',
    password: 'Vercel-test-password-2026',
    setupToken: f.env.ADMIN_SETUP_TOKEN,
  });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const image = new Uint8Array(6 * 1024 * 1024);
  image.set([137, 80, 78, 71]);
  const pdf = new Uint8Array(10 * 1024 * 1024);
  pdf.set(new TextEncoder().encode('%PDF-1.7'));
  pdf.set(new TextEncoder().encode('%%EOF'), pdf.length - 5);
  for (const [kind, mime, bytes] of [
    ['image', 'image/png', image],
    ['pdf', 'application/pdf', pdf],
  ]) {
    const metadata = { kind, mime, filename: kind + '-ทดสอบ', size: bytes.length };
    assert.equal((await f.post('/api/editor/uploads', metadata)).status, 401);
    const prepared = await f.post('/api/editor/uploads', metadata, cookie);
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const grant = await prepared.json();
    assert.equal(grant.mode, 'direct');
    assert.ok(!JSON.stringify(grant).includes(f.env.SUPABASE_SECRET_KEY));
    assert.equal(
      (await f.post('/api/editor/uploads/complete', { ticket: grant.ticket + 'bad' }, cookie))
        .status,
      400,
    );
    await fetch(grant.uploadUrl, { method: 'PUT', headers: { 'content-type': mime }, body: bytes });
    const complete = await f.post('/api/editor/uploads/complete', { ticket: grant.ticket }, cookie);
    assert.equal(complete.status, 201, await complete.clone().text());
    const media = await complete.json();
    assert.equal(
      (await f.post('/api/editor/uploads/complete', { ticket: grant.ticket }, cookie)).status,
      200,
    );
    const download = await f.request(media.url);
    assert.equal(download.status, 302);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.ok(
      download.headers.get('location').startsWith(f.env.SUPABASE_URL + '/storage/v1/object/sign/'),
    );
    if (kind === 'pdf')
      assert.ok(new URL(download.headers.get('location')).searchParams.get('download'));
    const logs = await f.pg.query(
      'SELECT count(*)::int AS n FROM studio_audit_logs WHERE action=$1',
      [kind === 'pdf' ? 'media.document' : 'media.upload'],
    );
    assert.equal(logs.rows[0].n, 1);
  }
  assert.equal(
    (
      await f.post(
        '/api/editor/uploads',
        { kind: 'image', mime: 'image/svg+xml', filename: 'bad.svg', size: 20 },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.post(
        '/api/editor/uploads',
        { kind: 'image', mime: 'image/png', filename: 'large.png', size: pdf.length + 1 },
        cookie,
      )
    ).status,
    400,
  );
  const invalid = await (
    await f.post(
      '/api/editor/uploads',
      { kind: 'image', mime: 'image/png', filename: 'fake.png', size: 7 },
      cookie,
    )
  ).json();
  await fetch(invalid.uploadUrl, {
    method: 'PUT',
    headers: {},
    body: new TextEncoder().encode('<html/>'),
  });
  assert.equal(
    (await f.post('/api/editor/uploads/complete', { ticket: invalid.ticket }, cookie)).status,
    400,
  );
  assert.equal(f.stored.size, 2, 'invalid objects are removed without touching completed uploads');
  const fileService = assets(resolve('dist/client'));
  assert.equal(
    (await fileService.fetch(new Request('https://admin.test/%2e%2e%2f.env'))).status,
    404,
  );
});
