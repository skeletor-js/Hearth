import { useEffect, useState } from 'react'

// Embeds a micro-app: ask main to start its Vite server, then point a sandboxed
// iframe at the returned URL. The sandbox attribute is the isolation wall — the
// micro-app can run scripts and talk to its own dev server, but it can't
// navigate the top frame, open popups, or reach Hearth's internals.
export function MicroAppFrame({ name }: { name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setError(null)
    window.hearth.microApps
      .start(name)
      .then((u) => {
        if (!cancelled) setUrl(u as string)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [name])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-white/8 bg-white/5 p-4 text-sm text-red-400">
          Failed to start {name}: {error}
        </div>
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-white/40">
        Starting {name}…
      </div>
    )
  }

  return (
    <iframe
      src={url}
      title={name}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
    />
  )
}
