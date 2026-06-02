import { useEffect, useState } from 'react'
import type { AgentKind, AuthState } from '../../../../electron/shared/protocol'
import { SecLabel, SetRow, Btn, Status, SecretField, CopyCommand } from '../controls'
import { toast } from '@/shell/toast'

const BACKENDS: { kind: AgentKind; label: string; secretKey: string }[] = [
  { kind: 'claude', label: 'Claude Code', secretKey: 'apikey.anthropic' },
  { kind: 'codex', label: 'Codex', secretKey: 'apikey.openai' },
]

// Auth is ACP-native: each backend authenticates itself. We render no OAuth and
// store no subscription token (docs/COMPLIANCE.md). The user logs in by running
// the CLI's `login` command themselves; BYO API key is the first-class alt.
export function AuthSection() {
  const [active, setActive] = useState<AgentKind>('claude')
  const [states, setStates] = useState<Record<string, AuthState>>({})
  const [encOk, setEncOk] = useState(true)

  const refresh = (kind: AgentKind, reconnect = false) =>
    window.hearth.auth.status(kind, reconnect).then((st) => setStates((s) => ({ ...s, [kind]: st })))

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setActive)
    void window.hearth.secrets.encryptionAvailable().then(setEncOk)
    for (const b of BACKENDS) void refresh(b.kind)
    const off = window.hearth.agent.onBackendChanged((s) => {
      setActive(s.kind)
      void refresh(s.kind)
    })
    const offAuth = window.hearth.auth.onChanged((st) => setStates((s) => ({ ...s, [st.kind]: st })))
    return () => {
      off()
      offAuth()
    }
  }, [])

  return (
    <>
      <SecLabel icon="user-circle">Account &amp; sign-in</SecLabel>
      {!encOk && (
        <p className="set-note warn">
          Your OS keyring is unavailable, so saved keys are stored obfuscated, not encrypted. Prefer running{' '}
          <code>claude login</code> instead.
        </p>
      )}
      {BACKENDS.map((b) => (
        <BackendAuth
          key={b.kind}
          backend={b}
          state={states[b.kind]}
          isActive={active === b.kind}
          onChanged={() => refresh(b.kind, true)}
        />
      ))}
    </>
  )
}

function badge(state: AuthState | undefined, isActive: boolean) {
  if (!state) return <Status tone="off">Checking…</Status>
  if (state.mode === 'api-key')
    return <Status tone="ok">API key{state.keySource === 'env' ? ' · from env' : ' · stored'}</Status>
  if (!isActive) return <Status tone="off">Inactive backend</Status>
  if (state.error) return <Status tone="warn">Not connected</Status>
  if (state.connected) return <Status tone="ok">Using your login</Status>
  return <Status tone="off">Connecting…</Status>
}

function BackendAuth({
  backend,
  state,
  isActive,
  onChanged,
}: {
  backend: { kind: AgentKind; label: string; secretKey: string }
  state: AuthState | undefined
  isActive: boolean
  onChanged: () => void
}) {
  const [mode, setMode] = useState<null | 'login' | 'apikey' | 'logout'>(null)
  const [command, setCommand] = useState('')
  const [saving, setSaving] = useState(false)
  const hasKey = state?.mode === 'api-key'

  const startLogin = async () => {
    const { command } = await window.hearth.auth.login(backend.kind)
    setCommand(command)
    setMode('login')
  }
  const saveKey = async (value: string) => {
    setSaving(true)
    await window.hearth.secrets.set(backend.secretKey, value)
    await window.hearth.auth.status(backend.kind, true) // reconnect so the key takes effect
    setSaving(false)
    setMode(null)
    onChanged()
    toast(`${backend.label} API key saved`)
  }
  const logout = async () => {
    const res = await window.hearth.auth.logout(backend.kind)
    if (res.cleared) {
      onChanged()
      toast(`${backend.label} key cleared`)
    } else if (res.command) {
      setCommand(res.command)
      setMode('logout')
    }
  }

  return (
    <SetRow k={backend.label} h={subhint(backend.kind, state)}>
      <div className="auth-ctl">
        <div className="auth-badge-row">
          {badge(state, isActive)}
          <div className="auth-actions">
            <Btn variant="ghost" icon="sign-in" onClick={startLogin}>
              Log in
            </Btn>
            <Btn variant="ghost" icon="key" onClick={() => setMode(mode === 'apikey' ? null : 'apikey')}>
              API key
            </Btn>
            {(hasKey || (isActive && state?.connected)) && (
              <Btn variant="ghost" icon="sign-out" onClick={logout}>
                Log out
              </Btn>
            )}
            {isActive && (
              <Btn variant="ghost" icon="arrow-clockwise" onClick={onChanged} title="Re-check">
                Re-check
              </Btn>
            )}
          </div>
        </div>

        {mode === 'apikey' && (
          <SecretField
            present={!!hasKey && state?.keySource === 'secret'}
            placeholder={`Paste your ${backend.kind === 'codex' ? 'OpenAI' : 'Anthropic'} API key`}
            saving={saving}
            onSave={saveKey}
            onClear={hasKey && state?.keySource === 'secret' ? logout : undefined}
          />
        )}
        {(mode === 'login' || mode === 'logout') && (
          <div className="auth-login">
            <p className="set-note">
              Run this in a terminal — it opens {backend.kind === 'codex' ? 'Codex' : 'Claude'}&apos;s own sign-in in
              your browser. Hearth never sees the credential. Then click Re-check.
            </p>
            <div className="auth-login-row">
              <CopyCommand command={command} />
              {isActive && (
                <Btn variant="accent" icon="arrow-clockwise" onClick={onChanged}>
                  Re-check
                </Btn>
              )}
            </div>
          </div>
        )}
      </div>
    </SetRow>
  )
}

function subhint(kind: AgentKind, state: AuthState | undefined): string {
  if (state?.mode === 'subscription' && state.connected)
    return 'Subscription usage via the Agent SDK draws from a separate metered credit pool (from Jun 15 2026).'
  return kind === 'codex'
    ? 'Sign in with `codex login`, or bring your own OpenAI API key.'
    : 'Sign in with `claude login`, or bring your own Anthropic API key.'
}
