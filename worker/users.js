import { json, fail, readJSON } from './http.js';
import { requireOwner, publicUser, writeOrigin } from './auth.js';
import { database } from './database.js';
import { audit } from './audit.js';
import {
  PERMISSIONS,
  DEFAULT_PERMISSIONS,
  requireSuperadmin,
  validPermissions,
} from './permissions.js';

export async function users(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/users' && !path.startsWith('/api/users/')) return null;
  const actor = await requireOwner(request, env);
  requireSuperadmin(actor);
  if (path === '/api/users' && request.method === 'GET') {
    return json({
      users: (await database(env, 'users_list')).map(publicUser),
      permissions: PERMISSIONS,
      defaultPermissions: DEFAULT_PERMISSIONS,
      currentUserId: actor.id,
    });
  }
  if (!['PATCH', 'DELETE'].includes(request.method))
    return json({ error: 'Method not allowed' }, 405);
  writeOrigin(request);
  const id = path.slice('/api/users/'.length);
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) fail('ไม่พบผู้ใช้', 404);
  const target = await database(env, 'users_get', { id });
  if (!target) fail('ไม่พบผู้ใช้', 404);
  if (target.status === 'removed')
    fail('ผู้ใช้นี้ถูกนำออกแล้ว ต้องให้เจ้าตัวส่งคำขอเข้าใหม่ก่อน', 409);
  if (target.role === 'superadmin' || id === actor.id)
    fail('ไม่สามารถลบหรือเปลี่ยนสิทธิ์บัญชี superadmin ได้', 403);
  const data = await readJSON(request);
  if (!Number.isInteger(data?.revision) || data.revision < 0) fail('Invalid revision');
  if (Object.keys(data).some((key) => !['revision', 'action', 'permissions'].includes(key)))
    fail('ข้อมูลการจัดการสิทธิ์ไม่ถูกต้อง');
  if (request.method === 'DELETE') {
    // Older RPCs hard-delete accounts; require the rejoin-capable schema first.
    let features;
    try {
      features = await database(env, 'auth_features');
    } catch (error) {
      if (error.message === 'Unknown database operation')
        fail('กรุณาอัปเดต SQL สำหรับระบบรออนุมัติก่อน', 503);
      throw error;
    }
    if (features?.membership !== 2) fail('กรุณาอัปเดต SQL สำหรับระบบรออนุมัติก่อน', 503);
    if (
      !(await database(env, 'users_delete', {
        id,
        revision: data.revision,
        actor: actor.id,
        audit: audit(actor, 'users.delete', id, {
          targetEmail: target.email,
          targetName: target.display_name,
        }),
      }))
    )
      fail('ข้อมูลผู้ใช้เปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    return json({ ok: true });
  }
  if (!['approve', 'update', 'suspend', 'reactivate'].includes(data.action))
    fail('Invalid user action');
  if (data.action === 'approve' && target.status !== 'pending')
    fail('บัญชีนี้ไม่ได้อยู่ระหว่างรออนุมัติ', 409);
  if (data.action === 'reactivate' && target.status !== 'suspended')
    fail('บัญชีนี้ไม่ได้ถูกระงับ', 409);
  if (data.action === 'update' && target.status === 'pending') fail('กรุณาอนุมัติบัญชีก่อน', 409);
  if (data.action === 'suspend' && target.status !== 'active')
    fail('ระงับได้เฉพาะบัญชีที่ใช้งานอยู่', 409);
  const permissions = validPermissions(data.permissions ?? JSON.parse(target.permissions));
  const status =
    data.action === 'approve' || data.action === 'reactivate'
      ? 'active'
      : data.action === 'suspend'
        ? 'suspended'
        : target.status;
  const updated = await database(env, 'users_update', {
    id,
    status,
    permissions: JSON.stringify(permissions),
    action: data.action,
    revision: data.revision,
    actor: actor.id,
    now: new Date().toISOString(),
    audit: audit(actor, 'users.' + data.action, id, {
      targetEmail: target.email,
      targetName: target.display_name,
      statusBefore: target.status,
      statusAfter: status,
      permissionsBefore: JSON.parse(target.permissions),
      permissionsAfter: permissions,
    }),
  });
  if (!updated) fail('ข้อมูลผู้ใช้เปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  return json({ ok: true, user: publicUser(await database(env, 'users_get', { id })) });
}
