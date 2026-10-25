import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const MAX_STRIKES = 3

const QUESTIONS = [
  { id: 1, text: 'Which hook stores a value that persists across renders without causing a re-render?', options: ['useState', 'useRef', 'useMemo', 'useReducer'] },
  { id: 2, text: 'In Electron, which process has access to Node.js and the OS?', options: ['Renderer', 'Preload only', 'Main', 'Service worker'] },
  { id: 3, text: 'What does contextIsolation: true do?', options: ['Disables the GPU', 'Separates preload and page JavaScript worlds', 'Blocks all network access', 'Enables kiosk mode'] },
  { id: 4, text: 'Which API invokes a main-process handler and returns a Promise?', options: ['ipcRenderer.invoke', 'ipcRenderer.sendSync', 'window.postMessage', 'fetch'] },
  { id: 5, text: 'What is Vite mainly used for in this project?', options: ['Packaging installers', 'Dev server and bundling', 'Camera access', 'Database storage'] },
]

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

const BADGE_LABELS = {
  idle: 'Pending',
  pending: 'Requesting…',
  granted: 'Granted',
  denied: 'Failed',
}

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

async function captureJpegBlob(imageCapture) {
  try {
    return await imageCapture.takePhoto()
  } catch {
    const bitmap = await imageCapture.grabFrame()
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

function PermissionItem({
  icon, title, description, status, errorMessage,
  actionLabel, grantedLabel = 'Done', onAction,
}) {
  const granted = status === 'granted'
  const pending = status === 'pending'

  return (
    <li className={`permission permission--${status}`}>
      <div className="permission__icon">{granted ? <CheckIcon /> : icon}</div>

      <div className="permission__text">
        <div className="permission__heading">
          <h2 className="permission__title">{title}</h2>
          <span className={`badge badge--${status}`}>
            {granted && <CheckIcon />}
            {BADGE_LABELS[status]}
          </span>
        </div>
        <p className="permission__desc">
          {status === 'denied'
            ? errorMessage || 'Permission was denied. Please try again.'
            : description}
        </p>
      </div>

      <button type="button" className="btn btn--secondary" onClick={onAction} disabled={granted || pending}>
        {granted ? grantedLabel : pending ? 'Requesting…' : actionLabel}
      </button>
    </li>
  )
}

export default function App() {
  // ---- Setup state ----
  const [camera, setCamera] = useState('idle')
  const [cameraError, setCameraError] = useState('')
  const [fullscreen, setFullscreen] = useState('idle')
  const [stream, setStream] = useState(null)
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [rulesError, setRulesError] = useState('')

  // ---- Exam state ----
  const [answers, setAnswers] = useState({})          // { [questionId]: optionIndex }
  const [current, setCurrent] = useState(0)
  const [violations, setViolations] = useState(0)
  const [warningOpen, setWarningOpen] = useState(false)
  const [remainingMs, setRemainingMs] = useState(null)
  const [result, setResult] = useState(null)          // set once the exam is submitted

  // Refs so event listeners and callbacks always see the latest values.
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const answersRef = useRef({})
  const violationsRef = useRef(0)
  const startedAtRef = useRef(0)
  const submittedRef = useRef(false)

  const bothGranted = camera === 'granted' && fullscreen === 'granted'

  // ---------- Submission ----------
  const submitExam = useCallback((reason) => {
    if (submittedRef.current) return // never submit twice
    submittedRef.current = true

    const total = QUESTIONS.length
    const answered = QUESTIONS.filter((q) => answersRef.current[q.id] !== undefined).length

    setResult({
      reason, // 'manual' | 'violations' | 'time'
      total,
      answered,
      skipped: total - answered,
      timeTakenMs: Date.now() - startedAtRef.current,
    })
    setWarningOpen(false)

    // Release the camera and tell main to stop snapshots / the timer.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    window.electronAPI?.submitExam().catch(() => {})
  }, [])

  // ---------- Anti-cheat ----------
  const recordViolation = useCallback(() => {
    const next = violationsRef.current + 1
    violationsRef.current = next
    setViolations(next)

    if (next >= MAX_STRIKES) submitExam('violations')
    else setWarningOpen(true)
  }, [submitExam])

  useEffect(() => {
    if (!started || result) return

    // Switching away fires both `blur` and `visibilitychange`.
    // `away` makes sure one switch counts as exactly one strike.
    let away = false
    const leave = () => {
      if (away) return
      away = true
      recordViolation()
    }
    const back = () => { away = false }
    const onVisibility = () => (document.hidden ? leave() : back())

    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [started, result, recordViolation])

  // ---------- Timer (source of truth lives in the main process) ----------
  useEffect(() => {
    if (!started || result || !window.electronAPI) return

    const tick = async () => {
      try {
        const { remainingMs, running } = await window.electronAPI.getRemainingTime()
        setRemainingMs(remainingMs)
        if (!running) submitExam('time')
      } catch { /* ignore a missed tick */ }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [started, result, submitExam])

  // ---------- Camera ----------
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream, started])

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  // Background snapshots every 5 seconds while the exam is running.
  useEffect(() => {
    if (!started || result) return

    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return

    const imageCapture = new ImageCapture(track)
    let busy = false

    const capture = async () => {
      if (busy || track.readyState !== 'live') return
      busy = true
      try {
        const blob = await captureJpegBlob(imageCapture)
        const arrayBuffer = await blob.arrayBuffer()
        await window.electronAPI?.saveImage(arrayBuffer)
      } catch (err) {
        console.warn('Snapshot failed:', err)
      } finally {
        busy = false
      }
    }

    const intervalId = setInterval(capture, 5000)
    return () => clearInterval(intervalId)
  }, [started, result])

  // ---------- Handlers ----------
  const getCameraAccess = async () => {
    setCamera('pending')
    setCameraError('')
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true })

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
        const isLocked = await window.electronAPI.setFullScreen(true)
        setFullscreen(isLocked ? 'granted' : 'denied')
      } else {
        await document.documentElement.requestFullscreen()
        setFullscreen('granted')
      }
    } catch {
      setFullscreen('denied')
    }
  }

  const goToTest = async () => {
    if (!bothGranted || starting) return
    setStarting(true)
    setRulesError('')

    try {
      let accepted
      if (window.electronAPI) {
        accepted = await window.electronAPI.showExamRules()
      } else {
        accepted = window.confirm(
          '1. Do not switch tabs or windows\n2. Cheating results in 0 marks\n\nAccept?'
        )
      }

      if (!accepted) {
        setRulesError('You must accept the exam rules to begin the test.')
        return
      }

      await window.electronAPI?.startTest({ durationMinutes: 60 })
      startedAtRef.current = Date.now()
      setStarted(true)
    } catch {
      setRulesError('Something went wrong. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  const selectAnswer = (questionId, optionIndex) => {
    answersRef.current = { ...answersRef.current, [questionId]: optionIndex }
    setAnswers(answersRef.current)
  }

  const exitAssessment = async () => {
    try {
      if (window.electronAPI) await window.electronAPI.quitApp()
      else window.close()
    } catch (err) {
      console.warn('Could not quit:', err)
    }
  }

  // ---------- Render ----------
  const question = QUESTIONS[current]
  const answeredCount = Object.keys(answers).length

  return (
    <main className="app">
      {/* Camera: visible preview during setup, 1px hidden element during the exam */}
      {stream && !result && (
        started ? (
          <video
            ref={videoRef}
            className="hidden-video"
            autoPlay
            muted
            playsInline
            aria-hidden="true"
            tabIndex={-1}
          />
        ) : (
          <div className="camera-preview" role="img" aria-label="Live camera preview">
            <video ref={videoRef} autoPlay muted playsInline />
            <span className="camera-preview__badge">
              <span className="camera-preview__dot" /> Live
            </span>
          </div>
        )
      )}

      {/* ---------- Submitted ---------- */}
      {result ? (
        <section className="card card--center">
          <div className="success-mark"><CheckIcon /></div>
          <h1 className="greeting">Exam Submitted Successfully</h1>
          {result.reason === 'violations' && (
            <p className="notice notice--danger">
              Your exam was submitted automatically after {MAX_STRIKES} focus-loss violations.
            </p>
          )}
          {result.reason === 'time' && (
            <p className="notice">Your exam was submitted automatically because time ran out.</p>
          )}

          <dl className="stats">
            <div className="stat"><dt>Questions answered</dt><dd>{result.answered}</dd></div>
            <div className="stat"><dt>Questions skipped</dt><dd>{result.skipped}</dd></div>
            <div className="stat"><dt>Time taken</dt><dd>{formatDuration(result.timeTakenMs)}</dd></div>
            <div className="stat"><dt>Violations</dt><dd>{violations}</dd></div>
          </dl>

          <button type="button" className="btn btn--primary" onClick={exitAssessment}>
            Exit Assessment
          </button>
        </section>
      ) : started ? (
        /* ---------- Exam ---------- */
        <section className="card">
          <header className="exam__header">
            <span className="brand">Athena</span>
            <div className="exam__meta">
              {remainingMs !== null && <span className="timer">{formatDuration(remainingMs)}</span>}
              <span className="strikes">Strikes: {violations}/{MAX_STRIKES}</span>
            </div>
          </header>

          <p className="exam__progress">
            Question {current + 1} of {QUESTIONS.length} · {answeredCount} answered
          </p>
          <h1 className="question">{question.text}</h1>

          <div className="options" role="radiogroup" aria-label="Answer options">
            {question.options.map((option, i) => (
              <label
                key={option}
                className={`option ${answers[question.id] === i ? 'option--selected' : ''}`}
              >
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  checked={answers[question.id] === i}
                  onChange={() => selectAnswer(question.id, i)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>

          <footer className="card__footer exam__footer">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setCurrent((c) => c - 1)}
              disabled={current === 0}
            >
              Previous
            </button>

            {current < QUESTIONS.length - 1 ? (
              <button type="button" className="btn btn--secondary" onClick={() => setCurrent((c) => c + 1)}>
                {answers[question.id] === undefined ? 'Skip' : 'Next'}
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => submitExam('manual')}>
                Submit Exam
              </button>
            )}
          </footer>
        </section>
      ) : (
        /* ---------- Setup ---------- */
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
            {rulesError && <p className="footer-error" role="alert">{rulesError}</p>}
            <button type="button" className="btn btn--primary" disabled={!bothGranted || starting} onClick={goToTest}>
              {starting ? 'Starting…' : 'Go To Test'}
            </button>
          </footer>
        </section>
      )}

      {/* ---------- Focus-loss warning ---------- */}
      {warningOpen && !result && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="warn-title">
            <h2 id="warn-title" className="modal__title">
              Warning: Focus lost! Strike {violations} of {MAX_STRIKES}
            </h2>
            <p className="modal__text">
              Switching windows or applications is not allowed. At {MAX_STRIKES} strikes your exam is
              submitted automatically.
            </p>
            <button type="button" className="btn btn--primary" autoFocus onClick={() => setWarningOpen(false)}>
              I Understand
            </button>
          </div>
        </div>
      )}
    </main>
  )
}