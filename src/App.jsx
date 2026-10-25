import { useState, useRef, useEffect } from 'react'
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

function getCameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera access was blocked. Allow it in your system settings and try again.'
    case 'NotFoundError':
      return 'No camera was found. Connect a webcam and try again.'
    case 'NotReadableError':
      return 'Your camera is in use by another application. Close it and try again.'
    default:
      return 'Could not start the camera. Please try again.'
  }
}

function PermissionItem({
  icon,
  title,
  description,
  status,
  errorMessage,
  actionLabel,
  grantedLabel = 'Done',
  onAction,
}) {
  const granted = status === 'granted'
  const pending = status === 'pending'

  return (
    <li className={`permission permission--${status}`}>
      <div className="permission__icon">{granted ? <CheckIcon /> : icon}</div>

      <div className="permission__text">
        <h2 className="permission__title">{title}</h2>
        <p className="permission__desc">
          {status === 'denied'
            ? errorMessage || 'Permission was denied. Please try again.'
            : description}
        </p>
      </div>

      <button
        type="button"
        className="btn btn--secondary"
        onClick={onAction}
        disabled={granted || pending}
      >
        {granted ? grantedLabel : pending ? 'Requesting…' : actionLabel}
      </button>
    </li>
  )
}

export default function App() {
  const [camera, setCamera] = useState('idle') // 'idle' | 'pending' | 'granted' | 'denied'
  const [cameraError, setCameraError] = useState('')
  const [stream, setStream] = useState(null)
  const [fullscreen, setFullscreen] = useState('idle')

  const videoRef = useRef(null)
  const streamRef = useRef(null) // lets cleanup see the latest stream

  // Attach the stream once the <video> element has actually mounted.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  // Release the camera when the component unmounts.
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const getCameraAccess = async () => {
    setCamera('pending')
    setCameraError('')

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true })

      // If the camera is unplugged or revoked mid-session, reset the UI.
      mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
        streamRef.current = null
        setStream(null)
        setCamera('denied')
        setCameraError('The camera was disconnected. Reconnect it and try again.')
      })

      streamRef.current = mediaStream
      setStream(mediaStream)
      setCamera('granted')
    } catch (err) {
      setCameraError(getCameraErrorMessage(err))
      setCamera('denied')
    }
  }

const switchToFullscreen = async () => {
  setFullscreen('pending')
  try {
    if (window.electronAPI) {
      const isLocked = await window.electronAPI.setFullScreen(true) // kiosk mode
      setFullscreen(isLocked ? 'granted' : 'denied')
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
      {stream && (
        <div className="camera-preview" role="img" aria-label="Live camera preview">
          <video ref={videoRef} autoPlay muted playsInline />
          <span className="camera-preview__badge">
            <span className="camera-preview__dot" /> Live
          </span>
        </div>
      )}

      <section className="card">
        <header className="card__header">
          <span className="brand">Athena</span>
          <h1 className="greeting">Hi User! Kindly Allow the following Permissions</h1>
          <p className="subtitle">These are required before your exam can begin.</p>
        </header>

        <ul className="permissions">
          <PermissionItem
            icon={<CameraIcon />}
            title="Configure Camera"
            description="Your camera is used to verify your identity during the exam."
            status={camera}
            errorMessage={cameraError}
            actionLabel="Get Camera Access"
            grantedLabel="Camera Configured"
            onAction={getCameraAccess}
          />
          <PermissionItem
  icon={<FullscreenIcon />}
  title="Switch to full screen"
  description="The exam runs in a locked full-screen mode to keep the session secure."
  status={fullscreen}
  errorMessage="Could not enter full screen. Please try again."
  actionLabel="Give Full Screen Permissions"
  grantedLabel="Full Screen Enabled"
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