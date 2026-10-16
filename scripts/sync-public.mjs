// Explicit opt-in sync: building the admin never writes into another project.
import { copyFile, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const target = process.argv[2] || process.env.MATCHA_PUBLIC_SITE_DIR;
if (!target) {
  console.error('Usage: npm run sync:public -- <Golden-Ray-Matcha directory>');
  process.exit(1);
}
const siteRoot = await realpath(resolve(target));
const manifest = JSON.parse(await readFile(resolve(siteRoot, 'package.json'), 'utf8'));
if (manifest.name !== 'goldenray-matcha') throw new Error('Target must be the Golden Ray Matcha website');
const publicRoot = await realpath(resolve(siteRoot, 'public'));
if (dirname(publicRoot).toLowerCase() !== siteRoot.toLowerCase())
  throw new Error('The public directory must stay inside the selected website');

for (const filename of ['matcha-studio-runtime.js', 'matcha-studio-runtime.css']) {
  const source = resolve(root, 'dist/renderer', filename);
  // Read both outputs before copying so a missing build cannot partially sync.
  await readFile(source);
}
for (const filename of ['matcha-studio-runtime.js', 'matcha-studio-runtime.css'])
  await copyFile(resolve(root, 'dist/renderer', filename), resolve(publicRoot, filename));
console.log(`Synced Matcha Studio renderer to ${publicRoot}`);
