import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './auth-fixture.mjs';
import { googleScenario } from './google-scenarios.mjs';

test('Google verifies OIDC and PKCE, consumes state once and preserves the approval/rejoin gate', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  await googleScenario(f);
});
test('Google login is unavailable until configured and never bootstraps the first superadmin', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const disabled = await f.fetch('/api/auth/google/start');
  assert.equal(disabled.headers.get('location'), '/login?google_error=unavailable');
  Object.assign(f.env, {
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4321/api/auth/google/callback',
  });
  const noOwner = await f.fetch('/api/auth/google/start');
  assert.equal(noOwner.headers.get('location'), '/login?google_error=owner');
});
