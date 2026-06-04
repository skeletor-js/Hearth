import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { UpdateStatus } from '../../electron/shared/protocol'

// Surfaces a staged auto-update. We don't apply updates silently — when one is
// downloaded and ready, this banner offers a one-click "Restart to update".
// Anything else (idle, checking, downloading, unsupported in dev) stays quiet;
// download progress is visible in Settings → About for anyone who looks.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void window.hearth.update.get().then(setStatus)
    return window.hearth.update.onStatus(setStatus)
  }, [])

  if (status.state !== 'downloaded') return null

  const restart = async () => {
    setInstalling(true)
    const res = await window.hearth.update.install()
    if (!res.ok) setInstalling(false) // a refused restart leaves the banner up
  }

  return (
    <div className="update-banner">
      <Icon name="flame" fill className="ico-13" />
      <span>
        Hearth {status.version ?? 'update'} is ready.
      </span>
      <button className="btn btn-sm btn-primary" onClick={() => void restart()} disabled={installing}>
        {installing ? 'Restarting…' : 'Restart to update'}
      </button>
    </div>
  )
}
