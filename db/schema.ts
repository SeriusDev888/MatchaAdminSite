import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const editorAuditLogs = sqliteTable(
  'editor_audit_logs',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    actorId: text('actor_id').notNull(),
    actorEmail: text('actor_email').notNull(),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    details: text('details').notNull(),
  },
  (table) => [index('editor_audit_logs_time').on(table.createdAt, table.id)],
);
export const editorState = sqliteTable('editor_state', {
  key: text('key').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export const editorVersions = sqliteTable('editor_versions', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const editorMedia = sqliteTable('editor_media', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const adminAccount = sqliteTable(
  'admin_account',
  {
    id: integer('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    salt: text('salt').notNull(),
  },
  (table) => [check('single_owner', sql`${table.id} = 1`)],
);
export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    expiresAt: integer('expires_at').notNull(),
    userId: text('user_id').notNull().default('superadmin'),
  },
  (table) => [index('admin_sessions_expiry').on(table.expiresAt)],
);
export const adminLoginAttempts = sqliteTable('admin_login_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetAt: integer('reset_at').notNull(),
});
export const adminOAuthStates = sqliteTable('admin_oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  bindingHash: text('binding_hash').notNull(),
  verifier: text('verifier').notNull(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const adminUsers = sqliteTable(
  'admin_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    permissions: text('permissions').notNull().default('[]'),
    passwordHash: text('password_hash').notNull(),
    salt: text('salt').notNull(),
    googleSub: text('google_sub').unique(),
    createdAt: text('created_at').notNull(),
    approvedAt: text('approved_at'),
    approvedBy: text('approved_by'),
    revision: integer('revision').notNull().default(0),
  },
  (table) => [
    check('valid_admin_role', sql`${table.role} IN ('superadmin','admin','applicant')`),
    check('valid_admin_status', sql`${table.status} IN ('pending','active','suspended','removed')`),
    check('active_superadmin', sql`${table.role} != 'superadmin' OR ${table.status} = 'active'`),
    check(
      'pending_applicant',
      sql`${table.role} != 'applicant' OR ${table.status} IN ('pending','removed')`,
    ),
  ],
);
