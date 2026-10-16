import { fail } from './http.js';

export function backend(env) {
  const mode = env.STUDIO_DATABASE || 'local';
  if (!['local', 'supabase'].includes(mode)) fail('Invalid STUDIO_DATABASE', 503);
  return mode;
}
export function supabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    fail('กรุณาตั้ง SUPABASE_URL และ SUPABASE_SECRET_KEY ของหลังบ้าน', 503);
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/')
    fail('Invalid SUPABASE_URL', 503);
  const headers = { apikey: env.SUPABASE_SECRET_KEY };
  // Legacy service_role keys are JWTs. New sb_secret keys belong only in apikey.
  if (env.SUPABASE_SECRET_KEY.startsWith('eyJ'))
    headers.Authorization = 'Bearer ' + env.SUPABASE_SECRET_KEY;
  return { origin: url.origin, headers };
}
export async function database(env, operation, p = {}) {
  if (backend(env) === 'supabase') {
    const { origin, headers } = supabase(env);
    const response = await fetch(origin + '/rest/v1/rpc/studio_api', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ operation, params: p }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      fail('เชื่อมต่อฐานข้อมูล Supabase ไม่สำเร็จ กรุณาตรวจการตั้งค่าฝั่งเซิร์ฟเวอร์', 503);
    const result = await response.json();
    if (result?.error) fail(result.error, result.status || 400);
    return result.value;
  }
  const db = env.DB;
  if (!db) fail('Local DB binding is required', 503);
  const statement = (sql, ...args) => db.prepare(sql).bind(...args);
  const first = (sql, ...args) => statement(sql, ...args).first();
  const rows = async (sql, ...args) => (await statement(sql, ...args).all()).results;
  const auditStatement = (conditional = true) => {
    const a = p.audit;
    return statement(
      `INSERT INTO editor_audit_logs (id,created_at,actor_id,actor_email,actor_name,actor_role,action,target,details)
      SELECT ?,?,?,?,?,?,?,?,?${conditional ? ' WHERE changes()=1' : ''}`,
      a.id,
      a.created_at,
      a.actor_id,
      a.actor_email,
      a.actor_name,
      a.actor_role,
      a.action,
      a.target,
      a.details,
    );
  };
  const changed = async (sql, ...args) => {
    if (!p.audit) return (await statement(sql, ...args).run()).meta.changes === 1;
    const result = await db.batch([statement(sql, ...args), auditStatement()]);
    return result[0].meta.changes === 1;
  };
  switch (operation) {
    case 'auth_features':
      return { membership: 2, google: true };
    case 'auth_google_subject':
      return first('SELECT * FROM admin_users WHERE google_sub=?', p.sub);
    case 'auth_google_link':
      return changed(
        'UPDATE admin_users SET google_sub=?,revision=revision+1 WHERE id=? AND email=? AND google_sub IS NULL',
        p.sub,
        p.id,
        p.email,
      );
    case 'auth_oauth_start':
      return db.batch([
        statement('DELETE FROM admin_oauth_states WHERE expires_at<=?', p.now),
        statement(
          'INSERT INTO admin_oauth_states (state_hash,binding_hash,verifier,nonce,return_to,expires_at) VALUES (?,?,?,?,?,?)',
          p.stateHash,
          p.bindingHash,
          p.verifier,
          p.nonce,
          p.returnTo,
          p.expires,
        ),
      ]);
    case 'auth_oauth_consume':
      return first(
        'DELETE FROM admin_oauth_states WHERE state_hash=? AND binding_hash=? AND expires_at>? RETURNING verifier,nonce,return_to',
        p.stateHash,
        p.bindingHash,
        p.now,
      );
    case 'auth_request_access':
      return changed(
        "UPDATE admin_users SET role='applicant',status='pending',permissions='[]',approved_at=NULL,approved_by=NULL,revision=revision+1 WHERE id=? AND status='removed' AND role!='superadmin' AND revision=?",
        p.id,
        p.revision,
      );
    case 'audit_list':
      return rows(
        `SELECT * FROM editor_audit_logs
        WHERE (?='' OR action LIKE ?||'%')
        AND (?='' OR instr(lower(actor_email||' '||actor_name),lower(?))>0)
        AND (?='' OR created_at<? OR (created_at=? AND id<?))
        ORDER BY created_at DESC,id DESC LIMIT ?`,
        p.prefix,
        p.prefix,
        p.search,
        p.search,
        p.beforeTime,
        p.beforeTime,
        p.beforeTime,
        p.beforeId,
        p.limit,
      );
    case 'state':
      return first('SELECT payload,revision,updated_at FROM editor_state WHERE key=?', p.key);
    case 'seed':
      return db.batch(
        ['draft', 'published'].map((key) =>
          statement(
            'INSERT OR IGNORE INTO editor_state (key,payload,revision,updated_at,updated_by) VALUES (?,?,0,?,?)',
            key,
            p.payload,
            p.now,
            p.user,
          ),
        ),
      );
    case 'draft_save':
      return changed(
        "UPDATE editor_state SET payload=?,revision=revision+1,updated_at=?,updated_by=? WHERE key='draft' AND revision=?",
        p.payload,
        p.now,
        p.user,
        p.revision,
      );
    case 'publish': {
      const result = await db.batch([
        statement(
          "UPDATE editor_state SET payload=(SELECT payload FROM editor_state WHERE key='draft'),revision=revision+1,updated_at=?,updated_by=? WHERE key='published' AND revision=? AND EXISTS(SELECT 1 FROM editor_state WHERE key='draft' AND revision=?)",
          p.now,
          p.user,
          p.publishedRevision,
          p.revision,
        ),
        ...(p.audit ? [auditStatement()] : []),
        statement(
          "INSERT INTO editor_versions (id,payload,created_at,created_by) SELECT ?,payload,?,? FROM editor_state WHERE key='published' AND revision=? AND updated_at=?",
          p.version,
          p.now,
          p.user,
          p.publishedRevision + 1,
          p.now,
        ),
      ]);
      return result[0].meta.changes === 1;
    }
    case 'versions':
      return rows('SELECT id,created_at FROM editor_versions ORDER BY created_at DESC LIMIT 30');
    case 'version':
      return first('SELECT payload FROM editor_versions WHERE id=?', p.id);
    case 'media_get':
      return first('SELECT mime,filename FROM editor_media WHERE id=?', p.id);
    case 'media_list':
      return rows(
        'SELECT id,filename,mime,size,created_at FROM editor_media ORDER BY created_at DESC LIMIT 150',
      );
    case 'media_insert':
      return changed(
        'INSERT INTO editor_media (id,filename,mime,size,created_at,created_by) VALUES (?,?,?,?,?,?)',
        p.id,
        p.filename,
        p.mime,
        p.size,
        p.now,
        p.user,
      );
    case 'auth_initialized':
      return Boolean(await first("SELECT id FROM admin_users WHERE role='superadmin' LIMIT 1"));
    case 'auth_user_email':
      return first('SELECT * FROM admin_users WHERE email=?', p.email);
    case 'auth_session_user':
      return first(
        'SELECT u.id,u.email,u.display_name,u.role,u.status,u.permissions,u.revision,u.created_at,u.approved_at FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
        p.hash,
        p.now,
      );
    case 'auth_throttle':
      return first(
        `INSERT INTO admin_login_attempts (key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at`,
        p.key,
        p.reset,
        p.now,
        p.now,
      );
    case 'auth_session_start':
      return db.batch([
        statement(
          'DELETE FROM admin_sessions WHERE expires_at<=? OR token_hash=?',
          p.now,
          p.previous,
        ),
        statement(
          'INSERT INTO admin_sessions (token_hash,expires_at,user_id) VALUES (?,?,?)',
          p.hash,
          p.expires,
          p.user,
        ),
        ...(p.audit ? [auditStatement(false)] : []),
        statement('DELETE FROM admin_login_attempts WHERE reset_at<=?', p.now),
      ]);
    case 'auth_session_delete':
      return changed('DELETE FROM admin_sessions WHERE token_hash=?', p.hash);
    case 'auth_create_superadmin':
      return changed(
        `INSERT OR IGNORE INTO admin_users (id,email,display_name,role,status,permissions,password_hash,salt,created_at,approved_at,approved_by,revision)
      SELECT 'superadmin',?,?,'superadmin','active','[]',?,?,?,?, 'superadmin',0 WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE role='superadmin')`,
        p.email,
        p.name,
        p.hash,
        p.salt,
        p.now,
        p.now,
      );
    case 'auth_register':
      return changed(
        `INSERT OR IGNORE INTO admin_users (id,email,display_name,role,status,permissions,password_hash,salt,created_at,google_sub,revision) VALUES (?,?,?,'applicant','pending','[]',?,?,?,?,0)`,
        p.id,
        p.email,
        p.name,
        p.hash,
        p.salt,
        p.now,
        p.sub || null,
      );
    case 'users_list':
      return rows(
        "SELECT id,email,display_name,role,status,permissions,created_at,approved_at,revision FROM admin_users WHERE status!='removed' ORDER BY created_at DESC,id",
      );
    case 'users_get':
      return first(
        'SELECT id,email,display_name,role,status,permissions,created_at,approved_at,revision FROM admin_users WHERE id=?',
        p.id,
      );
    case 'users_update': {
      const result = await db.batch([
        statement(
          `UPDATE admin_users SET role=CASE WHEN ?='approve' THEN 'admin' ELSE role END,status=?,permissions=?,approved_at=CASE WHEN ?='approve' THEN ? ELSE approved_at END,approved_by=CASE WHEN ?='approve' THEN ? ELSE approved_by END,revision=revision+1 WHERE id=? AND role IN ('admin','applicant') AND revision=? AND (?!='approve' OR status='pending')`,
          p.action,
          p.status,
          p.permissions,
          p.action,
          p.now,
          p.action,
          p.actor,
          p.id,
          p.revision,
          p.action,
        ),
        ...(p.audit ? [auditStatement()] : []),
      ]);
      return result[0].meta.changes === 1;
    }
    case 'users_delete': {
      return changed(
        "UPDATE admin_users SET status='removed',permissions='[]',revision=revision+1 WHERE id=? AND role IN ('admin','applicant') AND status!='removed' AND revision=?",
        p.id,
        p.revision,
      );
    }
    default:
      fail('Unknown database operation', 503);
  }
}

export function objects(env) {
  if (backend(env) === 'local') return env.BUCKET;
  const { origin, headers } = supabase(env);
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'studio-media';
  const path = (key) =>
    origin +
    '/storage/v1/object/' +
    encodeURIComponent(bucket) +
    '/' +
    key.split('/').map(encodeURIComponent).join('/');
  return {
    async signedUpload(key) {
      const response = await fetch(
        path(key).replace('/storage/v1/object/', '/storage/v1/object/upload/sign/'),
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{}',
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) fail('สร้างสิทธิ์อัปโหลด Supabase ไม่สำเร็จ', 503);
      const data = await response.json();
      const signed = new URL(origin + '/storage/v1' + data.url);
      if (signed.origin !== origin || !signed.searchParams.has('token'))
        fail('Invalid storage upload URL', 503);
      return signed.href;
    },
    async signedRead(key, filename) {
      const response = await fetch(
        path(key).replace('/storage/v1/object/', '/storage/v1/object/sign/'),
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ expiresIn: 300 }),
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) fail('สร้างลิงก์อ่านไฟล์ Supabase ไม่สำเร็จ', 503);
      const data = await response.json();
      const signed = new URL(origin + '/storage/v1' + data.signedURL);
      if (signed.origin !== origin || !signed.searchParams.has('token'))
        fail('Invalid storage read URL', 503);
      if (filename) signed.searchParams.set('download', filename);
      return signed.href;
    },
    async get(key) {
      const response = await fetch(path(key), {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) return null;
      if (!response.ok) fail('อ่านไฟล์จาก Supabase Storage ไม่สำเร็จ', 503);
      return { body: response.body };
    },
    async put(key, bytes, options) {
      const response = await fetch(path(key), {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': options.httpMetadata.contentType,
          'x-upsert': 'false',
        },
        body: bytes,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) fail('อัปโหลดไฟล์ไป Supabase Storage ไม่สำเร็จ', 503);
    },
    async delete(key) {
      const response = await fetch(origin + '/storage/v1/object/' + encodeURIComponent(bucket), {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [key] }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 404)
        fail('ลบไฟล์จาก Supabase Storage ไม่สำเร็จ', 503);
    },
  };
}
