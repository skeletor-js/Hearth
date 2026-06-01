import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Icon } from '@/shell/Icon'
import { useShell, ACCENT_OPTIONS, type Accent } from '@/shell/store'
import { Seg, SetRow, Switch } from '@/app/settings/controls'
import type { AgentKind, ModelState } from '../../electron/shared/protocol'
import type { SoulConfig } from '../../electron/main/soul/soul'

export const Route = createFileRoute('/settings')({ component: SettingsScreen })

function SettingsScreen() {
  const s = useShell()
  const [backend, setBackend] = useState<AgentKind>('claude')
  const [models, setModels] = useState<ModelState>({ available: [], current: null })
  const [soul, setSoul] = useState<SoulConfig | null>(null)
  const [memory, setMemory] = useState('')

  const loadModels = () => void window.hearth.agent.getModels().then(setModels)
  useEffect(() => {
    void window.hearth.agent.getBackend().then(setBackend)
    loadModels()
    void window.hearth.personality.get().then(setSoul)
    void window.hearth.memory.get().then(setMemory)
    const offBe = window.hearth.agent.onBackendChanged((st) => {
      setBackend(st.kind)
      loadModels()
    })
    const offModels = window.hearth.agent.onModelsChanged(setModels)
    return () => {
      offBe()
      offModels()
    }
  }, [])

  const setBe = (k: AgentKind) => {
    setBackend(k)
    void window.hearth.agent.setBackend(k)
  }
  const pickModel = (id: string) => {
    setModels((m) => ({ ...m, current: id }))
    void window.hearth.agent.setModel(id)
  }
  const patchSoul = (patch: Partial<SoulConfig>) => {
    if (!soul) return
    const next = { ...soul, ...patch }
    setSoul(next)
    void window.hearth.personality.set(next)
  }

  return (
    <div className="screen scroll" data-screen-label="Settings">
      <div className="screen-inner narrow">
        <h1 className="screen-title">Settings</h1>
        <p className="screen-sub">
          Your files and conversations stay on your machine. Hearth only talks to the agents you connect.
        </p>

        <div className="sec-label">
          <Icon name="user-circle" /> Account
        </div>
        <SetRow k="Signed in" h="Local profile · this machine">
          <span className="chip">
            <Icon name="user" /> you@hearth.local
          </span>
        </SetRow>
        <SetRow k="Keys" h="Bring your own subscription or API keys — nothing core is gated.">
          <span className="chip">
            <span className="dot ok" /> Bring-your-own keys
          </span>
        </SetRow>

        <div className="sec">
          <div className="sec-label">
            <Icon name="plugs-connected" /> Agent
          </div>
        </div>
        <SetRow k="Default backend" h="Which ACP agent new sessions start with.">
          <Seg<AgentKind> value={backend} options={[['claude', 'Claude'], ['codex', 'Codex']]} onChange={setBe} />
        </SetRow>
        <SetRow k="Default model" h={`Models exposed by ${backend === 'codex' ? 'Codex' : 'Claude'}.`}>
          {models.available.length === 0 ? (
            <select className="field" disabled>
              <option>Default</option>
            </select>
          ) : (
            <select className="field" value={models.current ?? ''} onChange={(e) => pickModel(e.target.value)}>
              {models.available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </SetRow>
        <SetRow k="Command approval" h="When Hearth wants to run a shell command or write files.">
          <Seg
            value={s.approval}
            options={[['auto', 'Auto'], ['commands', 'Ask on commands'], ['always', 'Ask always']]}
            onChange={s.setApproval}
          />
        </SetRow>

        <div className="sec">
          <div className="sec-label">
            <Icon name="palette" /> Appearance
          </div>
        </div>
        <SetRow k="Theme">
          <Seg value={s.theme} options={[['light', 'Light'], ['dark', 'Dark']]} onChange={s.setTheme} />
        </SetRow>
        <SetRow k="Accent">
          <div className="swatch-row">
            {ACCENT_OPTIONS.map((c: Accent) => (
              <button
                key={c}
                className={'swatch' + (s.accent === c ? ' on' : '')}
                style={{ background: c }}
                onClick={() => s.setAccent(c)}
              />
            ))}
          </div>
        </SetRow>
        <SetRow k="Reduce motion" h="Pause the ember and other ambient animation.">
          <Switch on={s.reduceMotion} onChange={s.setReduceMotion} />
        </SetRow>

        <div className="sec">
          <div className="sec-label">
            <Icon name="chat-text" /> Personality
          </div>
        </div>
        {soul && (
          <>
            <SetRow k="Response length">
              <Seg
                value={soul.length}
                options={[['short', 'Short'], ['balanced', 'Balanced'], ['thorough', 'Thorough']]}
                onChange={(length) => patchSoul({ length })}
              />
            </SetRow>
            <SetRow k="Directness">
              <Seg value={soul.directness} options={[['gentle', 'Gentle'], ['direct', 'Direct']]} onChange={(directness) => patchSoul({ directness })} />
            </SetRow>
            <SetRow k="Formatting density" h="These compile to a Soul block your agent reads — you don’t edit it directly.">
              <Seg value={soul.density} options={[['compact', 'Compact'], ['roomy', 'Roomy']]} onChange={(density) => patchSoul({ density })} />
            </SetRow>
          </>
        )}

        <div className="sec">
          <div className="sec-label">
            <Icon name="brain" /> Memory
          </div>
        </div>
        <SetRow k="Long-term memory" h="Managed through chat — say “remember this” or “forget that”. Read every session.">
          <span className="chip">
            <Icon name="file-text" /> {memory ? 'In use' : 'Empty'}
          </span>
        </SetRow>
        {memory && (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 'var(--t-11_5)', color: 'var(--subtle)', padding: '4px 2px' }}>
            {memory}
          </pre>
        )}
      </div>
    </div>
  )
}
