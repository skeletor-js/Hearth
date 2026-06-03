import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Icon } from './Icon'
import { AsciiEmber, FlameMark } from './Mascot'
import { useShell } from './store'
import { Btn, Status, CopyCommand } from '@/app/settings/controls'
import { startSession } from '@/app/sessions'
import type { AgentKind, AuthState } from '../../electron/shared/protocol'
import type { Workspace } from '../../electron/main/workspaces/registry'

/** Signed in via the CLI's own login, a stored/env API key, or a live connection. */
function authed(s?: AuthState): boolean {
  return !!(s && (s.mode === 'api-key' || s.connected || s.loginPresent))
}

const STEPS = ['Connect an agent', 'Choose a workspace', 'Ready']

const BACKENDS: { id: AgentKind; name: string; sub: string; icon: string }[] = [
  { id: 'claude', name: 'Claude', sub: 'Anthropic · Claude Agent over ACP', icon: 'terminal-window' },
  { id: 'codex', name: 'Codex', sub: 'OpenAI Codex over ACP', icon: 'brackets-curly' },
]

// First-run onboarding, trimmed to connect-agent + choose-workspace (locked).
export function Onboarding() {
  const navigate = useNavigate()
  const { setOnboarded } = useShell()
  const [step, setStep] = useState(0)
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string | null>(null)
  const [authStates, setAuthStates] = useState<Partial<Record<AgentKind, AuthState>>>({})
  const [loginCmd, setLoginCmd] = useState('')

  const refreshAuth = (k: AgentKind, reconnect = false) =>
    window.hearth.auth.status(k, reconnect).then((st) => setAuthStates((s) => ({ ...s, [k]: st })))

  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    void window.hearth.workspaces.list().then((l) => {
      setWorkspaces(l)
      setWsId(l[0]?.id ?? null)
    })
    for (const b of BACKENDS) void refreshAuth(b.id)
    return window.hearth.auth.onChanged((st) => setAuthStates((s) => ({ ...s, [st.kind]: st })))
  }, [])

  // The CLI's own `login` command for the chosen backend (string only — Hearth
  // never runs it or sees the credential).
  useEffect(() => {
    void window.hearth.auth.login(backend).then((r) => setLoginCmd(r.command))
  }, [backend])

  const pickBackend = (k: AgentKind) => {
    setBackend(k)
    void window.hearth.agent.setBackend(k)
  }
  const openFolder = async () => {
    const ws = await window.hearth.workspaces.open()
    if (ws) {
      setWorkspaces(await window.hearth.workspaces.list())
      setWsId(ws.id)
    }
  }
  const finish = async () => {
    const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0]
    if (ws) await startSession(ws)
    setOnboarded(true)
    void navigate({ to: '/chat' })
  }
  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish())
  const canNext = step !== 1 || !!wsId

  return (
    <div className="ob" data-screen-label="Onboarding">
      <div className="ob-side">
        <div className="ob-brand">
          <span className="flame">
            <FlameMark size={20} />
          </span>{' '}
          Hearth
        </div>
        <div className="ob-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={'ob-step ' + (i === step ? 'now' : i < step ? 'done' : '')}>
              <span className="ob-num">{i < step ? <Icon name="check" className="ico-12" fill /> : i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'auto', fontSize: 'var(--t-12)', color: 'var(--faint)', lineHeight: 1.6 }}>
          Open source · your data stays on your computer.
        </div>
      </div>

      <div className="ob-main">
        <div className="ob-card">
          {step === 0 && (
            <>
              <h1>Bring an agent you already pay for</h1>
              <p className="lead">Hearth connects over the Agent Client Protocol. Pick one to start — switch any time.</p>
              {BACKENDS.map((b) => (
                <div key={b.id} className={'pick' + (backend === b.id ? ' on' : '')} onClick={() => pickBackend(b.id)}>
                  <span className="pk-mark">
                    <Icon name={b.icon} className="ico-18" />
                  </span>
                  <div className="pk-body">
                    <div className="pk-name">{b.name}</div>
                    <div className="pk-sub">{b.sub}</div>
                  </div>
                  {backend === b.id && <Icon name="check-circle" fill className="pk-check" />}
                </div>
              ))}

              {/* Sign-in status for the chosen backend, so a first prompt can't fail
                  on an un-authenticated agent. Warns, never blocks. */}
              {(() => {
                const st = authStates[backend]
                const name = BACKENDS.find((b) => b.id === backend)?.name ?? 'the agent'
                if (authed(st))
                  return (
                    <div className="auth-login">
                      <Status tone="ok">{st?.mode === 'api-key' ? 'API key set' : 'Signed in'} — ready to go</Status>
                    </div>
                  )
                return (
                  <div className="auth-login">
                    <div className="auth-login-row">
                      <Status tone="warn">Not signed in</Status>
                      <Btn variant="ghost" icon="arrow-clockwise" onClick={() => void refreshAuth(backend, true)}>
                        Re-check
                      </Btn>
                    </div>
                    <p className="set-note">
                      Run this in a terminal to sign in — it opens {name}’s own login. Hearth never sees the credential.
                      Or bring an API key in Settings. You can continue and do this later.
                    </p>
                    {loginCmd && <CopyCommand command={loginCmd} />}
                  </div>
                )
              })()}
            </>
          )}

          {step === 1 && (
            <>
              <h1>Point Hearth at a project</h1>
              <p className="lead">Choose a folder to begin — Hearth itself, or any local repo.</p>
              {workspaces.map((w) => (
                <div key={w.id} className={'pick' + (wsId === w.id ? ' on' : '')} onClick={() => setWsId(w.id)}>
                  <span className="pk-mark">
                    <Icon name={w.isHearth ? 'flame' : 'git-branch'} fill={w.isHearth} />
                  </span>
                  <div className="pk-body">
                    <div className="pk-name">{w.name}</div>
                    <div className="pk-sub" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--t-11)' }}>{w.path}</div>
                  </div>
                  {wsId === w.id && <Icon name="check-circle" fill className="pk-check" />}
                </div>
              ))}
              <button className="btn btn-sm" style={{ marginTop: 2 }} onClick={openFolder}>
                <Icon name="folder-open" /> Open another folder…
              </button>
            </>
          )}

          {step === 2 && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <AsciiEmber fontSize={18} />
              </div>
              <h1>The hearth is lit</h1>
              <p className="lead" style={{ maxWidth: 380, margin: '0 auto 4px' }}>
                You’re on {BACKENDS.find((b) => b.id === backend)?.name}
                {wsId ? `, in ${workspaces.find((w) => w.id === wsId)?.name}` : ''}. Start a session — or ask Hearth to change itself.
              </p>
            </div>
          )}

          <div className="ob-actions">
            {step > 0 && (
              <button className="btn btn-sm btn-quiet" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" disabled={!canNext} onClick={next}>
              {step === STEPS.length - 1 ? 'Start' : 'Continue'} <Icon name="arrow-right" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
