import { fail } from './http.js';

export const PERMISSIONS = [
  {
    key: 'content.edit',
    label: 'แก้ไขหน้าเว็บและธีม',
    description: 'ข้อความ รูปภาพ ส่วนต่าง ๆ และรูปแบบของหน้าเว็บ',
  },
  { key: 'products.edit', label: 'จัดการสินค้า', description: 'เพิ่ม แก้ไข ซ่อน และนำสินค้าออก' },
  { key: 'brand.edit', label: 'จัดการแบรนด์', description: 'โลโก้ ชื่อแบรนด์ และข้อความส่วนท้าย' },
  {
    key: 'contact.edit',
    label: 'จัดการข้อมูลติดต่อ',
    description: 'อีเมล โทรศัพท์ LINE ที่อยู่ และแผนที่',
  },
  {
    key: 'media.upload',
    label: 'อัปโหลดสื่อและเอกสาร',
    description: 'เพิ่มรูปภาพและไฟล์ PDF ในคลังสื่อ',
  },
  {
    key: 'content.publish',
    label: 'เผยแพร่เว็บไซต์',
    description: 'เผยแพร่ฉบับร่างรวมของทีมให้ผู้เข้าชมเห็น',
  },
  {
    key: 'versions.restore',
    label: 'คืนเวอร์ชันเก่า',
    description: 'นำเวอร์ชันเดิมกลับมาเป็นฉบับร่าง ภายในสิทธิ์แก้ไขที่ได้รับ',
  },
];
export const DEFAULT_PERMISSIONS = PERMISSIONS.slice(0, 5).map((p) => p.key);
export function validPermissions(value) {
  if (
    !Array.isArray(value) ||
    value.length > PERMISSIONS.length ||
    value.some((key) => !PERMISSIONS.some((p) => p.key === key)) ||
    new Set(value).size !== value.length
  )
    fail('สิทธิ์ที่เลือกไม่ถูกต้อง');
  return value;
}
export function can(user, permission) {
  return user?.role === 'superadmin' || user?.permissions?.includes(permission);
}
export function requirePermission(user, permission) {
  if (!can(user, permission)) fail('คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อ superadmin', 403);
}
export function requireSuperadmin(user, message = 'เฉพาะ superadmin เท่านั้นที่จัดการผู้ใช้ได้') {
  if (user?.role !== 'superadmin') fail(message, 403);
}
const stable = (value) =>
  JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item;
  });
export function authorizeDocument(user, before, after) {
  if (user.role === 'superadmin') return;
  const groups = { catalog: 'products.edit', brand: 'brand.edit', contact: 'contact.edit' };
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (key === 'schema') continue;
    if (stable(before?.[key]) !== stable(after?.[key]))
      requirePermission(user, groups[key] || 'content.edit');
  }
}
