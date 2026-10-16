(() => {
  const $ = (id) => document.getElementById(id);
  let data,
    selected,
    filter = 'all',
    busy = false;
  const labels = { pending: 'รออนุมัติ', active: 'ใช้งานอยู่', suspended: 'ระงับการใช้งาน' };
  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  async function api(path = '', method = 'GET', body) {
    const response = await fetch('/api/users' + path, {
      method,
      cache: 'no-store',
      headers: { 'x-editor-request': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (response.status === 401) location.replace('/login');
    if (!response.ok) throw new Error(result.error || 'ไม่สามารถทำรายการได้');
    return result;
  }
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
  }
  function draw() {
    for (const state of ['pending', 'active', 'suspended'])
      $(state + '-count').textContent = data.users.filter((u) => u.status === state).length;
    const query = $('search').value.trim().toLowerCase();
    const users = data.users.filter(
      (u) =>
        (filter === 'all' || u.status === filter) &&
        (!query || (u.name + ' ' + u.email).toLowerCase().includes(query)),
    );
    $('user-list').replaceChildren();
    $('list-status').textContent = users.length
      ? `${users.length} บัญชี`
      : 'ไม่พบผู้ใช้ในรายการนี้';
    for (const user of users) {
      const row = element('article', 'user-row');
      row.dataset.userId = user.id;
      const info = element('div', 'user-info');
      info.append(element('strong', '', user.name), element('p', '', user.email));
      row.append(
        element('span', 'avatar', user.name.slice(0, 1).toUpperCase()),
        info,
        element(
          'span',
          'user-role',
          user.role === 'applicant' ? 'ผู้สมัคร' : user.role.toUpperCase(),
        ),
        element('span', 'badge ' + user.status, labels[user.status]),
      );
      if (user.role !== 'superadmin') {
        const button = element(
          'button',
          '',
          user.status === 'pending' ? 'ตรวจและอนุมัติ' : 'จัดการสิทธิ์',
        );
        button.onclick = () => open(user);
        row.append(button);
      } else row.append(element('small', 'user-role', 'บัญชีเจ้าของ'));
      $('user-list').append(row);
    }
  }
  async function load() {
    data = await api();
    draw();
  }
  function open(user) {
    selected = user;
    $('dialog-title').textContent = user.name;
    $('dialog-email').textContent = user.email;
    $('dialog-status').textContent = 'สถานะ: ' + labels[user.status];
    $('dialog-error').hidden = true;
    $('permission-list')
      .querySelectorAll('label')
      .forEach((el) => el.remove());
    const current = user.status === 'pending' ? data.defaultPermissions : user.permissions;
    for (const permission of data.permissions) {
      const label = element('label', 'permission'),
        input = element('input');
      input.type = 'checkbox';
      input.value = permission.key;
      input.checked = current.includes(permission.key);
      input.name = 'permission';
      const text = element('span');
      text.append(
        element('strong', '', permission.label),
        element('small', '', permission.description),
      );
      label.append(input, text);
      $('permission-list').append(label);
    }
    $('save-user').textContent = user.status === 'pending' ? 'อนุมัติเป็น admin' : 'บันทึกสิทธิ์';
    $('toggle-status').hidden = user.status === 'pending';
    $('toggle-status').textContent =
      user.status === 'suspended' ? 'เปิดใช้งานอีกครั้ง' : 'ระงับการใช้งาน';
    $('user-dialog').showModal();
  }
  async function mutate(action, method = 'PATCH') {
    if (busy) return;
    busy = true;
    $('dialog-error').hidden = true;
    $('user-form').setAttribute('aria-busy', 'true');
    $('user-form')
      .querySelectorAll('button,input')
      .forEach((el) => (el.disabled = true));
    try {
      await api('/' + encodeURIComponent(selected.id), method, {
        revision: selected.revision,
        action,
        permissions: [...$('permission-list').querySelectorAll('input:checked')].map(
          (el) => el.value,
        ),
      });
      $('user-dialog').close();
      await load();
      toast(
        method === 'DELETE'
          ? 'ลบผู้ใช้ออกจากทีมและถอนสิทธิ์แก้ไขแล้ว'
          : action === 'approve'
            ? 'อนุมัติแล้ว สมาชิกสามารถเข้าสู่ระบบได้'
            : 'บันทึกสิทธิ์แล้ว',
      );
    } catch (error) {
      $('dialog-error').textContent = error.message;
      $('dialog-error').hidden = false;
    } finally {
      busy = false;
      $('user-form').removeAttribute('aria-busy');
      $('user-form')
        .querySelectorAll('button,input')
        .forEach((el) => (el.disabled = false));
    }
  }
  $('user-form').onsubmit = (event) => {
    event.preventDefault();
    void mutate(selected.status === 'pending' ? 'approve' : 'update');
  };
  $('toggle-status').onclick = () =>
    void mutate(selected.status === 'suspended' ? 'reactivate' : 'suspend');
  $('delete-user').onclick = () => {
    if (confirm(`ลบ ${selected.email} ออกจากระบบ? สิทธิ์แก้ไขจะถูกถอนทันที และผู้ใช้สามารถส่งคำขอเข้าใหม่ได้`))
      void mutate('delete', 'DELETE');
  };
  $('close-dialog').onclick = () => {
    if (!busy) $('user-dialog').close();
  };
  $('user-dialog').addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  $('search').oninput = () => {
    if (data) draw();
  };
  document.querySelectorAll('[data-filter]').forEach(
    (button) =>
      (button.onclick = () => {
        filter = button.dataset.filter;
        document
          .querySelectorAll('[data-filter]')
          .forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
        if (data) draw();
      }),
  );
  $('reload').onclick = () => load().catch((error) => toast(error.message));
  $('logout').onclick = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-editor-request': '1' },
      });
      if (!response.ok) throw new Error('ออกจากระบบไม่สำเร็จ');
      location.replace('/login');
    } catch (error) {
      toast(error.message);
    }
  };
  addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  load().catch((error) => {
    $('list-status').textContent = error.message;
  });
})();
