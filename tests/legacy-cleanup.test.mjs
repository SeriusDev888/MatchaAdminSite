import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const cleanup = readFileSync(
  new URL('../supabase/maintenance/cleanup_legacy_cms.sql', import.meta.url),
  'utf8',
);
const legacy = [
  'about_content',
  'brand_settings',
  'catalog_content',
  'catalog_specifications',
  'contact_settings',
  'dashboard_drafts',
  'home_content',
  'product_sourcing',
  'product_tags',
  'products',
  'tags',
  'user_guide_content',
];
const retained = [
  'activity_logs',
  'content_settings',
  'pending_requests',
  'roles',
  'studio_members',
];
const active = [
  'studio_users',
  'studio_sessions',
  'studio_login_attempts',
  'studio_oauth_states',
  'studio_versions',
  'studio_media',
  'studio_audit_logs',
];

async function fixture(t, valid = true) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.studio_state(key text PRIMARY KEY,payload text);',
  );
  const content = Object.fromEntries(
    ['home', 'productSourcing', 'userGuide', 'about', 'catalog'].map((key) => [key, {}]),
  );
  const payload = JSON.stringify(valid ? { schema: 1, content } : { schema: 1 });
  for (const key of ['draft', 'published'])
    await pg.query('INSERT INTO public.studio_state VALUES($1,$2)', [key, payload]);
  for (const table of [...legacy, ...retained, ...active])
    await pg.exec(`CREATE TABLE public.${table}(id text PRIMARY KEY,value text)`);
  await pg.exec(
    "INSERT INTO public.products VALUES('product-1','preserve this row'); INSERT INTO public.tags VALUES('tag-1','tag'); ALTER TABLE public.product_tags ADD COLUMN product_id text REFERENCES public.products(id); INSERT INTO public.product_tags VALUES('link-1','link','product-1'); INSERT INTO public.studio_users VALUES('owner','keep owner'); INSERT INTO public.studio_members VALUES('old-member','keep old account');",
  );
  return pg;
}

test('cleanup privately copies legacy data, drops only the named tables and leaves Studio and old accounts intact', async (t) => {
  const pg = await fixture(t);
  await pg.exec(cleanup);
  assert.deepEqual((await pg.query('SELECT * FROM legacy_matcha_backup_20261015.products')).rows, [
    { id: 'product-1', value: 'preserve this row' },
  ]);
  for (const table of legacy)
    assert.equal(
      (await pg.query('SELECT to_regclass($1) AS name', ['public.' + table])).rows[0].name,
      null,
    );
  for (const table of [...retained, ...active, 'studio_state'])
    assert.notEqual(
      (await pg.query('SELECT to_regclass($1) AS name', ['public.' + table])).rows[0].name,
      null,
    );
  assert.equal(
    (await pg.query('SELECT count(*)::int AS count FROM public.studio_users')).rows[0].count,
    1,
  );
  await pg.exec('SET ROLE anon');
  await assert.rejects(
    pg.query('SELECT * FROM legacy_matcha_backup_20261015.products'),
    /permission denied/,
  );
});

test('cleanup refuses unmigrated content and nonempty drafts without removing tables', async (t) => {
  const pg = await fixture(t, false);
  await assert.rejects(pg.exec(cleanup), /Migrated Matcha/);
  await pg.exec('ROLLBACK');
  assert.equal(
    (await pg.query('SELECT count(*)::int AS count FROM public.products')).rows[0].count,
    1,
  );
  const payload = JSON.stringify({
    schema: 1,
    content: Object.fromEntries(
      ['home', 'productSourcing', 'userGuide', 'about', 'catalog'].map((key) => [key, {}]),
    ),
  });
  await pg.query('UPDATE public.studio_state SET payload=$1', [payload]);
  await pg.exec("INSERT INTO public.dashboard_drafts VALUES('draft','unreviewed data')");
  await assert.rejects(pg.exec(cleanup), /dashboard_drafts now contains data/);
  await pg.exec('ROLLBACK');
  assert.equal(
    (await pg.query('SELECT count(*)::int AS count FROM public.products')).rows[0].count,
    1,
  );
});

test('external dependencies abort the complete cleanup instead of cascading into other objects', async (t) => {
  const pg = await fixture(t);
  await pg.exec('CREATE VIEW public.external_product_report AS SELECT * FROM public.products');
  await assert.rejects(pg.exec(cleanup), /depend/);
  await pg.exec('ROLLBACK');
  assert.equal(
    (await pg.query('SELECT count(*)::int AS count FROM public.products')).rows[0].count,
    1,
  );
  assert.equal(
    (await pg.query("SELECT to_regnamespace('legacy_matcha_backup_20261015') AS name")).rows[0]
      .name,
    null,
  );
});
