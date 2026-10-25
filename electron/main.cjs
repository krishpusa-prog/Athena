const { app, BrowserWindow, ipcMain, dialog, session, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs/promises')

// `npm start` passes --prod so Electron loads dist/ instead of the Vite dev server.
const isDev = !app.isPackaged && !process.argv.includes('--prod')
const DEV_URL = 'http://127.0.0.1:5173'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const EXAM_RULES = [
  '1. Do not switch tabs or windows.',
  '2. Cheating results in 0 marks.',
  '3. Photos from your camera are captured periodically for proctoring.',
]

// Exam state lives in the main process so the renderer can't tamper with it.
const examState = {
  running: false,
  endsAt: 0,
  rulesAccepted: false,
  submitted: false,
}

// Dev: electron/cameraFeed. Packaged: __dirname is a read-only asar, so use userData.
function getCameraFeedDir() {
  return isDev
    ? path.join(__dirname, 'cameraFeed')
    : path.join(app.getPath('userData'), 'cameraFeed')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Alt+F4 / Cmd+W / window close are ignored while an exam is running.
  win.on('close', (e) => {
    if (examState.running) e.preventDefault()
  })

  if (isDev) {
    win.loadURL(DEV_URL)
    // DevTools steal focus and would trigger strikes, so it's opt-in:
    //   ATHENA_DEVTOOLS=1 npm run dev
    if (process.env.ATHENA_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

// ---------- IPC security helpers ----------

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

// ---------- IPC handlers ----------

// Kiosk mode: fullscreen with the OS frame, dock/taskbar and menu bar locked out.
ipcMain.handle('window:set-fullscreen', guarded((event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false

  const enable = Boolean(flag)
  win.setKiosk(enable)

  if (enable) {
    win.setClosable(false)
    win.setMinimizable(false)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.focus()
  } else {
    win.setClosable(true)
    win.setMinimizable(true)
    win.setAlwaysOnTop(false)
  }

  return win.isKiosk()
}))

ipcMain.handle('exam:show-rules', guarded(async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Exam Rules',
    message: 'Please read the exam instructions',
    detail: EXAM_RULES.join('\n\n'),
    buttons: ['Accept', 'Cancel'],
    defaultId: 1, // Enter won't accept by accident
    cancelId: 1,  // Esc / closing the dialog = Cancel
    noLink: true,
  })

  examState.rulesAccepted = response === 0
  return examState.rulesAccepted
}))

ipcMain.handle('exam:start', guarded((_event, config = {}) => {
  // Enforced here, so DevTools can't skip the rules dialog.
  if (!examState.rulesAccepted) throw new Error('Exam rules have not been accepted')

  const minutes = Number(config.durationMinutes) > 0 ? Number(config.durationMinutes) : 60
  examState.running = true
  examState.submitted = false
  examState.endsAt = Date.now() + minutes * 60 * 1000
  return { started: true, endsAt: examState.endsAt }
}))

ipcMain.handle('exam:get-remaining-time', guarded(() => {
  const remainingMs = examState.running ? Math.max(0, examState.endsAt - Date.now()) : 0
  if (examState.running && remainingMs === 0) examState.running = false
  return { remainingMs, running: examState.running }
}))

ipcMain.handle('proctor:save-image-to-folder', guarded(async (_event, arrayBuffer) => {
  // Only accept photos while an exam is actually running.
  if (!examState.running) throw new Error('No exam in progress')

  if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer)) {
    throw new Error('Expected binary image data')
  }

  const buffer = Buffer.from(arrayBuffer)
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image size')
  }

  // Some cameras return PNG from takePhoto(); keep the extension honest.
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50
  const dir = getCameraFeedDir()
  await fs.mkdir(dir, { recursive: true }) // creates cameraFeed/ if missing

  const filePath = path.join(dir, `${Date.now()}.${isPng ? 'png' : 'jpg'}`)
  await fs.writeFile(filePath, buffer)
  return { saved: true, path: filePath }
}))

ipcMain.handle('exam:submit', guarded(() => {
  examState.running = false // also makes save-image-to-folder reject further photos
  examState.submitted = true
  return { submitted: true }
}))

ipcMain.handle('app:quit', guarded((event) => {
  if (examState.running) throw new Error('Submit the exam before exiting')

  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.setKiosk(false)
    win.setClosable(true)
    win.setAlwaysOnTop(false)
  }
  app.quit()
  return true
}))

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  // Allow camera only; deny every other permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  createWindow()

  if (isDev) {
    // Dev-only escape hatch: Ctrl/Cmd + Shift + K exits kiosk mode.
    globalShortcut.register('CommandOrControl+Shift+K', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      examState.running = false // otherwise the close handler would block quitting
      win.setKiosk(false)
      win.setClosable(true)
      win.setMinimizable(true)
      win.setAlwaysOnTop(false)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => globalShortcut.unregisterAll())