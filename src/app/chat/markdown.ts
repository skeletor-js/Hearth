import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Shared markdown rendering for the chat surface (assistant messages + the
// expandable reasoning in the trace). Output is sanitized before it reaches any
// dangerouslySetInnerHTML.
marked.setOptions({ gfm: true, breaks: true })

export function renderMd(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}
