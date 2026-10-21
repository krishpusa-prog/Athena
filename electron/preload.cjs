const { contextBridge, ipcRenderer } = require('electron')

// Single source of truth for allowed IPC channels.
const CHANNELS = {
  setFullScreen: 'window:set-fullscreen',
  getRemainingTime: 'exam:get-remaining-time',
  startTest: 'exam:start',
  showExamRules: 'exam:show-rules',
  saveImage: 'proctor:save-image',
}

// Never expose ipcRenderer itself. Each method below is a narrow wrapper
// around one fixed channel, so the renderer can't send arbitrary IPC messages.
contextBridge.exposeInMainWorld('electronAPI', {
  /** @param {boolean} flag */
  setFullScreen: (flag) => ipcRenderer.invoke(CHANNELS.setFullScreen, Boolean(flag)),

  /** @returns {Promise<{ remainingMs: number, running: boolean }>} */
  getRemainingTime: () => ipcRenderer.invoke(CHANNELS.getRemainingTime),

  /** @param {{ examId?: string, durationMinutes?: number }} config */
  startTest: (config = {}) => ipcRenderer.invoke(CHANNELS.startTest, config),

  showExamRules: () => ipcRenderer.invoke(CHANNELS.showExamRules),

  /**
   * @param {string} dataUrl  e.g. "data:image/png;base64,...."
   * @param {string} filename e.g. "snapshot-001.png"
   */
  saveImage: (dataUrl, filename) =>
    ipcRenderer.invoke(CHANNELS.saveImage, { dataUrl, filename }),
})