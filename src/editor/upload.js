// Only short-lived, single-object upload URLs reach the browser. Server keys stay private.
window.StudioUpload = async function (file, kind = 'image') {
  async function jsonRequest(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-editor-request': '1' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.redirect === '/pending') location.replace('/pending');
    if (!response.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
    return data;
  }
  const mime = kind === 'pdf' ? 'application/pdf' : file.type;
  const prepared = await jsonRequest('/api/editor/uploads', {
    kind,
    mime,
    size: file.size,
    filename: file.name,
  });
  if (prepared.mode === 'proxy') {
    const response = await fetch(prepared.endpoint, {
      method: 'POST',
      headers: {
        'x-editor-request': '1',
        'x-file-name': encodeURIComponent(file.name),
        'content-type': mime,
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
    return data;
  }
  const response = await fetch(prepared.uploadUrl, {
    method: 'PUT',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'content-type': prepared.mime, 'x-upsert': 'false' },
    body: file,
  });
  if (!response.ok) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองเลือกไฟล์อีกครั้ง');
  return jsonRequest('/api/editor/uploads/complete', { ticket: prepared.ticket });
};
