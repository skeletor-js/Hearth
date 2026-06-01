// A scripted Agent for developing the UI and permission flow without a live
// model. Enable by launching with HEARTH_FAKE_AGENT=1 (see index.ts). It plays a
// realistic self-edit turn: assistant message, a thought, a tool call that
// produces a diff, a mid-turn permission ask, then a closing message and end.
//
// This is the test double the B-track UI work is built against — it exercises
// every SessionUpdate variant and the permission round-trip.

import type { Agent, AgentSession, PermissionRequest, SessionUpdate } from './agent.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class FakeAgent implements Agent {
  readonly kind = 'claude' as const
  private updateHandlers = new Set<(s: string, u: SessionUpdate) => void>()
  private permissionHandler: ((s: string, r: PermissionRequest) => Promise<string>) | null = null
  private counter = 0

  async connect(): Promise<void> {
    // Nothing to spawn.
  }

  async newSession(): Promise<AgentSession> {
    const id = `fake-${++this.counter}`
    return {
      id,
      prompt: (text: string) => this.runTurn(id, text),
      cancel: async () => {
        this.emit(id, { type: 'end', stopReason: 'cancelled' })
      },
      dispose: async () => {},
    }
  }

  private async runTurn(sessionId: string, text: string): Promise<void> {
    const path = 'src/shell/Sidebar.tsx'
    await sleep(120)
    this.emit(sessionId, { type: 'message', role: 'assistant', text: `On it — "${text.slice(0, 40)}".` })
    await sleep(120)
    this.emit(sessionId, { type: 'thought', text: `Opening ${path} to find the title.` })
    await sleep(150)
    this.emit(sessionId, { type: 'tool-call', id: 'tc1', title: `Edit ${path}`, status: 'running' })
    await sleep(150)
    this.emit(sessionId, {
      type: 'diff',
      path,
      oldText: '<span>Hearth</span>',
      newText: '<span>Hearth ✨</span>',
    })

    // Mid-turn permission ask — the turn blocks here until the UI answers.
    let approved = true
    if (this.permissionHandler) {
      const chosen = await this.permissionHandler(sessionId, {
        id: 'tc1',
        title: `Write ${path}?`,
        options: [
          { id: 'allow', label: 'Allow', kind: 'allow' },
          { id: 'always', label: 'Allow always', kind: 'allow-always' },
          { id: 'reject', label: 'Reject', kind: 'reject' },
        ],
      })
      approved = chosen !== 'reject'
    }

    await sleep(120)
    this.emit(sessionId, {
      type: 'tool-call',
      id: 'tc1',
      title: `Edit ${path}`,
      status: approved ? 'done' : 'error',
    })
    await sleep(120)
    this.emit(sessionId, {
      type: 'message',
      role: 'assistant',
      text: approved ? 'Done — the title is updated.' : 'Okay, I left the file unchanged.',
    })
    this.emit(sessionId, { type: 'end', stopReason: 'end_turn' })
  }

  onUpdate(cb: (s: string, u: SessionUpdate) => void): () => void {
    this.updateHandlers.add(cb)
    return () => this.updateHandlers.delete(cb)
  }

  onPermission(cb: (s: string, r: PermissionRequest) => Promise<string>): void {
    this.permissionHandler = cb
  }

  private emit(sessionId: string, update: SessionUpdate): void {
    for (const h of this.updateHandlers) h(sessionId, update)
  }

  async dispose(): Promise<void> {
    this.updateHandlers.clear()
  }
}
