import { fail } from './http.js';
import { validateDocument } from './validation.js';
import { database } from './database.js';
import { authorizeDocument } from './permissions.js';
import { audit, documentChanges } from './audit.js';
import defaults from '../src/shared/matcha-defaults.json' with { type: 'json' };
const EMPTY = {
  schema: 1,
  theme: {},
  pages: {},
  global: { nodes: {}, additions: [], order: {} },
  ...defaults,
};
export const state = (env, key) => database(env, 'state', { key });
export const unpack = (row) =>
  row
    ? { document: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at }
    : { document: structuredClone(EMPTY), revision: 0, updatedAt: null };
export async function seed(env, user) {
  await database(env, 'seed', {
    payload: JSON.stringify(EMPTY),
    now: new Date().toISOString(),
    user: user.id,
  });
}
export async function saveDraft(env, user, payload, revision, restoredVersion) {
  const validated = validateDocument(payload);
  const before = unpack((await state(env, 'draft')) || (await state(env, 'published'))).document;
  authorizeDocument(user, before, validated);
  await seed(env, user);
  if (
    !(await database(env, 'draft_save', {
      payload: JSON.stringify(validated),
      now: new Date().toISOString(),
      user: user.id,
      revision,
      audit: audit(
        user,
        restoredVersion ? 'content.restore' : 'content.save',
        restoredVersion || 'draft',
        {
          revision: revision + 1,
          ...documentChanges(before, validated),
          ...(restoredVersion ? { versionId: restoredVersion } : {}),
        },
      ),
    }))
  )
    fail('มีฉบับร่างใหม่จากอีกแท็บ กรุณาโหลดฉบับล่าสุดก่อนบันทึก', 409);
  return unpack(await state(env, 'draft'));
}
