import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, credentials } from './auth-fixture.mjs';
import { membershipScenario } from './permission-scenarios.mjs';

test('registration, approval, permissions, suspension and removal are enforced by the API', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  await membershipScenario(f);
});
test('registration cannot bootstrap itself or grant privileges from submitted fields', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const member = {
    ...credentials,
    email: 'signup@example.test',
    name: 'New member',
    role: 'superadmin',
    status: 'active',
    permissions: ['content.publish'],
  };
  assert.equal((await f.post('/api/auth/register', member)).status, 403);
  const cookie = await f.setup();
  assert.equal((await f.post('/api/auth/register', member)).status, 201);
  assert.equal((await f.post('/api/auth/register', member)).status, 409);
  const users = (await (await f.fetch('/api/users', { headers: { cookie } })).json()).users;
  const user = users.find((u) => u.email === member.email);
  assert.equal(user.role, 'applicant');
  assert.equal(user.status, 'pending');
  assert.deepEqual(user.permissions, []);
  assert.equal(
    (
      await f.post('/api/auth/register', { ...member, email: 'csrf@example.test' }, '', {
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
});
test('old owner accounts and sessions migrate to superadmin without changing CMS data', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of ['0000_nebulous_blade.sql', '0001_admin_login.sql'])
      db.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
    db.exec(
      "INSERT INTO admin_account VALUES(1,'OWNER@example.test','hash','salt'); INSERT INTO admin_sessions VALUES('token',12345); INSERT INTO editor_state VALUES('published','{}',23,'time','owner');",
    );
    db.exec(readFileSync(new URL('../drizzle/0002_user_permissions.sql', import.meta.url), 'utf8'));
    for (const migration of [
      '0003_applicant_role.sql',
      '0004_activity_logs.sql',
      '0005_google_membership.sql',
    ])
      db.exec(readFileSync(new URL('../drizzle/' + migration, import.meta.url), 'utf8'));
    assert.equal(db.prepare('SELECT role FROM admin_users').get().role, 'superadmin');
    assert.equal(db.prepare('SELECT user_id FROM admin_sessions').get().user_id, 'superadmin');
    assert.equal(db.prepare('SELECT revision FROM editor_state').get().revision, 23);
    assert.equal(db.prepare('SELECT password_hash FROM admin_users').get().password_hash, 'hash');
    assert.equal(db.prepare('SELECT google_sub FROM admin_users').get().google_sub, null);
  } finally {
    db.close();
  }
});

test('removal refuses an old Supabase RPC before it can hard-delete an account', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const cookie = await f.setup();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  Object.assign(f.env, {
    STUDIO_DATABASE: 'supabase',
    SUPABASE_URL: 'https://old.example.test',
    SUPABASE_SECRET_KEY: 'test-secret',
  });
  let deleted = false;
  globalThis.fetch = async (_url, options) => {
    const { operation } = JSON.parse(options.body);
    if (operation === 'auth_session_user')
      return Response.json({
        value: { id: 'superadmin', role: 'superadmin', status: 'active', permissions: '[]' },
      });
    if (operation === 'users_get')
      return Response.json({
        value: { id: 'member', role: 'admin', status: 'active', permissions: '[]', revision: 0 },
      });
    if (operation === 'auth_features')
      return Response.json({ error: 'Unknown database operation', status: 400 });
    if (operation === 'users_delete') deleted = true;
    throw new Error('Unexpected operation: ' + operation);
  };
  const response = await f.fetch('/api/users/member', {
    method: 'DELETE',
    headers: {
      cookie,
      origin: 'http://127.0.0.1:4321',
      'x-editor-request': '1',
      'content-type': 'application/json',
    },
    body: '{"revision":0}',
  });
  assert.equal(response.status, 503);
  assert.equal(deleted, false);
});
