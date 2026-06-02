import { useEffect, useState } from 'react'
import type { McpServerConfig, McpServerInput, McpEnvVar, McpTransport } from '../../../../electron/main/mcp/registry'
import type { ProbeResult } from '../../../../electron/main/mcp/probe'
import { SecLabel, Switch, Btn, Status } from '../controls'
import { Icon } from '@/shell/Icon'
import { toast } from '@/shell/toast'

// User MCP servers, merged into every new session alongside the built-in `hearth`
// bridge. Changes apply to NEW sessions (ACP binds servers at session creation).
export function ConnectorsSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [editing, setEditing] = useState<null | string | 'new'>(null)
  const [tests, setTests] = useState<Record<string, ProbeResult | 'running'>>({})

  const load = () => window.hearth.mcp.list().then(setServers)
  useEffect(() => void load(), [])

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
