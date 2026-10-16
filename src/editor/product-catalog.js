(() => {
  const api = window.EditorAPI,
    $ = (id) => document.getElementById(id),
    clone = structuredClone;
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${SiteDefaults.icons[name]}"></path></svg>`;
  let productId = 'ceremonial',
    lastCatalog = '';
  const catalog = () =>
    (api.document()?.catalog || SiteDefaults.products).filter((p) => !p.deleted);
  const product = () => catalog().find((p) => p.id === productId) || catalog()[0];
  function updateProduct(id, values) {
    api.mutate(() => {
      const doc = api.document();
      doc.catalog ??= clone(SiteDefaults.products);
      const p = doc.catalog.find((p) => p.id === id);
      if (p) {
        Object.assign(p, values);
        p.modifiedFields = [...new Set([...(p.modifiedFields || []), ...Object.keys(values)])];
      }
    });
  }
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const host = $('tab-products'),
    toolbar = host.querySelector('.product-manager-toolbar'),
    cards = make('div', 'product-catalog-cards'),
    identity = make('div', 'product-selected-heading'),
    core = make('div', 'product-core-fields'),
    empty = make('p', 'product-catalog-empty', 'ยังไม่มีสินค้า กด “เพิ่มสินค้า” เพื่อเริ่มต้น');
  cards.id = 'product-catalog-cards';
  cards.setAttribute('aria-label', 'เลือกสินค้าที่ต้องการแก้ไข');
  core.id = 'product-core-fields';
  empty.id = 'product-catalog-empty';
  for (const child of [...host.children])
    if (child !== toolbar && !child.classList.contains('panel-intro')) core.append(child);
  toolbar.after(cards, empty, identity, core);
  const defaultPhoto = make('div', 'product-original-photo');
  defaultPhoto.id = 'product-original-photo';
  $('product-preview').after(defaultPhoto);
  const selectedTitle = make('h2', '', ''),
    selectedDescription = make('p', '', ''),
    selectedText = make('div', ''),
    remove = make('button', 'product-delete', 'ลบสินค้านี้');
  remove.id = 'product-delete';
  remove.type = 'button';
  selectedText.append(selectedTitle, selectedDescription);
  identity.append(selectedText, remove);
  const priceHelp = make('small', 'product-price-help');
  $('product-price').after(priceHelp);
  const deleteDialog = document.createElement('dialog');
  deleteDialog.id = 'product-delete-dialog';
  const deleteTitle = make('h2', '', 'ลบสินค้า?'),
    deleteText = make('p', '', ''),
    deleteActions = make('div', 'dialog-actions'),
    cancel = make('button', '', 'ยกเลิก'),
    confirm = make('button', 'product-delete', 'ลบสินค้า');
  cancel.type = confirm.type = 'button';
  cancel.id = 'product-delete-cancel';
  confirm.id = 'product-delete-confirm';
  deleteActions.append(cancel, confirm);
  deleteDialog.append(deleteTitle, deleteText, deleteActions);
  document.body.append(deleteDialog);
  let deletingId = '';
  remove.onclick = () => {
    const p = product();
    if (!p) return;
    deletingId = p.id;
    deleteText.textContent =
      'ลบ ' + p.name + ' ออกจากรายการและหน้าสินค้า สามารถกดเลิกทำก่อนบันทึกได้';
    deleteDialog.showModal();
    cancel.focus();
  };
  cancel.onclick = () => deleteDialog.close();
  confirm.onclick = () => {
    const p = catalog().find((x) => x.id === deletingId);
    if (!p) {
      deleteDialog.close();
      return;
    }
    if (SiteDefaults.products.some((x) => x.id === p.id))
      updateProduct(p.id, { deleted: true, active: false });
    else
      api.mutate(() => {
        api.document().catalog = api.document().catalog.filter((x) => x.id !== p.id);
      });
    deleteDialog.close();
    showProduct();
    api.toast('ลบ ' + p.name + ' แล้ว กดเลิกทำเพื่อเรียกคืน');
    $('product-add').focus();
  };
  function picture(p) {
    const el = make('span', 'product-card-photo');
    if (p.image) {
      const img = make('img');
      img.src = p.image;
      img.alt = '';
      el.append(img);
    } else el.textContent = 'ยังไม่มีรูป';
    return el;
  }
  function drawCards() {
    const focusId = document.activeElement?.dataset?.catalogProduct;
    cards.replaceChildren();
    for (const p of catalog()) {
      const b = make('button', 'product-catalog-card');
      b.type = 'button';
      b.dataset.catalogProduct = p.id;
      b.setAttribute('aria-pressed', String(p.id === productId));
      const text = make('span', 'product-card-copy'),
        title = make('strong', '', p.name),
        type = make(
          'span',
          '',
          p.title ||
            { ceremonial: 'Ceremonial', premium: 'Premium', culinary: 'Culinary' }[p.category],
        ),
        price = make('b', '', ProductDetails.price(p) || 'สอบถามราคา'),
        state = make(
          'small',
          '',
          p.active === false ? 'ซ่อนจากรายการสินค้า' : 'แสดงในรายการสินค้า',
        );
      text.append(title, type, price, state);
      b.append(picture(p), text);
      b.onclick = () => {
        productId = p.id;
        showProduct();
      };
      cards.append(b);
    }
    if (focusId)
      cards
        .querySelector('[data-catalog-product="' + focusId + '"]')
        ?.focus({ preventScroll: true });
  }
  function showProduct() {
    const p = product();
    core.hidden = identity.hidden = !p;
    empty.hidden = !!p;
    $('product-open').disabled = !p;
    $('product-select').disabled = !p;
    if (!p) {
      productId = '';
      drawCards();
      dispatchEvent(new Event('cms:product'));
      return;
    }
    productId = p.id;
    for (const key of [
      'name',
      'title',
      'subtitle',
      'description',
      'cardSubtitle',
      'cardDescription',
      'tag',
      'sku',
      'price',
      'buyUrl',
      'image',
      'category',
      'color',
    ])
      $('product-' + key).value = key === 'price' ? ProductDetails.price(p) : p[key] || '';
    const detail = ProductDetails.get(p);
    priceHelp.textContent =
      !p.price && detail.sampleInfo && detail.samplePrice
        ? 'ราคาตัวอย่างเดียวกับหน้าสินค้า แก้ช่องนี้เพื่อตั้งราคาสินค้า'
        : '';
    selectedTitle.textContent = (api.document()?.brand?.name || 'Golden Ray Matcha') + ' ' + p.name;
    selectedDescription.textContent = (p.title || 'สินค้า') + ' · กำลังแก้ไขข้อมูลของสินค้านี้';
    $('product-active').checked = p.active !== false;
    $('product-ingredients').value = (p.ingredients || [])
      .map((v) => v[1] + ' | ' + v[2])
      .join('\n');
    $('product-preview').src = p.image || '';
    $('product-preview').hidden = !p.image;
    const original = false;
    defaultPhoto.hidden = !original;
    defaultPhoto.setAttribute('role', 'img');
    defaultPhoto.setAttribute('aria-label', 'รูปสินค้า ' + p.name);
    $('product-original-note').hidden = !!p.image || original;
    $('product-original-note').textContent = 'ยังไม่มีรูปสินค้า — อัปโหลดหรือเลือกจากคลังรูป';
    $('product-select').value = productId;
    drawCards();
    dispatchEvent(new Event('cms:product'));
  }
  function sync() {
    if (!api.document()) return;
    const items = catalog(),
      key = JSON.stringify(items.map((p) => [p.id, p.name]));
    let changed = false;
    if (key !== lastCatalog) {
      lastCatalog = key;
      changed = true;
      $('product-select').replaceChildren(...items.map((p) => new Option(p.name, p.id)));
      if (!items.some((p) => p.id === productId)) productId = items[0]?.id || '';
      $('product-select').value = productId;
      const page = $('page-select');
      [...page.options].filter((o) => o.value.startsWith('product/')).forEach((o) => o.remove());
      for (const p of items) {
        const option = new Option(p.name, 'product/' + p.id);
        option.dataset.product = 'true';
        page.add(option);
      }
      page.value = location.hash.slice(1) || 'home';
    }
    $('product-add').disabled = (api.document().catalog || SiteDefaults.products).length >= 60;
    showProduct();
    const brand = api.document().brand || {};
    if (!document.activeElement.closest('#tab-brand'))
      for (const [key, fallback] of [
        ['name', 'Golden Ray Matcha'],
        ['mark', 'G'],
        ['tagline', 'Direct Sourcing from Japan'],
        ['logo', ''],
      ])
        $('brand-' + key).value = brand[key] ?? fallback;
    const img = $('brand-preview');
    img.src = brand.logo || '';
    img.hidden = !brand.logo;
  }
  for (const key of [
    'name',
    'title',
    'subtitle',
    'description',
    'cardSubtitle',
    'cardDescription',
    'tag',
    'sku',
    'price',
    'buyUrl',
    'image',
    'category',
    'color',
  ])
    $('product-' + key).onchange = () =>
      updateProduct(productId, { [key]: $('product-' + key).value });
  $('product-active').onchange = () =>
    updateProduct(productId, { active: $('product-active').checked });
  $('product-ingredients').onchange = () => {
    const rows = $('product-ingredients')
      .value.split('\n')
      .filter((v) => v.trim())
      .map((v) => {
        const [title, ...description] = v.split('|');
        return [title.trim().slice(0, 2), title.trim(), description.join('|').trim()];
      });
    updateProduct(productId, { ingredients: rows });
  };
  $('product-select').onchange = () => {
    productId = $('product-select').value;
    showProduct();
  };
  $('product-open').onclick = () => {
    if (!product()) return;
    api.closeManager();
    api.navigate('product/' + productId);
  };
  $('product-add').onclick = () => {
    if ((api.document().catalog || SiteDefaults.products).length >= 60) {
      api.toast('รองรับสินค้าได้สูงสุด 60 รายการ');
      return;
    }
    const id = 'item-' + crypto.randomUUID().slice(0, 8);
    api.mutate(() => {
      const doc = api.document();
      doc.catalog ??= clone(SiteDefaults.products);
      doc.catalog.push({
        id,
        name: 'NEW PRODUCT',
        title: 'สินค้าใหม่',
        subtitle: '',
        description: '',
        cardSubtitle: '',
        cardDescription: '',
        tag: 'NEW',
        mood: '',
        category: 'ceremonial',
        color: '#2e7d32',
        image: '',
        active: true,
        ingredients: [],
        benefits: [
          ['leaf', ''],
          ['heart', ''],
          ['sun', ''],
        ],
      });
    });
    productId = id;
    showProduct();
    $('product-name').focus();
  };
  function productImagePicker(upload) {
    const id = productId;
    api[upload ? 'uploadMedia' : 'chooseMedia']((url) => {
      updateProduct(id, { image: url });
      showProduct();
      api.tab('products');
    });
  }
  $('product-pick').onclick = () => productImagePicker(false);
  $('product-upload').onclick = () => productImagePicker(true);
  $('product-reset-image').onclick = () => {
    updateProduct(productId, { image: '' });
    showProduct();
  };
  window.CMSAdmin = {
    getProduct: product,
    getCatalog: catalog,
    updateProduct,
    updateProductImage: (id, image) => updateProduct(id, { image }),
    selectProduct: (id) => {
      productId = id;
      showProduct();
      api.tab('products');
    },
  };
  addEventListener('editor:document', sync);
  addEventListener('editor:selection', () => {
    const s = api.selection();
    if (s?.isBrand) api.tab('brand');
  });
  sync();
})();
