import { useState } from 'react'
import './App.css'

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
)

const FullscreenIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

function PermissionItem({ icon, title, description, status, actionLabel, onAction }) {
  const granted = status === 'granted'

  return (
    <li className={`permission permission--${status}`}>
      <div className="permission__icon">{granted ? <CheckIcon /> : icon}</div>

      <div className="permission__text">
        <h2 className="permission__title">{title}</h2>
        <p className="permission__desc">
          {status === 'denied' ? 'Permission was denied. Please try again.' : description}
        </p>
      </div>

      <button
        type="button"
        className="btn btn--secondary"
        onClick={onAction}
        disabled={granted}
      >
        {granted ? 'Done' : actionLabel}
      </button>
    </li>
  )
}

export default function App() {
  const [camera, setCamera] = useState('idle')         // 'idle' | 'granted' | 'denied'
  const [fullscreen, setFullscreen] = useState('idle')

  const configureCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((track) => track.stop()) // we only needed the permission check
      setCamera('granted')
    } catch {
      setCamera('denied')
    }
  }

  const switchToFullscreen = async () => {
    try {
      if (window.electronAPI) {
        const isFullScreen = await window.electronAPI.setFullScreen(true)
        setFullscreen(isFullScreen ? 'granted' : 'denied')
      } else {
        // Plain-browser fallback (npm run dev without Electron)
        await document.documentElement.requestFullscreen()
        setFullscreen('granted')
      }
    } catch {
      setFullscreen('denied')
    }
  }

  const allGranted = camera === 'granted' && fullscreen === 'granted'

  return (
    <main className="app">
      <section className="card">
        <header className="card__header">
          <span className="brand">Athena</span>
          <h1 className="greeting">Hi User! Kindly Allow the following Permissions</h1>
          <p className="subtitle">
            These are required before your exam can begin.
          </p>
        </header>

        <ul className="permissions">
          <PermissionItem
            icon={<CameraIcon />}
            title="Configure Camera"
            description="Your camera is used to verify your identity during the exam."
            status={camera}
            actionLabel="Allow"
            onAction={configureCamera}
          />
          <PermissionItem
            icon={<FullscreenIcon />}
            title="Switch to full screen"
            description="The exam must run in full screen to keep the session secure."
            status={fullscreen}
            actionLabel="Switch"
            onAction={switchToFullscreen}
          />
        </ul>

        <footer className="card__footer">
          <button type="button" className="btn btn--primary" disabled={!allGranted}>
            Continue
          </button>
        </footer>
      </section>
    </main>
  )
}