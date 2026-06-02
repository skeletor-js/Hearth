import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SecLabel, SetRow, Btn } from '../controls'
import { Icon } from '@/shell/Icon'
import { toast } from '@/shell/toast'

// Memory: the agent's durable notes, managed through chat. Here we surface its
// state and give an escape hatch (clear) beyond the conversational flow.
export function MemorySection({ memory, onChanged }: { memory: string; onChanged: () => void }) {
  const clear = async () => {
    await window.hearth.memory.clear()
    onChanged()
    toast('Memory cleared')
  }
  return (
    <>
      <SecLabel icon="brain">Memory</SecLabel>
      <SetRow k="Long-term memory" h="Managed through chat — say “remember this” or “forget that”. Read every session.">
        <span className="chip">
          <Icon name="file-text" /> {memory ? 'In use' : 'Empty'}
        </span>
        {memory && (
          <Btn variant="danger" onClick={clear}>
            Clear
          </Btn>
        )}
      </SetRow>
      {memory && <pre className="memory-pre scroll">{memory}</pre>}
    </>
  )
}

// Self-modification: surfaces the always-on guardrails (every self-edit is a
// revertable commit; source-mutating shell is auto-mediated) and links to History.
export function SelfModSection() {
  const navigate = useNavigate()
  return (
    <>
      <SecLabel icon="shield-check">Self-modification</SecLabel>
      <SetRow
        k="Versioned edits"
        h="Every change Hearth makes to its own source is committed and revertable. Direct source-mutating shell is auto-blocked so edits flow through the tracked path."
      >
        <Btn variant="ghost" icon="clock-counter-clockwise" onClick={() => void navigate({ to: '/history' })}>
          View history
        </Btn>
      </SetRow>
    </>
  )
}

// Data & privacy: backs the "stays on your machine" claim with real actions.
export function DataPrivacySection() {
  return (
    <>
      <SecLabel icon="shield">Data &amp; privacy</SecLabel>
      <SetRow k="Local data" h="Conversations, settings, and secrets live on this machine.">
        <Btn variant="ghost" icon="folder-open" onClick={() => void window.hearth.data.reveal()}>
          Reveal data folder
        </Btn>
      </SetRow>
    </>
  )
}

interface AboutInfo {
  app: string
  electron: string
  node: string
  acpSdk: string | null
  claudeAdapter: string | null
  codexAdapter: string | null
}

export function AboutSection() {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  useEffect(() => {
    void window.hearth.about.info().then(setInfo)
  }, [])
  if (!info) return null
  const rows: [string, string | null][] = [
    ['Hearth', info.app],
    ['Electron', info.electron],
    ['Node', info.node],
    ['ACP SDK', info.acpSdk],
    ['Claude adapter', info.claudeAdapter],
    ['Codex adapter', info.codexAdapter],
  ]
  return (
    <>
      <SecLabel icon="info">About</SecLabel>
      <div className="about-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="about-row">
            <span className="about-k">{k}</span>
            <span className="about-v mono">{v ?? '—'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
