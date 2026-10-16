(() => {
  'use strict';
  const $ = (id) => document.getElementById(id),
    all = (s) => [...document.querySelectorAll(s)],
    copy = (x) => structuredClone(x);
  const pages = [
    ['home', 'Home · หน้าแรก'],
    ['products', 'Products · สินค้ามัทฉะ'],
    ['guide', 'User Guide · คู่มือการชง'],
    ['about', 'About Us · เกี่ยวกับเรา'],
    ['catalog', 'Catalog · เอกสารและแคตตาล็อก'],
    ['contact', 'Contact · ติดต่อเรา'],
  ];
  const originals = [
    'hero-matcha.jpg',
    'logo.jpg',
    'guide-matcha-preparation.jpg',
    'product-ceremonial-grade.jpg',
    'product-premium-latte.jpg',
    'product-culinary-bakery.jpg',
    'region-shizuoka.jpg',
    'region-fukuoka.jpg',
    'region-kyotouji.jpg',
    'region-kagoshima.jpg',
  ];
  const sitePath = (page) =>
    page.startsWith('product/')
      ? '/products#' + encodeURIComponent(page.slice(8))
      : page === 'home'
        ? '/'
        : '/' + page;
  let doc,
    revision = 0,
    publishedRevision = 0,
    saved = '',
    selected = null,
    route = location.hash.slice(1) || 'home',
    undo = [],
    redo = [],
    busy = false,
    uploadApply = false,
    mediaCallback = null,
    manager = null,
    outlineItems = [],
    draggedSection = null;
  const frame = $('preview'),
    signature = () => JSON.stringify(doc),
    dirty = () => doc && signature() !== saved;
  const send = (type, data = {}) => {
    if (type === 'state' && !data.document) return;
    frame.contentWindow?.postMessage({ source: 'matcha-editor', type, ...data }, location.origin);
  };
  let currentUser = null;
  const can = (permission) =>
    currentUser?.role === 'superadmin' || currentUser?.permissions?.includes(permission);
  const anyEdit = () => ['content.edit', 'products.edit', 'brand.edit', 'contact.edit'].some(can);
  function applyPermissions() {
    if (!currentUser) return;
    $('users-link').hidden = currentUser.role !== 'superadmin';
    $('logs-link').hidden = false;
    $('current-role').textContent = currentUser.role.toUpperCase();
    for (const [name, permission] of Object.entries({
      products: 'products.edit',
      brand: 'brand.edit',
      contact: 'contact.edit',
    }))
      all('[data-manager="' + name + '"]').forEach((el) => (el.hidden = !can(permission)));
    $('publish').disabled = busy || !can('content.publish');
    $('save').disabled = busy || !anyEdit();
    $('element-fields').inert = busy || !can('content.edit');
    for (const id of ['tab-theme', 'tab-effects']) {
      const el = $(id);
      if (el) el.inert = busy || !can('content.edit');
    }
    $('file-input').disabled = busy || !can('media.upload');
  }
  const stableDocument = (value) =>
    JSON.stringify(value, function (_key, item) {
      return item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item;
    });
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 5500);
  }
  async function api(path, method = 'GET', body) {
    const options = { method, headers: { 'x-editor-request': '1' } };
    if (body !== undefined) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch('/api/' + path, options);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('ไม่สามารถเชื่อมต่อระบบบันทึกได้ กรุณาลองใหม่');
    }
    if (response.status === 401) $('reauth').hidden = false;
    if (data.redirect === '/pending') {
      saved = signature();
      location.replace('/pending');
    }
    if (!response.ok) throw new Error(data.error || 'ทำรายการไม่สำเร็จ');
    $('reauth').hidden = true;
    return data;
  }
  $('logout').onclick = () => {
    if (busy || (dirty() && !confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่?')))
      return;
    locked(async () => {
      await api('auth/logout', 'POST', {});
      saved = signature();
      sessionStorage.removeItem('studio-return-hash');
      location.replace('/login');
    });
  };
  addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  let checkingMembership = false;
  async function checkMembership() {
    if (!currentUser || checkingMembership || document.hidden) return;
    checkingMembership = true;
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store' });
      if (response.ok) {
        const session = await response.json();
        if (session.authenticated && !session.approved) {
          saved = signature();
          location.replace('/pending');
        }
      }
    } catch {
    } finally {
      checkingMembership = false;
    }
  }
  setInterval(() => void checkMembership(), 5000);
  addEventListener('focus', () => void checkMembership());
  function status() {
    $('save-state').textContent = busy
      ? 'กำลังบันทึก…'
      : dirty()
        ? 'มีการแก้ไขที่ยังไม่บันทึก'
        : 'บันทึกฉบับร่างแล้ว';
    $('undo').disabled = !undo.length || busy;
    $('redo').disabled = !redo.length || busy;
    for (const id of ['save', 'publish', 'reload']) $(id).disabled = busy;
    applyPermissions();
    if (doc) dispatchEvent(new Event('editor:document'));
  }
  const group = (scope = 'page', page = route) =>
    scope === 'global'
      ? (doc.global ??= { nodes: {}, additions: [], order: {} })
      : (doc.pages[page] ??= { nodes: {}, additions: [], order: {} });
  const readGroup = (scope = 'page') => (scope === 'global' ? doc.global : doc.pages[route]);
  function mutate(fn) {
    if (busy) return;
    const before = signature();
    fn();
    if (currentUser?.role !== 'superadmin') {
      const old = JSON.parse(before),
        groups = { catalog: 'products.edit', brand: 'brand.edit', contact: 'contact.edit' };
      const denied = [...new Set([...Object.keys(old), ...Object.keys(doc)])].some(
        (key) =>
          key !== 'schema' &&
          stableDocument(old[key]) !== stableDocument(doc[key]) &&
          !can(groups[key] || 'content.edit'),
      );
      if (denied) {
        doc = old;
        send('state', { document: doc });
        status();
        toast('คุณไม่มีสิทธิ์แก้ไขส่วนนี้');
        return;
      }
    }
    if (signature() === before) return;
    undo.push(before);
    if (undo.length > 80) undo.shift();
    redo = [];
    send('state', { document: doc });
    status();
  }
  function patch(values, scope = selected?.scope, id = selected?.id, page = route) {
    if (!id) return;
    if (scope !== 'global' && SiteDefaults.isProductRoute(page)) return;
    if (
      values.image !== undefined &&
      id === selected?.id &&
      selected.productId &&
      window.CMSAdmin
    ) {
      CMSAdmin.updateProductImage(selected.productId, values.image);
      return;
    }
    mutate(() => {
      const g = group(scope, page);
      g.nodes ??= {};
      const old = g.nodes[id] || {},
        previous = old.text !== undefined ? old.text : id === selected?.id ? selected.text : null;
      if (values.text !== undefined && !values.text.trim() && previous?.trim())
        values = { ...values, lastText: previous };
      g.nodes[id] = { ...old, ...values };
    });
    if (selected?.id === id) {
      selected.patch = { ...selected.patch, ...values };
      if (values.text !== undefined) selected.text = values.text;
      syncTextRecovery();
    }
    dispatchEvent(new Event('editor:selection'));
  }
  function patchStyle(key, value) {
    if (!selected) return;
    const field = $('style-scope').value === 'mobile' ? 'mobileStyles' : 'styles';
    const old = readGroup(selected.scope)?.nodes?.[selected.id]?.[field] || {};
    const styles = { ...old };
    if (value === '') delete styles[key];
    else styles[key] = value;
    patch({ [field]: styles });
  }
  const managerScreen = $('management-screen'),
    managerPanels = $('management-panels'),
    inspector = document.querySelector('.inspector'),
    studioBody = document.querySelector('.studio-body');
  for (const name of ['products', 'brand', 'contact']) managerPanels.append($('tab-' + name));
  const productsPanel = $('tab-products');
  function productGroup(className, items) {
    const box = document.createElement('div');
    box.className = className;
    items[0].before(box);
    items.forEach((el) => box.append(el));
    return box;
  }
  productGroup('product-manager-toolbar', [
    $('product-select').closest('label'),
    $('product-add').parentElement,
  ]);
  productGroup('product-manager-media', [
    $('product-preview'),
    $('product-original-note'),
    $('product-image').closest('label'),
    $('product-pick').parentElement,
    $('product-reset-image'),
  ]);

  function closeManager() {
    mediaCallback = null;
    managerScreen.hidden = true;
    studioBody.hidden = false;
    document.body.classList.remove('management-open');
    inspector.append($('tab-media'));
    $('page-select').disabled = false;
    manager = null;
    all('[data-manager]').forEach((b) => b.classList.remove('active'));
    tab('element');
  }
  function tab(name) {
    if (['products', 'brand', 'contact'].includes(name)) {
      if (manager && manager !== name) mediaCallback = null;
      manager = name;
      managerScreen.dataset.manager = name;
      studioBody.hidden = true;
      managerScreen.hidden = false;
      document.body.classList.add('management-open');
      $('page-select').disabled = true;
      $('manager-title').textContent = {
        products: 'จัดการสินค้า',
        brand: 'โลโก้และชื่อแบรนด์',
        contact: 'Contact',
      }[name];
      all('[data-manager]').forEach((b) =>
        b.classList.toggle('active', b.dataset.manager === name),
      );
      all('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
      managerScreen.scrollTop = 0;
      return;
    }
    if (name === 'media' && manager) {
      managerPanels.append($('tab-media'));
      $('manager-title').textContent = 'เลือกภาพจากคลัง';
      all('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-media'));
      loadMedia();
      return;
    }
    if (manager) closeManager();
    all('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    all('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
    if (name === 'media') loadMedia();
    if (name === 'versions') loadVersions();
  }
  $('manager-back').onclick = () => {
    closeManager();
    document.querySelector('[data-manager="products"]').focus();
  };
  all('[data-manager]').forEach((b) => (b.onclick = () => tab(b.dataset.manager)));
  all('[data-tab]').forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
  function hex(color) {
    if (/^#[a-f\d]{6}$/i.test(color)) return color;
    const n = color?.match(/[\d.]+/g);
    return n && n.length >= 3
      ? '#' +
          n
            .slice(0, 3)
            .map((x) => Math.round(Number(x)).toString(16).padStart(2, '0'))
            .join('')
      : '#ffffff';
  }
  function populate(element) {
    selected = element;
    $('no-selection').hidden = true;
    $('element-fields').hidden = false;
    $('element-tag').textContent =
      element.scope === 'global' ? 'ทั้งเว็บไซต์ · ' + element.tag : element.tag;
    $('element-name').textContent = element.label;
    $('text-field').hidden = element.text === null;
    $('text-value').value = element.text || '';
    $('link-field').hidden = element.href === null;
    $('link-value').value = element.href || '';
    $('image-value').value = element.image || '';
    $('alt-value').value = element.alt || '';
    $('remove-image').hidden = element.imageKind !== 'background';
    $('image-label').textContent = element.productId
      ? 'รูปสินค้า · ใช้ร่วมกันทุกหน้า'
      : 'รูป / ภาพพื้นหลัง';
    const p = readGroup(element.scope)?.nodes?.[element.id] || {};
    element.patch = p;
    const styles = {
      ...element.styles,
      ...p.styles,
      ...($('style-scope').value === 'mobile' ? p.mobileStyles : {}),
    };
    all('[data-style]').forEach((input) => {
      let v = styles[input.dataset.style] || '';
      if (input.type === 'color') v = hex(v);
      if (input.dataset.unit) v = parseFloat(v) || '';
      input.value = v;
    });
    $('select-parent').disabled = !element.parent;
    syncTextRecovery();
    all('.layer-item').forEach((b) => b.classList.toggle('active', b.dataset.id === element.id));
    dispatchEvent(new Event('editor:selection'));
  }
  function syncTextRecovery() {
    $('toggle-element-visibility').textContent = selected?.patch?.hidden
      ? 'แสดงองค์ประกอบนี้'
      : 'ซ่อนองค์ประกอบนี้';
    $('toggle-element-visibility').setAttribute('aria-pressed', String(!!selected?.patch?.hidden));
    const text = selected?.text,
      patch = selected?.patch || {};
    $('text-recovery').hidden = text === null || text === undefined;
    $('restore-original-text').disabled = patch.text === undefined;
    $('restore-last-text').hidden = !!text?.trim() || !patch.lastText?.trim();
  }
  $('toggle-element-visibility').onclick = () => {
    if (!selected) return;
    patch({ hidden: !selected.patch?.hidden });
    send('select', { id: selected.id });
  };
  $('restore-last-text').onclick = () => {
    if (!selected?.patch?.lastText) return;
    patch({ text: selected.patch.lastText });
    send('select', { id: selected.id });
  };
  $('restore-original-text').onclick = () => {
    if (!selected) return;
    mutate(() => {
      const node = group(selected.scope).nodes?.[selected.id];
      if (node) delete node.text;
    });
    send('select', { id: selected.id });
  };
  function drawEmptyTexts(items) {
    $('empty-texts-panel').hidden = !items.length;
    $('empty-text-count').textContent = '(' + items.length + ')';
    $('empty-texts-list').replaceChildren();
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'empty-text-item';
      b.dataset.id = item.id;
      b.textContent = item.label;
      b.title = item.label;
      b.onclick = () => {
        send('select', { id: item.id });
        tab('element');
      };
      $('empty-texts-list').append(b);
    }
  }
  $('style-scope').onchange = () => selected && populate(selected);
  function swapSections(first, second) {
    if (SiteDefaults.isProductRoute(route)) return;
    const a = outlineItems.find((v) => v.id === first),
      b = outlineItems.find((v) => v.id === second);
    if (
      !a?.reorderable ||
      !b?.reorderable ||
      a.scope !== 'page' ||
      b.scope !== 'page' ||
      a.parent !== b.parent ||
      first === second
    )
      return;
    const ids = [...a.siblings],
      i = ids.indexOf(first),
      j = ids.indexOf(second);
    if (i < 0 || j < 0) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    mutate(() => {
      const g = group('page');
      g.order ??= {};
      g.order[a.parent] = ids;
    });
    $('order-status').textContent = 'สลับลำดับ ' + a.label + ' กับ ' + b.label + ' แล้ว';
  }
  function drawOutline(items) {
    outlineItems = items;
    $('outline').replaceChildren();
    let number = 0;
    for (const item of items) {
      const row = document.createElement('div');
      row.className =
        'layer-row' +
        (item.depth ? ' is-child' : '') +
        (item.scope === 'global' ? ' is-locked' : '');
      row.dataset.section = item.id;
      const b = document.createElement('button');
      b.className = 'layer-item' + (selected?.id === item.id ? ' active' : '');
      b.dataset.id = item.id;
      b.title = item.label;
      const icon = document.createElement('i');
      icon.textContent =
        item.scope === 'global' ? '◆' : item.depth ? '↳' : String(++number).padStart(2, '0');
      const label = document.createElement('span');
      label.textContent = item.label;
      b.append(icon, label);
      b.onclick = () => {
        send('select', { id: item.id });
        tab('element');
      };
      row.append(b);
      if (item.reorderable) {
        row.draggable = true;
        b.title = item.label + ' · ลากเพื่อสลับลำดับ';
        const controls = document.createElement('div');
        controls.className = 'section-order-buttons';
        const grip = document.createElement('span');
        grip.textContent = '⠿';
        grip.className = 'section-grip';
        grip.title = 'ลากไปวางบนส่วนอื่นเพื่อสลับ';
        row.prepend(grip);
        for (const [delta, title, text] of [
          [-1, 'เลื่อนขึ้น', '↑'],
          [1, 'เลื่อนลง', '↓'],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = text;
          button.title = title;
          button.setAttribute('aria-label', title + ' ' + item.label);
          button.dataset.order = delta;
          const index = item.siblings.indexOf(item.id);
          button.disabled = index + delta < 0 || index + delta >= item.siblings.length;
          button.onclick = () => swapSections(item.id, item.siblings[index + delta]);
          controls.append(button);
        }
        row.append(controls);
        row.ondragstart = (e) => {
          draggedSection = item.id;
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'move';
          row.classList.add('dragging');
        };
        row.ondragover = (e) => {
          const source = outlineItems.find((v) => v.id === draggedSection);
          if (source?.parent !== item.parent || draggedSection === item.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('drop-target');
        };
        row.ondragleave = () => row.classList.remove('drop-target');
        row.ondrop = (e) => {
          e.preventDefault();
          row.classList.remove('drop-target');
          swapSections(draggedSection, item.id);
          draggedSection = null;
        };
        row.ondragend = () => {
          draggedSection = null;
          all('.layer-row').forEach((r) => r.classList.remove('dragging', 'drop-target'));
        };
      } else if (item.scope === 'global') {
        const lock = document.createElement('span');
        lock.className = 'section-lock';
        lock.textContent = 'ล็อก';
        lock.title = 'ส่วนหัวและส่วนท้ายคงตำแหน่งเดิม';
        row.append(lock);
      }
      $('outline').append(row);
    }
  }
  window.addEventListener('message', (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== frame.contentWindow ||
      event.data?.source !== 'matcha-preview'
    )
      return;
    const m = event.data;
    if (m.type === 'ready') {
      route = m.route;
      syncProductLock();
      location.hash = route;
      $('page-select').value = route;
      $('open-live').href = '/site' + sitePath(route);
      send('state', { document: doc });
      send('interactive', { value: $('interactive').checked });
    }
    if (m.type === 'outline') drawOutline(m.items);
    if (m.type === 'emptyTexts') drawEmptyTexts(m.items);
    if (m.type === 'hiddenElements') {
      const panel = $('hidden-elements-panel'),
        list = $('hidden-elements-list');
      panel.hidden = !m.items.length;
      $('hidden-element-count').textContent = '(' + m.items.length + ')';
      list.replaceChildren();
      for (const item of m.items) {
        const b = document.createElement('button');
        b.className = 'empty-text-item';
        b.textContent = item.label;
        b.onclick = () => {
          send('select', { id: item.id });
          tab('element');
        };
        list.append(b);
      }
    }
    if (
      m.type === 'selected' &&
      !(m.element.scope === 'page' && SiteDefaults.isProductRoute(m.route))
    )
      populate(m.element);
    if (m.type === 'inlineText') {
      patch({ text: m.text }, m.scope, m.id, m.route);
      if (selected?.id === m.id) $('text-value').value = m.text;
    }
  });
  for (const [value, label] of pages) $('page-select').add(new Option(label, value));
  function navigate(page) {
    route = page;
    syncProductLock();
    location.hash = route;
    $('page-select').value = route;
    selected = null;
    $('no-selection').hidden = false;
    $('element-fields').hidden = true;
    const [pathname, hash] = sitePath(route).split('#');
    frame.src =
      '/preview' +
      pathname +
      '?editor-preview=1&studio-route=' +
      encodeURIComponent(route) +
      (hash ? '#' + hash : '');
    $('open-live').href = '/site' + sitePath(route);
  }
  function syncProductLock() {
    const locked = SiteDefaults.isProductRoute(route);
    $('product-page-lock').hidden = !locked;
    if (locked) {
      selected = null;
      $('no-selection').hidden = false;
      $('element-fields').hidden = true;
    }
  }
  $('page-select').onchange = () => navigate($('page-select').value);
  $('text-value').oninput = () => patch({ text: $('text-value').value });
  $('link-value').onchange = () => patch({ href: $('link-value').value.trim() });
  $('image-value').onchange = () => patch({ image: $('image-value').value.trim() });
  $('alt-value').onchange = () => patch({ alt: $('alt-value').value });
  $('remove-image').onclick = () => {
    patch({ image: '' });
    $('image-value').value = '';
  };
  all('[data-style]').forEach(
    (input) =>
      (input.onchange = () =>
        patchStyle(
          input.dataset.style,
          input.value + (input.value && input.dataset.unit ? input.dataset.unit : ''),
        )),
  );
  $('select-parent').onclick = () => send('parent');
  $('reset-element').onclick = () => {
    if (!selected) return;
    mutate(() => delete group(selected.scope).nodes[selected.id]);
    send('select', { id: selected.id });
  };
  function history(direction) {
    const from = direction === 'undo' ? undo : redo,
      to = direction === 'undo' ? redo : undo;
    if (!from.length || busy) return;
    to.push(signature());
    doc = JSON.parse(from.pop());
    send('state', { document: doc });
    syncTheme();
    status();
    if (selected) send('select', { id: selected.id });
  }
  $('undo').onclick = () => history('undo');
  $('redo').onclick = () => history('redo');
  const defaults = {
    background: '#fffaf6',
    text: '#152d4e',
    accent: '#15533f',
    surface: '#fffdfb',
  };
  const themes = {
    original: {},
    garden: { ...defaults, font: 'sans' },
    rose: {
      background: '#fff6f8',
      text: '#251653',
      accent: '#ac3971',
      surface: '#ffffff',
      font: 'thai',
    },
    night: {
      background: '#182d29',
      text: '#f0eadb',
      accent: '#976647',
      surface: '#29433d',
      font: 'sans',
    },
  };
  function syncTheme() {
    all('[data-theme-color]').forEach(
      (i) => (i.value = doc.theme[i.dataset.themeColor] || defaults[i.dataset.themeColor]),
    );
    $('theme-font').value = doc.theme.font || 'original';
  }
  all('[data-theme]').forEach(
    (b) =>
      (b.onclick = () => {
        mutate(() => (doc.theme = copy(themes[b.dataset.theme])));
        syncTheme();
      }),
  );
  all('[data-theme-color]').forEach(
    (i) => (i.onchange = () => mutate(() => (doc.theme[i.dataset.themeColor] = i.value))),
  );
  $('theme-font').onchange = () => mutate(() => (doc.theme.font = $('theme-font').value));
  all('[data-width]').forEach(
    (b) =>
      (b.onclick = () => {
        all('[data-width]').forEach((x) => x.classList.toggle('active', x === b));
        frame.style.width = b.dataset.width === 'full' ? '100%' : b.dataset.width + 'px';
        $('canvas-size').textContent =
          b.dataset.width === 'full' ? 'เต็มพื้นที่' : b.dataset.width + ' px';
      }),
  );
  $('interactive').onchange = () => send('interactive', { value: $('interactive').checked });
  async function save() {
    if (!dirty()) return;
    const snapshot = copy(doc),
      result = await api('editor/draft', 'PUT', { document: snapshot, revision });
    revision = result.revision;
    saved = JSON.stringify(snapshot);
    status();
  }
  async function locked(fn) {
    if (busy) return;
    busy = true;
    $('element-fields').inert = true;
    status();
    try {
      await fn();
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
      $('element-fields').inert = false;
      status();
    }
  }
  $('save').onclick = () =>
    locked(async () => {
      await save();
      toast('บันทึกฉบับร่างแล้ว ผู้เข้าชมยังเห็นเวอร์ชันเดิม');
    });
  async function load() {
    const data = await api('editor/draft');
    doc = data.document;
    revision = data.revision;
    publishedRevision = data.publishedRevision;
    saved = signature();
    undo = [];
    redo = [];
    selected = null;
    syncTheme();
    send('state', { document: doc });
    $('no-selection').hidden = false;
    $('element-fields').hidden = true;
    status();
  }
  $('reload').onclick = () => {
    if (dirty() && !confirm('โหลดฉบับล่าสุด? การแก้ไขที่ยังไม่บันทึกในแท็บนี้จะถูกแทนที่')) return;
    locked(async () => {
      await load();
      toast('โหลดฉบับล่าสุดแล้ว');
    });
  };
  $('publish').onclick = () => $('publish-dialog').showModal();
  $('cancel-publish').onclick = () => $('publish-dialog').close();
  $('confirm-publish').onclick = () => {
    $('publish-dialog').close();
    locked(async () => {
      await save();
      const result = await api('editor/publish', 'POST', { revision, publishedRevision });
      publishedRevision = result.publishedRevision;
      toast('เผยแพร่แล้ว เปิดหน้าเว็บเพื่อดูการเปลี่ยนแปลง');
      loadVersions();
    });
  };
  async function loadVersions() {
    try {
      const result = await api('editor/versions');
      $('versions-list').replaceChildren();
      if (!result.versions.length) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'ยังไม่มีเวอร์ชันที่เผยแพร่จากตัวแก้ไข';
        $('versions-list').append(p);
      }
      result.versions.forEach((v, i) => {
        const card = document.createElement('div');
        card.className = 'version-card version-item';
        const time = document.createElement('p');
        time.textContent =
          new Date(v.created_at).toLocaleString('th-TH') + (i === 0 ? ' · ล่าสุด' : '');
        const b = document.createElement('button');
        b.textContent = 'นำมาเป็นฉบับร่าง';
        b.onclick = () => {
          if (dirty() && !confirm('แทนที่ฉบับร่างที่กำลังแก้ด้วยเวอร์ชันนี้?')) return;
          locked(async () => {
            const result = await api('editor/restore', 'POST', { id: v.id, revision });
            undo.push(signature());
            redo = [];
            doc = result.document;
            revision = result.revision;
            saved = signature();
            send('state', { document: doc });
            syncTheme();
            toast('คืนเวอร์ชันเป็นฉบับร่างแล้ว ตรวจดูก่อนเผยแพร่');
          });
        };
        card.append(time, b);
        $('versions-list').append(card);
      });
    } catch (error) {
      toast(error.message);
    }
  }
  $('refresh-versions').onclick = loadVersions;
  async function loadMedia() {
    try {
      const result = await api('editor/media');
      $('media-library').replaceChildren();
      for (const item of [
        ...result.media.filter((item) => item.mime !== 'application/pdf'),
        ...originals.map((filename) => ({ filename, url: '/images/' + filename })),
      ]) {
        const b = document.createElement('button');
        b.className = 'media-item media-tile';
        b.title = item.filename;
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.filename;
        img.loading = 'lazy';
        const name = document.createElement('span');
        name.textContent = item.filename;
        b.append(img, name);
        b.onclick = () => {
          if (mediaCallback) {
            const callback = mediaCallback;
            mediaCallback = null;
            callback(item.url);
            return;
          }
          if (!selected) {
            toast('เลือกองค์ประกอบในหน้าตัวอย่างก่อนเลือกภาพ');
            return;
          }
          patch({ image: item.url });
          $('image-value').value = item.url;
          tab('element');
          toast('เปลี่ยนรูปในฉบับร่างแล้ว');
        };
        $('media-library').append(b);
      }
    } catch (error) {
      toast(error.message);
    }
  }
  $('pick-image').onclick = () => {
    mediaCallback = null;
    tab('media');
  };
  $('upload-image').onclick = () => {
    mediaCallback = null;
    uploadApply = true;
    $('file-input').click();
  };
  $('library-upload').onclick = () => {
    uploadApply = false;
    $('file-input').click();
  };
  $('file-input').onchange = async () => {
    const file = $('file-input').files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('รูปต้องมีขนาดไม่เกิน 10 MB');
      return;
    }
    const target =
      uploadApply && selected ? { id: selected.id, scope: selected.scope, page: route } : null;
    let uploaded;
    await locked(async () => {
      uploaded = await StudioUpload(file);
      await loadMedia();
      toast('อัปโหลดรูปและเก็บในคลังแล้ว');
    });
    if (uploaded && mediaCallback) {
      const callback = mediaCallback;
      mediaCallback = null;
      callback(uploaded.url);
    } else if (uploaded && target) {
      patch({ image: uploaded.url }, target.scope, target.id, target.page);
      if (selected?.id === target.id) $('image-value').value = uploaded.url;
    }
    $('file-input').value = '';
  };
  addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  function shortcut(action) {
    if (!doc || busy || document.querySelector('dialog[open]')) return;
    if (action === 'save') $('save').click();
    else if (action === 'undo' || action === 'redo') history(action);
  }
  addEventListener('keydown', (event) => {
    const typing = event.target.isContentEditable || event.target.matches('input,textarea,select');
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.isComposing ||
      document.querySelector('dialog[open]')
    )
      return;
    const key = event.code?.startsWith('Key')
        ? event.code.slice(3).toLowerCase()
        : event.key.toLowerCase(),
      action =
        key === 's'
          ? 'save'
          : key === 'y' || (key === 'z' && event.shiftKey)
            ? 'redo'
            : key === 'z'
              ? 'undo'
              : null;
    if (!action) return;
    event.preventDefault();
    // Commit fields that save on change before applying document history.
    if (event.target.matches('input,textarea,select')) event.target.blur();
    shortcut(action);
  });
  addEventListener('message', (event) => {
    if (
      event.origin === location.origin &&
      event.source === frame.contentWindow &&
      event.data?.source === 'matcha-preview' &&
      event.data.type === 'shortcut'
    )
      shortcut(event.data.action);
  });
  window.EditorAPI = {
    can,
    document: () => doc,
    selection: () => selected,
    mutate,
    patch,
    patchStyle,
    navigate,
    tab,
    closeManager,
    toast,
    chooseMedia: (callback) => {
      mediaCallback = callback;
      tab('media');
    },
    uploadMedia: (callback) => {
      mediaCallback = callback;
      uploadApply = false;
      $('file-input').click();
    },
  };
  (async () => {
    try {
      const session = await api('editor/session');
      if (!session.canEdit) {
        location.replace('/login' + location.hash);
        return;
      }
      currentUser = session.user;
      await load();
      $('gate').hidden = true;
      $('studio').hidden = false;
      navigate(
        pages.some((p) => p[0] === route) ||
          (doc.catalog || []).some((p) => 'product/' + p.id === route)
          ? route
          : 'home',
      );
    } catch (error) {
      $('gate-message').textContent = error.message;
    }
  })();
})();
