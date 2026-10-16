import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database, supabase } from '../worker/database.js';
import { validateDocument } from '../worker/validation.js';
import defaults from '../src/shared/matcha-defaults.json' with { type: 'json' };

export const tables = [
  'brand_settings',
  'contact_settings',
  'home_content',
  'product_sourcing',
  'user_guide_content',
  'about_content',
  'catalog_content',
  'catalog_specifications',
  'products',
  'tags',
  'product_tags',
];

export function convertLegacy(legacy) {
  const document = {
    schema: 1,
    theme: {},
    pages: {},
    global: { nodes: {}, additions: [], order: {} },
    ...structuredClone(defaults),
    content: {},
  };
  const first = (table) => legacy[table]?.[0];
  const copy = (target, row, fields) => {
    for (const [source, destination] of Object.entries(fields)) {
      if (typeof row?.[source] === 'string' && row[source].trim())
        target[destination] = row[source];
    }
  };
  copy(document.brand, first('brand_settings'), {
    logo_url: 'logo',
    brand_name: 'name',
    loading_screen_message: 'tagline',
    footer_copyright: 'footerCopyright',
    footer_description: 'footerDescription',
  });
  copy(document.contact, first('contact_settings'), {
    email: 'email',
    phone_number: 'phoneNumber',
    line_oa_id: 'lineOaId',
    line_oa_url: 'lineOaUrl',
    available_time_description: 'availableTimeDescription',
    address_as_text: 'addressAsText',
    map_latitude: 'mapLatitude',
    map_longitude: 'mapLongitude',
    map_location_name: 'mapLocationName',
  });
  const home = first('home_content');
  if (home)
    document.content.home = {
      hero: home.hero || {},
      intro: home.intro || {},
      regions: home.regions || [],
      standards: home.standards || {},
    };
  const sourcing = first('product_sourcing');
  if (sourcing)
    document.content.productSourcing = {
      title: sourcing.title || '',
      badge: sourcing.badge || '',
      description: sourcing.description || '',
    };
  const guide = first('user_guide_content');
  if (guide)
    document.content.userGuide = {
      header: guide.header || {},
      steps: guide.steps || [],
      guide: guide.guide || {},
    };
  const about = first('about_content');
  if (about)
    document.content.about = {
      header: about.header || {},
      sourcing: about.sourcing || {},
      commitments: about.commitments || [],
      qualityControl: about.quality_control || { items: [] },
    };
  const catalog = first('catalog_content');
  if (catalog)
    document.content.catalog = {
      header: catalog.header || {},
      productCatalog: {
        ...catalog.product_catalog,
        file: catalog.product_catalog?.file || { fileName: '', fileUrl: '' },
      },
      specifications: [...(legacy.catalog_specifications || [])]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          id: String(item.id),
          title: item.title || '',
          description: item.description || '',
          file: { fileName: item.file_name || '', fileUrl: item.file_url || '' },
        })),
    };
  // Preserve the site's three built-in products when the previous CMS had no products.
  if (legacy.products?.length) {
    const ordered = [...legacy.products];
    const featured = home?.featured_product_ids || [];
    ordered.sort((a, b) => {
      const rank = (id) => (featured.includes(id) ? featured.indexOf(id) : featured.length);
      return rank(a.id) - rank(b.id);
    });
    document.catalog = ordered.map((item, index) => {
      const base = structuredClone(defaults.catalog[index % defaults.catalog.length]);
      const tagNames = (legacy.product_tags || [])
        .filter((link) => link.product_id === item.id)
        .map((link) => legacy.tags?.find((tag) => tag.id === link.tag_id)?.name)
        .filter(Boolean);
      return {
        ...base,
        id: `legacy-${item.id}`,
        name: item.title || base.name,
        description: item.description || '',
        image: item.image_url || '',
        origin: item.origin || '',
        cultivar: item.cultivar || '',
        harvestSeason: item.harvest_season || '',
        packagingDetails: item.packaging_details || [],
        tag: tagNames.join(', '),
        color: /^#[a-f0-9]{6}$/i.test(item.theme || '') ? item.theme : base.color,
      };
    });
  }
  return validateDocument(document);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.loadEnvFile(resolve(root, '.env'));
  if (process.env.STUDIO_DATABASE !== 'supabase')
    throw new Error('Import requires STUDIO_DATABASE=supabase');
  const env = process.env;
  const { origin, headers } = supabase(env);
  const legacy = Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        const response = await fetch(`${origin}/rest/v1/${table}?select=*`, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw new Error(`Could not read legacy table ${table}: ${response.status}`);
        return [table, await response.json()];
      }),
    ),
  );
  const studio = Object.fromEntries(
    await Promise.all(
      ['draft', 'published'].map(async (key) => [key, await database(env, 'state', { key })]),
    ),
  );
  const backupDir = resolve(root, '../.logs/matcha-studio-migration');
  await mkdir(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `before-import-${Date.now()}.json`);
  await writeFile(
    backupPath,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), sourceOrigin: origin, legacy, studio },
      null,
      2,
    ),
  );
  const document = convertLegacy(legacy);
  const summary = {
    backupPath,
    products: document.catalog.length,
    pages: Object.keys(document.content),
    existingStudio: Object.fromEntries(Object.entries(studio).map(([key, row]) => [key, !!row])),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!process.argv.includes('--apply'))
    return console.log('Dry run only. Use --apply to initialize empty Studio state.');
  if (studio.draft || studio.published)
    throw new Error('Studio already has content; import stopped without overwriting it');
  const payload = JSON.stringify(document);
  await database(env, 'seed', { payload, now: new Date().toISOString(), user: 'legacy-import' });
  for (const key of ['draft', 'published']) {
    const row = await database(env, 'state', { key });
    if (row?.payload !== payload)
      throw new Error(
        `Studio ${key} differs; a concurrent change may have occurred. Nothing was overwritten.`,
      );
  }
  console.log('Imported and verified draft + published. Legacy tables and storage were retained.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
