(() => {
  const panel = document.getElementById('tab-contact');
  panel.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'panel-intro';
  intro.innerHTML =
    '<span class="tiny">WHOLESALE ENQUIRIES</span><h2>ข้อมูลติดต่อ</h2><p>ใช้ร่วมกับหน้าติดต่อ ส่วนหัว และส่วนท้ายของเว็บไซต์</p>';
  panel.append(intro);
  const fields = [
    ['email', 'อีเมล', 'email'],
    ['phoneNumber', 'เบอร์โทรศัพท์', 'tel'],
    ['lineOaId', 'LINE OA ID'],
    ['lineOaUrl', 'ลิงก์ LINE OA', 'url'],
    ['availableTimeDescription', 'วันและเวลาทำการ'],
    ['addressAsText', 'ที่อยู่', 'textarea'],
    ['mapLatitude', 'ละติจูด'],
    ['mapLongitude', 'ลองจิจูด'],
    ['mapLocationName', 'ชื่อสถานที่บนแผนที่'],
  ];
  for (const [key, label, type] of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.textContent = label;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type && type !== 'textarea') input.type = type;
    input.id = 'contact-' + key;
    input.maxLength = 1500;
    input.onchange = () =>
      EditorAPI.mutate(() => {
        EditorAPI.document().contact = { ...EditorAPI.document().contact, [key]: input.value };
      });
    wrapper.append(input);
    panel.append(wrapper);
  }
  function sync() {
    const contact = EditorAPI.document()?.contact || {};
    for (const [key] of fields) {
      const input = document.getElementById('contact-' + key);
      if (document.activeElement !== input) input.value = contact[key] || '';
    }
  }
  addEventListener('editor:document', sync);
  sync();
})();
