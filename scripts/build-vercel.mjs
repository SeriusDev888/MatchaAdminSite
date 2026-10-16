import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

export async function prepareVercel({ admin = false } = {}) {
  const source = resolve('dist/client'),
    output = resolve('dist/vercel-public');
  await mkdir(output, { recursive: true });
  // All HTML in an AdminSite stays inside the function so no static route can bypass auth.
  if (admin)
    for (const file of await readdir(output, { withFileTypes: true }))
      if (file.isFile() && extname(file.name) === '.html') await rm(resolve(output, file.name));
  await cp(source, output, {
    recursive: true,
    filter: (file) => !admin || extname(file) !== '.html',
  });
}
