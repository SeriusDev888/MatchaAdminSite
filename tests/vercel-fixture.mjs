import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { createHandler } from '../platform/vercel.js';
export async function vercelFixture(t, origin = 'https://admin.test') {
  const pg = new PGlite();
  await pg.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);',
  );
  await pg.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const originalFetch = globalThis.fetch,
    stored = new Map();
  const env = {
    STUDIO_DATABASE: 'supabase',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'test-only-vercel-credential',
    SUPABASE_STORAGE_BUCKET: 'studio-media',
    ADMIN_SETUP_TOKEN: 'test-vercel-setup-token-at-least-32-characters',
    LOCAL_AUTH_SETUP: 'true',
    SITE_ORIGIN: process.env.VERCEL_TEST_SITE || 'http://127.0.0.1:3000',
  };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== env.SUPABASE_URL) return originalFetch(input, options);
    if (url.pathname === '/rest/v1/rpc/studio_api') {
      assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
      const { operation, params } = JSON.parse(options.body);
      const result = await pg.query('SELECT public.studio_api($1,$2::jsonb) AS result', [
        operation,
        JSON.stringify(params),
      ]);
      return Response.json(result.rows[0].result);
    }
    const key = url.pathname.split('/editor/')[1];
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/')) {
      if (options.method === 'PUT') {
        assert.equal(url.searchParams.get('token'), 'upload-test-token');
        assert.equal(options.headers.apikey, undefined, 'the browser never needs a secret');
        if (stored.has(key)) return new Response('Already exists', { status: 409 });
        stored.set(key, new Uint8Array(await new Response(options.body).arrayBuffer()));
        return Response.json({ Key: 'studio-media/editor/' + key });
      }
      assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
      assert.notEqual(options.headers['x-upsert'], 'true');
      return Response.json({
        url: '/object/upload/sign/studio-media/editor/' + key + '?token=upload-test-token',
      });
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/'))
      return Response.json({
        signedURL: '/object/sign/studio-media/editor/' + key + '?token=read-test-token',
      });
    if (options.method === 'DELETE') {
      for (const key of JSON.parse(options.body).prefixes) stored.delete(key.split('/').pop());
      return Response.json({});
    }
    return stored.has(key) ? new Response(stored.get(key)) : new Response(null, { status: 404 });
  };
  const handler = createHandler(worker, { admin: true, environment: () => env });
  const request = (path, options = {}) => handler.fetch(new Request(origin + path, options));
  const post = (path, data, cookie = '') =>
    request(path, {
      method: 'POST',
      headers: { origin, cookie, 'x-editor-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await pg.close();
  });
  return { pg, handler, env, stored, request, post, originalFetch };
}
