import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentKind, AvailableCommand, ConfigOption, ModelState, ModeState, PromptCapabilities, PromptImage, Usage } from '../../../electron/shared/protocol'
import type { Workspace } from '../../../electron/main/workspaces/registry'
import { Icon } from '@/shell/Icon'
import { Switch } from '@/app/settings/controls'
import { GitPanel } from '@/app/workbench/GitPanel'
import { useSession } from '@/app/session-store'
import { startSession } from '@/app/sessions'
import { useWorkspaces } from '../use-workspaces'

const BACKENDS: Record<AgentKind, { name: string; sub: string; icon: string }> = {
  claude: { name: 'Claude', sub: 'Claude Agent · ACP', icon: 'terminal-window' },
  codex: { name: 'Codex', sub: 'OpenAI Codex · ACP', icon: 'brackets-curly' },
}

type Anchor = { left: number; bottom: number }
// The agent-settings popover is tall (backend + mode + model + options + usage), and
// the composer sits mid-screen, so it opens DOWNWARD from the chip with a
// viewport-clamped height instead of growing upward off the top.
type DownAnchor = { left: number; top: number; maxHeight: number }

function basename(p: string): string {
  return p.split('/').pop() || p
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

/** The agent-settings popover: backend, permission mode, model, any other
 * agent-advertised config options, and a read-only usage line. Modes/options are
 * rendered generically from what the backend advertises — no fixed label map. */
function AgentSettingsPop({
  current,
  anchor,
  models,
  modes,
  configOptions,
  usage,
  onPick,
  onPickModel,
  onPickMode,
  onSetConfig,
  onClose,
}: {
  current: AgentKind
  anchor: DownAnchor
  models: ModelState
  modes: ModeState
  configOptions: ConfigOption[]
  usage: Usage | null
  onPick: (k: AgentKind) => void
  onPickModel: (id: string) => void
  onPickMode: (id: string) => void
  onSetConfig: (id: string, value: string | boolean) => void
  onClose: () => void
}) {
  // Mode + model are surfaced by their own controls; render only the *other*
  // advertised options generically (forward-compatible, e.g. a future reasoning
  // level), so they never duplicate the mode/model sections.
  const extraConfig = configOptions.filter((o) => o.category !== 'mode' && o.category !== 'model')
  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={{ left: anchor.left, top: anchor.top, maxHeight: anchor.maxHeight, overflow: 'auto' }}>
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

        {modes.available.length > 0 && (
          <>
            <div className="pop-sect">Permission mode</div>
            <div className="pop-note">The agent’s own mode for this session. Hearth’s Command approval (Settings) gates these asks on top.</div>
            {modes.available.map((m) => (
              <div key={m.id} className="pop-item" onClick={() => onPickMode(m.id)}>
                <span className="pi-mark">
                  <Icon name="shield-check" />
                </span>
                <div className="pi-body">
                  <div className="pi-name">{m.name}</div>
                  {m.description && <div className="pi-sub">{m.description}</div>}
                </div>
                {modes.current === m.id && <Icon name="check" className="pi-check" />}
              </div>
            ))}
          </>
        )}

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

        {extraConfig.map((opt) =>
          opt.type === 'boolean' ? (
            <div key={opt.id}>
              <div className="pop-sect">{opt.name}</div>
              <div className="pop-item" style={{ cursor: 'default' }}>
                <div className="pi-body">
                  {opt.description && <div className="pi-sub">{opt.description}</div>}
                </div>
                <Switch on={opt.current} onChange={(v) => onSetConfig(opt.id, v)} />
              </div>
            </div>
          ) : (
            <div key={opt.id}>
              <div className="pop-sect">{opt.name}</div>
              {opt.options.map((o) => (
                <div key={o.value} className="pop-item" onClick={() => onSetConfig(opt.id, o.value)}>
                  <span className="pi-mark">
                    <Icon name="sliders-horizontal" />
                  </span>
                  <div className="pi-body">
                    <div className="pi-name">{o.name}</div>
                    {o.description && <div className="pi-sub">{o.description}</div>}
                  </div>
                  {opt.current === o.value && <Icon name="check" className="pi-check" />}
                </div>
              ))}
            </div>
          ),
        )}

        {usage && (
          <>
            <div className="pop-sect">Usage</div>
            <div className="pop-item" style={{ cursor: 'default' }}>
              <span className="pi-mark">
                <Icon name="gauge" />
              </span>
              <div className="pi-body">
                <div className="pi-name">
                  {fmtTokens(usage.used)} / {fmtTokens(usage.size)} context
                  {usage.cost && ` · $${usage.cost.amount.toFixed(usage.cost.amount < 1 ? 3 : 2)}`}
                </div>
                <div className="pi-sub">Runs on the Agent SDK metered credit pool — see docs/COMPLIANCE.md</div>
              </div>
            </div>
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
  const workspaces = useWorkspaces()

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
  onSend: (text: string, images?: PromptImage[]) => void
  onStop: () => void
  scratchpadAttached?: boolean
  onDetachScratchpad?: () => void
}) {
  const [input, setInput] = useState('')
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [models, setModels] = useState<ModelState>({ available: [], current: null })
  const [modes, setModes] = useState<ModeState>({ available: [], current: null })
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [promptCaps, setPromptCaps] = useState<PromptCapabilities>({ image: false, embeddedContext: false })
  const [pendingImages, setPendingImages] = useState<PromptImage[]>([])
  const [commands, setCommands] = useState<AvailableCommand[]>([])
  const [slashSel, setSlashSel] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [settingsAnchor, setSettingsAnchor] = useState<DownAnchor | null>(null)
  const [gitAnchor, setGitAnchor] = useState<Anchor | null>(null)
  const [wsAnchor, setWsAnchor] = useState<Anchor | null>(null)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const modeRef = useRef<HTMLButtonElement>(null)
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

  // Pull the agent's current backend + session config (model/mode/options/usage),
  // and re-pull on backend switch. Live changes arrive on the change channels.
  const refreshAgent = () => {
    void window.hearth.agent.getModels().then(setModels)
    void window.hearth.agent.getModes().then(setModes)
    void window.hearth.agent.getConfigOptions().then(setConfigOptions)
    void window.hearth.agent.getUsage().then(setUsage)
    void window.hearth.agent.getPromptCapabilities().then(setPromptCaps)
    void window.hearth.agent.getCommands().then(setCommands)
    setPendingImages([]) // a backend that can't take images shouldn't keep stale ones
  }
  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    refreshAgent()
    const offBe = window.hearth.agent.onBackendChanged((s) => {
      setBackend(s.kind)
      refreshAgent()
    })
    const offModels = window.hearth.agent.onModelsChanged(setModels)
    const offModes = window.hearth.agent.onModeChanged(setModes)
    const offConfig = window.hearth.agent.onConfigChanged(setConfigOptions)
    const offUsage = window.hearth.agent.onUsageChanged(setUsage)
    const offCommands = window.hearth.agent.onCommandsChanged(setCommands)
    return () => {
      offBe()
      offModels()
      offModes()
      offConfig()
      offUsage()
      offCommands()
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
  const allWorkspaces = useWorkspaces()
  useEffect(() => {
    if (!cwd) return setWsName(null)
    const ws = allWorkspaces.find((w) => w.id === workspaceId)
    setWsName(ws?.name ?? basename(cwd))
  }, [cwd, workspaceId, allWorkspaces])

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
  const pickMode = (id: string) => {
    setModes((m) => ({ ...m, current: id }))
    void window.hearth.agent.setMode(id)
  }
  const setConfig = (id: string, value: string | boolean) => {
    void window.hearth.agent.setConfigOption(id, value)
  }

  const anchorFrom = (el: HTMLElement | null): Anchor | null => {
    const r = el?.getBoundingClientRect()
    return r ? { left: r.left, bottom: window.innerHeight - r.top + 6 } : null
  }
  const openSettings = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    if (r) setSettingsAnchor({ left: r.left, top: r.bottom + 6, maxHeight: window.innerHeight - r.bottom - 18 })
  }
  const openGit = () => setGitAnchor(anchorFrom(branchRef.current))
  const openWs = () => setWsAnchor(anchorFrom(wsRef.current))

  // --- Image attachments (W1) — gated on promptCapabilities.image ---
  const addImageFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    const read = (f: File) =>
      new Promise<PromptImage>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => {
          // dataURL: "data:<mime>;base64,<data>" — strip the prefix for the ACP block.
          const s = String(r.result)
          const comma = s.indexOf(',')
          resolve({ data: comma >= 0 ? s.slice(comma + 1) : s, mimeType: f.type })
        }
        r.onerror = () => reject(r.error)
        r.readAsDataURL(f)
      })
    const next = await Promise.all(imgs.map(read))
    setPendingImages((p) => [...p, ...next])
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (!promptCaps.image) return
    const files = Array.from(e.clipboardData.files)
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      void addImageFiles(files)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    if (!promptCaps.image) return
    const files = Array.from(e.dataTransfer.files)
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      void addImageFiles(files)
    }
  }

  // --- Slash-command palette (W6) ---
  const slashQuery = /^\/(\S*)$/.exec(input)?.[1] // "/" + token, no space yet
  const slashMatches =
    slashQuery != null ? commands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase())).slice(0, 8) : []
  const slashOpen = slashMatches.length > 0 && !slashDismissed
  const pickCommand = (name: string) => {
    setInput(`/${name} `)
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  // Reset selection and un-dismiss whenever the typed token changes, so the menu
  // re-opens as the user keeps typing after an Escape.
  useEffect(() => {
    setSlashSel(0)
    setSlashDismissed(false)
  }, [slashQuery])

  const send = () => {
    const text = input.trim()
    if ((!text && pendingImages.length === 0) || busy) return
    onSend(text, pendingImages.length ? pendingImages : undefined)
    setInput('')
    setPendingImages([])
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setSlashSel((i) => (i + 1) % slashMatches.length)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setSlashSel((i) => (i - 1 + slashMatches.length) % slashMatches.length)
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        return pickCommand(slashMatches[slashSel].name)
      }
      // Escape dismisses the menu only — the typed message is preserved.
      if (e.key === 'Escape') {
        e.preventDefault()
        return setSlashDismissed(true)
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const be = BACKENDS[backend]
  const modeName = modes.available.find((m) => m.id === modes.current)?.name
  const canSend = !!input.trim() || pendingImages.length > 0
  return (
    <div className="composer-wrap">
      {slashOpen && (
        <div className="slash-menu">
          {slashMatches.map((c, i) => (
            <div
              key={c.name}
              className={'slash-item' + (i === slashSel ? ' is-active' : '')}
              onMouseEnter={() => setSlashSel(i)}
              onClick={() => pickCommand(c.name)}
            >
              <span className="slash-name">/{c.name}</span>
              {c.description && <span className="slash-desc">{c.description}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="composer" onDrop={onDrop} onDragOver={(e) => promptCaps.image && e.preventDefault()}>
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
          <button ref={settingsRef} className="chip" title="Agent settings" onClick={() => openSettings(settingsRef.current)}>
            <Icon name={be.icon} /> {be.name}
            <Icon name="caret-down" />
          </button>
          {scratchpadAttached && (
            <button className="chip" title="Scratchpad is attached to each message — click to turn off" onClick={onDetachScratchpad}>
              <Icon name="note-pencil" /> Scratchpad attached <Icon name="x" />
            </button>
          )}
        </div>
        {pendingImages.length > 0 && (
          <div className="composer-attachments">
            {pendingImages.map((img, i) => (
              <div key={i} className="attach-thumb">
                <img src={`data:${img.mimeType};base64,${img.data}`} alt="attachment" />
                <button className="attach-x" title="Remove" onClick={() => setPendingImages((p) => p.filter((_, j) => j !== i))}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={promptCaps.image ? 'Reply to Hearth, paste a screenshot, or ask it to change itself…' : 'Reply to Hearth, or ask it to change itself…'}
          style={{ overflowY: 'auto' }}
        />
        <div className="composer-bar">
          {modes.available.length > 0 && (
            <button
              ref={modeRef}
              className="chip chip-sm"
              title="Permission mode — click for agent settings"
              onClick={() => openSettings(modeRef.current)}
            >
              <Icon name="shield-check" /> {modeName ?? 'Mode'}
            </button>
          )}
          <span className="spacer" />
          <button
            className={'send' + (busy ? '' : canSend ? '' : ' is-disabled')}
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
          modes={modes}
          configOptions={configOptions}
          usage={usage}
          onPick={pickBackend}
          onPickModel={pickModel}
          onPickMode={pickMode}
          onSetConfig={setConfig}
          onClose={() => setSettingsAnchor(null)}
        />
      )}
      {wsAnchor && <WorkspacePop anchor={wsAnchor} currentId={workspaceId} onClose={() => setWsAnchor(null)} />}
      {gitAnchor && <GitPanel anchor={gitAnchor} onClose={() => setGitAnchor(null)} />}
    </div>
  )
}
