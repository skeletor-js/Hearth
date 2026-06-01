import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import type { Extension } from '@codemirror/state'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Icon } from '@/shell/Icon'
import { useShell } from '@/shell/store'
import { useSession } from '../session-store'
import type { FileContent, FileEntry } from '../../../electron/main/fs/files'

function langFor(rel: string): Extension[] {
  const ext = rel.split('.').pop()?.toLowerCase()
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs')
    return [javascript({ typescript: ext.includes('ts'), jsx: ext.endsWith('x') })]
  if (ext === 'json') return [json()]
  if (ext === 'css') return [css()]
  if (ext === 'html' || ext === 'htm') return [html()]
  if (ext === 'md' || ext === 'markdown') return [markdown()]
  return []
}

interface OpenFile extends FileContent {
  draft: string
}

export function FilesTab() {
  const cwd = useSession((s) => s.active?.cwd)
  const theme = useShell((s) => s.theme)
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadDir = async (rel: string) => {
    const entries = await window.hearth.files.list(cwd, rel || undefined)
    setTree((t) => ({ ...t, [rel]: entries }))
  }

  useEffect(() => {
    setTree({})
    setExpanded(new Set())
    setOpen(null)
    void loadDir('')
  }, [cwd])

  const toggleDir = (rel: string) => {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(rel)) next.delete(rel)
      else {
        next.add(rel)
        if (!tree[rel]) void loadDir(rel)
      }
      return next
    })
  }

  const openFile = async (rel: string) => {
    const fc = await window.hearth.files.read(cwd, rel)
    setOpen({ ...fc, draft: fc.content })
    setPreview(false)
  }

  const dirty = open ? open.draft !== open.content : false
  const isMd = open ? /\.(md|markdown)$/i.test(open.rel) : false
  const previewHtml = useMemo(
    () => (open && preview ? DOMPurify.sanitize(marked.parse(open.draft, { async: false }) as string) : ''),
    [open, preview],
  )

  const save = async () => {
    if (!open || !dirty || saving) return
    setSaving(true)
    try {
      await window.hearth.files.write(cwd, open.rel, open.draft)
      setOpen((o) => (o ? { ...o, content: o.draft } : o))
    } finally {
      setSaving(false)
    }
  }

  if (open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="wb-subhead">
          <button className="btn-icon" title="Back to files" onClick={() => setOpen(null)}>
            <Icon name="arrow-left" />
          </button>
          <span className="path" style={{ flex: 1 }}>
            {open.rel}
            {dirty && <span style={{ color: 'var(--accent)' }}> ●</span>}
          </span>
          {isMd && (
            <button className="btn btn-sm btn-quiet" onClick={() => setPreview((p) => !p)}>
              <Icon name={preview ? 'pencil-simple' : 'eye'} /> {preview ? 'Edit' : 'Preview'}
            </button>
          )}
          <button className="btn btn-sm btn-primary" disabled={!dirty || open.readonly || saving} onClick={save}>
            <Icon name="floppy-disk" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {preview ? (
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <CodeMirror
              value={open.draft}
              theme={theme}
              extensions={langFor(open.rel)}
              editable={!open.readonly}
              onChange={(v) => setOpen((o) => (o ? { ...o, draft: v } : o))}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              style={{ fontSize: 'var(--t-13)' }}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="wb-subhead">
        <Icon name="folder-open" className="ico-13" />
        <span className="path">{cwd ?? '~'}</span>
      </div>
      <div className="ftree">
        <FileTree rel="" tree={tree} expanded={expanded} depth={0} onToggle={toggleDir} onOpen={openFile} />
      </div>
    </>
  )
}

function FileTree({
  rel,
  tree,
  expanded,
  depth,
  onToggle,
  onOpen,
}: {
  rel: string
  tree: Record<string, FileEntry[]>
  expanded: Set<string>
  depth: number
  onToggle: (rel: string) => void
  onOpen: (rel: string) => void
}) {
  const entries = tree[rel]
  if (!entries) return null
  return (
    <>
      {entries.map((e) => (
        <div key={e.rel}>
          <div
            className="ftree-row"
            style={{ paddingLeft: 8 + depth * 14, cursor: 'pointer' }}
            onClick={() => (e.dir ? onToggle(e.rel) : onOpen(e.rel))}
          >
            <Icon name={e.dir ? (expanded.has(e.rel) ? 'caret-down' : 'caret-right') : 'file'} />
            <span>{e.name}</span>
          </div>
          {e.dir && expanded.has(e.rel) && (
            <FileTree rel={e.rel} tree={tree} expanded={expanded} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} />
          )}
        </div>
      ))}
    </>
  )
}
