// Matcha-specific fields share the template's undo/draft/publication lifecycle.
(() => {
  // These supplement-template fields have no counterpart on the wholesale site.
  for (const key of [
    'title',
    'subtitle',
    'cardSubtitle',
    'cardDescription',
    'sku',
    'price',
    'buyUrl',
    'ingredients',
  ])
    document.getElementById('product-' + key).closest('label').hidden = true;
  const panel = document.createElement('div');
  panel.className = 'matcha-fields field-grid';
  document.getElementById('product-core-fields').append(panel);
  const fields = [
    ['origin', 'แหล่งปลูก / Origin'],
    ['cultivar', 'สายพันธุ์ / Cultivar'],
    ['harvestSeason', 'ฤดูเก็บเกี่ยว / Harvest'],
    ['packagingDetails', 'ขนาดบรรจุ (หนึ่งรายการต่อบรรทัด)'],
  ];
  for (const [key, label] of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.textContent = label;
    const input = document.createElement(key === 'packagingDetails' ? 'textarea' : 'input');
    input.id = 'matcha-' + key;
    input.maxLength = key === 'packagingDetails' ? 10000 : 250;
    if (key === 'packagingDetails') input.rows = 4;
    input.onchange = () => {
      const product = CMSAdmin.getProduct();
      if (!product) return;
      CMSAdmin.updateProduct(product.id, {
        [key]:
          key === 'packagingDetails'
            ? input.value
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean)
            : input.value,
      });
    };
    wrapper.append(input);
    panel.append(wrapper);
  }
  function sync() {
    const product = CMSAdmin.getProduct();
    panel.hidden = !product;
    if (!product) return;
    for (const [key] of fields) {
      const input = document.getElementById('matcha-' + key);
      if (input !== document.activeElement)
        input.value = Array.isArray(product[key]) ? product[key].join('\n') : product[key] || '';
    }
  }
  addEventListener('cms:product', sync);
  sync();
})();
