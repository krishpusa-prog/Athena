# Athena

A desktop proctoring and exam portal built with **Electron, React and Vite** for an Application Development course.

Athena locks the student's machine into a single full-screen exam window, watches the webcam in the background, and ends the exam automatically if the student keeps leaving the window.

## Features

- **Kiosk lockdown:** the exam runs in Electron kiosk mode. The OS window frame, dock/taskbar and menu bar are hidden, the window stays on top, and closing it is blocked while the exam is running.
- **Entry validation:** "Go To Test" stays disabled until camera and full-screen permissions are both granted. The student must then accept the exam rules in a native dialog. Acceptance is enforced in the main process, not just the UI.
- **Automated camera proctoring (WebRTC):** the camera stream is requested with `getUserMedia`. During the exam the preview is hidden and the stream keeps running in a 1px hidden `<video>` element.
- **Background snapshot storage:** every 5 seconds a photo is taken with the `ImageCapture` API, sent over IPC as an `ArrayBuffer`, and saved by the main process as `<timestamp>.jpg` in `electron/cameraFeed/`.
- **Anti-cheat blur detection:** `window` `blur` and `document` `visibilitychange` events record strikes. Each strike shows a warning modal, and the third strike submits the exam automatically.
- **Timer and submission:** the countdown lives in the main process. The result screen shows questions answered, skipped, time taken and violations, with an **Exit Assessment** button that quits the kiosk window cleanly.

## Architecture

```
┌──────────────────────────┐
│ Renderer (React + Vite)  │  src/
│ UI, camera, focus checks │  No Node.js access
└────────────┬─────────────┘
             │  window.electronAPI.*
┌────────────▼─────────────┐
│ Preload (contextBridge)  │  electron/preload.cjs
│ Fixed, whitelisted       │  Wraps ipcRenderer.invoke, never
│ channels only            │  exposes ipcRenderer itself
└────────────┬─────────────┘
             │  ipcRenderer.invoke  →  ipcMain.handle
┌────────────▼─────────────┐
│ Main process (Node)      │  electron/main.cjs
│ Kiosk, dialogs, timer,   │  Full OS access, validates every
│ file system, app quit    │  request and sender
└──────────────────────────┘
```

**Security model:** `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The renderer can only call the methods listed below. Every handler checks that the request comes from Athena's own page, and the main process owns all sensitive state (rules accepted, timer, exam running).

### IPC API (`window.electronAPI`)

| Method | Channel | Purpose |
| --- | --- | --- |
| `setFullScreen(flag)` | `window:set-fullscreen` | Enable or disable kiosk mode |
| `showExamRules()` | `exam:show-rules` | Native Accept / Cancel dialog, returns `true` on Accept |
| `startTest(config)` | `exam:start` | Starts the timer. Rejected unless the rules were accepted |
| `getRemainingTime()` | `exam:get-remaining-time` | `{ remainingMs, running }` |
| `saveImage(arrayBuffer)` | `proctor:save-image-to-folder` | Writes a snapshot to `cameraFeed/`. Only while an exam is running |
| `submitExam()` | `exam:submit` | Stops the exam and snapshots |
| `quitApp()` | `app:quit` | Unlocks kiosk and quits. Rejected while an exam is running |

### Project structure

```
athena/
├── electron/
│   ├── main.cjs          # Main process
│   ├── preload.cjs       # contextBridge API
│   └── cameraFeed/       # Snapshots (created at runtime, git-ignored)
├── src/
│   ├── App.jsx           # Setup, exam and submission screens
│   ├── App.css
│   ├── index.css         # Tailwind import and base styles
│   └── main.jsx
├── vite.config.js
└── package.json
```

## Setup and run

**Requirements:** Node.js 20.19 or newer, a webcam, and Windows, macOS or Linux.

```bash
# 1. Install dependencies
npm install

# 2. Development: Vite dev server + Electron window with hot reload
npm run dev

# 3. Production-like run: builds the React app, then launches Electron on dist/
npm start
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Vite only, in a browser. Uses fallbacks for fullscreen and rules, and has no kiosk or snapshot saving |
| `npm run build` | Builds the React app to `dist/` |
| `npm run dist` | Builds an installer with electron-builder into `release/` |

### Dev escape hatch

Kiosk mode can lock you out while developing. In development (`npm run dev`) press **Ctrl/Cmd + Shift + K** to leave kiosk mode. If you are still stuck, end the process from Task Manager or Activity Monitor.

### macOS camera permission

On macOS the app needs OS-level camera access. In development the prompt is attributed to your terminal. For packaged builds, add `NSCameraUsageDescription` under `mac.extendInfo` in the electron-builder config.

## How an exam runs

1. **Setup:** the student grants camera access and enters kiosk full screen. Each card shows a status badge.
2. **Rules:** "Go To Test" opens a native dialog. Only **Accept** continues.
3. **Exam:** the preview is hidden, snapshots start, the timer runs, and focus tracking is active.
4. **Strikes:** switching windows or apps gives a warning (`Strike X of 3`). The third strike submits automatically.
5. **Submission:** the camera is released and the stats are shown. **Exit Assessment** quits the app.

## Known limitations

- Kiosk mode cannot block every OS-level shortcut (Alt+Tab, Win/Cmd key, Ctrl+Alt+Del). Athena detects focus loss instead of preventing it.
- Snapshots are saved locally and never uploaded. Upload them to a backend and delete the local copies after submission.
- A strike is counted once per switch away and does not apply while a native OS dialog is open.
- Questions and answers are sample data in `App.jsx`, with no grading or backend yet.
- Students are photographed during the exam. Tell them in advance and follow your institution's privacy policy.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Black camera preview | Check OS camera permissions. Close other apps using the webcam |
| `npm start` shows a blank window | Run `npm run build` and check that `dist/index.html` exists |
| No files in `cameraFeed/` | Photos are only saved after you accept the rules and while the exam is running |
| Stuck in kiosk mode | Ctrl/Cmd + Shift + K in dev, otherwise kill the process |