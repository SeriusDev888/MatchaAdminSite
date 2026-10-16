// Real SQLite, isolated from the owner's local account and published content.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';

export const credentials = { email: 'admin@example.test', password: 'Test-only-password-2026' };
export function fixture(origin = 'http://127.0.0.1:4321') {
  const sql = new DatabaseSync(':memory:');
  for (const file of [
    '0000_nebulous_blade.sql',
    '0001_admin_login.sql',
    '0002_user_permissions.sql',
    '0003_applicant_role.sql',
    '0004_activity_logs.sql',
    '0005_google_membership.sql',
  ])
    sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  function prepare(query) {
    let params = [];
    return {
      bind(...values) {
        params = values;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...params) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...params) };
      },
      async run() {
        const result = sql.prepare(query).run(...params);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  const env = {
    LOCAL_AUTH_SETUP: 'true',
    DB: {
      prepare,
      async batch(statements) {
        sql.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sql.exec('COMMIT');
          return results;
        } catch (error) {
          sql.exec('ROLLBACK');
          throw error;
        }
      },
    },
    ASSETS: {
      fetch() {
        return new Response('<html>admin</html>', { headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const request = (path, options = {}) => new Request(origin + path, options);
  const fetch = (path, options = {}) => worker.fetch(request(path, options), env);
  const post = (path, data = {}, cookie = '', headers = {}) =>
    fetch(path, {
      method: 'POST',
      headers: {
        origin,
        'x-editor-request': '1',
        'content-type': 'application/json',
        cookie,
        ...headers,
      },
      body: JSON.stringify(data),
    });
  const setup = async () => {
    const response = await post('/api/auth/setup', credentials);
    if (response.status !== 200) throw new Error(await response.text());
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { sql, env, request, fetch, post, setup };
}
