import type { MouseEvent } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import mdLang from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import yaml from 'highlight.js/lib/languages/yaml'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'

// Register a focused language set (canonical names auto-register their aliases,
// e.g. javascript -> js, typescript -> ts, xml -> html).
const LANGS: Record<string, typeof javascript> = {
  javascript, typescript, json, css, xml, bash, python, markdown: mdLang, diff, yaml, rust, go,
}
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Fenced/indented code -> a framed block with a language label + Copy button and
// syntax-highlighted body. The Copy button is handled via event delegation
// (handleCodeCopyClick) since this HTML is injected, not React-rendered.
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : ''
  let body: string
  try {
    body = language ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value
  } catch {
    body = escapeHtml(text)
  }
  const label = escapeHtml((lang || '').split(/\s+/)[0])
  return (
    `<div class="code-block"><div class="code-head">` +
    `<span class="code-lang">${label}</span>` +
    `<button class="code-copy" type="button" aria-label="Copy code">Copy</button>` +
    `</div><pre><code class="hljs">${body}</code></pre></div>`
  )
}

marked.setOptions({ gfm: true, breaks: true })
marked.use({ renderer })

export function renderMd(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}

/** Delegated handler for code-block Copy buttons. Returns true if it handled a click. */
export function handleCodeCopyClick(e: MouseEvent): boolean {
  const btn = (e.target as HTMLElement)?.closest?.('.code-copy') as HTMLElement | null
  if (!btn) return false
  const code = btn.closest('.code-block')?.querySelector('pre code')?.textContent ?? ''
  try {
    void navigator.clipboard?.writeText(code)
  } catch {
    /* clipboard unavailable in this context */
  }
  const prev = btn.textContent
  btn.textContent = 'Copied'
  window.setTimeout(() => {
    btn.textContent = prev || 'Copy'
  }, 1200)
  return true
}
