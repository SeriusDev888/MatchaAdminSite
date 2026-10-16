(() => {
  const $ = (id) => document.getElementById(id);
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    $('check-status').disabled = true;
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('ตรวจสอบสถานะไม่สำเร็จ กรุณาลองใหม่');
      const data = await response.json();
      if (!data.authenticated) {
        location.replace('/login?next=%2Fpending');
        return;
      }
      if (data.approved) {
        location.replace('/');
        return;
      }
      const user = data.user;
      $('current-role').textContent = user.role.toUpperCase();
      $('member-name').textContent = user.name;
      $('member-email').textContent = user.email;
      const removed = user.status === 'removed',
        suspended = user.status === 'suspended';
      $('pending-title').textContent = removed
        ? 'คุณถูกนำออกจากทีม'
        : suspended
          ? 'บัญชีของคุณถูกระงับ'
          : 'รออนุมัติจากผู้ดูแล';
      $('pending-description').textContent = removed
        ? 'สิทธิ์แก้ไขเดิมถูกถอนแล้ว หากต้องการกลับมาดูแลเว็บไซต์ กดขอเข้าใช้งานอีกครั้งเพื่อให้ superadmin พิจารณาใหม่'
        : suspended
          ? 'ขณะนี้ยังเข้าแก้ไขเว็บไซต์ไม่ได้ กรุณาติดต่อ superadmin เพื่อเปิดใช้งานบัญชีอีกครั้ง'
          : 'ส่งคำขอของคุณแล้ว กรุณารอ superadmin อนุมัติ ก่อนเริ่มแก้ไขเว็บไซต์';
      $('member-status').textContent = removed
        ? 'ถูกนำออก'
        : suspended
          ? 'ระงับการใช้งาน'
          : 'รออนุมัติ';
      $('request-access').hidden = !removed;
      $('pending-error').hidden = true;
    } catch (error) {
      $('pending-error').textContent = error.message;
      $('pending-error').hidden = false;
    } finally {
      checking = false;
      $('check-status').disabled = false;
    }
  }
  $('check-status').onclick = check;
  $('request-access').onclick = async () => {
    $('request-access').disabled = true;
    try {
      const response = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'x-editor-request': '1' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ส่งคำขอไม่สำเร็จ');
      await check();
    } catch (error) {
      $('pending-error').textContent = error.message;
      $('pending-error').hidden = false;
    } finally {
      $('request-access').disabled = false;
    }
  };
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
      $('pending-error').textContent = error.message;
      $('pending-error').hidden = false;
      $('logout').disabled = false;
    }
  };
  setInterval(() => {
    if (!document.hidden) void check();
  }, 5000);
  addEventListener('focus', () => void check());
  addEventListener('pageshow', (event) => {
    if (event.persisted) void check();
  });
  void check();
})();
