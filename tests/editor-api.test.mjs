import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.STUDIO_TEST_ORIGIN || 'http://127.0.0.1:4321';
const owner = {};
const empty = { schema: 1, theme: {}, pages: {}, global: { nodes: {}, additions: [], order: {} } };
async function call(path, method = 'GET', body, headers = owner) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...headers,
      ...(method !== 'GET'
        ? { origin, 'x-editor-request': '1', 'content-type': 'application/json' }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test(
  'owner access, durable drafts, publication, version restore, conflicts and input validation',
  {
    skip:
      !process.env.STUDIO_TEST_EMAIL || !process.env.STUDIO_TEST_PASSWORD
        ? 'Set STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD for the test account'
        : false,
  },
  async () => {
    const login = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { origin, 'x-editor-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify({
        email: process.env.STUDIO_TEST_EMAIL,
        password: process.env.STUDIO_TEST_PASSWORD,
      }),
    });
    assert.equal(login.status, 200, await login.clone().text());
    owner.cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/editor/session', 'GET', undefined, {})).data.canEdit, false);
    assert.equal((await call('/api/editor/draft', 'GET', undefined, {})).status, 401);
    assert.equal(
      (
        await call('/api/editor/draft', 'GET', undefined, {
          'oai-authenticated-user-email': 'other@example.test',
        })
      ).status,
      401,
    );
    assert.equal((await call('/api/editor/session')).data.canEdit, true);
    let draft = (await call('/api/editor/draft')).data;
    const localSave = await call(
      '/api/editor/draft',
      'PUT',
      { document: draft.document, revision: draft.revision },
      owner,
    );
    assert.equal(localSave.status, 200);
    draft = localSave.data;
    const original = structuredClone(draft.document),
      pub = (await call('/api/content')).data;
    const changed = structuredClone(empty);
    changed.pages.guide = {
      nodes: { 'main/0': { text: 'integration draft', styles: { color: '#123456' } } },
      additions: [],
      order: {},
    };
    const rejected = await fetch(origin + '/api/editor/draft', {
      method: 'PUT',
      headers: {
        ...owner,
        origin: 'https://other.example',
        'x-editor-request': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ document: changed, revision: draft.revision }),
    });
    assert.equal(rejected.status, 403);
    let result = await call('/api/editor/draft', 'PUT', {
      document: changed,
      revision: draft.revision,
    });
    assert.equal(result.status, 200);
    const stale = draft.revision;
    draft = result.data;
    assert.deepEqual((await call('/api/editor/draft')).data.document, changed);
    assert.deepEqual(
      (await call('/api/content')).data.document,
      pub.document,
      'draft must not change publication',
    );
    assert.equal(
      (await call('/api/editor/draft', 'PUT', { document: empty, revision: stale })).status,
      409,
    );
    for (const patch of [
      { image: 'javascript:alert(1)' },
      { styles: { backgroundColor: 'red;display:none' } },
      { text: 'x'.repeat(20001) },
      { deleted: 'yes' },
      { offset: { x: 1001, y: 0 } },
      { mobileOffset: { x: null, y: 0 } },
    ]) {
      const invalid = structuredClone(changed);
      invalid.pages.guide.nodes['main/0'] = patch;
      assert.equal(
        (await call('/api/editor/draft', 'PUT', { document: invalid, revision: draft.revision }))
          .status,
        400,
      );
    }
    result = await call('/api/editor/publish', 'POST', {
      revision: draft.revision,
      publishedRevision: pub.revision,
    });
    assert.equal(result.status, 200);
    let publishedRevision = result.data.publishedRevision;
    assert.deepEqual((await call('/api/content')).data.document, changed);
    assert.equal(
      (await call('/api/editor/publish', 'POST', { revision: stale, publishedRevision })).status,
      409,
    );
    const versions = (await call('/api/editor/versions')).data.versions;
    assert.ok(versions.length);
    draft = (
      await call('/api/editor/draft', 'PUT', { document: original, revision: draft.revision })
    ).data;
    result = await call('/api/editor/restore', 'POST', {
      id: versions[0].id,
      revision: draft.revision,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.document, changed);
    draft = result.data;
    const upload = await fetch(origin + '/api/editor/media', {
      method: 'POST',
      headers: { ...owner, origin, 'x-editor-request': '1', 'x-file-name': 'test.png' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    assert.equal(upload.status, 201);
    const media = await upload.json();
    const image = await fetch(origin + media.url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await call('/api/editor/media')).data.media.some((m) => m.id === media.id));
    assert.equal(
      (
        await fetch(origin + '/api/editor/media', {
          method: 'POST',
          headers: { ...owner, origin, 'x-editor-request': '1' },
          body: '<svg onload="alert(1)"/>',
        })
      ).status,
      400,
    );
    // Restore local fixture to the original state after exercising actual SQLite and R2.
    draft = (
      await call('/api/editor/draft', 'PUT', { document: original, revision: draft.revision })
    ).data;
    result = await call('/api/editor/publish', 'POST', {
      revision: draft.revision,
      publishedRevision,
    });
    assert.equal(result.status, 200);
  },
);
