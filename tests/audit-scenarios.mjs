import assert from 'node:assert/strict';
import { database } from '../worker/database.js';
import { audit } from '../worker/audit.js';
import { credentials } from './auth-fixture.mjs';

export async function auditScenario(f) {
  const cookie = await f.setup();
  const read = (path = '/api/logs', session = cookie) =>
    f.fetch(path, { headers: { cookie: session } });
  const entries = async (path) => {
    const response = await read(path);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).logs;
  };
  const edit = (document, revision, session = cookie, extra = {}) =>
    f.fetch('/api/editor/draft', {
      method: 'PUT',
      headers: {
        cookie: session,
        origin: 'http://127.0.0.1:4321',
        'x-editor-request': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ document, revision, ...extra }),
    });
  const member = {
    email: 'audit-member@example.test',
    password: 'Audit-member-password-2026',
    name: '<img src=x onerror=alert(1)> ทีมงาน',
  };
  const userChange = (id, data, method = 'PATCH') =>
    f.fetch('/api/users/' + id, {
      method,
      headers: {
        cookie,
        origin: 'http://127.0.0.1:4321',
        'x-editor-request': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  assert.equal((await read('/api/logs', '')).status, 401);
  for (const path of ['/logs', '/logs/', '/logs.html']) {
    const response = await read(path, '');
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login?next=%2Flogs');
  }
  const page = await read('/logs');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await f.post('/api/logs', {}, cookie)).status, 405);
  assert.equal((await entries()).length, 2);
  assert.equal((await f.post('/api/auth/register', member)).status, 201);
  const users = await (await read('/api/users')).json();
  const target = users.users.find((user) => user.email === member.email);
  assert.equal(
    (
      await userChange(target.id, {
        action: 'approve',
        revision: 0,
        permissions: ['content.edit', 'media.upload'],
      })
    ).status,
    200,
  );
  const signedIn = await f.post('/api/auth/login', member);
  const memberCookie = signedIn.headers.get('set-cookie').split(';')[0];
  for (const path of ['/api/logs', '/logs', '/logs/', '/logs.html'])
    assert.equal((await read(path, memberCookie)).status, 200);
  const draft = await (await read('/api/editor/draft')).json();
  const document = structuredClone(draft.document);
  document.pages.home = { nodes: { 'main/h1': { text: 'Audit test heading' } } };
  const savedResponse = await edit(document, draft.revision, memberCookie, {
    audit: { actor_id: 'forged' },
  });
  assert.equal(savedResponse.status, 200);
  let saved = await savedResponse.json();
  const count = (await entries()).length;
  assert.equal((await edit(document, draft.revision)).status, 409);
  assert.equal(
    (
      await f.post(
        '/api/editor/publish',
        { revision: saved.revision, publishedRevision: draft.publishedRevision },
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await entries()).length,
    count,
    'rejected/conflicting actions never create success logs',
  );
  const publishedResponse = await f.post(
    '/api/editor/publish',
    { revision: saved.revision, publishedRevision: draft.publishedRevision },
    cookie,
  );
  assert.equal(publishedResponse.status, 200);
  const publication = await publishedResponse.json();
  const restore = await f.post(
    '/api/editor/restore',
    { id: publication.versionId, revision: saved.revision },
    cookie,
  );
  assert.equal(restore.status, 200);
  saved = await restore.json();
  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  f.env.BUCKET = { async put() {}, async delete() {} };
  // PostgreSQL scenarios mock the RPC; its object adapter needs a separate storage response.
  const originalMode = f.env.STUDIO_DATABASE;
  const put = async (path, bytes) =>
    f.fetch(path, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://127.0.0.1:4321',
        'x-editor-request': '1',
        'x-file-name': encodeURIComponent('test-เอกสาร'),
      },
      body: bytes,
    });
  // The scenario's optional storage mock is supplied by its PostgreSQL fixture.
  assert.equal((await put('/api/editor/media', png)).status, 201);
  assert.equal(
    (await put('/api/editor/documents', new TextEncoder().encode('%PDF-1.7\nTest\n%%EOF'))).status,
    201,
  );
  assert.equal(f.env.STUDIO_DATABASE, originalMode);
  assert.equal((await f.post('/api/auth/logout', {}, memberCookie)).status, 200);
  assert.equal(
    (await userChange(target.id, { action: 'update', revision: 1, permissions: [] })).status,
    200,
  );
  assert.equal((await userChange(target.id, { action: 'suspend', revision: 2 })).status, 200);
  assert.equal((await userChange(target.id, { action: 'reactivate', revision: 3 })).status, 200);
  assert.equal((await userChange(target.id, { revision: 4 }, 'DELETE')).status, 200);
  const logs = await entries();
  const actions = logs.map((row) => row.action);
  for (const action of [
    'auth.setup',
    'auth.register',
    'auth.login',
    'auth.logout',
    'content.save',
    'content.publish',
    'content.restore',
    'media.upload',
    'media.document',
    'users.approve',
    'users.update',
    'users.suspend',
    'users.reactivate',
    'users.delete',
  ])
    assert.ok(actions.includes(action), action);
  const change = logs.find((row) => row.action === 'content.save');
  assert.equal(
    change.actor_id,
    target.id,
    'the actor comes from the session, never the request body',
  );
  assert.equal(change.actor_email, member.email, 'actor snapshot remains after member deletion');
  assert.deepEqual(change.details.pages, ['home']);
  assert.ok(logs.find((row) => row.action === 'users.delete').details.targetEmail === member.email);
  const serialized = JSON.stringify(logs);
  for (const secret of [
    member.password,
    credentials.password,
    'password_hash',
    'salt',
    memberCookie.split('=')[1],
  ])
    assert.ok(!serialized.includes(secret), 'no credentials in logs');
  assert.ok(
    (await entries('/api/logs?category=users')).every((row) => row.action.startsWith('users.')),
  );
  assert.ok(
    (await entries('/api/logs?search=audit-member')).every(
      (row) => row.actor_email === member.email,
    ),
  );
  assert.equal((await entries('/api/logs?search=does-not-exist')).length, 0);
  const seen = [];
  let cursor;
  do {
    const response = await read(
      '/api/logs?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    seen.push(...data.logs.map((row) => row.id));
    cursor = data.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, logs.length);
  assert.equal(seen.length, logs.length, 'pagination has no missing or duplicate rows');
  for (const query of ['limit=0', 'limit=200', 'limit=bad', 'category=bad', 'cursor=bad'])
    assert.equal((await read('/api/logs?' + query)).status, 400);
  const actor = { id: 'superadmin', email: credentials.email, role: 'superadmin' };
  const beforeRollback = await (await read('/api/editor/draft')).json();
  const duplicate = { ...audit(actor, 'content.save', 'draft'), id: logs[0].id };
  await assert.rejects(
    database(f.env, 'draft_save', {
      payload: JSON.stringify({ ...document, theme: { accent: '#112233' } }),
      revision: saved.revision,
      now: new Date().toISOString(),
      user: actor.id,
      audit: duplicate,
    }),
  );
  const afterRollback = await (await read('/api/editor/draft')).json();
  assert.deepEqual(
    afterRollback,
    beforeRollback,
    'a failed log insert rolls back the content change',
  );
}
