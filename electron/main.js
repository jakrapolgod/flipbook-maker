/* Desktop shell for Flipbook Maker.

   The app itself is unchanged: the same local HTTP server that start.cmd runs
   is started inside the main process on a free port, and the window simply
   loads it. Serving over http rather than file:// keeps pdf.js workers,
   fetch() and Web Crypto working exactly as they do in a browser.
*/
'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const server = require('../server.js');

const APP_NAME = 'Flipbook Maker';
let win = null;
let handle = null;

/* One window only — a second launch focuses the first. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'ไฟล์',
      submenu: [
        { role: 'reload', label: 'โหลดหน้าใหม่' },
        { type: 'separator' },
        { role: 'quit', label: 'ออกจากโปรแกรม' }
      ]
    },
    {
      label: 'แก้ไข',
      submenu: [
        { role: 'undo', label: 'เลิกทำ' },
        { role: 'redo', label: 'ทำซ้ำ' },
        { type: 'separator' },
        { role: 'cut', label: 'ตัด' },
        { role: 'copy', label: 'คัดลอก' },
        { role: 'paste', label: 'วาง' },
        { role: 'selectAll', label: 'เลือกทั้งหมด' }
      ]
    },
    {
      label: 'มุมมอง',
      submenu: [
        { role: 'resetZoom', label: 'ขนาดปกติ' },
        { role: 'zoomIn', label: 'ขยาย' },
        { role: 'zoomOut', label: 'ย่อ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'เต็มจอ' },
        { role: 'toggleDevTools', label: 'เครื่องมือนักพัฒนา' }
      ]
    },
    {
      label: 'ช่วยเหลือ',
      submenu: [
        {
          label: 'เกี่ยวกับ ' + APP_NAME,
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'เกี่ยวกับ ' + APP_NAME,
              message: APP_NAME + ' ' + app.getVersion(),
              detail: 'สร้าง ebook แบบพลิกหน้าจากรูปภาพหรือ PDF\n' +
                'ทำงานในเครื่องทั้งหมด ไม่ส่งไฟล์ออกไปไหน'
            });
          }
        },
        {
          label: 'เปิดโฟลเดอร์ดาวน์โหลด',
          click: () => shell.openPath(app.getPath('downloads'))
        }
      ]
    }
  ]);
}

/* Exports use a download link; ask the user where to put the file. */
function wireDownloads(session) {
  session.on('will-download', (event, item) => {
    item.setSaveDialogOptions({
      title: 'บันทึกไฟล์ ebook',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename())
    });
    item.once('done', (e, state) => {
      if (state === 'completed') {
        shell.showItemInFolder(item.getSavePath());
      } else if (state === 'interrupted') {
        dialog.showErrorBox('บันทึกไฟล์ไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง');
      }
    });
  });
}

async function createWindow() {
  try {
    handle = await server.start(0);          // 0 = let the OS pick a free port
  } catch (err) {
    dialog.showErrorBox('เริ่มโปรแกรมไม่สำเร็จ', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#f4f5f8',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(buildMenu());
  wireDownloads(win.webContents.session);

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  /* Keep any stray link in the default browser, not in this window. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
    });

  win.loadURL(handle.url);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (handle) handle.close();
});
