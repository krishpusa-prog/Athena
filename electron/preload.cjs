const { contextBridge, ipcRenderer } = require('electron')

// Single source of truth for allowed IPC channels.
const CHANNELS = {
  setFullScreen: 'window:set-fullscreen',
  getRemainingTime: 'exam:get-remaining-time',
  startTest: 'exam:start',
  showExamRules: 'exam:show-rules',
  saveImage: 'proctor:save-image-to-folder',
  submitExam: 'exam:submit',
  quitApp: 'app:quit',
}

// Never expose ipcRenderer itself. Each method below is a narrow wrapper
// around one fixed channel, so the renderer can't send arbitrary IPC messages.
contextBridge.exposeInMainWorld('electronAPI', {
  /** Enables or disables kiosk mode. Resolves to true if kiosk is active. */
  setFullScreen: (flag) => ipcRenderer.invoke(CHANNELS.setFullScreen, Boolean(flag)),

  /** @returns {Promise<{ remainingMs: number, running: boolean }>} */
  getRemainingTime: () => ipcRenderer.invoke(CHANNELS.getRemainingTime),

  /** Starts the exam timer. Rejected unless the rules were accepted. */
  startTest: (config = {}) => ipcRenderer.invoke(CHANNELS.startTest, config),

  /** Native Accept / Cancel dialog. Resolves to true only on Accept. */
  showExamRules: () => ipcRenderer.invoke(CHANNELS.showExamRules),

  /** @param {ArrayBuffer} arrayBuffer raw JPEG bytes from ImageCapture */
  saveImage: (arrayBuffer) => ipcRenderer.invoke(CHANNELS.saveImage, arrayBuffer),

  /** Tells main the exam is over (stops snapshots and the timer). */
  submitExam: () => ipcRenderer.invoke(CHANNELS.submitExam),

  /** Unlocks the kiosk window and quits. Rejected while an exam is running. */
  quitApp: () => ipcRenderer.invoke(CHANNELS.quitApp),
})