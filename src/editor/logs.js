(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const labels = {
    'auth.setup': 'ตั้งค่าบัญชี superadmin',
    'auth.register': 'สมัครสมาชิก',
    'auth.login': 'เข้าสู่ระบบ',
    'auth.logout': 'ออกจากระบบ',
    'content.save': 'บันทึกฉบับร่าง',
    'content.publish': 'เผยแพร่เว็บไซต์',
    'content.restore': 'คืนเวอร์ชันเป็นฉบับร่าง',
    'media.upload': 'อัปโหลดรูปภาพ',
    'media.document': 'อัปโหลดเอกสาร',
    'users.approve': 'อนุมัติสมาชิก',
    'users.update': 'เปลี่ยนสิทธิ์สมาชิก',
    'users.suspend': 'ระงับสมาชิก',
    'users.reactivate': 'เปิดใช้งานสมาชิก',
    'users.delete': 'ลบสมาชิก',
    'users.request': 'ขอเข้าใช้งานอีกครั้ง',
    'auth.google_register': 'สมัครด้วย Google',
    'auth.google_link': 'เชื่อมบัญชี Google',
  };
  const fields = {
    method: 'วิธีเข้าสู่ระบบ',
    revision: 'ฉบับร่างเลขที่',
    sections: 'ส่วนที่เปลี่ยน',
    pages: 'หน้าที่เปลี่ยน',
    products: 'สินค้าที่เปลี่ยน',
    versionId: 'รหัสเวอร์ชัน',
    draftRevision: 'ฉบับร่างเลขที่',
    publishedRevision: 'เผยแพร่เลขที่',
    filename: 'ชื่อไฟล์',
    mime: 'ประเภทไฟล์',
    size: 'ขนาด (ไบต์)',
    targetEmail: 'อีเมลสมาชิก',
    targetName: 'ชื่อสมาชิก',
    statusBefore: 'สถานะเดิม',
    statusAfter: 'สถานะใหม่',
    permissionsBefore: 'สิทธิ์เดิม',
    permissionsAfter: 'สิทธิ์ใหม่',
  };
  const terms = {
    google: 'Google',
    password: 'อีเมลและรหัสผ่าน',
    brand: 'แบรนด์',
    contact: 'ข้อมูลติดต่อ',
    catalog: 'สินค้า',
    content: 'เนื้อหาหน้าเว็บ',
    pages: 'รูปแบบหน้าเว็บ',
    global: 'ส่วนร่วมทุกหน้า',
    theme: 'ธีม',
    active: 'ใช้งานอยู่',
    pending: 'รออนุมัติ',
    suspended: 'ระงับ',
    'content.edit': 'แก้หน้าเว็บ',
    'products.edit': 'จัดการสินค้า',
    'brand.edit': 'จัดการแบรนด์',
    'contact.edit': 'ข้อมูลติดต่อ',
    'media.upload': 'อัปโหลดสื่อ',
    'content.publish': 'เผยแพร่',
    'versions.restore': 'คืนเวอร์ชัน',
  };
  let nextCursor = null,
    controller,
    query = { category: '', search: '' };
  const formatTime = (value) =>
    new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' });
  const text = (value) =>
    Array.isArray(value)
      ? value.map((item) => terms[item] || item).join(', ') || 'ไม่มี'
      : terms[value] || String(value);
  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function detail(row) {
    $('dialog-title').textContent = labels[row.action] || row.action;
    $('log-detail').replaceChildren();
    const add = (label, value) =>
      $('log-detail').append(element('dt', '', label), element('dd', '', value));
    add('เวลา', formatTime(row.created_at));
    add('ผู้ทำรายการ', row.actor_name);
    add('อีเมล', row.actor_email);
    add('ยศขณะทำรายการ', row.actor_role);
    if (row.target) add('รายการที่เกี่ยวข้อง', row.target);
    for (const [key, value] of Object.entries(row.details)) add(fields[key] || key, text(value));
    $('log-dialog').showModal();
  }
  function draw(rows, append) {
    if (!append) $('log-list').replaceChildren();
    for (const row of rows) {
      const tr = element('tr');
      const time = element('td', '', formatTime(row.created_at));
      const actor = element('td');
      actor.append(
        element('strong', 'log-actor', row.actor_name),
        element('small', '', row.actor_email),
      );
      const activity = element('td');
      activity.append(
        element('span', 'log-action ' + row.action.split('.')[0], labels[row.action] || row.action),
      );
      const summary =
        row.details.targetEmail ||
        row.details.filename ||
        (row.details.sections ? text(row.details.sections) : '');
      if (summary) activity.append(element('small', '', summary));
      const action = element('td');
      const button = element('button', 'detail-button', 'ดูรายละเอียด');
      button.setAttribute('aria-label', 'ดูรายละเอียด ' + (labels[row.action] || row.action));
      button.onclick = () => detail(row);
      action.append(button);
      tr.append(time, actor, activity, action);
      $('log-list').append(tr);
    }
    const count = $('log-list').children.length;
    $('list-status').textContent = count ? `แสดง ${count} รายการ · ใหม่ไปเก่า` : 'ไม่พบรายการ';
    $('log-table').hidden = !count;
    $('empty-state').hidden = !!count;
  }
  async function load(cursor = null) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    $('log-error').hidden = true;
    $('list-status').textContent = 'กำลังโหลดประวัติ…';
    for (const id of ['apply', 'reload', 'next-page']) $(id).disabled = true;
    try {
      const params = new URLSearchParams(query);
      if (cursor) params.set('cursor', cursor);
      const response = await fetch('/api/logs?' + params, {
        cache: 'no-store',
        signal: current.signal,
      });
      const data = await response.json();
      if (response.status === 401) {
        location.replace('/login?next=%2Flogs');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'โหลดประวัติไม่สำเร็จ กรุณาลองใหม่');
      nextCursor = data.nextCursor;
      draw(data.logs, !!cursor);
      $('next-page').hidden = !nextCursor;
    } catch (error) {
      if (current.signal.aborted) return;
      $('log-error').textContent = error.message;
      $('log-error').hidden = false;
      $('list-status').textContent = 'โหลดประวัติไม่สำเร็จ';
      if (!cursor) {
        $('log-list').replaceChildren();
        $('log-table').hidden = true;
        $('empty-state').hidden = true;
        $('next-page').hidden = true;
      }
    } finally {
      if (!current.signal.aborted)
        for (const id of ['apply', 'reload', 'next-page']) $(id).disabled = false;
    }
  }
  $('filters').onsubmit = (event) => {
    event.preventDefault();
    query = { category: $('category').value, search: $('search').value.trim() };
    void load();
  };
  $('reload').onclick = () => load();
  $('next-page').onclick = () => load(nextCursor);
  $('close-dialog').onclick = () => $('log-dialog').close();
  $('logout').onclick = async () => {
    $('logout').disabled = true;
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-editor-request': '1' },
      });
      if (!response.ok) throw new Error('ออกจากระบบไม่สำเร็จ');
      location.replace('/login');
    } catch (error) {
      $('log-error').textContent = error.message;
      $('log-error').hidden = false;
      $('logout').disabled = false;
    }
  };
  void load();
  void fetch('/api/auth/status', { cache: 'no-store' })
    .then((response) => response.json())
    .then((session) => {
      if (session.user) {
        $('log-role').textContent = session.user.role.toUpperCase();
        $('manage-users').hidden = session.user.role !== 'superadmin';
      }
    })
    .catch(() => {});
})();
