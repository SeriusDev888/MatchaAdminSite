(() => {
  const api = window.EditorAPI,
    $ = (id) => document.getElementById(id),
    clone = structuredClone;
  const names = {
    leaf: 'ใบไม้',
    flower: 'ดอกไม้',
    shield: 'โล่',
    heart: 'หัวใจ',
    bolt: 'พลังงาน',
    moon: 'พระจันทร์',
    face: 'ผิวพรรณ',
    sun: 'แสงแดด',
    hand: 'มือ',
    star: 'ดาว',
    drop: 'หยดน้ำ',
    sparkles: 'ประกาย',
    check: 'เครื่องหมายถูก',
    flask: 'งานวิจัย',
    mountain: 'ภูเขา',
    lotus: 'ดอกบัว',
    award: 'คุณภาพ',
    bed: 'การพักผ่อน',
    globe: 'โลก',
    mail: 'อีเมล',
    chat: 'แชต',
    pin: 'สถานที่',
    arrow: 'ลูกศร',
    ...Object.fromEntries(
      Object.entries(window.StickerLibrary || {}).map(([key, item]) => [key, item.label]),
    ),
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${SiteDefaults.icons[name]}"></path></svg>`;
  const effectTarget = () => {
    const s = api.selection();
    return s?.effectTarget
      ? { id: s.effectTarget, scope: s.scope, page: location.hash.slice(1) || 'home' }
      : null;
  };
  function effectValues(target = effectTarget()) {
    const doc = api.document(),
      g = target?.scope === 'global' ? doc?.global : doc?.pages?.[target?.page];
    return (
      g?.nodes?.[target?.id]?.effect || { type: 'original', opacity: 0.7, size: 20, density: 10 }
    );
  }
  function setEffect(values, target = effectTarget()) {
    if (!target) return;
    api.patch(
      { effect: { ...effectValues(target), ...values } },
      target.scope,
      target.id,
      target.page,
    );
  }
  function syncSelection() {
    const s = api.selection(),
      target = effectTarget();
    $('effects-fields').hidden = !target;
    $('effects-empty').hidden = !!target;
    $('effect-target-name').textContent = s?.effectLabel || '';
    $('sticker-fields').hidden = !s?.isSticker;
    $('sticker-empty').hidden = !!s?.isSticker;
    if (target && !document.activeElement.closest('#effects-fields')) {
      const fx = effectValues(target);
      $('effect-type').value = fx.type || 'original';
      $('effect-image').value = fx.image || '';
      $('effect-opacity').value = fx.opacity ?? 0.7;
      $('effect-size').value = fx.size || 20;
      $('effect-density').value = fx.density || 10;
      $('effect-color').value = fx.color || '#f6aecb';
    }
    $('effect-custom').hidden = $('effect-type').value !== 'custom';
    if (s?.isSticker) {
      const activeSticker = s.patch?.sticker;
      document
        .querySelectorAll('[data-sticker]')
        .forEach((b) => b.classList.toggle('active', b.dataset.sticker === activeSticker));
      if (activeSticker) {
        const index = stickerButtons.findIndex((b) => b.dataset.sticker === activeSticker);
        if (index !== -1) {
          const targetPage = Math.floor(index / PAGE_SIZE) + 1;
          if (targetPage !== currentPage) renderPage(targetPage);
        }
      }
      $('sticker-color').value = rgbHex(s.styles.color);
      $('sticker-size').value = parseFloat(s.styles.width) || 32;
    }
  }
  function rgbHex(v) {
    const m = v?.match(/\d+/g);
    return v?.startsWith('#')
      ? v
      : m
        ? '#' +
          m
            .slice(0, 3)
            .map((n) => (+n).toString(16).padStart(2, '0'))
            .join('')
        : '#ef64a0';
  }
  for (const key of ['type', 'image', 'opacity', 'size', 'density', 'color'])
    $('effect-' + key).onchange = () => {
      const input = $('effect-' + key);
      setEffect({
        [key]: ['opacity', 'size', 'density'].includes(key) ? Number(input.value) : input.value,
      });
      $('effect-custom').hidden = $('effect-type').value !== 'custom';
    };
  for (const [id, method] of [
    ['effect-pick', 'chooseMedia'],
    ['effect-upload', 'uploadMedia'],
  ])
    $(id).onclick = () => {
      const target = effectTarget();
      api[method]((url) => {
        setEffect({ type: 'custom', image: url }, target);
        $('effect-image').value = url;
        $('effect-type').value = 'custom';
        api.tab('effects');
        syncSelection();
      });
    };
  const PAGE_SIZE = 24;
  const stickerButtons = [];
  for (const [name, label] of Object.entries(names)) {
    const b = document.createElement('button');
    b.dataset.sticker = name;
    b.type = 'button';
    b.title = label;
    b.innerHTML = icon(name) + '<span>' + label + '</span>';
    b.onclick = () => api.patch({ sticker: name });
    $('sticker-grid').append(b);
    stickerButtons.push(b);
  }
  let currentPage = 1;
  const totalPages = Math.ceil(stickerButtons.length / PAGE_SIZE) || 1;

  function renderPage(page) {
    currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    stickerButtons.forEach((b, i) => {
      b.hidden = i < start || i >= end;
    });
    if ($('sticker-page-info')) {
      $('sticker-page-info').textContent = `หน้า ${currentPage} / ${totalPages}`;
    }
    if ($('sticker-prev')) {
      $('sticker-prev').disabled = currentPage <= 1;
    }
    if ($('sticker-next')) {
      $('sticker-next').disabled = currentPage >= totalPages;
    }
  }

  if ($('sticker-prev')) $('sticker-prev').onclick = () => renderPage(currentPage - 1);
  if ($('sticker-next')) $('sticker-next').onclick = () => renderPage(currentPage + 1);
  renderPage(1);

  $('sticker-reset').onclick = () => api.patch({ sticker: '' });
  $('sticker-color').onchange = () => api.patchStyle('color', $('sticker-color').value);
  $('sticker-size').onchange = () => {
    api.patchStyle('width', $('sticker-size').value + 'px');
    api.patchStyle('height', $('sticker-size').value + 'px');
  };

  addEventListener('editor:document', syncSelection);
  addEventListener('editor:selection', () => {
    syncSelection();
    const s = api.selection();
    if (s?.isSticker) api.tab('effects');
  });
  syncSelection();
})();
