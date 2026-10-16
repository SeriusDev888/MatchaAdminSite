# Matcha legacy CMS cleanup

`cleanup_legacy_cms.sql` สำหรับโปรเจกต์ Supabase ของ Matcha ในภาพเท่านั้น ไม่ใช้กับ Supplement
ก่อนรัน ต้องใช้เว็บหน้าบ้านและหลังบ้านรุ่นใหม่ที่อ่าน Studio แล้ว หากโค้ดที่ deploy ยังเป็นรุ่นเก่า ให้ deploy รุ่นใหม่ก่อน

ตรวจข้อมูลจริงวันที่ 15 ตุลาคม 2026 แล้ว: published ใน `studio_state` มีข้อมูล home/productSourcing/userGuide/about/catalog
ตาราง CMS ที่เคยนำเข้า 11 ตารางไม่มีการเปลี่ยนแปลงนับจากสำรองก่อนนำเข้า และ `dashboard_drafts` ว่าง

## ตารางที่จะลบจาก public

`about_content`, `brand_settings`, `catalog_content`, `catalog_specifications`, `contact_settings`,
`dashboard_drafts`, `home_content`, `product_sourcing`, `product_tags`, `products`, `tags`, `user_guide_content`

SQL ตรวจข้อมูล Studio ก่อน ล็อกตารางต้นทางระหว่างคัดลอก แล้วสำเนาข้อมูลทั้ง 12 ตารางไป schema ส่วนตัว
`legacy_matcha_backup_20261015` ก่อนลบ ใช้ transaction เดียวกันและไม่ใช้ CASCADE
ถ้าเจอ dependency ภายนอก ตาราง draft ไม่ว่าง หรือยังย้ายเนื้อหาไม่ครบ จะหยุดและไม่ลบข้อมูล
ถ้า schema สำรองชื่อนี้มีอยู่แล้วจะหยุด เพื่อไม่เขียนทับสำเนาเดิม

สำเนารักษาข้อมูลและชนิดคอลัมน์ ไม่ใช่ full database dump ที่เก็บ functions, triggers และ constraints เดิมครบถ้วน
สำรอง JSON ของเนื้อหาเก่าล่าสุดอยู่ที่ `C:\Godenray_Project\.logs\matcha-studio-migration\before-cleanup-review.json`

## ตารางที่เก็บไว้

ระบบปัจจุบัน: `studio_users`, `studio_sessions`, `studio_login_attempts`, `studio_oauth_states`,
`studio_state`, `studio_versions`, `studio_media`, `studio_audit_logs`

ตารางเก่าที่มีข้อมูลซึ่งยังไม่ได้ย้าย:

| ตาราง            | จำนวนแถวตอนตรวจ |
| ---------------- | --------------: |
| activity_logs    |             188 |
| content_settings |              14 |
| pending_requests |               2 |
| roles            |               3 |
| studio_members   |               7 |

`studio_members` เป็นตารางเก่าที่ระบบใหม่ไม่ได้ใช้ แต่มีข้อมูลสมาชิกอยู่ จึงไม่รวมใน SQL ลบนี้
ยังไม่ลบ Supabase Auth, functions, triggers, buckets หรือไฟล์ใด ๆ โดยเฉพาะรูป/โลโก้/PDF ที่นำเข้าอาจยังอ้าง Storage เดิม

สคริปต์ทดสอบใน PostgreSQL fixture แล้ว ไม่มีการรันลบในฐานข้อมูลจริง
