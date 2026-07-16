# Security Policy

> เอกสารนี้สำหรับทุกคนที่ทำงานกับ repo นี้ — อ่านแล้วรู้ว่าอะไรห้ามหลุด, หลุดแล้วต้องทำอะไรใน 1 ชั่วโมงแรก, และรายงานช่องโหว่ที่ช่องทางไหน

repo นี้เป็น product กลางที่ **deploy เข้า NetSuite account ของลูกค้าหลายราย** — ความผิดพลาดด้าน secret หรือข้อมูลไม่ใช่เรื่องภายในทีมอย่างเดียว แต่กระทบเอกสารการเงิน (Invoice / ใบกำกับภาษี) ของลูกค้าทุก account ที่ติดตั้ง product นี้โดยตรง

## ของที่ห้ามอยู่ใน repo / Issue / PR / screenshot

| ประเภท | ตัวอย่าง | ที่อยู่ที่ถูกต้อง |
|---|---|---|
| Credentials | รหัสผ่าน NetSuite, TOTP secret, token ทุกชนิด | ไฟล์ `.env` ที่เครื่องตัวเอง (gitignore แล้ว — **ตรวจว่า ignore จริง**) — ขอจากทีมโดยตรง ห้ามส่งผ่าน Issue/chat สาธารณะ |
| Session | โฟลเดอร์ `.qa-profiles/` (Chrome profile มี session cookie + 2FA trust) | เครื่องตัวเองเท่านั้น (gitignore แล้ว) — ห้าม zip ส่งต่อ |
| Auth binding | `project.json` ที่มี authid จริง | gitignore แล้ว — deploy script bind/restore ให้อัตโนมัติ ห้าม commit |
| ข้อมูลลูกค้าเชิงมูลค่า | ต้นทุนจริง, ราคาซื้อ, ยอดคงคลัง/ยอดผลิตเป็นมูลค่าเงิน | ใน Issue ใช้ record id ให้คนมีสิทธิ์ไปเปิดดูเอง — screenshot ตัวเลขเงินให้ crop/เบลอ |
| URL ที่ฝัง token | ลิงก์ File Cabinet / Suitelet ที่มี `?compid=...&h=...` | ตัด query string ที่เป็น token ออกก่อนแปะ |

## เจอ secret หลุดใน commit — ทำทันที (ลำดับสำคัญ)

1. **Rotate ก่อน ลบทีหลัง** — เปลี่ยนรหัส/สร้าง token ใหม่ทันที (ของที่หลุดแล้วถือว่า compromised ต่อให้ลบ commit ก็ตาม เพราะ history/fork/cache เก็บไว้)
2. แจ้งเจ้าของ repo (@wichtking) ทาง direct channel — ไม่เปิด Issue สาธารณะ
3. ลบออกจาก history (`git filter-repo` หรือให้ GitHub support ช่วย purge) แล้ว force-push โดยเจ้าของ repo เท่านั้น
4. บันทึกเหตุการณ์ + สิ่งที่ rotate ไปแล้วลง Issue (หลัง rotate เสร็จ เปิดเผยได้เพราะ secret เก่าตายแล้ว)

## รายงานช่องโหว่ (vulnerability / บั๊กที่เปิดช่องข้อมูล)

- บั๊กที่**เปิดช่องให้เห็น/แก้ข้อมูลเกินสิทธิ์** (เช่น Suitelet ไม่เช็ค role, SuiteQL injection จาก URL param, error message โชว์ข้อมูลลูกค้า) — **อย่าเปิด Issue สาธารณะพร้อมวิธี reproduce**
- ใช้ **GitHub → Security → Report a vulnerability** (private advisory) หรือแจ้ง @wichtking โดยตรง
- จะได้รับตอบรับภายใน 2 วันทำการ · แก้บน sandbox → verify → deploy prod ตาม [CONTRIBUTING.md](CONTRIBUTING.md) · เปิดเผยรายละเอียดใน Release Notes หลัง fix ขึ้น prod แล้ว
- บั๊กทั่วไปที่ไม่ใช่ช่องโหว่ (คำนวณผิด, UI พัง) → เปิด Issue ปกติตาม [CONTRIBUTING.md](CONTRIBUTING.md)

## ขอบเขต

| ในขอบเขต | นอกขอบเขต |
|---|---|
| โค้ดทุกไฟล์ใต้ `designer/` + `engine/` + `templates/` + `scripts/` ใน repo นี้ | ช่องโหว่ของ NetSuite platform เอง (รายงาน Oracle) |
| การตั้งค่า role/permission ที่โค้ดเราพึ่งพา | repo อื่นของ org (ใช้ SECURITY.md ของ repo นั้น) |

---
*นโยบายนี้ขัดกับความจริงเมื่อไหร่ แก้ผ่าน PR ตาม flow ปกติ — ยกเว้นเรื่อง secret หลุด ให้ทำตามขั้นตอนก่อนแล้วค่อยมาแก้เอกสาร*
