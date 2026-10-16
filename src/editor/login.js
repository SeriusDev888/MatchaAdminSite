(() => {
  const $ = (id) => document.getElementById(id);
  let mode = location.pathname.startsWith('/register') ? 'register' : 'login';
  const next = new URLSearchParams(location.search).get('next'),
    destination = ['/editor.html', '/users', '/logs'].includes(next) ? next : '/';
  $('google-login').onclick = () =>
    location.assign('/api/auth/google/start?next=' + encodeURIComponent(destination));
  async function api(path, body) {
    const response = await fetch('/api/auth/' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', 'x-editor-request': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ไม่สามารถเชื่อมต่อระบบได้');
    return data;
  }
  const submitLabel = () =>
    mode === 'setup'
      ? 'สร้างบัญชี superadmin'
      : mode === 'register'
        ? 'สมัครและส่งคำขออนุมัติ'
        : 'เข้าสู่ระบบ';
  $('toggle-password').onclick = () => {
    const visible = $('password').type === 'password';
    $('password').type = visible ? 'text' : 'password';
    $('toggle-password').textContent = visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน';
    $('toggle-password').setAttribute('aria-pressed', String(visible));
  };
  $('login-form').onsubmit = async (event) => {
    event.preventDefault();
    $('form-error').hidden = true;
    if (mode !== 'login' && $('password').value !== $('confirm-password').value) {
      $('form-error').textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
      $('form-error').hidden = false;
      $('confirm-password').focus();
      return;
    }
    $('submit').disabled = true;
    $('login-form').setAttribute('aria-busy', 'true');
    $('submit-label').textContent = 'กำลังดำเนินการ…';
    try {
      const result = await api(mode, {
        email: $('email').value,
        password: $('password').value,
        name: $('display-name').value || undefined,
        setupToken: $('setup-token').value,
      });
      location.replace(
        result.redirect === '/pending'
          ? '/pending'
          : destination + (sessionStorage.getItem('studio-return-hash') || ''),
      );
    } catch (error) {
      $('form-error').textContent = error.message;
      $('form-error').hidden = false;
    } finally {
      $('submit').disabled = false;
      $('login-form').removeAttribute('aria-busy');
      $('submit-label').textContent = submitLabel();
    }
  };
  (async () => {
    try {
      if (location.hash) sessionStorage.setItem('studio-return-hash', location.hash);
      const status = await api('status');
      if (status.authenticated) {
        location.replace(status.approved ? destination : '/pending');
        return;
      }
      if (!status.initialized) {
        if (!status.canSetup) {
          $('status-message').textContent =
            'ระบบยังไม่ได้ตั้งค่าบัญชี กรุณาติดต่อเจ้าของระบบเพื่อเริ่มใช้งาน';
          return;
        }
        mode = 'setup';
      }
      if (mode !== 'login') {
        $('form-title').textContent =
          mode === 'setup' ? 'ตั้งค่าบัญชี superadmin' : 'สมัครเป็นผู้ดูแลเว็บไซต์';
        $('form-description').textContent =
          mode === 'setup'
            ? 'บัญชีแรกมีสิทธิ์อนุมัติและจัดการผู้ใช้ทั้งหมด'
            : 'หลังสมัครต้องรอ superadmin อนุมัติก่อนเข้าแก้ไขเว็บไซต์';
        $('password').autocomplete = 'new-password';
        $('password').minLength = 12;
        $('password').setAttribute('aria-describedby', 'password-help');
        $('password-help').hidden = false;
        $('confirm-field').hidden = false;
        $('confirm-password').required = true;
        $('name-field').hidden = false;
        $('display-name').required = mode === 'register';
        $('token-field').hidden = mode !== 'setup' || !status.requiresSetupToken;
        $('setup-token').required = mode === 'setup' && status.requiresSetupToken;
      }
      $('submit-label').textContent = submitLabel();
      $('google-section').hidden = mode === 'setup';
      $('google-login').disabled = !status.googleEnabled;
      $('google-unavailable').hidden = status.googleEnabled;
      const googleError = new URLSearchParams(location.search).get('google_error');
      if (googleError) {
        const messages = {
          database: 'Google Login ยังไม่พร้อมใช้งาน กรุณาติดต่อเจ้าของระบบเพื่ออัปเดตฐานข้อมูล',
          cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว',
          state: 'คำขอเข้าสู่ระบบหมดอายุ กรุณาลองใหม่',
          link: 'บัญชีนี้ยังเชื่อมกับ Google ไม่ได้ กรุณาใช้รหัสผ่านเดิมหรือติดต่อเจ้าของระบบ',
          owner: 'กรุณาให้เจ้าของระบบตั้งบัญชีแรกก่อน',
          unavailable: 'Google Login ยังไม่พร้อมใช้งาน',
        };
        $('form-error').textContent =
          messages[googleError] || 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่';
        $('form-error').hidden = false;
        history.replaceState(null, '', location.pathname);
      }
      $('status-message').hidden = true;
      $('login-form').hidden = false;
      $('session-note').hidden = false;
      if (status.initialized) {
        $('auth-switch').href = mode === 'register' ? '/login' : '/register';
        $('auth-switch').textContent =
          mode === 'register' ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครเพื่อรออนุมัติ';
        $('auth-switch').hidden = false;
      }
    } catch {
      $('status-message').textContent = 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองโหลดหน้าใหม่';
    }
  })();
})();
