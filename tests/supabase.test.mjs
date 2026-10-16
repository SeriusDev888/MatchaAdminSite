import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './auth-fixture.mjs';
import { membershipScenario } from './permission-scenarios.mjs';
import { database, objects } from '../worker/database.js';
import { auditScenario } from './audit-scenarios.mjs';
import { googleScenario } from './google-scenarios.mjs';

async function postgresFixture(t) {
  const pg = new PGlite();
  const f = fixture();
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    f.sql.close();
    await pg.close();
  });
  await pg.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);',
  );
  await pg.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await pg.exec(
    "INSERT INTO public.studio_state VALUES ('upgrade-check','preserve-existing-content',7,'2026-01-01T00:00:00.000Z','existing-owner')",
  );
  // The upgrade can be applied repeatedly without changing existing tables or content.
  const migration = readFileSync(
    new URL('../supabase/migrations/20261015_activity_logs.sql', import.meta.url),
    'utf8',
  );
  await pg.exec(migration);
  await pg.exec(migration);
  const membershipMigration = readFileSync(
    new URL('../supabase/migrations/20261015_google_membership.sql', import.meta.url),
    'utf8',
  );
  await pg.exec(membershipMigration);
  await pg.exec(membershipMigration);
  const preserved = await pg.query(
    "SELECT payload,revision FROM public.studio_state WHERE key='upgrade-check'",
  );
  assert.deepEqual(preserved.rows, [{ payload: 'preserve-existing-content', revision: 7 }]);
  await pg.exec('SET ROLE anon');
  await assert.rejects(
    pg.query("SELECT public.studio_api('users_list','{}')"),
    /permission denied/,
  );
  await assert.rejects(pg.query('SELECT * FROM public.studio_users'), /permission denied/);
  await assert.rejects(pg.query('SELECT * FROM public.studio_audit_logs'), /permission denied/);
  await pg.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(pg.query('SELECT * FROM public.studio_audit_logs'), /permission denied/);
  await assert.rejects(pg.query('DELETE FROM public.studio_audit_logs'), /permission denied/);
  await pg.exec('RESET ROLE');
  await pg.exec('SET ROLE service_role');
  Object.assign(f.env, {
    STUDIO_DATABASE: 'supabase',
    SUPABASE_URL: 'https://studio.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test_only',
  });
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('https://studio.example.test/storage/v1/object/'))
      return new Response('image');
    assert.equal(url, 'https://studio.example.test/rest/v1/rpc/studio_api');
    assert.equal(options.headers.apikey, 'sb_secret_test_only');
    assert.equal(
      options.redirect,
      'manual',
      'Worker supports manual redirects; credentials must not follow redirects',
    );
    assert.equal(options.headers.Authorization, undefined);
    const { operation, params } = JSON.parse(options.body);
    const result = await pg.query('SELECT public.studio_api($1,$2::jsonb) AS result', [
      operation,
      JSON.stringify(params),
    ]);
    return Response.json(result.rows[0].result);
  };
  return f;
}

test('Supabase SQL executes on PostgreSQL, denies browser roles and supports the complete membership workflow', async (t) => {
  await membershipScenario(await postgresFixture(t));
});

test('Supabase activity logs are atomic, private and survive member deletion', async (t) => {
  await auditScenario(await postgresFixture(t));
});
test('Supabase supports Google identity, pending approval and reapplication without escalating roles', async (t) => {
  await googleScenario(await postgresFixture(t));
});
test('Supabase configuration fails closed and Storage requests keep credentials on the server', async (t) => {
  await assert.rejects(database({ STUDIO_DATABASE: 'supabase' }, 'state', { key: 'published' }), {
    status: 503,
  });
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('image');
  };
  const env = {
    STUDIO_DATABASE: 'supabase',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test_only',
    SUPABASE_STORAGE_BUCKET: 'studio-media',
  };
  const storage = objects(env);
  await storage.put('editor/image-id', new Uint8Array([1]), {
    httpMetadata: { contentType: 'image/png' },
  });
  await storage.get('editor/image-id');
  await storage.delete('editor/image-id');
  assert.equal(calls[0].options.headers.apikey, 'sb_secret_test_only');
  assert.equal(calls[0].options.headers['content-type'], 'image/png');
  assert.equal(calls[2].url, 'https://project.example.test/storage/v1/object/studio-media');
  assert.deepEqual(JSON.parse(calls[2].options.body), { prefixes: ['editor/image-id'] });
  assert.ok(
    calls.every((call) => call.url.startsWith('https://project.example.test/storage/v1/object/')),
  );
});

test('Supabase redirects fail closed without forwarding database or storage credentials', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://other.example.test/' },
    });
  };
  const env = {
    STUDIO_DATABASE: 'supabase',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test_only',
  };
  await assert.rejects(database(env, 'state', { key: 'published' }), { status: 503 });
  const storage = objects(env);
  await assert.rejects(storage.get('editor/test'), { status: 503 });
  await assert.rejects(
    storage.put('editor/test', new Uint8Array([1]), { httpMetadata: { contentType: 'image/png' } }),
    { status: 503 },
  );
  await assert.rejects(storage.delete('editor/test'), { status: 503 });
  assert.equal(calls, 4, 'each operation makes one request and rejects the redirect');
});
