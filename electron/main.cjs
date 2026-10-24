const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs/promises')

const isDev = !app.isPackaged
const DEV_URL = 'http://127.0.0.1:5173'

// ---- Temporary in-memory exam state (replace with real logic later) ----
const examState = { running: false, endsAt: 0 }

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      // Must be an absolute path; __dirname keeps it correct in dev and packaged builds.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Only accept IPC from our own app pages, not from any other content.
function isTrustedSender(event) {
  const url = event.senderFrame?.url || ''
  return isDev ? url.startsWith(DEV_URL) : url.startsWith('file://')
}

function guarded(handler) {
  return (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender')
    return handler(event, ...args)
  }
}

// ---- IPC handlers (stubs) ----
ipcMain.handle('window:set-fullscreen', guarded((event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  win.setFullScreen(Boolean(flag))
  return win.isFullScreen()
}))

ipcMain.handle('exam:get-remaining-time', guarded(() => {
  const remainingMs = examState.running ? Math.max(0, examState.endsAt - Date.now()) : 0
  if (examState.running && remainingMs === 0) examState.running = false
  return { remainingMs, running: examState.running }
}))

ipcMain.handle('exam:start', guarded((_event, config = {}) => {
  const minutes = Number(config.durationMinutes) > 0 ? Number(config.durationMinutes) : 60
  examState.running = true
  examState.endsAt = Date.now() + minutes * 60 * 1000
  // TODO: lock down window, start focus-loss monitoring, etc.
  return { started: true, endsAt: examState.endsAt }
}))

ipcMain.handle('exam:show-rules', guarded(async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Exam Rules',
    message: 'Please read the exam rules',
    detail: 'TODO: replace with the real rules text.',
    buttons: ['I Understand'],
  })
  return true
}))

ipcMain.handle('proctor:save-image', guarded(async (_event, { dataUrl, filename } = {}) => {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '')
  if (!match) throw new Error('Invalid image data')

  // basename() blocks path traversal like "../../something"
  const safeName = path.basename(filename || `capture-${Date.now()}.${match[1]}`)
  const dir = path.join(app.getPath('userData'), 'captures')
  await fs.mkdir(dir, { recursive: true })

  const filePath = path.join(dir, safeName)
  await fs.writeFile(filePath, Buffer.from(match[2], 'base64'))
  return { saved: true, path: filePath }
}))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})