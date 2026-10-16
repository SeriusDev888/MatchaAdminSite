import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './auth-fixture.mjs';
import { auditScenario } from './audit-scenarios.mjs';

test('activity logs record successful actions atomically, remain private and preserve deleted actors', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  await auditScenario(f);
});

test('missing local log schema returns an actionable error', async (t) => {
  const f = fixture();
  t.after(() => f.sql.close());
  const cookie = await f.setup();
  f.sql.exec('DROP TABLE editor_audit_logs');
  const response = await f.fetch('/api/logs', { headers: { cookie } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'LOG_SCHEMA_REQUIRED');
});
