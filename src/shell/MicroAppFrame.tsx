import { useEffect, useState } from 'react'
import type { AppCapabilities } from '../../electron/main/micro-apps/capabilities'

// Embeds a micro-app: ask main to start its Vite server, then point a sandboxed
// iframe at the returned URL. Isolation is layered (see the sandbox-hardening
// plan): the sandbox attribute keeps the frame from touching Hearth, and the
// per-app CSP Hearth injects keeps it off the network — except hosts the user has
// explicitly approved here. So before launching, we surface any hosts the app's
// manifest requests but the user hasn't granted, and let the user decide.

type Phase =
  | { kind: 'checking' }
  | { kind: 'approval'; pending: AppCapabilities['pending'] }
  | { kind: 'starting' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string }

// Grace window before a left-behind tool's Vite server is stopped (U15). Long
// enough that a quick back-nav reattaches to the live server; short enough
// that closed tools don't each leak a ~100-200 MB node process. Module-scoped
// so the timer survives the component unmounting (that's the whole point).
const STOP_GRACE_MS = 30_000
const pendingStops = new Map<string, ReturnType<typeof setTimeout>>()

export function MicroAppFrame({ name }: { name: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })

  // Re-run whenever the app changes. `gen` lets the approve handler re-trigger.
  const [gen, setGen] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Back within the grace window: cancel the pending stop and reuse the
    // still-running server (start() below returns its existing URL).
    const pending = pendingStops.get(name)
    if (pending) {
      clearTimeout(pending)
      pendingStops.delete(name)
    }
    setPhase({ kind: 'checking' })
    ;(async () => {
      try {
        const caps = await window.hearth.microApps.capabilities(name)
        if (cancelled) return
        if (caps.pending.length > 0) {
          setPhase({ kind: 'approval', pending: caps.pending })
          return
        }
        setPhase({ kind: 'starting' })
        const url = await window.hearth.microApps.start(name)
        if (!cancelled) setPhase({ kind: 'ready', url })
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancelled = true
      // Leaving the tool: stop its server after the grace window unless the
      // frame remounts first (the effect above cancels the timer). App quit
      // still stops everything via stopAllMicroApps in main.
      const timer = setTimeout(() => {
        pendingStops.delete(name)
        void window.hearth.microApps.stop(name)
      }, STOP_GRACE_MS)
      pendingStops.set(name, timer)
    }
  }, [name, gen])

  async function approveAndLaunch(hosts: string[]) {
    try {
      if (hosts.length > 0) await window.hearth.microApps.approve(name, hosts)
      setGen((g) => g + 1) // re-run the effect; pending should now be empty
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  if (phase.kind === 'error') {
    return (
      <Centered>
        <div className="max-w-md rounded-md border border-white/8 bg-white/5 p-4 text-sm text-red-400">
          Failed to start {name}: {phase.message}
        </div>
      </Centered>
    )
  }

  if (phase.kind === 'approval') {
    return (
      <Centered>
        <div className="max-w-md rounded-md border border-white/8 bg-white/5 p-5 text-sm text-white/80">
          <div className="mb-1 font-medium text-white">{name} wants network access</div>
          <p className="mb-3 text-white/50">
            This micro-app is requesting to connect to the hosts below. It can reach
            nothing external until you approve. Only approve hosts you trust.
          </p>
          <ul className="mb-4 space-y-2">
            {phase.pending.map((req) => (
              <li key={req.host} className="rounded border border-white/8 bg-black/20 p-2">
                <div className="font-mono text-[13px] text-white">{req.host}</div>
                {req.reason && <div className="mt-0.5 text-white/40">{req.reason}</div>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-white/10 px-3 py-1.5 text-white hover:bg-white/15"
              onClick={() => void approveAndLaunch(phase.pending.map((r) => r.host))}
            >
              Approve all & launch
            </button>
            <button
              type="button"
              className="rounded px-3 py-1.5 text-white/60 hover:bg-white/5"
              onClick={() => void approveAndLaunch([])}
            >
              Launch without access
            </button>
          </div>
        </div>
      </Centered>
    )
  }

  if (phase.kind !== 'ready') {
    return <Centered><span className="text-sm text-white/40">Starting {name}…</span></Centered>
  }

  return (
    <iframe
      src={phase.url}
      title={name}
      className="h-full w-full border-0 bg-white"
      // No `allow-same-origin`: the frame keeps an opaque origin so it can't reach
      // Hearth's storage/DOM even if it ends up same-port as the shell. `allow=""`
      // denies every powerful feature (camera, mic, geolocation, …) at the frame
      // level, on top of the session-wide deny in session-policy.ts. Network egress
      // is governed by the per-app CSP header Hearth injects (see capabilities.ts).
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center p-6">{children}</div>
}
