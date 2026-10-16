import { createRemoteJWKSet, jwtVerify, base64url } from 'jose';
import { database } from './database.js';
import { audit } from './audit.js';
import { fail, json } from './http.js';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const bytes = (value) => new TextEncoder().encode(value);
const random = () => base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (value) =>
  base64url.encode(await crypto.subtle.digest('SHA-256', bytes(value)));
export const googleConfigured = (env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
const destination = (value) =>
  ['/', '/editor.html', '/logs', '/users', '/pending'].includes(value) ? value : '/';

export async function googleAuthentication(request, env, auth) {
  const url = new URL(request.url);
  if (!['/api/auth/google/start', '/api/auth/google/callback'].includes(url.pathname)) return null;
  auth.secureTransport(request);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const cookieName = auth.cookieName + '_google';
  const cookie = (value, age = 600) =>
    `${cookieName}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${age}${url.protocol === 'https:' ? '; Secure' : ''}`;
  function redirect(path, clear = false) {
    const response = new Response(null, {
      status: 303,
      headers: { location: path, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
    if (clear) response.headers.append('set-cookie', cookie('', 0));
    return response;
  }
  if (!googleConfigured(env)) return redirect('/login?google_error=unavailable', true);
  const callback = new URL(env.GOOGLE_REDIRECT_URI);
  if (
    callback.origin !== url.origin ||
    callback.pathname !== '/api/auth/google/callback' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    fail('GOOGLE_REDIRECT_URI ไม่ตรงกับ URL หลังบ้านนี้', 503);
  if (url.pathname.endsWith('/start')) {
    const limited = await auth.throttle(request, env);
    if (limited) return limited;
    if (!(await database(env, 'auth_initialized'))) return redirect('/login?google_error=owner');
    try {
      await database(env, 'auth_features');
    } catch {
      return redirect('/login?google_error=database');
    }
    const state = random(),
      binding = random(),
      nonce = random(),
      verifier = random();
    await database(env, 'auth_oauth_start', {
      stateHash: await digest(state),
      bindingHash: await digest(auth.cookieName + ':' + binding),
      nonce,
      verifier,
      returnTo: destination(url.searchParams.get('next')),
      now: Math.floor(Date.now() / 1000),
      expires: Math.floor(Date.now() / 1000) + 600,
    });
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: callback.href,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await digest(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    const response = redirect(target.href);
    response.headers.set('set-cookie', cookie(binding));
    return response;
  }
  try {
    const state = url.searchParams.get('state');
    const binding = (request.headers.get('cookie') || '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    if (
      !state ||
      !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
      !binding ||
      !/^[a-zA-Z0-9_-]{43}$/.test(binding)
    )
      return redirect('/login?google_error=state', true);
    const stored = await database(env, 'auth_oauth_consume', {
      stateHash: await digest(state),
      bindingHash: await digest(auth.cookieName + ':' + binding),
      now: Math.floor(Date.now() / 1000),
    });
    if (!stored) return redirect('/login?google_error=state', true);
    if (url.searchParams.has('error')) return redirect('/login?google_error=cancelled', true);
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) return redirect('/login?google_error=failed', true);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callback.href,
        code_verifier: stored.verifier,
      }).toString(),
    });
    if (!response.ok) return redirect('/login?google_error=failed', true);
    const tokens = await response.json();
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 20000)
      return redirect('/login?google_error=failed', true);
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
      requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'email', 'email_verified'],
      maxTokenAge: '10m',
      clockTolerance: 5,
    });
    if (
      payload.nonce !== stored.nonce ||
      payload.email_verified !== true ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 255 ||
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      (payload.azp && payload.azp !== env.GOOGLE_CLIENT_ID)
    )
      return redirect('/login?google_error=identity', true);
    let user = await database(env, 'auth_google_subject', { sub: payload.sub });
    const email = payload.email.toLowerCase();
    if (!user) {
      const existing = await database(env, 'auth_user_email', { email });
      if (existing) {
        // Only Google-authoritative Gmail/Workspace addresses can link an existing password account.
        const authority =
          email.endsWith('@gmail.com') ||
          (typeof payload.hd === 'string' && payload.hd.toLowerCase() === email.split('@')[1]);
        if (!authority || existing.google_sub) return redirect('/login?google_error=link', true);
        await database(env, 'auth_google_link', {
          sub: payload.sub,
          id: existing.id,
          email,
          audit: audit(existing, 'auth.google_link', existing.id),
        });
      } else {
        const id = crypto.randomUUID(),
          name = typeof payload.name === 'string' ? payload.name.slice(0, 100) : email;
        await database(env, 'auth_register', {
          id,
          email,
          name,
          sub: payload.sub,
          salt: random(),
          hash: random(),
          now: new Date().toISOString(),
          audit: audit({ id, email, name, role: 'applicant' }, 'auth.google_register', id),
        });
      }
      user = await database(env, 'auth_google_subject', { sub: payload.sub });
    }
    if (!user) return redirect('/login?google_error=link', true);
    const session = await auth.startSession(request, env, user, 'google');
    const result = redirect(
      user.status === 'active'
        ? destination(stored.return_to) === '/pending'
          ? '/'
          : destination(stored.return_to)
        : '/pending',
      true,
    );
    result.headers.append('set-cookie', session.headers.get('set-cookie'));
    return result;
  } catch {
    // Do not log authorization codes, tokens, Google responses or credentials.
    return redirect('/login?google_error=failed', true);
  }
}
