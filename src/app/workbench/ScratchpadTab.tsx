import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon } from '@/shell/Icon'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import { readScratchpad, writeScratchpad, SCRATCHPAD_MAX } from '../scratchpad'
import { markdownLive } from './markdown-live'

// A per-workspace markdown notepad. Backed by `.hearth/scratchpad.md` in the active
// session's cwd. The user jots here; the agent can read it, you can send it on
// command, or auto-attach it to every turn (toggle here, chip in the composer).
export function ScratchpadTab() {
  const cwd = useSession((s) => s.active?.cwd)
  const theme = useShell((s) => s.theme)
  const attach = useShell((s) => (cwd ? s.scratchpadAttach[cwd] ?? false : false))
  const setScratchpadAttach = useShell((s) => s.setScratchpadAttach)
  const requestPrompt = useSession((s) => s.requestPrompt)
  const setNonEmpty = useSession((s) => s.setScratchpadNonEmpty)

  const [text, setText] = useState('')
  const [saved, setSaved] = useState(true)
  const [hasSel, setHasSel] = useState(false)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ cwd: string; text: string } | null>(null)

  // Flush a queued write immediately (e.g. before switching workspace), to the cwd
  // it was captured against — never the new one.
  const flush = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const p = pending.current
    if (p) {
      pending.current = null
      void writeScratchpad(p.cwd, p.text)
    }
  }

  // Load on cwd change; flush any pending write to the old cwd on the way out.
  useEffect(() => {
    if (!cwd) {
      setText('')
      return
    }
    let live = true
    void readScratchpad(cwd).then((p) => {
      if (!live) return
      setText(p)
      setSaved(true)
      setNonEmpty(p.trim().length > 0)
    })
    return () => {
      live = false
      flush()
    }
  }, [cwd])

  const onChange = (v: string) => {
    setText(v)
    setSaved(false)
    setNonEmpty(v.trim().length > 0)
    if (!cwd) return
    pending.current = { cwd, text: v }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const p = pending.current
      saveTimer.current = null
      pending.current = null
      if (p) void writeScratchpad(p.cwd, p.text).then(() => setSaved(true))
    }, 500)
  }

  // Live markdown rendering + a length cap (paste included) so the pad stays a
  // quick-notes pad.
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }), // GFM: task lists, strikethrough, tables
      markdownLive(),
      EditorState.changeFilter.of((tr) => tr.newDoc.length <= SCRATCHPAD_MAX),
      EditorView.lineWrapping,
    ],
    [],
  )

  const sendAll = () => {
    const t = text.trim()
    if (t) requestPrompt(t)
  }
  const sendSelection = () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const sel = view.state.sliceDoc(from, to).trim()
    if (sel) requestPrompt(sel)
  }

  if (!cwd) {
    return (
      <div className="wb-empty">
        <Icon name="note-pencil" />
        <p>Start a session to use the scratchpad.</p>
      </div>
    )
  }

  const near = text.length > SCRATCHPAD_MAX * 0.9

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="wb-subhead">
        <Icon name="note-pencil" className="ico-13" />
        <span className="path" style={{ flex: 1 }}>
          Scratchpad
          <span style={{ color: saved ? 'var(--subtle)' : 'var(--accent)' }}> · {saved ? 'Saved' : 'Saving…'}</span>
        </span>
        <button
          className="btn btn-sm btn-quiet"
          style={attach ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
          title="Attach the scratchpad to every message in this workspace"
          onClick={() => setScratchpadAttach(cwd, !attach)}
        >
          <Icon name={attach ? 'check' : 'paperclip'} /> Auto-attach
        </button>
        {hasSel && (
          <button className="btn btn-sm btn-quiet" onClick={sendSelection}>
            <Icon name="text-aa" /> Send selection
          </button>
        )}
        <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={sendAll}>
          <Icon name="arrow-up" /> Send to agent
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <CodeMirror
          value={text}
          theme={theme}
          extensions={extensions}
          onChange={onChange}
          onCreateEditor={(view) => (viewRef.current = view)}
          onUpdate={(u) => setHasSel(!u.state.selection.main.empty)}
          placeholder="Jot notes here. Send them to the agent, or turn on Auto-attach."
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
          style={{ fontSize: 'var(--t-13)' }}
        />
      </div>
      <div className="wb-subhead" style={{ justifyContent: 'flex-end' }}>
        <span className="path" style={{ color: near ? 'var(--accent)' : 'var(--subtle)' }}>
          {text.length}/{SCRATCHPAD_MAX}
        </span>
      </div>
    </div>
  )
}
