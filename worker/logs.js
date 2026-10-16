import { json, fail } from './http.js';
import { requireIdentity } from './auth.js';
import { database } from './database.js';

export async function logs(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/logs') return null;
  await requireIdentity(request, env);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const category = url.searchParams.get('category') || '';
  const search = (url.searchParams.get('search') || '').trim();
  const limit = Number(url.searchParams.get('limit') || 50);
  if (
    !['', 'auth', 'content', 'users', 'media'].includes(category) ||
    search.length > 254 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    fail('ตัวกรองประวัติไม่ถูกต้อง');
  let cursor = { time: '', id: '' };
  if (url.searchParams.has('cursor')) {
    try {
      cursor = JSON.parse(atob(url.searchParams.get('cursor')));
    } catch {
      fail('หน้าประวัติไม่ถูกต้อง');
    }
    if (
      !cursor ||
      typeof cursor.time !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor.time) ||
      typeof cursor.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(cursor.id)
    )
      fail('หน้าประวัติไม่ถูกต้อง');
  }
  let rows;
  try {
    rows = await database(env, 'audit_list', {
      prefix: category ? category + '.' : '',
      search,
      beforeTime: cursor.time,
      beforeId: cursor.id,
      limit: limit + 1,
    });
  } catch (error) {
    if (
      error.message === 'Unknown database operation' ||
      /no such table: editor_audit_logs/.test(error.message)
    )
      return json(
        {
          error: 'ยังไม่ได้ติดตั้งตารางประวัติ กรุณารัน SQL เพิ่มประวัติของ AdminSite นี้ก่อน',
          code: 'LOG_SCHEMA_REQUIRED',
        },
        503,
      );
    throw error;
  }
  const entries = rows.slice(0, limit);
  const last = entries.at(-1);
  return json({
    logs: entries.map((row) => ({ ...row, details: JSON.parse(row.details) })),
    nextCursor:
      rows.length > limit ? btoa(JSON.stringify({ time: last.created_at, id: last.id })) : null,
  });
}
