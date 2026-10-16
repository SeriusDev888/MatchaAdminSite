import { fail, json, readLimited } from './http.js';
import { database } from './database.js';
import { requireSuperadmin } from './permissions.js';
import { audit } from './audit.js';
import { googleAuthentication, googleConfigured } from './google.js';
const COOKIE = 'matcha_studio_session';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const digest = async (value) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const now = () => Math.floor(Date.now() / 1000);
function local(request) {
  const url = new URL(request.url);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}
function secureTransport(request) {
  if (new URL(request.url).protocol !== 'https:' && !local(request))
    fail('กรุณาเปิดระบบผ่าน HTTPS', 403);
}
function cookieToken(request) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);
}
function sessionCookie(request, token, age = SESSION_SECONDS, sameSite = 'Strict') {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${age}${local(request) ? '' : '; Secure'}`;
}
function redirect(path) {
  return new Response(null, {
    status: 303,
    headers: { location: path, 'cache-control': 'no-store' },
  });
}
export function loginRedirect(request) {
  const path = new URL(request.url).pathname;
  const next = path.startsWith('/logs')
    ? '/logs'
    : path.startsWith('/users')
      ? '/users'
      : path === '/editor.html'
        ? '/editor.html'
        : '/';
  return redirect('/login?next=' + encodeURIComponent(next));
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return hex(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
      key,
      256,
    ),
  );
}
async function equal(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    role: row.role,
    status: row.status,
    permissions:
      typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    revision: row.revision,
  };
}
export async function identity(request, env) {
  const token = cookieToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  secureTransport(request);
  const row = await database(env, 'auth_session_user', {
    hash: await digest(COOKIE + ':' + token),
    now: now(),
  });
  return row ? publicUser(row) : null;
}
export const approved = (user) =>
  user?.status === 'active' && ['admin', 'superadmin'].includes(user.role);
export async function owner(request, env) {
  const user = await identity(request, env);
  return approved(user) ? user : null;
}
export async function requireIdentity(request, env) {
  const user = await identity(request, env);
  if (!user) fail('กรุณาเข้าสู่ระบบ', 401);
  return user;
}
export async function membershipRedirect(request, env) {
  return (await identity(request, env)) ? redirect('/pending') : loginRedirect(request);
}
export async function requireOwner(request, env) {
  const user = await requireIdentity(request, env);
  if (!approved(user))
    throw Object.assign(new Error('บัญชีนี้ยังไม่มีสิทธิ์แก้ไขเว็บไซต์'), {
      status: 403,
      code: 'MEMBERSHIP_REQUIRED',
      redirect: '/pending',
    });
  return user;
}
export function writeOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    fail('Invalid request origin', 403);
  if (request.headers.get('x-editor-request') !== '1') fail('Invalid editor request', 403);
}
async function input(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json'))
    fail('กรุณาส่งข้อมูลแบบ JSON', 415);
  try {
    return JSON.parse(new TextDecoder().decode(await readLimited(request, 4096)));
  } catch (error) {
    if (error.status) throw error;
    fail('ข้อมูลไม่ถูกต้อง');
  }
}
async function throttle(request, env) {
  const time = now(),
    ip = local(request) ? 'loopback' : request.headers.get('cf-connecting-ip') || 'unknown';
  const result = await database(env, 'auth_throttle', {
    key: await digest(ip),
    reset: time + 900,
    now: time,
  });
  if (result.attempts > 10) {
    const response = json({ error: 'ลองทำรายการหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' }, 429);
    response.headers.set('retry-after', String(Math.max(1, result.reset_at - time)));
    return response;
  }
  return null;
}
async function startSession(request, env, user, method = 'password') {
  const token = random();
  await database(env, 'auth_session_start', {
    now: now(),
    previous: await digest(COOKIE + ':' + (cookieToken(request) || '')),
    hash: await digest(COOKIE + ':' + token),
    expires: now() + SESSION_SECONDS,
    user: user.id,
    audit: audit(user, 'auth.login', user.id, { method }),
  });
  const profile = publicUser(user);
  const response = json({
    ok: true,
    user: profile,
    redirect: approved(profile) ? '/' : '/pending',
    accountStatus: profile.status,
  });
  response.headers.set(
    'set-cookie',
    sessionCookie(request, token, SESSION_SECONDS, method === 'google' ? 'Lax' : 'Strict'),
  );
  return response;
}
export async function authentication(request, env) {
  const path = new URL(request.url).pathname;
  const googleResponse = await googleAuthentication(request, env, {
    cookieName: COOKIE,
    startSession,
    throttle,
    secureTransport,
  });
  if (googleResponse) return googleResponse;
  const loginPages = ['/login', '/login.html', '/register', '/register.html'];
  const userPages = ['/users', '/users/', '/users.html', '/logs', '/logs/', '/logs.html'];
  const pendingPages = ['/pending', '/pending/', '/pending.html'];
  if (loginPages.includes(path) || userPages.includes(path) || pendingPages.includes(path)) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const user = await identity(request, env);
    if (pendingPages.includes(path)) {
      if (!user) return redirect('/login?next=%2Fpending');
      if (approved(user)) return redirect('/');
    }
    if (userPages.includes(path)) {
      if (!user) return loginRedirect(request);
      if (path.startsWith('/users')) {
        if (!approved(user)) return redirect('/pending');
        requireSuperadmin(user);
      }
    } else if (loginPages.includes(path) && user)
      return redirect(approved(user) ? '/' : '/pending');
    const asset = await env.ASSETS.fetch(
      new Request(
        new URL(
          pendingPages.includes(path)
            ? '/pending.html'
            : path.startsWith('/logs')
              ? '/logs.html'
              : userPages.includes(path)
                ? '/users.html'
                : '/login.html',
          request.url,
        ),
        {
          method: request.method,
        },
      ),
    );
    const response = new Response(asset.body, asset);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-frame-options', 'DENY');
    response.headers.set(
      'content-security-policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return response;
  }
  if (!path.startsWith('/api/auth/')) return null;
  secureTransport(request);
  if (path === '/api/auth/status' && request.method === 'GET') {
    const user = await identity(request, env),
      initialized = await database(env, 'auth_initialized');
    return json({
      authenticated: Boolean(user),
      email: user?.email,
      user,
      approved: Boolean(approved(user)),
      googleEnabled: initialized && googleConfigured(env),
      initialized,
      canSetup:
        !initialized &&
        ((local(request) && env.LOCAL_AUTH_SETUP === 'true') || Boolean(env.ADMIN_SETUP_TOKEN)),
      requiresSetupToken: !local(request) || env.LOCAL_AUTH_SETUP !== 'true',
    });
  }
  if (
    ![
      '/api/auth/setup',
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/request-access',
    ].includes(path)
  )
    return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  writeOrigin(request);
  if (path === '/api/auth/logout') {
    const token = cookieToken(request);
    const actor = await identity(request, env);
    if (token)
      await database(env, 'auth_session_delete', {
        hash: await digest(COOKIE + ':' + token),
        ...(actor ? { audit: audit(actor, 'auth.logout', actor.id) } : {}),
      });
    const response = json({ ok: true });
    response.headers.set('set-cookie', sessionCookie(request, '', 0));
    return response;
  }
  if (path === '/api/auth/request-access') {
    const user = await requireIdentity(request, env);
    if (user.status === 'pending')
      return json({ ok: true, status: 'pending', alreadyPending: true });
    if (user.status !== 'removed') fail('ยังไม่สามารถส่งคำขอใหม่ได้ กรุณาติดต่อ superadmin', 409);
    const result = await database(env, 'auth_request_access', {
      id: user.id,
      revision: user.revision,
      audit: audit(user, 'users.request', user.id, {
        statusBefore: 'removed',
        statusAfter: 'pending',
      }),
    });
    if (!result) fail('สถานะบัญชีเปลี่ยนแล้ว กรุณาตรวจสอบใหม่', 409);
    return json({ ok: true, status: 'pending' });
  }
  const limited = await throttle(request, env);
  if (limited) return limited;
  const data = await input(request);
  if (!data || typeof data.email !== 'string' || typeof data.password !== 'string')
    fail('กรุณากรอกอีเมลและรหัสผ่าน');
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || data.password.length > 256)
    fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  if (path === '/api/auth/setup' || path === '/api/auth/register') {
    const initialized = await database(env, 'auth_initialized');
    if (path.endsWith('/setup')) {
      if (initialized) fail('ตั้งค่าบัญชีแล้ว กรุณาเข้าสู่ระบบ', 409);
      if (
        !(local(request) && env.LOCAL_AUTH_SETUP === 'true') &&
        (!env.ADMIN_SETUP_TOKEN ||
          typeof data.setupToken !== 'string' ||
          !(await equal(data.setupToken, env.ADMIN_SETUP_TOKEN)))
      )
        fail('ต้องใช้รหัสตั้งค่าจากเจ้าของระบบ', 403);
    } else if (!initialized) fail('กรุณารอเจ้าของระบบตั้งบัญชี superadmin ก่อน', 403);
    if (data.password.length < 12) fail('ใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร');
    const name = typeof data.name === 'string' ? data.name.trim() : email;
    if (!name || name.length > 100) fail('กรุณากรอกชื่อไม่เกิน 100 ตัวอักษร');
    const salt = random(),
      hash = await passwordHash(data.password, salt),
      time = new Date().toISOString();
    const registrationId = path.endsWith('/setup') ? 'superadmin' : crypto.randomUUID();
    const created = await database(
      env,
      path.endsWith('/setup') ? 'auth_create_superadmin' : 'auth_register',
      {
        id: registrationId,
        email,
        name,
        salt,
        hash,
        now: time,
        audit: audit(
          {
            id: registrationId,
            email,
            name,
            role: path.endsWith('/setup') ? 'superadmin' : 'applicant',
          },
          path.endsWith('/setup') ? 'auth.setup' : 'auth.register',
          registrationId,
        ),
      },
    );
    if (!created) fail('บัญชีนี้ถูกตั้งค่าหรือสมัครไว้แล้ว กรุณาเข้าสู่ระบบ', 409);
    if (path.endsWith('/register')) {
      const response = await startSession(
        request,
        env,
        await database(env, 'auth_user_email', { email }),
      );
      return new Response(response.body, { status: 201, headers: response.headers });
    }
  }
  const user = await database(env, 'auth_user_email', { email });
  const hash = await passwordHash(data.password, user?.salt || 'unconfigured-account');
  if (!user || !(await equal(hash, user.password_hash))) fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
  return startSession(request, env, user);
}
