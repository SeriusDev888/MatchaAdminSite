import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export function assets(root = resolve(process.cwd(), 'dist/client')) {
  return {
    async fetch(request) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      let path;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response('Bad path', { status: 400 });
      }
      if (path.includes('\\') || path.includes('\0') || path.split('/').includes('..'))
        return new Response('Not found', { status: 404 });
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
      try {
        const body = await readFile(file);
        return new Response(request.method === 'HEAD' ? null : body, {
          headers: {
            'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code))
          return new Response('Not found', { status: 404 });
        throw error;
      }
    },
  };
}

export function createHandler(
  worker,
  { admin = false, environment = () => process.env, assetService = assets() } = {},
) {
  return {
    async fetch(request) {
      if (admin) {
        const raw = new URL(request.url).pathname;
        let decoded;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          return new Response('Bad path', { status: 400 });
        }
        // A fallback asset lookup must not expose protected HTML via encoded names,
        // double decoding, trailing slashes or Windows' case-insensitive filesystem.
        if (
          /\.html\/?$/i.test(decoded) &&
          (raw !== decoded || raw !== raw.toLowerCase() || raw.endsWith('/'))
        )
          return new Response('Not found', { status: 404 });
      }
      const settings = environment();
      if (admin && settings.STUDIO_DATABASE && settings.STUDIO_DATABASE !== 'supabase')
        return Response.json(
          { error: 'Vercel requires STUDIO_DATABASE=supabase' },
          { status: 503 },
        );
      const env = {
        ...settings,
        ...(admin ? { STUDIO_DATABASE: 'supabase' } : {}),
        VERCEL_RUNTIME: 'true',
        ASSETS: assetService,
      };
      // Rate limits must use the IP supplied by Vercel, not a caller-supplied CF header.
      const headers = new Headers(request.headers);
      headers.delete('cf-connecting-ip');
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (ip) headers.set('cf-connecting-ip', ip);
      const response = await worker.fetch(new Request(request, { headers }), env);
      // Node fetch decodes upstream gzip/br bodies but retains encoding/length headers.
      // Forwarding those headers makes proxied preview scripts fail to decode in browsers.
      const responseHeaders = new Headers(response.headers);
      for (const name of ['content-encoding', 'content-length', 'transfer-encoding'])
        responseHeaders.delete(name);
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    },
  };
}
