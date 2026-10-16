import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, base64url } from 'jose';
import { database } from '../worker/database.js';
const pair = await generateKeyPair('RS256');
const jwk = {
  ...(await exportJWK(pair.publicKey)),
  kid: 'google-test-key',
  alg: 'RS256',
  use: 'sig',
};

export async function googleScenario(f) {
  const adminCookie = await f.setup();
  Object.assign(f.env, {
    GOOGLE_CLIENT_ID: 'google-test-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'google-test-secret',
    GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4321/api/auth/google/callback',
  });
  const originalFetch = globalThis.fetch;
  let claims,
    transaction,
    exchanges = 0;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') {
      exchanges++;
      assert.equal(options.redirect, 'manual');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_secret'), f.env.GOOGLE_CLIENT_SECRET);
      const challenge = base64url.encode(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier'))),
      );
      assert.equal(challenge, transaction.target.searchParams.get('code_challenge'));
      let token = await new SignJWT({
        nonce: transaction.target.searchParams.get('nonce'),
        email: 'google-user@gmail.com',
        email_verified: true,
        name: 'Google applicant',
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setSubject(claims?.sub || 'google-subject-1')
        .setIssuer(claims?.iss || 'https://accounts.google.com')
        .setAudience(claims?.aud || f.env.GOOGLE_CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime(claims?.exp || '5m')
        .sign(pair.privateKey);
      if (claims?.badSignature) {
        const parts = token.split('.');
        parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
        token = parts.join('.');
      }
      return Response.json({ id_token: token, access_token: 'must-not-be-stored-or-logged' });
    }
    return originalFetch(input, options);
  };
  const read = (path, cookie = adminCookie) => f.fetch(path, { headers: { cookie } });
  async function begin() {
    const response = await f.fetch('/api/auth/google/start?next=https://attacker.example/');
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location'));
    assert.equal(target.origin, 'https://accounts.google.com');
    assert.equal(target.searchParams.get('scope'), 'openid email profile');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(target.searchParams.get('client_secret'), null);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    transaction = { target, cookie };
    return transaction;
  }
  const callback = (tx = transaction, cookie = tx.cookie) =>
    f.fetch(
      '/api/auth/google/callback?code=test-code&state=' +
        encodeURIComponent(tx.target.searchParams.get('state')),
      { headers: { cookie } },
    );
  const sessionCookie = (response) =>
    response.headers
      .getSetCookie()
      .find((value) => /^(matcha|supplement)_studio_session=/.test(value))
      ?.split(';')[0];
  try {
    await begin();
    const badCookie = await callback(transaction, 'other_brand_google=invalid');
    assert.match(badCookie.headers.get('location'), /google_error=state/);
    assert.equal(exchanges, 0);
    const created = await callback();
    assert.equal(created.headers.get('location'), '/pending');
    const cookie = sessionCookie(created);
    assert.ok(cookie);
    assert.ok(
      created.headers
        .getSetCookie()
        .some((value) => /_studio_session=/.test(value) && /SameSite=Lax/.test(value)),
      'Google session survives the provider redirect',
    );
    assert.match((await callback()).headers.get('location'), /google_error=state/);
    assert.equal(exchanges, 1, 'state is consumed once');
    let status = await (await read('/api/auth/status', cookie)).json();
    assert.equal(status.user.role, 'applicant');
    assert.equal(status.user.status, 'pending');
    assert.deepEqual(status.user.permissions, []);
    assert.equal((await read('/api/editor/draft', cookie)).status, 403);
    assert.equal((await read('/api/logs', cookie)).status, 200);
    const id = status.user.id;
    const users = await (await read('/api/users')).json();
    const user = users.users.find((user) => user.id === id);
    const change = (method, data) =>
      f.fetch('/api/users/' + id, {
        method,
        headers: {
          cookie: adminCookie,
          origin: 'http://127.0.0.1:4321',
          'x-editor-request': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    assert.equal(
      (
        await change('PATCH', {
          action: 'approve',
          revision: user.revision,
          permissions: ['content.edit'],
        })
      ).status,
      200,
    );
    await begin();
    const approvedLogin = await callback();
    assert.equal(approvedLogin.headers.get('location'), '/', 'external next URL is ignored');
    const activeCookie = sessionCookie(approvedLogin);
    assert.equal((await read('/api/editor/draft', activeCookie)).status, 200);
    status = await (await read('/api/auth/status', activeCookie)).json();
    assert.equal((await change('DELETE', { revision: status.user.revision })).status, 200);
    await begin();
    const removedLogin = await callback();
    assert.equal(removedLogin.headers.get('location'), '/pending');
    const removedCookie = sessionCookie(removedLogin);
    assert.equal((await f.post('/api/auth/request-access', {}, removedCookie)).status, 200);
    assert.equal((await read('/api/editor/draft', removedCookie)).status, 403);
    status = await (await read('/api/auth/status', removedCookie)).json();
    assert.equal(status.user.id, id, 'reapplication keeps the same identity');
    const native = {
      email: 'native@gmail.com',
      name: 'Existing password member',
      password: 'Native-test-password-2026',
    };
    assert.equal((await f.post('/api/auth/register', native)).status, 201);
    const nativeUser = (await (await read('/api/users')).json()).users.find(
      (user) => user.email === native.email,
    );
    assert.equal(
      (
        await f.fetch('/api/users/' + nativeUser.id, {
          method: 'PATCH',
          headers: {
            cookie: adminCookie,
            origin: 'http://127.0.0.1:4321',
            'x-editor-request': '1',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'approve',
            revision: nativeUser.revision,
            permissions: ['brand.edit'],
          }),
        })
      ).status,
      200,
    );
    claims = { sub: 'existing-password-google-sub', email: native.email };
    await begin();
    const linked = await callback();
    assert.equal(linked.headers.get('location'), '/');
    const linkedUser = await (await read('/api/auth/status', sessionCookie(linked))).json();
    assert.equal(linkedUser.user.id, nativeUser.id);
    assert.equal(linkedUser.user.role, 'admin');
    assert.deepEqual(linkedUser.user.permissions, ['brand.edit']);
    claims = { sub: 'external-email-not-authoritative', email: 'admin@example.test' };
    await begin();
    const blockedLink = await callback();
    assert.match(blockedLink.headers.get('location'), /google_error=link/);
    assert.equal(sessionCookie(blockedLink), undefined);
    // Reset the fixture's rate window so all token rejection cases exercise verification.
    const rateKey = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode('loopback')),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await database(f.env, 'auth_throttle', {
      key: rateKey,
      now: Math.floor(Date.now() / 1000) + 1000,
      reset: Math.floor(Date.now() / 1000) + 1900,
    });
    for (const invalid of [
      { nonce: 'wrong-nonce' },
      { aud: 'other-client' },
      { iss: 'https://evil.example' },
      { email_verified: false },
      { exp: 1 },
      { badSignature: true },
    ]) {
      await begin();
      claims = invalid;
      const rejected = await callback();
      assert.match(rejected.headers.get('location'), /google_error=/);
      assert.equal(sessionCookie(rejected), undefined);
    }
    claims = {};
    await begin();
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 601000;
      assert.match((await callback()).headers.get('location'), /google_error=state/);
    } finally {
      Date.now = originalNow;
    }
    const logs = await (await read('/api/logs')).json();
    assert.ok(logs.logs.some((log) => log.action === 'auth.google_register'));
    const text = JSON.stringify(logs);
    for (const secret of [
      'google-test-secret',
      'must-not-be-stored-or-logged',
      'code_verifier',
      'test-code',
    ])
      assert.ok(!text.includes(secret));
  } finally {
    globalThis.fetch = originalFetch;
  }
}
