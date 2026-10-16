import assert from 'node:assert/strict';
import { credentials } from './auth-fixture.mjs';
export async function membershipScenario(f) {
  const superCookie = await f.setup();
  const member = {
    email: 'member@example.test',
    password: 'Member-test-password-2026',
    name: 'Team member',
  };
  const headers = (cookie) => ({
    cookie,
    origin: 'http://127.0.0.1:4321',
    'x-editor-request': '1',
    'content-type': 'application/json',
  });
  const read = async (path, cookie) => f.fetch(path, { headers: { cookie } });
  const change = (id, body, cookie = superCookie, method = 'PATCH') =>
    f.fetch('/api/users/' + id, { method, headers: headers(cookie), body: JSON.stringify(body) });
  assert.equal((await f.post('/api/auth/register', member)).status, 201);
  const pendingLogin = await f.post('/api/auth/login', member);
  assert.equal(pendingLogin.status, 200);
  assert.equal((await pendingLogin.json()).accountStatus, 'pending');
  const pendingCookie = pendingLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await read('/api/editor/draft', pendingCookie)).status, 403);
  assert.equal((await read('/api/logs', pendingCookie)).status, 200);
  assert.equal((await read('/api/users', '')).status, 401);
  let data = await (await read('/api/users', superCookie)).json();
  let user = data.users.find((u) => u.email === member.email);
  assert.equal(user.status, 'pending');
  assert.equal(user.role, 'applicant');
  assert.deepEqual(user.permissions, []);
  assert.ok(!JSON.stringify(data).includes('password_hash'));
  assert.equal(
    (
      await change(user.id, {
        action: 'approve',
        permissions: ['content.edit'],
        revision: user.revision,
        role: 'superadmin',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await change(user.id, {
        action: 'approve',
        permissions: ['users.manage'],
        revision: user.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await change(user.id, {
        action: 'approve',
        permissions: ['content.edit'],
        revision: user.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await change(user.id, { action: 'approve', permissions: [], revision: user.revision })).status,
    409,
  );
  const loggedIn = await f.post('/api/auth/login', member);
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await read('/api/users', cookie)).status, 403);
  assert.equal((await read('/users', cookie)).status, 403);
  assert.equal(
    (
      await change(
        user.id,
        { action: 'update', permissions: ['content.publish'], revision: 1 },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.fetch('/api/users/superadmin', {
        method: 'DELETE',
        headers: headers(superCookie),
        body: '{"revision":0}',
      })
    ).status,
    403,
  );
  let draft = await (await read('/api/editor/draft', cookie)).json();
  const changed = structuredClone(draft.document);
  changed.pages.home = {
    nodes: { 'main/0': { text: 'Approved editor change' } },
    additions: [],
    order: {},
  };
  const save = await f.fetch('/api/editor/draft', {
    method: 'PUT',
    headers: headers(cookie),
    body: JSON.stringify({ document: changed, revision: draft.revision }),
  });
  assert.equal(save.status, 200, await save.clone().text());
  draft = await save.json();
  const brand = structuredClone(draft.document);
  brand.brand = { ...brand.brand, name: 'Not allowed' };
  assert.equal(
    (
      await f.fetch('/api/editor/draft', {
        method: 'PUT',
        headers: headers(cookie),
        body: JSON.stringify({ document: brand, revision: draft.revision }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.post(
        '/api/editor/publish',
        { revision: draft.revision, publishedRevision: 0 },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.post('/api/editor/restore', { id: 'any', revision: draft.revision }, cookie)).status,
    403,
  );
  assert.equal((await f.post('/api/editor/media', {}, cookie)).status, 403);
  data = await (await read('/api/users', superCookie)).json();
  user = data.users.find((u) => u.id === user.id);
  assert.equal(
    (
      await change(user.id, {
        action: 'update',
        permissions: ['content.publish'],
        revision: user.revision,
      })
    ).status,
    200,
  );
  // Permission changes apply to an already-issued cookie immediately.
  const next = structuredClone(draft.document);
  next.pages.home.nodes['main/0'].text = 'Revoked edit';
  assert.equal(
    (
      await f.fetch('/api/editor/draft', {
        method: 'PUT',
        headers: headers(cookie),
        body: JSON.stringify({ document: next, revision: draft.revision }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.post(
        '/api/editor/publish',
        { revision: draft.revision, publishedRevision: 0 },
        cookie,
      )
    ).status,
    200,
  );
  assert.deepEqual((await (await read('/api/content', '')).json()).document, draft.document);
  user = (await (await read('/api/users', superCookie)).json()).users.find((u) => u.id === user.id);
  assert.equal((await change(user.id, { action: 'suspend', revision: user.revision })).status, 200);
  assert.equal((await read('/api/editor/draft', cookie)).status, 403);
  const suspendedLogin = await f.post('/api/auth/login', member);
  assert.equal(suspendedLogin.status, 200);
  assert.equal((await suspendedLogin.json()).redirect, '/pending');
  user = (await (await read('/api/users', superCookie)).json()).users.find((u) => u.id === user.id);
  assert.equal(
    (await change(user.id, { action: 'reactivate', revision: user.revision })).status,
    200,
  );
  assert.equal(
    (await read('/api/editor/draft', cookie)).status,
    200,
    'reactivating a member restores approved access to their verified identity',
  );
  const renewed = await f.post('/api/auth/login', member);
  assert.equal(renewed.status, 200);
  const renewedCookie = renewed.headers.get('set-cookie').split(';')[0];
  user = (await (await read('/api/users', superCookie)).json()).users.find((u) => u.id === user.id);
  assert.equal(
    (await change(user.id, { revision: user.revision }, superCookie, 'DELETE')).status,
    200,
  );
  assert.equal((await read('/api/editor/draft', renewedCookie)).status, 403);
  assert.equal((await read('/', renewedCookie)).headers.get('location'), '/pending');
  assert.equal((await read('/pending', renewedCookie)).status, 200);
  assert.equal((await read('/api/logs', renewedCookie)).status, 200);
  const removed = await (await read('/api/auth/status', renewedCookie)).json();
  assert.equal(removed.user.status, 'removed');
  assert.deepEqual(removed.user.permissions, []);
  assert.equal(
    (
      await f.post(
        '/api/auth/request-access',
        { role: 'superadmin', permissions: ['content.publish'] },
        renewedCookie,
      )
    ).status,
    200,
  );
  assert.equal((await f.post('/api/auth/request-access', {}, renewedCookie)).status, 200);
  data = await (await read('/api/users', superCookie)).json();
  const reapplied = data.users.find((u) => u.id === user.id);
  assert.equal(reapplied.status, 'pending');
  assert.equal(reapplied.role, 'applicant');
  assert.deepEqual(reapplied.permissions, []);
  assert.equal((await read('/api/editor/draft', renewedCookie)).status, 403);
  assert.equal(
    (
      await change(user.id, {
        action: 'approve',
        revision: reapplied.revision,
        permissions: ['content.edit'],
      })
    ).status,
    200,
  );
  assert.equal((await read('/api/editor/draft', renewedCookie)).status, 200);
  assert.equal((await read('/api/users', superCookie)).status, 200);
  const owner = await f.post('/api/auth/login', credentials);
  assert.equal(owner.status, 200);
}
