import { useEffect, useState } from 'react'
import type { SecretInfo } from '../../../../electron/main/secrets/secret-store'
import { SecLabel, Btn } from '../controls'
import { toast } from '@/shell/toast'

// A flat view of every stored secret NAME (API keys + MCP env). Values are never
// shown — the renderer can't read them back. Delete-only here; setting happens in
// the Auth / Connectors sections that own each key.
export function SecretsSection() {
  const [secrets, setSecrets] = useState<SecretInfo[]>([])
  const [encOk, setEncOk] = useState(true)

  const load = () => window.hearth.secrets.list().then(setSecrets)
  useEffect(() => {
    void load()
    void window.hearth.secrets.encryptionAvailable().then(setEncOk)
  }, [])

  const del = async (key: string) => {
    await window.hearth.secrets.delete(key)
    void load()
    toast(`Deleted ${key}`)
  }

  return (
    <>
      <SecLabel icon="lock-key">Secrets</SecLabel>
      <p className="set-note">
        {encOk ? 'Encrypted in your OS keychain' : 'Stored locally (OS keychain unavailable — not encrypted)'}. Values
        are write-only; Hearth can use them but never shows them back.
      </p>
      <div className="list">
        {secrets.length === 0 && <div className="list-empty">No secrets stored.</div>}
        {secrets.map((s) => (
          <div key={s.key} className="list-row">
            <div className="list-main">
              <div className="list-title mono">{s.key}</div>
            </div>
            <div className="list-actions">
              <Btn variant="danger" onClick={() => del(s.key)}>
                Delete
              </Btn>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
