# Golden Ray Matcha · Website Studio

โปรเจกต์ `C:\Godenray_Project\matcha-adminsite` สร้างจาก `C:\Godenray_Project\supplement-admin-site` และปรับสำหรับเว็บ Golden Ray Matcha เป็นแอปและโฟลเดอร์แยกจาก Next.js และจาก `GoldenRay-Matcha-AdminSite` เดิม

## ประวัติการใช้งาน

เมนู **ประวัติการใช้งาน** (`/logs`) สำหรับทุก role ที่ล็อกอิน แสดงผู้ทำรายการ เวลา การแก้ไข/เผยแพร่ อัปโหลด และการจัดการสมาชิก
ค้นหาผู้ทำรายการ กรองประเภท เปิดรายละเอียด และดูรายการก่อนหน้าได้ ไม่เก็บรหัสผ่านหรือข้อมูลเซสชัน และไม่ลบ log เมื่อสมาชิกถูกลบ

ถ้าใช้ Supabase เดิม ให้รัน `supabase/migrations/20261015_google_membership.sql` ใน SQL Editor ของโปรเจกต์ Matcha ซึ่งรวมระบบ log และสมาชิกแล้ว
ไม่ต้องแก้ `.env` ตารางใหม่ชื่อ `studio_audit_logs`; SQL ไม่ลบหรือเปลี่ยนเนื้อหา/บัญชีเดิม และไม่มีประวัติย้อนหลัง
ถ้าตั้งฐานข้อมูลใหม่ ให้รัน `supabase/schema.sql` ซึ่งรวม log แล้ว ส่วน local ให้รัน `npm run db:local`

## Google Login และหน้ารออนุมัติ

รองรับอีเมล/รหัสผ่านและ Google ผู้สมัครใหม่เข้าสู่หน้ารออนุมัติ `/pending` ก่อนเข้าแก้ไข เมื่อถูกนำออกจะกลับหน้านี้และกดขอใหม่ได้โดยไม่รับสิทธิ์เดิมกลับอัตโนมัติ
ใช้ SQL รุ่นล่าสุด `supabase/migrations/20261015_google_membership.sql` ซึ่งรวม log แล้ว และตั้ง `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` ใน `.env` ของหลังบ้าน
ดูคู่มือตั้งค่าและ callback URL ของทั้งสองแบรนด์ใน `C:\Godenray_Project\GOOGLE_LOGIN_SETUP.md`

## เข้าสู่ระบบหลังบ้าน

เปิด `/login` หรือเปิดหน้าหลังบ้านตามปกติ ระบบจะพาไปหน้าล็อกอินก่อนเสมอ
หากเป็นการใช้งานครั้งแรกในเครื่อง ให้สร้างบัญชีแอดมินด้วยอีเมลและรหัสผ่านอย่างน้อย 12 ตัวอักษร
บัญชีแรกเป็น superadmin ของโปรเจกต์นั้น สมาชิกเพิ่มเติมสมัครผ่าน `/register` และต้องรอ superadmin อนุมัติ

- รัน `npm run build` และ `npm run db:local` เพื่อเพิ่มตารางบัญชีและเซสชัน โดยไม่แก้เนื้อหาเดิม
- จากนั้นรัน `npm run dev` และตั้งบัญชีของคุณในหน้าแรกที่เปิดขึ้นมา ไม่มีรหัสผ่านเริ่มต้น
- เข้าครั้งถัดไปด้วยบัญชีที่ตั้งไว้ ออกจากระบบด้วยปุ่ม **ออกจากระบบ** บนแถบด้านบน
- รหัสผ่านเก็บเป็น PBKDF2-SHA256 พร้อม salt; เซสชันเก็บในฐานข้อมูลที่เลือกและ cookie แบบ HttpOnly มีอายุ 8 ชั่วโมง (Strict สำหรับรหัสผ่าน, Lax สำหรับ Google เพื่อรองรับ callback)
- การออกจากระบบยกเลิกเซสชันบนเซิร์ฟเวอร์ทันที ทั้งสอง Studio ใช้ชื่อ cookie ต่างกัน จึงล็อกอินแยกกันแม้อยู่บน localhost เดียวกัน
- หากเซสชันหมดอายุขณะแก้ไข จะมีลิงก์ **เข้าสู่ระบบอีกครั้ง** เปิดในแท็บใหม่ กลับมาแท็บเดิมแล้วบันทึกต่อได้
- ไม่ใช้ `LOCAL_ADMIN_ACCESS` หรือ identity headers เพื่อข้ามหน้าล็อกอินอีกต่อไป

`LOCAL_AUTH_SETUP=true` ใน dev launcher อนุญาตให้ตั้งบัญชีครั้งแรกเฉพาะ HTTP loopback เท่านั้น
การเปิดใช้งานบน HTTPS hosting ต้อง apply migrations กับ D1 ของระบบจริงก่อน และตั้ง secret `ADMIN_SETUP_TOKEN`
เป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษรผ่านผู้ให้บริการ จากนั้นใช้ค่านั้นในช่องรหัสตั้งค่าบนหน้าแรก
เมื่อตั้งบัญชี superadmin สำเร็จ สามารถนำ secret นี้ออกได้ การตั้งค่าบัญชีเจ้าของครั้งแรกจะถูกปิดเมื่อมี superadmin อยู่แล้ว

บัญชีในเครื่องเก็บที่ `.wrangler/state` อย่าลบโฟลเดอร์นี้ เพราะมีทั้งข้อมูล CMS และบัญชีที่ตั้งไว้

### ทดสอบระบบล็อกอิน

ใช้ Node.js 22.13 ขึ้นไปสำหรับชุดทดสอบ SQLite

```sh
npm run test:unit
npm run build
npm run test:login
```

`test:login` เปิด Wrangler และ Chrome ด้วยฐานข้อมูลทดสอบชั่วคราวใน `output/` จึงไม่สร้างบัญชีในข้อมูลจริง
ครอบคลุมการตั้งบัญชี ล็อกอิน ล็อกเอาต์ เดสก์ท็อป มือถือ และรัน API integration suite ด้วยบัญชีทดสอบ
ภาพตรวจหน้าจออยู่ใน `output/login-*.png`

หากรัน `npm test` หรือ browser tests เดิมกับ dev server ให้ตั้ง `STUDIO_TEST_EMAIL` และ `STUDIO_TEST_PASSWORD`
เป็นบัญชีของระบบทดสอบก่อน และเปิดเว็บหลักตามปกติ ห้ามใช้บัญชี production เพราะชุดทดสอบแก้ฉบับร่างและทดลองเผยแพร่

## เริ่มใช้งานในเครื่อง

ใช้ Node.js 22 ขึ้นไป บน PowerShell ที่ไม่อนุญาต `.ps1` ให้ใช้ `npm.cmd`

```sh
cd C:\Godenray_Project\matcha-adminsite
npm ci
npm run build
npm run db:local
npm run dev
```

เปิดหลังบ้านที่ **http://127.0.0.1:4321/** ค่าเริ่มต้นพรีวิวเว็บหลักคือ `http://127.0.0.1:3000` เริ่มเว็บหลักด้วย `npm run dev` จาก root ของ repository ในอีก terminal

ตั้งค่าตัวแปรของหลังบ้านใน `C:\Godenray_Project\matcha-adminsite\.env` โดยอ้างอิง `.env.example` หากเปลี่ยนพอร์ตเว็บหลัก ให้แก้ `SITE_ORIGIN` ให้ตรงกัน

เพิ่มใน `.env.local` ของเว็บหลัก แล้วเริ่ม Next ใหม่:

```dotenv
MATCHA_CONTENT_ORIGIN=http://127.0.0.1:4321
```

เว็บหลักอ่านข้อมูลที่ Publish จาก Studio เท่านั้น ต้องตั้ง `MATCHA_CONTENT_ORIGIN` และไม่ต้องใช้ `NEXT_PUBLIC_SUPABASE_*` บนหน้าบ้านอีกแล้ว
หลังบ้านเชื่อม Supabase ด้วย `.env` ของตัวเอง (`STUDIO_DATABASE=supabase`) หรือใช้ D1/R2 ในโหมด `local`
หาก API หลังบ้านไม่พร้อมใช้งาน API เนื้อหาของหน้าบ้านจะแจ้ง 503 โดยไม่กลับไปอ่านตาราง CMS เก่า

สำหรับการย้าย CMS เดิม ให้รัน `node scripts/import-legacy-content.mjs` เพื่อตรวจและสำรองก่อน แล้วเพิ่ม `--apply` เพื่อเริ่ม draft/published ใน Studio ที่ยังว่าง
สคริปต์ไม่เขียนทับ Studio ที่มีข้อมูลแล้ว และไม่ลบตารางเก่าหรือไฟล์เดิม รูป/PDF ที่นำเข้าอาจยังอ้าง storage เดิม จึงควรเก็บไว้

ทดสอบการเชื่อมหน้าบ้านแบบครบสายด้วย `npm run test:published-site` หลัง build ทั้งสองโปรเจกต์แล้ว
คำสั่งนี้เปิด Studio และ Next แยกด้วยข้อมูลชั่วคราว ตรวจการแก้ไข ฉบับร่าง การเผยแพร่ และการซ่อนสินค้าทั้งหมด โดยไม่แตะ Supabase จริง

คำสั่ง build, dev, db และ test ของหลังบ้านให้รันจาก `C:\Godenray_Project\matcha-adminsite` โดยตรง เว็บหลักเชื่อมต่อผ่าน HTTP ด้วย `MATCHA_CONTENT_ORIGIN` และไม่ได้ import source จากโฟลเดอร์หลังบ้าน

## ฟังก์ชัน

- เลือกพรีวิวหน้า Home, Products, User Guide, About Us, Catalog และ Contact จากเว็บ Next จริง
- คลิกข้อความ รูปภาพ หรือส่วนของหน้าเพื่อปรับข้อความ รูป สี ระยะห่าง และรูปแบบบนมือถือ
- จัดลำดับส่วน เพิ่มส่วน ซ่อนองค์ประกอบ เปลี่ยนไอคอน ธีม และภาพตกแต่ง
- จัดการสินค้าเพิ่ม/ลบ/ซ่อน พร้อมแหล่งปลูก สายพันธุ์ ฤดูเก็บเกี่ยว และขนาดบรรจุ หน้าสินค้าใช้ตัวจัดการสินค้าแทนการแก้ข้อความรายชิ้น
- จัดการโลโก้ ชื่อแบรนด์ ข้อความส่วนท้าย อีเมล โทรศัพท์ LINE เวลาทำการ และตำแหน่งแผนที่
- คลังสื่อรองรับ PNG, JPEG, WebP และ GIF สูงสุด 10 MB; API เอกสารรองรับ PDF
- Undo/Redo, บันทึกฉบับร่าง, เผยแพร่ และคืนเวอร์ชันเก่ามาเป็นฉบับร่าง พร้อมตรวจการแก้ไขชนกันหลายแท็บ

ฉบับร่างไม่แสดงบนเว็บหลักจนกว่าจะกดเผยแพร่ การแก้ข้อความด้วย visual editor ใช้ร่วมทุกภาษา; คำแปลเดิมยังอยู่ใน `data/locales/` และไม่ได้เปลี่ยนเป็นระบบแปลหลายภาษาใน Studio

## ข้อมูลและความเป็นอิสระ

ใช้ D1 และ R2 ชื่อ `goldenray-matcha-studio` แยกจาก Supplement ไม่มีการคัดลอก `.wrangler/state`, credentials, Site ID หรือประวัติการแก้ไขจากต้นแบบ ข้อมูล local อยู่ใน `.wrangler/state` ของโปรเจกต์นี้และไม่ถูก commit

`src/shared/matcha-defaults.json` เป็นข้อมูลเริ่มต้นที่อิงเนื้อหาเว็บมัทฉะเดิม รวมข้อมูลติดต่อที่ยังเป็นตัวอย่าง ควรแก้เป็นข้อมูลจริงก่อนเผยแพร่ใช้งาน

`src/preview/matcha-runtime.js` เป็น renderer ร่วมของ Studio กับเว็บหลัก `npm run build` สร้างไฟล์เฉพาะใน `dist` ของหลังบ้าน โดยไม่แก้ไฟล์นอกโปรเจกต์ ไฟล์สำหรับเว็บหลักอยู่ใน `dist/renderer/`

เมื่อแก้ renderer ให้ build แล้ว sync ไปยังเว็บหลักอย่างชัดเจน:

```sh
cd C:\Godenray_Project\matcha-adminsite
npm run build
npm run sync:public -- "C:\Godenray_Project\Golden-Ray-Matcha"
```

หรือกำหนด `MATCHA_PUBLIC_SITE_DIR` แล้วรัน `npm run sync:public` สคริปต์ตรวจว่าเป็นโปรเจกต์ `goldenray-matcha` ก่อนคัดลอกเฉพาะ `public/matcha-studio-runtime.js` และ `.css` เว็บหลักมีไฟล์ renderer ที่ build แล้วอยู่ใน repository จึง build ได้โดยไม่ต้องมีโฟลเดอร์หลังบ้านอยู่ข้างกัน

## การทดสอบ

```sh
npm run test:unit
# เปิดทั้ง admin :4321 และเว็บหลัก :3000 ก่อน
npm test
npm run test:browser
```

Browser test ใช้ Chrome ที่ติดตั้งไว้ หรือกำหนด `CHROME_PATH` ทดสอบกับฐานข้อมูล local และคืนเนื้อหาที่เผยแพร่กับฉบับร่างหลังจบ ภาพตรวจหน้าจออยู่ใน `output/` ที่ไม่ถูก commit

## นำขึ้นระบบจริง

งานนี้จัดเตรียมและรันในเครื่อง ยังไม่ได้ deploy หลังบ้านเป็น Site ใหม่ `wrangler.json` มี database ID ตัวอย่าง ต้องผูก D1/R2 ใหม่ ตั้ง `SITE_ORIGIN`, secret `ADMIN_SETUP_TOKEN` และตั้ง `MATCHA_CONTENT_ORIGIN` ของเว็บหลักให้เข้าถึงบริการหลังบ้านได้

dev launcher เปิดการตั้งบัญชีครั้งแรกเฉพาะ HTTP loopback และ bind `127.0.0.1` หลังจากตั้งบัญชีแล้วต้องล็อกอินทุกครั้ง การใช้งานจริงตรวจสิทธิ์ด้วยเซสชันของ Studio และไม่เชื่อ identity headers จากผู้เรียก

พรีวิว proxy และเว็บหลักส่งต่อเฉพาะ GET ของข้อมูลเผยแพร่และสื่อ ไม่ส่ง cookie/identity ของผู้เข้าชมไปยัง backend และไม่เปิด admin write APIs ผ่านเว็บหลัก

## ผู้ใช้ สิทธิ์ และ Supabase

เพิ่มหน้าสมัคร `/register` และหน้าจัดการ **ผู้ใช้และสิทธิ์** `/users`
ผู้สมัครต้องรออนุมัติและไม่มีสิทธิ์แก้ไขจนกว่า superadmin จะกดรับเป็น admin
superadmin กำหนดสิทธิ์แก้หน้าเว็บ สินค้า แบรนด์ Contact อัปโหลด เผยแพร่ และคืนเวอร์ชันแยกกันได้
การอนุมัติ ระงับ เปิดใช้ใหม่ ลบผู้ใช้ และเปลี่ยนสิทธิ์ทำได้เฉพาะ superadmin และตรวจที่ API ทุกครั้ง
บัญชีเจ้าของเดิมใน local ย้ายเป็น superadmin โดย `0002_user_permissions.sql`

เลือกใช้ฐานข้อมูลด้วย `STUDIO_DATABASE=local` หรือ `supabase`
ตัวอย่างค่าฐานข้อมูลจริงอยู่ที่ `.env.supabase.example`; schema สำหรับ SQL Editor อยู่ที่ `supabase/schema.sql`
คู่มือตั้งค่าแยกสองแบรนด์และรายการ keys อยู่ที่ [ENVIRONMENT_SETUP.md](../ENVIRONMENT_SETUP.md)
เมื่อสลับฐานข้อมูลใหม่ ต้องย้ายข้อมูล local แยกต่างหาก ระบบไม่สลับหรือย้ายข้อมูลให้อัตโนมัติ
# Vercel deployment

รองรับ Vercel Functions บน Node.js 24.x แล้ว ตั้ง Framework เป็น **Other**, Build Command `npm run build`, Output Directory `dist/vercel-public` โดยมี `vercel.json` ให้แล้ว
เมื่อ import repository `SeriusDev888/MatchaAdminSite` ให้ใช้ Root Directory `./`
ตั้งค่า Environment Variables ตาม `.env.production.example` ใช้ `STUDIO_DATABASE=supabase`; ไม่ต้องผูก D1/R2 บน Vercel
`SITE_ORIGIN` ต้องเป็น URL หน้าบ้าน Matcha และ Google callback ต้องเป็น URL หลังบ้านนี้ + `/api/auth/google/callback`
HTML ของ editor/ผู้ใช้/log ผ่านระบบตรวจสิทธิ์ก่อนเสิร์ฟเสมอ รูป/PDF อัปโหลดตรงเข้า private Supabase Storage สูงสุด 10 MB และตรวจไฟล์ตอนยืนยัน
ตรวจ adapter และ signed upload ด้วย `npm run test:vercel`; ตรวจ Chrome ด้วย `npm run test:vercel:browser` หลัง build หน้าบ้านแล้ว ชุดทดสอบจะเปิด Next production ชั่วคราวให้ หรือใช้ URL production ผ่าน `VERCEL_TEST_SITE`
การแก้ renderer ยังต้อง `npm run sync:public -- ../Golden-Ray-Matcha` ก่อน build หน้าบ้าน
