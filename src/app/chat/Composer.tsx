import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentKind, ModelState } from '../../../electron/shared/protocol'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/app/settings/controls'
import { GitPanel } from '@/app/workbench/GitPanel'

type Mode = 'plan' | 'auto' | 'ask'
const MODES: [Mode, string, string][] = [
  ['plan', 'Plan', 'list-bullets'],
  ['auto', 'Auto', 'lightning'],
  ['ask', 'Ask', 'hand'],
]

const BACKENDS: Record<AgentKind, { name: string; sub: string; icon: string }> = {
  claude: { name: 'Claude', sub: 'Claude Agent · ACP', icon: 'terminal-window' },
  codex: { name: 'Codex', sub: 'OpenAI Codex · ACP', icon: 'brackets-curly' },
}

function BackendPop({
  current,
  anchor,
  models,
  onPick,
  onPickModel,
  onClose,
}: {
  current: AgentKind
  anchor: { left: number; bottom: number }
  models: ModelState
  onPick: (k: AgentKind) => void
  onPickModel: (id: string) => void
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
        {models.available.length > 0 && (
          <>
            <div className="pop-sect">Model</div>
            {models.available.map((m) => (
              <div key={m.id} className="pop-item" onClick={() => onPickModel(m.id)}>
                <span className="pi-mark">
                  <Icon name="cpu" />
                </span>
                <div className="pi-body">
                  <div className="pi-name">{m.name}</div>
                  {m.description && <div className="pi-sub">{m.description}</div>}
                </div>
                {models.current === m.id && <Icon name="check" className="pi-check" />}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

export function Composer({
  busy,
  onSend,
  onStop,
  branch = 'hearth',
  scratchpadAttached = false,
  onDetachScratchpad,
}: {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  branch?: string
  scratchpadAttached?: boolean
  onDetachScratchpad?: () => void
}) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [models, setModels] = useState<ModelState>({ available: [], current: null })
  const [popAnchor, setPopAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const [gitAnchor, setGitAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const beRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the composer with its content, capped before it scrolls internally.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    void window.hearth.agent.getModels().then(setModels)
    const offBe = window.hearth.agent.onBackendChanged((s) => {
      setBackend(s.kind)
      void window.hearth.agent.getModels().then(setModels)
    })
    const offModels = window.hearth.agent.onModelsChanged(setModels)
    return () => {
      offBe()
      offModels()
    }
  }, [])

  const pickBackend = async (k: AgentKind) => {
    if (k === backend) return
    setBackend(k)
    await window.hearth.agent.setBackend(k)
  }
  const pickModel = (id: string) => {
    setModels((m) => ({ ...m, current: id }))
    void window.hearth.agent.setModel(id)
  }

  const openPop = () => {
    const r = beRef.current?.getBoundingClientRect()
    if (r) setPopAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 })
  }
  const openGit = () => {
    const r = branchRef.current?.getBoundingClientRect()
    if (r) setGitAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 })
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
          <button ref={branchRef} className="chip" title="Branch, changes & environment" onClick={openGit}>
            <Icon name="git-branch" /> {branch}
          </button>
          <span className="chip" title="Hearth can edit its own code">
            <Icon name="flame" fill style={{ color: 'var(--accent)' }} /> Self-edit
          </span>
          <button ref={beRef} className="chip" title="Switch agent backend" onClick={openPop}>
            <Icon name={be.icon} /> {be.name}
          </button>
          {scratchpadAttached && (
            <button className="chip" title="Scratchpad is attached to each message — click to turn off" onClick={onDetachScratchpad}>
              <Icon name="note-pencil" /> Scratchpad attached <Icon name="x" />
            </button>
          )}
        </div>
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply to Hearth, or ask it to change itself…"
          style={{ overflowY: 'auto' }}
        />
        <div className="composer-bar">
          <Seg value={mode} options={MODES} onChange={setMode} />
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
        <BackendPop
          current={backend}
          anchor={popAnchor}
          models={models}
          onPick={pickBackend}
          onPickModel={pickModel}
          onClose={() => setPopAnchor(null)}
        />
      )}
      {gitAnchor && <GitPanel anchor={gitAnchor} onClose={() => setGitAnchor(null)} />}
    </div>
  )
}
