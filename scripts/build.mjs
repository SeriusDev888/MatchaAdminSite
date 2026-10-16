import { mkdir, cp, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { prepareVercel } from './build-vercel.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
if (dirname(output) !== root || !output.endsWith('dist'))
  throw new Error('Invalid build directory');
// Preserve watched directories so rebuilding while Wrangler runs does not invalidate its watchers.
for (const dir of ['client', 'server', 'renderer', '.openai'])
  await mkdir(resolve(output, dir), { recursive: true });
const files = JSON.parse(await readFile(resolve(root, 'scripts/frontend-files.json'), 'utf8'));
const expected = new Set([
  ...Object.keys(files),
  'sticker-library.js',
  'site-config.js',
  'preview-runtime.js',
]);
try {
  for (const file of await readdir(resolve(root, 'public'))) expected.add(file);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Remove obsolete generated bundles, including admin files from the old combined build.
for (const file of await readdir(resolve(output, 'client'), { withFileTypes: true })) {
  if (file.isFile() && !expected.has(file.name)) await rm(resolve(output, 'client', file.name));
}
try {
  await cp(resolve(root, 'public'), resolve(output, 'client'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const [filename, source] of Object.entries(files)) {
  await copyFile(resolve(root, source), resolve(output, 'client', filename));
}
const defaults = JSON.parse(
  await readFile(resolve(root, 'src/shared/matcha-defaults.json'), 'utf8'),
);
const icons = JSON.parse(await readFile(resolve(root, 'src/shared/base-icons.json'), 'utf8'));
const iconLicense = await readFile(resolve(root, 'public/assets/licenses/lucide.txt'), 'utf8');
await writeFile(
  resolve(output, 'client/site-config.js'),
  `window.SiteDefaults = { isProductRoute: route => route === 'products' || route.startsWith('product/'), products: ${JSON.stringify(defaults.catalog)}, icons: ${JSON.stringify(icons)} };\n`,
);
await build({
  entryPoints: [resolve(root, 'src/preview/matcha-runtime.js')],
  outfile: resolve(output, 'client/preview-runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  banner: { js: '/*! Lucide icons\n' + iconLicense.replaceAll('*/', '* /') + '\n*/' },
});
await copyFile(
  resolve(output, 'client/preview-runtime.js'),
  resolve(output, 'renderer/matcha-studio-runtime.js'),
);
await copyFile(
  resolve(root, 'src/styles/preview/preview-runtime.css'),
  resolve(output, 'renderer/matcha-studio-runtime.css'),
);
const stickers = await readFile(resolve(root, 'src/shared/sticker-library.json'), 'utf8');
await writeFile(
  resolve(output, 'client/sticker-library.js'),
  `// Lucide icons, ISC license: assets/licenses/lucide.txt\nwindow.StickerLibrary = ${stickers};\nObject.assign(SiteDefaults.icons, Object.fromEntries(Object.entries(StickerLibrary).map(([key, item]) => [key, item.path])));\n`,
);
await build({
  entryPoints: [resolve(root, 'worker/index.js')],
  outfile: resolve(output, 'server/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
await copyFile(resolve(root, '.openai/hosting.json'), resolve(output, '.openai/hosting.json'));
await copyFile(resolve(root, 'wrangler.json'), resolve(output, 'server/wrangler.json'));
await prepareVercel({ admin: true });
console.log(`Built ${JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name}`);
