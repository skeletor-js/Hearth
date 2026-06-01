import { useEffect, useRef, useState } from 'react'
import type { AgentKind } from '../../../electron/shared/protocol'
import { Icon } from '@/shell/Icon'

const MODES = [
  ['plan', 'Plan', 'list-bullets'],
  ['auto', 'Auto', 'lightning'],
  ['ask', 'Ask', 'hand'],
] as const
type Mode = (typeof MODES)[number][0]

const BACKENDS: Record<AgentKind, { name: string; sub: string; icon: string }> = {
  claude: { name: 'Claude', sub: 'Claude Agent · ACP', icon: 'terminal-window' },
  codex: { name: 'Codex', sub: 'OpenAI Codex · ACP', icon: 'brackets-curly' },
}

function BackendPop({
  current,
  anchor,
  onPick,
  onClose,
}: {
  current: AgentKind
  anchor: { left: number; bottom: number }
  onPick: (k: AgentKind) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={anchor}>
        <div className="pop-sect">Agent backend · ACP</div>
        {(Object.keys(BACKENDS) as AgentKind[]).map((id) => {
          const b = BACKENDS[id]
          return (
            <div
              key={id}
              className="pop-item"
              onClick={() => {
                onPick(id)
                onClose()
              }}
            >
              <span className="pi-mark">
                <Icon name={b.icon} />
              </span>
              <div className="pi-body">
                <div className="pi-name">{b.name}</div>
                <div className="pi-sub">{b.sub}</div>
              </div>
              {current === id && <Icon name="check" className="pi-check" />}
            </div>
          )
        })}
      </div>
    </>
  )
}

export function Composer({
  busy,
  onSend,
  onStop,
  branch = 'hearth',
}: {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  branch?: string
}) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [popAnchor, setPopAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const beRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    return window.hearth.agent.onBackendChanged((s) => setBackend(s.kind))
  }, [])

  const pickBackend = async (k: AgentKind) => {
    if (k === backend) return
    setBackend(k)
    await window.hearth.agent.setBackend(k)
  }

  const openPop = () => {
    const r = beRef.current?.getBoundingClientRect()
    if (r) setPopAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 })
  }

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    onSend(text)
    setInput('')
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const be = BACKENDS[backend]
  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="ctx-chips">
          <span className="chip">
            <Icon name="git-branch" /> {branch}
          </span>
          <span className="chip chip-accent">
            <Icon name="flame" fill /> Self-edit on
          </span>
          <button ref={beRef} className="chip" title="Switch agent backend" onClick={openPop}>
            <Icon name={be.icon} /> {be.name}
          </button>
        </div>
        <textarea
          className="composer-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply to Hearth, or ask it to change itself…"
        />
        <div className="composer-bar">
          <div className="mini-seg">
            {MODES.map(([v, l, ic]) => (
              <span key={v} className={'seg' + (mode === v ? ' is-active' : '')} onClick={() => setMode(v)}>
                <Icon name={ic} />
                {l}
              </span>
            ))}
          </div>
          <span className="spacer" />
          <button
            className={'send' + (busy ? '' : input.trim() ? '' : ' is-disabled')}
            onClick={busy ? onStop : send}
            title={busy ? 'Stop' : 'Send'}
          >
            <Icon name={busy ? 'stop' : 'arrow-up'} fill={busy} />
          </button>
        </div>
      </div>
      {popAnchor && (
        <BackendPop current={backend} anchor={popAnchor} onPick={pickBackend} onClose={() => setPopAnchor(null)} />
      )}
    </div>
  )
}
