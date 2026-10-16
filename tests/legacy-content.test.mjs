import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacy } from '../scripts/import-legacy-content.mjs';
import { validateDocument } from '../worker/validation.js';

test('legacy import preserves brand, contact, page content and ordered catalog files', () => {
  const legacy = {
    brand_settings: [{ brand_name: 'Existing brand', logo_url: 'https://example.com/logo.png' }],
    contact_settings: [{ phone_number: '0812345678', map_latitude: '13.7' }],
    home_content: [{ hero: { mainTitle: 'Existing headline' }, regions: [] }],
    catalog_content: [
      {
        header: { title: 'Downloads' },
        product_catalog: { file: { fileUrl: 'https://example.com/main.pdf' } },
      },
    ],
    catalog_specifications: [
      { id: 2, title: 'Second', position: 2 },
      { id: 1, title: 'First', position: 1, file_url: 'https://example.com/spec.pdf' },
    ],
    products: [],
  };
  const before = structuredClone(legacy);
  const document = convertLegacy(legacy);
  assert.equal(document.brand.name, 'Existing brand');
  assert.equal(document.brand.logo, 'https://example.com/logo.png');
  assert.equal(document.contact.phoneNumber, '0812345678');
  assert.equal(document.content.home.hero.mainTitle, 'Existing headline');
  assert.equal(
    document.content.catalog.specifications[0].file.fileUrl,
    'https://example.com/spec.pdf',
  );
  assert.equal(
    document.catalog.length,
    3,
    'previous built-in products remain when legacy catalog was empty',
  );
  assert.deepEqual(legacy, before, 'conversion never modifies its source');
});

test('imported page content rejects executable URLs and missing containers', () => {
  const document = convertLegacy({});
  assert.throws(() =>
    validateDocument({ ...document, content: { home: { hero: {}, intro: {}, standards: {} } } }),
  );
  assert.throws(() =>
    convertLegacy({ home_content: [{ hero: { imageUrl: 'javascript:alert(1)' } }] }),
  );
  assert.throws(() => convertLegacy({ home_content: [{ hero: { mainTitle: {} } }] }));
  assert.throws(() => convertLegacy({ home_content: [{ regions: [null] }] }));
  assert.throws(() =>
    convertLegacy({
      catalog_content: [{ product_catalog: { file: { fileUrl: 'data:text/html,bad' } } }],
    }),
  );
});
