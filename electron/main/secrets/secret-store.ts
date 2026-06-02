// Encrypted local secret store. Holds the user's OWN secrets — BYO API keys and
// the env values MCP servers need — encrypted at rest via the OS keychain
// (Electron safeStorage: Keychain on macOS, DPAPI on Windows, libsecret on
// Linux). It NEVER holds an inherited Claude/Codex subscription token (see
// docs/COMPLIANCE.md rule 2) — those stay owned by the CLI.
//
// Values never leave main in plaintext after being set: the renderer can set,
// delete, and list secret *names* (presence), but can't read a value back. Only
// main-process code (auth + MCP env resolution) reads values.
//
// The crypto backend is injected so the store is unit-testable without Electron;
// the default backend wraps safeStorage. Reads are synchronous (the decrypted
// map lives in memory) so auth resolution can stay sync.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Pluggable encryption so the store can be tested without Electron. */
export interface CryptoBackend {
  /** True when the OS provides real encryption. False → values stored obfuscated, not secure. */
  available: boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

/** On-disk shape. `enc` marks whether `data` is truly encrypted or just base64. */
interface SecretsFile {
  enc: boolean
  data: string // base64 of the encrypted bytes (enc) or of the JSON map (!enc)
}

export interface SecretInfo {
  key: string
  hasValue: true
}

export class SecretStore {
  private map = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly backend: CryptoBackend,
  ) {
    this.load()
  }

  /** True when secrets are encrypted at rest. UI warns when false. */
  get encryptionAvailable(): boolean {
    return this.backend.available
  }

  get(key: string): string | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, value: string): void {
    if (!key) throw new Error('secret key is required')
    this.map.set(key, value)
    this.persist()
  }

  delete(key: string): void {
    if (this.map.delete(key)) this.persist()
  }

  /** Names + presence only — never values. This is what the renderer sees. */
  list(): SecretInfo[] {
    return [...this.map.keys()].sort().map((key) => ({ key, hasValue: true }))
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const file = JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretsFile
      const json = file.enc
        ? this.backend.decrypt(Buffer.from(file.data, 'base64'))
        : Buffer.from(file.data, 'base64').toString('utf8')
      const obj = JSON.parse(json) as Record<string, string>
      this.map = new Map(Object.entries(obj))
    } catch {
      // A corrupt or undecryptable file (e.g. moved machine, keychain rotated)
      // starts empty rather than crashing boot. The user re-enters secrets.
      this.map = new Map()
    }
  }

  private persist(): void {
    const json = JSON.stringify(Object.fromEntries(this.map))
    const file: SecretsFile = this.backend.available
      ? { enc: true, data: this.backend.encrypt(json).toString('base64') }
      : { enc: false, data: Buffer.from(json, 'utf8').toString('base64') }
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(file), { mode: 0o600 })
  }
}

/** The production crypto backend, wrapping Electron's safeStorage. */
export function safeStorageBackend(safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}): CryptoBackend {
  const available = safeStorage.isEncryptionAvailable()
  return {
    available,
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (blob) => safeStorage.decryptString(blob),
  }
}
