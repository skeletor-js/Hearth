import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentKind, ModelState } from '../../../electron/shared/protocol'
import type { Workspace } from '../../../electron/main/workspaces/registry'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/app/settings/controls'
import { GitPanel } from '@/app/workbench/GitPanel'
import { useSession } from '@/app/session-store'
import { startSession } from '@/app/sessions'

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

type Anchor = { left: number; bottom: number }

function basename(p: string): string {
  return p.split('/').pop() || p
}

/** The agent-settings popover: backend switch + model picker. Phase 1B adds the
 * advertised-mode selector and a usage line here. */
function AgentSettingsPop({
  current,
  anchor,
  models,
  onPick,
  onPickModel,
  onClose,
}: {
  current: AgentKind
  anchor: Anchor
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

/** Switch the active workspace. A session is bound to one cwd, so picking a
 * workspace starts a fresh session there (consistent with the rail). */
function WorkspacePop({
  anchor,
  currentId,
  onClose,
}: {
  anchor: Anchor
  currentId: string | undefined
  onClose: () => void
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  useEffect(() => {
    void window.hearth.workspaces.list().then(setWorkspaces)
  }, [])

  const pick = async (ws: Workspace) => {
    onClose()
    await startSession(ws)
    useSession.getState().flashWorkspaceChip()
  }
  const openFolder = async () => {
    const ws = await window.hearth.workspaces.open()
    onClose()
    if (ws) {
      await startSession(ws)
      useSession.getState().flashWorkspaceChip()
    }
  }

  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={anchor}>
        <div className="pop-sect">Workspace</div>
        {workspaces.map((w) => (
          <div key={w.id} className="pop-item" onClick={() => void pick(w)} title={w.path}>
            <span className="pi-mark">
              <Icon name={w.isHearth ? 'flame' : 'folder'} />
            </span>
            <div className="pi-body" style={{ minWidth: 0 }}>
              <div className="pi-name">{w.name}</div>
              <div className="pi-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {w.path}
              </div>
            </div>
            {w.id === currentId && <Icon name="check" className="pi-check" />}
          </div>
        ))}
        <div className="pop-item" onClick={() => void openFolder()}>
          <span className="pi-mark">
            <Icon name="folder-simple-plus" />
          </span>
          <div className="pi-body">
            <div className="pi-name">Open folder…</div>
          </div>
        </div>
      </div>
    </>
  )
}

export function Composer({
  busy,
  onSend,
  onStop,
  scratchpadAttached = false,
  onDetachScratchpad,
}: {
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  scratchpadAttached?: boolean
  onDetachScratchpad?: () => void
}) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [models, setModels] = useState<ModelState>({ available: [], current: null })
  const [settingsAnchor, setSettingsAnchor] = useState<Anchor | null>(null)
  const [gitAnchor, setGitAnchor] = useState<Anchor | null>(null)
  const [wsAnchor, setWsAnchor] = useState<Anchor | null>(null)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const wsRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const cwd = useSession((s) => s.active?.cwd)
  const workspaceId = useSession((s) => s.active?.workspaceId)
  const diffNonce = useSession((s) => s.diffNonce)
  const flashNonce = useSession((s) => s.workspaceFlashNonce)
  const [branch, setBranch] = useState<{ name: string; ahead: number; behind: number } | null>(null)
  const [wsName, setWsName] = useState<string | null>(null)
  const [flashing, setFlashing] = useState(false)

  // Auto-grow the composer with its content, capped before it scrolls internally.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  // Load a prompt pushed in for editing/resend (e.g. "Edit" on a past message).
  const composerDraft = useSession((s) => s.composerDraft)
  useEffect(() => {
    if (composerDraft == null) return
    setInput(composerDraft)
    useSession.getState().setComposerDraft(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [composerDraft])

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

  // Real branch (+ ahead/behind) for the active session's cwd. Refreshes when the
  // session changes and whenever the working tree likely changed (diffNonce).
  useEffect(() => {
    let live = true
    if (!cwd) return setBranch(null)
    void window.hearth.git
      .status(cwd)
      .then((s) => live && setBranch(s?.branch ? { name: s.branch, ahead: s.ahead, behind: s.behind } : null))
      .catch(() => live && setBranch(null))
    return () => {
      live = false
    }
  }, [cwd, diffNonce])

  // Workspace name: match the active workspace id, fall back to the cwd basename.
  useEffect(() => {
    let live = true
    if (!cwd) return setWsName(null)
    void window.hearth.workspaces.list().then((list) => {
      if (!live) return
      const ws = list.find((w) => w.id === workspaceId)
      setWsName(ws?.name ?? basename(cwd))
    })
    return () => {
      live = false
    }
  }, [cwd, workspaceId])

  // Pulse the workspace chip when New Session signals the workspace is changeable.
  useEffect(() => {
    if (flashNonce === 0) return
    setFlashing(true)
    const t = setTimeout(() => setFlashing(false), 1500)
    return () => clearTimeout(t)
  }, [flashNonce])

  const pickBackend = async (k: AgentKind) => {
    if (k === backend) return
    setBackend(k)
    await window.hearth.agent.setBackend(k)
  }
  const pickModel = (id: string) => {
    setModels((m) => ({ ...m, current: id }))
    void window.hearth.agent.setModel(id)
  }

  const anchorFrom = (el: HTMLElement | null): Anchor | null => {
    const r = el?.getBoundingClientRect()
    return r ? { left: r.left, bottom: window.innerHeight - r.top + 6 } : null
  }
  const openSettings = () => setSettingsAnchor(anchorFrom(settingsRef.current))
  const openGit = () => setGitAnchor(anchorFrom(branchRef.current))
  const openWs = () => setWsAnchor(anchorFrom(wsRef.current))

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
          <button
            ref={wsRef}
            className={'chip' + (flashing ? ' is-flashing' : '')}
            title={cwd ? `Workspace: ${cwd} — click to switch` : 'Workspace'}
            onClick={openWs}
          >
            <Icon name="folder" /> {wsName ?? '…'}
          </button>
          <button ref={branchRef} className="chip" title="Branch, changes & environment" onClick={openGit}>
            <Icon name="git-branch" /> {branch?.name ?? '…'}
            {branch && (branch.ahead > 0 || branch.behind > 0) && (
              <span style={{ color: 'var(--faint)' }}>
                {branch.ahead > 0 ? ` ↑${branch.ahead}` : ''}
                {branch.behind > 0 ? ` ↓${branch.behind}` : ''}
              </span>
            )}
          </button>
          <button ref={settingsRef} className="chip" title="Agent settings" onClick={openSettings}>
            <Icon name={be.icon} /> {be.name}
            <Icon name="caret-down" />
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
      {settingsAnchor && (
        <AgentSettingsPop
          current={backend}
          anchor={settingsAnchor}
          models={models}
          onPick={pickBackend}
          onPickModel={pickModel}
          onClose={() => setSettingsAnchor(null)}
        />
      )}
      {wsAnchor && <WorkspacePop anchor={wsAnchor} currentId={workspaceId} onClose={() => setWsAnchor(null)} />}
      {gitAnchor && <GitPanel anchor={gitAnchor} onClose={() => setGitAnchor(null)} />}
    </div>
  )
}
