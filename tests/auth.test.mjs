import test from 'node:test';
import assert from 'node:assert/strict';
import { owner, requireOwner } from '../worker/auth.js';
import { fixture, credentials } from './auth-fixture.mjs';

test('anonymous users cannot open editor aliases, previews or write APIs, including forged gateway identities', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  for (const path of ['/', '/index.html', '/editor.html', '/editor', '/index']) {
    const response = await f.fetch(path);
    assert.equal(response.status, 303, path);
    assert.match(response.headers.get('location'), /^\/login/);
  }
  for (const path of ['/api/editor/draft', '/preview/'])
    assert.equal((await f.fetch(path)).status, 401);
  const request = f.request('/api/editor/draft', {
    headers: {
      'oai-authenticated-user-id': 'owner',
      'oai-authenticated-user-email': 'owner@example.test',
    },
  });
  assert.equal(await owner(request, { ...f.env, LOCAL_ADMIN_ACCESS: 'true' }), null);
  await assert.rejects(requireOwner(request, f.env), { status: 401 });
  assert.equal((await (await f.fetch('/api/editor/session')).json()).canEdit, false);
});

test('first-time setup stores a salted password hash, starts an HttpOnly session and cannot replace the owner', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  assert.equal((await (await f.fetch('/api/auth/status')).json()).canSetup, true);
  assert.equal(
    (await f.post('/api/auth/setup', { ...credentials, password: 'short' })).status,
    400,
  );
  const response = await f.post('/api/auth/setup', credentials);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=28800/);
  assert.ok(!cookie.includes('; Secure'), 'loopback HTTP works');
  const row = f.sql.prepare('SELECT * FROM admin_users').get();
  assert.match(row.password_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(row.password_hash, credentials.password);
  assert.match(row.salt, /^[a-f0-9]{64}$/);
  const user = await requireOwner(f.request('/', { headers: { cookie } }), f.env);
  assert.equal(user.email, credentials.email);
  assert.equal((await f.fetch('/', { headers: { cookie } })).status, 200);
  assert.equal(
    (await f.post('/api/auth/setup', { ...credentials, email: 'takeover@example.test' })).status,
    409,
  );
  assert.equal((await f.fetch('/login', { headers: { cookie } })).status, 303);
});

test('login validates credentials, rotates sessions, rejects tampering and logout revokes replayed cookies', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const first = await f.setup();
  assert.equal(
    (await f.post('/api/auth/login', { ...credentials, password: 'incorrect' })).status,
    401,
  );
  assert.equal(
    (await f.post('/api/auth/login', { ...credentials, email: 'other@example.test' })).status,
    401,
  );
  const login = await f.post(
    '/api/auth/login',
    { ...credentials, email: ' ADMIN@example.test ' },
    first,
  );
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, first);
  assert.equal(await owner(f.request('/', { headers: { cookie: first } }), f.env), null);
  assert.equal(await owner(f.request('/', { headers: { cookie: cookie + 'a' } }), f.env), null);
  const logout = await f.post('/api/auth/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await owner(f.request('/', { headers: { cookie } }), f.env), null);
});

test('expired sessions are denied and cross-origin login, setup and logout are rejected', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const cookie = await f.setup();
  for (const path of ['/api/auth/login', '/api/auth/setup', '/api/auth/logout']) {
    assert.equal(
      (await f.post(path, credentials, cookie, { origin: 'https://evil.test' })).status,
      403,
    );
    assert.equal((await f.post(path, credentials, cookie, { 'x-editor-request': '' })).status, 403);
  }
  f.sql.exec('UPDATE admin_sessions SET expires_at=0');
  assert.equal(await owner(f.request('/', { headers: { cookie } }), f.env), null);
  assert.equal((await f.fetch('/api/editor/draft', { headers: { cookie } })).status, 401);
});

test('remote setup needs a secret, HTTPS cookies are Secure and insecure remote login is refused', async (t) => {
  const f = fixture('https://admin.example.test');
  t.after(() => f.sql.close());
  assert.equal((await (await f.fetch('/api/auth/status')).json()).canSetup, false);
  assert.equal((await f.post('/api/auth/setup', credentials)).status, 403);
  f.env.ADMIN_SETUP_TOKEN = 'test-setup-secret-with-32-characters';
  assert.equal(
    (await f.post('/api/auth/setup', { ...credentials, setupToken: 'wrong' })).status,
    403,
  );
  const response = await f.post('/api/auth/setup', {
    ...credentials,
    setupToken: f.env.ADMIN_SETUP_TOKEN,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  const insecure = fixture('http://admin.example.test');
  t.after(() => insecure.sql.close());
  assert.equal((await insecure.fetch('/api/auth/status')).status, 403);
});

test('repeated failed logins are throttled and the limit resets after its window', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  await f.setup();
  for (let i = 0; i < 9; i++)
    assert.equal(
      (await f.post('/api/auth/login', { ...credentials, password: 'wrong' })).status,
      401,
    );
  const response = await f.post('/api/auth/login', credentials);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  f.sql.exec('UPDATE admin_login_attempts SET reset_at=0');
  assert.equal((await f.post('/api/auth/login', credentials)).status, 200);
});

test('login pages are uncached, cannot be framed and do not affect public published content', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const login = await f.fetch('/login');
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
  assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await f.fetch('/api/content')).status, 200);
  assert.equal((await f.fetch('/api/auth/login')).status, 405);
});

test('local setup can be disabled and another Studio cookie cannot grant access', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  f.env.LOCAL_AUTH_SETUP = 'false';
  assert.equal((await f.post('/api/auth/setup', credentials)).status, 403);
  f.env.LOCAL_AUTH_SETUP = 'true';
  const cookie = await f.setup();
  const name = cookie.split('=')[0];
  const other = cookie.replace(
    name,
    name.startsWith('matcha') ? 'supplement_studio_session' : 'matcha_studio_session',
  );
  assert.equal(await owner(f.request('/', { headers: { cookie: other } }), f.env), null);
  assert.equal((await f.fetch('/api/editor/draft', { headers: { cookie: other } })).status, 401);
});
