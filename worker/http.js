export const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
export const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export async function readJSON(request) {
  const bytes = await readLimited(request, 2000000);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('Invalid JSON');
  }
}
export async function readLimited(request, max) {
  if (Number(request.headers.get('content-length')) > max) fail('File is too large', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      fail('File is too large', 413);
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}
