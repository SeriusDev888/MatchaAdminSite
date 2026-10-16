import { SignJWT, jwtVerify } from 'jose';
import { backend, database, objects } from './database.js';
import { fail, json, readJSON, readLimited } from './http.js';
import { requirePermission } from './permissions.js';
import { audit } from './audit.js';
import { detectImage } from './media.js';

const MAX = 10 * 1024 * 1024;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const signingKey = (env) => new TextEncoder().encode('studio-upload:' + env.SUPABASE_SECRET_KEY);
const result = (id, filename, mime) => ({ id, url: '/media/' + id, filename, mime });

export async function uploads(request, env, user) {
  const url = new URL(request.url);
  if (!['/api/editor/uploads', '/api/editor/uploads/complete'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  requirePermission(user, 'media.upload');
  const input = await readJSON(request);
  if (url.pathname.endsWith('/complete')) {
    if (backend(env) !== 'supabase' || typeof input.ticket !== 'string')
      fail('Invalid upload ticket');
    let ticket;
    try {
      ticket = (
        await jwtVerify(input.ticket, signingKey(env), {
          algorithms: ['HS256'],
          issuer: url.origin,
          audience: 'studio-upload',
        })
      ).payload;
    } catch {
      fail('สิทธิ์อัปโหลดหมดอายุหรือไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่', 400);
    }
    if (ticket.sub !== user.id) fail('Invalid upload owner', 403);
    const { id, filename, mime, size } = ticket;
    // Completion retries return the existing media, never duplicate a log or delete a valid object.
    if (await database(env, 'media_get', { id })) return json(result(id, filename, mime));
    const object = await objects(env).get('editor/' + id);
    if (!object) fail('ยังไม่พบไฟล์อัปโหลด กรุณาลองอีกครั้ง', 409);
    let bytes;
    try {
      bytes = await readLimited(new Response(object.body), MAX);
      const valid =
        mime === 'application/pdf'
          ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' &&
            new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF')
          : detectImage(bytes) === mime;
      if (!valid || bytes.length !== size) fail('ชนิดหรือขนาดไฟล์ไม่ตรงกับที่ขออัปโหลด');
    } catch (error) {
      await objects(env).delete('editor/' + id);
      throw error;
    }
    try {
      await database(env, 'media_insert', {
        id,
        filename,
        mime,
        size,
        now: new Date().toISOString(),
        user: user.id,
        audit: audit(user, mime === 'application/pdf' ? 'media.document' : 'media.upload', id, {
          filename,
          mime,
          size,
        }),
      });
    } catch (error) {
      // Another completion may have won the same unique ID concurrently.
      if (!(await database(env, 'media_get', { id }))) throw error;
    }
    return json(result(id, filename, mime), 201);
  }
  const { kind, mime, size } = input;
  if (!['image', 'pdf'].includes(kind) || !Number.isInteger(size) || size <= 0 || size > MAX)
    fail('รองรับรูปและ PDF ขนาดไม่เกิน 10 MB');
  if (kind === 'pdf' ? mime !== 'application/pdf' : !imageTypes.includes(mime))
    fail('ชนิดไฟล์ไม่รองรับ');
  const filename = typeof input.filename === 'string' ? input.filename.trim().slice(0, 180) : '';
  if (!filename) fail('กรุณาระบุชื่อไฟล์');
  if (backend(env) === 'local')
    return json({
      mode: 'proxy',
      endpoint: kind === 'pdf' ? '/api/editor/documents' : '/api/editor/media',
    });
  const id = crypto.randomUUID();
  const uploadUrl = await objects(env).signedUpload('editor/' + id);
  const ticket = await new SignJWT({ id, filename, mime, size })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(url.origin)
    .setAudience('studio-upload')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey(env));
  return json({ mode: 'direct', uploadUrl, ticket, mime });
}
