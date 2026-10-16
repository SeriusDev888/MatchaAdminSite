// Only explicit summaries belong in the log. Never pass request bodies, cookies or credentials.
export function audit(actor, action, target = '', details = {}) {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    actor_id: actor.id,
    actor_email: actor.email || '',
    actor_name: actor.name || actor.display_name || actor.email || '',
    actor_role: actor.role,
    action,
    target,
    details: JSON.stringify(details),
  };
}

export function documentChanges(before, after) {
  const changed = (left, right) => JSON.stringify(left) !== JSON.stringify(right);
  const sections = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(
    (key) => key !== 'schema' && changed(before?.[key], after?.[key]),
  );
  const pages = [
    ...new Set([...Object.keys(before?.pages || {}), ...Object.keys(after?.pages || {})]),
  ].filter((key) => changed(before?.pages?.[key], after?.pages?.[key]));
  const products = [
    ...new Set(
      [...(before?.catalog || []), ...(after?.catalog || [])].map((product) => product.id),
    ),
  ].filter((id) =>
    changed(
      before?.catalog?.find((product) => product.id === id),
      after?.catalog?.find((product) => product.id === id),
    ),
  );
  return { sections, pages, products };
}
