# สัญญาอนุญาตของซอฟต์แวร์ภายนอก

โค้ดของ Flipbook Maker เองอยู่ภายใต้สัญญาอนุญาต MIT (ดู [LICENSE](LICENSE))

โปรเจกต์นี้รวมซอฟต์แวร์ของผู้อื่นไว้ด้วย ซึ่งมีสัญญาอนุญาตของตัวเอง
รายการด้านล่างครอบคลุมทั้งไฟล์ที่อยู่ในโฟลเดอร์ `vendor/` และสิ่งที่ถูกแพ็กเข้าไปในตัวติดตั้ง

---

## รวมอยู่ในโฟลเดอร์ `vendor/`

ไฟล์เหล่านี้ถูกแจกจ่ายไปพร้อมกับโปรเจกต์ และประกาศสัญญาอนุญาตฉบับเต็มของแต่ละตัว
ยังคงอยู่ในหัวไฟล์ตามเดิม ไม่ได้ถูกตัดออก

### pdf.js — `vendor/pdf.min.js`, `vendor/pdf.worker.min.js`

- เวอร์ชัน 3.11.174
- ลิขสิทธิ์ Mozilla Foundation
- สัญญาอนุญาต **Apache License 2.0**
- https://github.com/mozilla/pdf.js
- ฉบับเต็ม: https://www.apache.org/licenses/LICENSE-2.0

ใช้สำหรับอ่านไฟล์ PDF และเรนเดอร์แต่ละหน้าเป็นภาพ

### JSZip — `vendor/jszip.min.js`

- เวอร์ชัน 3.10.1
- ลิขสิทธิ์ Stuart Knightley
- สัญญาอนุญาต **MIT หรือ GPLv3** (เลือกใช้ได้) — โปรเจกต์นี้ใช้ภายใต้ MIT
- https://github.com/Stuk/jszip

JSZip รวมไลบรารี **pako** ไว้ข้างในด้วย (สัญญาอนุญาต MIT)
https://github.com/nodeca/pako

ใช้สำหรับสร้างไฟล์ `.zip` ตอน export แบบแพ็กเกจเว็บ

---

## รวมอยู่ในตัวติดตั้งสำหรับ Windows

ตัวติดตั้งที่สร้างด้วย `npm run dist` จะแพ็ก Electron และ Chromium เข้าไปด้วย
สำเนาสัญญาอนุญาตของทั้งสองอยู่ในโฟลเดอร์ที่ติดตั้งแล้ว ในไฟล์
`LICENSE.electron.txt` และ `LICENSES.chromium.html`

### Electron

- สัญญาอนุญาต **MIT**
- https://github.com/electron/electron

### Chromium

- สัญญาอนุญาตแบบ BSD 3-Clause และอื่น ๆ ตามส่วนประกอบ
- https://www.chromium.org/

---

## ส่วนที่เขียนเองทั้งหมด

ไฟล์ต่อไปนี้เป็นงานต้นฉบับของโปรเจกต์นี้ อยู่ภายใต้ MIT

```
index.html
css/app.css          css/flipbook.css
js/app.js            js/flipbook.js       js/export.js
server.js            electron/main.js
tools/html-to-package.js
build/icon.ico       build/icon.png
```

เอนจินพลิกหน้าใน `js/flipbook.js` เขียนขึ้นใหม่ทั้งหมด ไม่ได้ดัดแปลงมาจากไลบรารี
flipbook ตัวใดตัวหนึ่ง และไอคอนใน `build/` วาดขึ้นเองด้วยรูปทรงเรขาคณิตพื้นฐาน
