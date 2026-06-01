import { useEffect, useState } from 'react'

// Embeds a micro-app: ask main to start its Vite server, then point a sandboxed
// iframe at the returned URL. The sandbox attribute is the isolation wall — a
// micro-app can't reach Hearth's internals or crash the shell.
export function MicroAppFrame({ name }: { name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.hearth.microApps
      .start(name)
      .then((u) => !cancelled && setUrl(u as string))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [name])

  if (error) return <div className="p-6 text-sm text-red-400">Failed to start {name}: {error}</div>
  if (!url) return <div className="p-6 text-sm text-white/40">Starting {name}…</div>

  return (
    <iframe
      src={url}
      title={name}
      className="h-full w-full border-0"
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      referrerPolicy="no-referrer"
    />
  )
}
