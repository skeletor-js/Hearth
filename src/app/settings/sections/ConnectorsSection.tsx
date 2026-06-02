import { useEffect, useState } from 'react'
import type { McpServerConfig, McpServerInput, McpEnvVar, McpTransport } from '../../../../electron/main/mcp/registry'
import type { ProbeResult } from '../../../../electron/main/mcp/probe'
import type { ActiveConnector, ActiveConnectors } from '../../../../electron/shared/protocol'
import { SecLabel, Switch, Btn, Status, CopyCommand } from '../controls'
import { Icon } from '@/shell/Icon'
import { toast } from '@/shell/toast'
import { useShell } from '@/shell/store'
import { useTerminalBus } from '@/app/workbench/terminal-bus'
import { GUIDED_CONNECTORS, addCommands, type GuidedConnector } from '../connectors-catalog'

// User MCP servers, merged into every new session alongside the built-in `hearth`
// bridge. Changes apply to NEW sessions (ACP binds servers at session creation).
export function ConnectorsSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [editing, setEditing] = useState<null | string | 'new'>(null)
  const [tests, setTests] = useState<Record<string, ProbeResult | 'running'>>({})

  const [active, setActive] = useState<ActiveConnectors | null>(null)
  const loadActive = () =>
    window.hearth.mcp.active().then((a) => {
      setActive(a)
      return a
    })
  const load = () => window.hearth.mcp.list().then(setServers)
  useEffect(() => {
    void load()
    void loadActive()
  }, [])

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'running' }))
    const res = await window.hearth.mcp.test(id)
    setTests((t) => ({ ...t, [id]: res }))
  }
  const toggle = async (id: string, on: boolean) => {
    await window.hearth.mcp.setEnabled(id, on)
    void load()
  }
  const remove = async (id: string) => {
    await window.hearth.mcp.remove(id)
    void load()
  }

  return (
    <>
      <SecLabel icon="plugs-connected">Connectors (MCP)</SecLabel>
      <p className="set-note">
        Tools you give every agent session. The built-in <b>hearth</b> connector (see &amp; drive the live app) is
        always on. Changes apply to new sessions.
      </p>

      <div className="list">
        <div className="list-row">
          <div className="list-main">
            <div className="list-title">
              hearth <span className="chip chip-sm">Built in</span>
            </div>
            <div className="list-meta">stdio · view / drive the live app</div>
          </div>
          <div className="list-actions">
            <Status tone="ok">Always on</Status>
          </div>
        </div>

        {servers.map((s) => {
          const res = tests[s.id]
          return (
            <div key={s.id} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {s.name} <span className="chip chip-sm">{s.transport.type}</span>
                </div>
                <div className="list-meta">{transportSummary(s.transport)}</div>
                {res && res !== 'running' && (
                  <div className={'list-meta ' + (res.ok ? 'ok' : 'err')}>
                    {res.ok
                      ? res.reachableOnly
                        ? 'Reachable'
                        : `Connected · ${res.tools ?? 0} tool${res.tools === 1 ? '' : 's'}`
                      : `Failed · ${res.error}`}
                  </div>
                )}
              </div>
              <div className="list-actions">
                <Btn variant="ghost" busy={res === 'running'} onClick={() => test(s.id)}>
                  Test
                </Btn>
                <Btn variant="ghost" onClick={() => setEditing(s.id)}>
                  Edit
                </Btn>
                <Btn variant="danger" onClick={() => remove(s.id)}>
                  Remove
                </Btn>
                <Switch on={s.enabled} onChange={(on) => toggle(s.id, on)} />
              </div>
            </div>
          )
        })}
      </div>

      {editing ? (
        <ServerForm
          existing={editing === 'new' ? undefined : servers.find((s) => s.id === editing)}
          onDone={() => {
            setEditing(null)
            void load()
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Btn variant="default" icon="plus" onClick={() => setEditing('new')}>
          Add connector
        </Btn>
      )}

      {active && <GuidedConnectors active={active} onRefresh={loadActive} />}
      {active && <ActiveConnectorsView active={active} />}
    </>
  )
}

const isPresent = (active: ActiveConnectors, kind: 'claude' | 'codex', serverName: string): boolean =>
  active[kind].some((c) => c.name === serverName)

// A1 + A1b: guided "Add connector". We generate the right `mcp add` command per
// backend and run it in the Hearth terminal; the CLI does the OAuth. Connectors
// are per-backend, so when both CLIs are set up the user authorizes twice (once
// each) — we walk them through both. Connectors without a first-party remote MCP
// endpoint route to the persistent browser instead of a fabricated command.
function GuidedConnectors({ active, onRefresh }: { active: ActiveConnectors; onRefresh: () => Promise<ActiveConnectors> }) {
  const backends = ([] as ('claude' | 'codex')[]).concat(
    active.claudeCli ? ['claude'] : [],
    active.codexCli ? ['codex'] : [],
  )
  const [flow, setFlow] = useState<{ c: GuidedConnector; stepIdx: number; waiting: boolean } | null>(null)

  // Poll the read-only connector view until the server appears for the current
  // step's backend (= the `mcp add` landed), then advance. The user completes the
  // CLI's browser sign-in in the meantime; bounded so a stuck flow never hangs.
  useEffect(() => {
    if (!flow?.waiting) return
    const kind = backends[flow.stepIdx]
    const serverName = flow.c.serverName
    let tries = 0
    const timer = setInterval(async () => {
      tries++
      const a = await onRefresh() // re-fetch + sync parent so ✓/✗ updates live
      if (isPresent(a, kind, serverName) || tries >= 36) {
        clearInterval(timer)
        setFlow((f) => (f ? { ...f, waiting: false } : f))
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [flow?.waiting, flow?.stepIdx])

  const runStep = (c: GuidedConnector, kind: 'claude' | 'codex') => {
    const cmds = addCommands(c, kind)
    if (!cmds.length) return
    useShell.getState().setBottomOpen(true)
    useShell.getState().setBottomTab('terminal')
    useTerminalBus.getState().run(cmds.join(' && '))
    setFlow((f) => (f ? { ...f, waiting: true } : f))
  }

  const advance = () => {
    setFlow((f) => {
      if (!f) return null
      const next = f.stepIdx + 1
      if (next >= backends.length) {
        onRefresh()
        return null
      }
      return { ...f, stepIdx: next, waiting: false }
    })
  }

  return (
    <>
      <SecLabel icon="plug-charging">Add a connector</SecLabel>
      <p className="set-note">
        Hearth runs the right command in your terminal and the CLI handles sign-in — no tokens are stored here.
        Connectors are configured <b>per backend</b>, so with both Claude Code and Codex set up you authorize each
        connector twice.
      </p>
      {backends.length === 0 && (
        <p className="set-note warn">Neither claude nor codex resolves on your PATH — install one to add connectors.</p>
      )}
      <div className="list">
        {GUIDED_CONNECTORS.map((c) => {
          const onClaude = isPresent(active, 'claude', c.serverName)
          const onCodex = isPresent(active, 'codex', c.serverName)
          return (
            <div key={c.id} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {c.label}
                  {!c.url && <span className="chip chip-sm">browser</span>}
                </div>
                <div className="list-meta">
                  {active.claudeCli && (
                    <span className={onClaude ? 'ok' : ''}>Claude {onClaude ? '✓' : '—'}</span>
                  )}
                  {active.claudeCli && active.codexCli && ' · '}
                  {active.codexCli && <span className={onCodex ? 'ok' : ''}>Codex {onCodex ? '✓' : '—'}</span>}
                </div>
              </div>
              <div className="list-actions">
                {c.url ? (
                  <Btn variant="default" onClick={() => setFlow({ c, stepIdx: 0, waiting: false })} disabled={!backends.length}>
                    Set up
                  </Btn>
                ) : (
                  <Btn
                    variant="ghost"
                    icon="globe"
                    onClick={() => {
                      useShell.getState().setBottomOpen(true)
                      useShell.getState().setBottomTab('browser')
                      // let BrowserTab mount (it opens about:blank) before navigating
                      setTimeout(() => window.hearth.browser.navigate(c.site), 250)
                    }}
                  >
                    Log in via browser
                  </Btn>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {flow && (
        <ConnectorFlow
          flow={flow}
          backends={backends}
          present={(kind) => isPresent(active, kind, flow.c.serverName)}
          onRun={runStep}
          onSkipOrNext={advance}
          onClose={() => {
            onRefresh()
            setFlow(null)
          }}
        />
      )}
    </>
  )
}

function ConnectorFlow({
  flow,
  backends,
  present,
  onRun,
  onSkipOrNext,
  onClose,
}: {
  flow: { c: GuidedConnector; stepIdx: number; waiting: boolean }
  backends: ('claude' | 'codex')[]
  present: (kind: 'claude' | 'codex') => boolean
  onRun: (c: GuidedConnector, kind: 'claude' | 'codex') => void
  onSkipOrNext: () => void
  onClose: () => void
}) {
  const kind = backends[flow.stepIdx]
  const label = kind === 'codex' ? 'Codex' : 'Claude Code'
  const done = present(kind)
  return (
    <div className="auth-login">
      {backends.length > 1 && (
        <p className="set-note">
          {flow.c.label} — step {flow.stepIdx + 1} of {backends.length}: authorize for <b>{label}</b>. MCP connectors
          are per backend, so you&apos;ll do this once for each.
        </p>
      )}
      <CopyCommand command={addCommands(flow.c, kind).join(' && ')} />
      <div className="auth-login-row">
        <Btn variant="accent" icon="terminal-window" onClick={() => onRun(flow.c, kind)}>
          Run in terminal
        </Btn>
        {done ? (
          <Status tone="ok">{flow.c.serverName} added</Status>
        ) : flow.waiting ? (
          <Status tone="run">Waiting for {flow.c.serverName}… complete sign-in in the terminal</Status>
        ) : (
          <Status tone="off">Press Enter in the terminal, then finish sign-in</Status>
        )}
        {flow.stepIdx < backends.length - 1 ? (
          <Btn variant="ghost" onClick={onSkipOrNext}>
            {done ? 'Next backend' : 'Skip this backend'}
          </Btn>
        ) : (
          <Btn variant="ghost" onClick={onClose}>
            Done
          </Btn>
        )}
      </div>
    </div>
  )
}

// A2: read-only view of what each backend loads from its OWN CLI config. Managed
// by Claude Code / Codex — edited in the terminal, never written by Hearth.
function ActiveConnectorsView({ active }: { active: ActiveConnectors }) {
  const backends: { kind: 'claude' | 'codex'; label: string; cmd: string; servers: ActiveConnector[]; cli: boolean }[] = [
    { kind: 'claude', label: 'Claude Code', cmd: 'claude mcp', servers: active.claude, cli: active.claudeCli },
    { kind: 'codex', label: 'Codex', cmd: 'codex mcp', servers: active.codex, cli: active.codexCli },
  ]
  return (
    <>
      <SecLabel icon="plugs">Active connectors (from your CLIs)</SecLabel>
      <p className="set-note">
        What each backend loads from its own config. Managed by Claude Code / Codex — add or remove these in the
        terminal (e.g. <code>claude mcp add</code>), not here. Hearth only reads them.
      </p>
      {backends.map((b) => (
        <div key={b.kind} className="list">
          <div className="list-row">
            <div className="list-main">
              <div className="list-title">{b.label}</div>
            </div>
            <div className="list-actions">
              {b.cli ? (
                <Status tone="off">{b.servers.length} connector{b.servers.length === 1 ? '' : 's'}</Status>
              ) : (
                <Status tone="warn">CLI not found on PATH</Status>
              )}
            </div>
          </div>
          {!b.cli && (
            <div className="list-row">
              <div className="list-meta warn">
                <code>{b.kind}</code> isn&apos;t resolvable in Hearth&apos;s terminal — install it or check your PATH to
                manage connectors.
              </div>
            </div>
          )}
          {b.servers.map((s) => (
            <div key={b.kind + ':' + s.scope + ':' + s.name} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {s.name} <span className="chip chip-sm">{s.transport}</span>
                  <span className="chip chip-sm">{s.scope}</span>
                </div>
                <div className="list-meta">{s.target || '—'}</div>
              </div>
              <div className="list-actions">{s.hasAuth && <Status tone="ok">Authorized</Status>}</div>
            </div>
          ))}
          {b.cli && b.servers.length === 0 && (
            <div className="list-row">
              <div className="list-meta">None yet — run <code>{b.cmd} add …</code> in the terminal.</div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function transportSummary(t: McpTransport): string {
  return t.type === 'stdio' ? `${t.command} ${t.args.join(' ')}`.trim() : t.url
}

type EnvDraft = { name: string; value: string; secret: boolean; hadSecret: boolean }

function ServerForm({
  existing,
  onDone,
  onCancel,
}: {
  existing?: McpServerConfig
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<McpTransport['type']>(existing?.transport.type ?? 'stdio')
  const [command, setCommand] = useState(existing?.transport.type === 'stdio' ? existing.transport.command : '')
  const [args, setArgs] = useState(existing?.transport.type === 'stdio' ? existing.transport.args.join(' ') : '')
  const [url, setUrl] = useState(existing && existing.transport.type !== 'stdio' ? existing.transport.url : '')
  const [env, setEnv] = useState<EnvDraft[]>(
    (existing?.env ?? []).map((e) => ({ name: e.name, value: '', secret: !!e.secretKey, hadSecret: !!e.secretKey })),
  )
  const [busy, setBusy] = useState(false)

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server'

  const save = async () => {
    if (!name.trim()) return toast('Name is required')
    setBusy(true)
    const transport: McpTransport =
      type === 'stdio'
        ? { type: 'stdio', command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] }
        : { type, url: url.trim() }

    // Build env, writing secret values to the encrypted store and referencing them
    // by key. A blank secret value on edit keeps the existing secret.
    const envConfig: McpEnvVar[] = []
    for (const e of env) {
      if (!e.name.trim()) continue
      if (e.secret) {
        const secretKey = `mcp.${slug(name)}.${e.name.trim()}`
        if (e.value.trim()) await window.hearth.secrets.set(secretKey, e.value.trim())
        envConfig.push({ name: e.name.trim(), secretKey })
      } else {
        envConfig.push({ name: e.name.trim(), value: e.value })
      }
    }

    const input: McpServerInput = { name: name.trim(), enabled: existing?.enabled ?? true, transport, env: envConfig }
    if (existing) await window.hearth.mcp.update(existing.id, input)
    else await window.hearth.mcp.add(input)
    setBusy(false)
    onDone()
  }

  return (
    <div className="mcp-form">
      <div className="mcp-form-row">
        <label>Name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Linear" />
      </div>
      <div className="mcp-form-row">
        <label>Transport</label>
        <div className="mini-seg">
          {(['stdio', 'http', 'sse'] as const).map((t) => (
            <span key={t} className={'seg' + (type === t ? ' is-active' : '')} onClick={() => setType(t)}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {type === 'stdio' ? (
        <>
          <div className="mcp-form-row">
            <label>Command</label>
            <input className="field" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          </div>
          <div className="mcp-form-row">
            <label>Arguments</label>
            <input className="field" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @scope/mcp-server" />
          </div>
        </>
      ) : (
        <div className="mcp-form-row">
          <label>URL</label>
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
        </div>
      )}

      <div className="mcp-form-row top">
        <label>{type === 'stdio' ? 'Env vars' : 'Headers'}</label>
        <div className="env-list">
          {env.map((e, i) => (
            <div key={i} className="env-row">
              <input
                className="field"
                value={e.name}
                placeholder="NAME"
                onChange={(ev) => setEnv((arr) => arr.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
              />
              <input
                className="field"
                type={e.secret ? 'password' : 'text'}
                value={e.value}
                placeholder={e.hadSecret && !e.value ? '•••• (unchanged)' : 'value'}
                onChange={(ev) => setEnv((arr) => arr.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))}
              />
              <label className="env-secret" title="Store encrypted">
                <input
                  type="checkbox"
                  checked={e.secret}
                  onChange={(ev) => setEnv((arr) => arr.map((x, j) => (j === i ? { ...x, secret: ev.target.checked } : x)))}
                />
                <Icon name="lock-key" />
              </label>
              <button className="env-del" onClick={() => setEnv((arr) => arr.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <Btn variant="ghost" icon="plus" onClick={() => setEnv((arr) => [...arr, { name: '', value: '', secret: false, hadSecret: false }])}>
            Add {type === 'stdio' ? 'var' : 'header'}
          </Btn>
        </div>
      </div>

      <div className="mcp-form-actions">
        <Btn variant="accent" busy={busy} onClick={save}>
          {existing ? 'Save' : 'Add connector'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}
