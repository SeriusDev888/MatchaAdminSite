import { fail } from './http.js';

export function siteOrigin(env) {
  if (!env.SITE_ORIGIN) fail('SITE_ORIGIN is required', 503);
  const url = new URL(env.SITE_ORIGIN);
  if (!['http:', 'https:'].includes(url.protocol)) fail('Invalid SITE_ORIGIN', 503);
  return url.origin;
}

export async function preview(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.startsWith('/preview')
    ? url.pathname.slice('/preview'.length) || '/'
    : url.pathname;
  if (path.startsWith('/api/') || path === '/editor.html')
    return new Response('Not found', { status: 404 });
  const upstream = new URL(path + url.search, siteOrigin(env));
  const forwarded = new Request(upstream, { method: request.method, redirect: 'manual' });
  const response = await (env.SITE_SERVICE ? env.SITE_SERVICE.fetch(forwarded) : fetch(forwarded));
  const headers = new Headers(response.headers);
  if ((headers.get('content-type') || '').includes('text/html')) {
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('etag');
    headers.set('cache-control', 'no-store');
    // The public site contains only its read-only renderer. Editing controls are loaded here,
    // from assets owned by this admin project, and never included in the public build.
    const html = (await response.text())
      .replace(/<head(\s[^>]*)?>/i, '$&<base href="/preview/">')
      .replace(/<script\b[^>]*\bsrc=["'](?:\.\/)?content-runtime\.js["'][^>]*>\s*<\/script>/gi, '')
      .replace(/<link\b[^>]*\bhref=["'](?:\.\/)?content-runtime\.css["'][^>]*>/gi, '')
      .replace(/<\/head>/i, '<link rel="stylesheet" href="/preview-runtime.css"></head>');
    return new Response(request.method === 'HEAD' ? null : html, {
      status: response.status,
      headers,
    });
  }
  return new Response(response.body, { status: response.status, headers });
}
