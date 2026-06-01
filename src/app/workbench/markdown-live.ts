// Live markdown rendering for CodeMirror: renders the document as formatted text —
// headings sized, bold/italic/code/strike styled, bullets drawn as •, and GFM task
// items drawn as real (clickable) checkboxes. The markdown syntax markers (`#`,
// `**`, `` ` ``, `- `, `[ ]`) are always concealed so the pad reads as rendered, not
// as source. Driven by the Lezer markdown tree from `@codemirror/lang-markdown`
// (GFM must be enabled — see ScratchpadTab).

import { syntaxTree } from '@codemirror/language'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { Range } from '@codemirror/state'

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.from === this.from
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-md-task'
    box.setAttribute('aria-label', 'toggle task')
    box.addEventListener('mousedown', (e) => e.preventDefault()) // don't steal the editor selection
    box.addEventListener('click', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' } })
    })
    return box
  }
  ignoreEvent() {
    return false // let the checkbox receive its own click
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '•'
    return s
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() })
const conceal = Decoration.replace({})
const heading = (level: number) => Decoration.line({ class: `cm-md-h${level}` })
const quoteLine = Decoration.line({ class: 'cm-md-quote' })
const strong = Decoration.mark({ class: 'cm-md-strong' })
const emphasis = Decoration.mark({ class: 'cm-md-em' })
const inlineCode = Decoration.mark({ class: 'cm-md-code' })
const strike = Decoration.mark({ class: 'cm-md-strike' })

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const { state } = view
  const seenLine = new Set<number>()
  const lineOnce = (pos: number, deco: Decoration) => {
    const line = state.doc.lineAt(pos)
    if (seenLine.has(line.from)) return
    seenLine.add(line.from)
    ranges.push(deco.range(line.from))
  }
  // Conceal a marker plus a single trailing space, if present.
  const concealWithSpace = (from: number, to: number) => {
    const end = state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
    ranges.push(conceal.range(from, end))
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const h = /^ATXHeading(\d)$/.exec(name)
        if (h) {
          lineOnce(node.from, heading(+h[1]))
          return
        }
        switch (name) {
          case 'Blockquote':
            lineOnce(node.from, quoteLine)
            break
          case 'StrongEmphasis':
            ranges.push(strong.range(node.from, node.to))
            break
          case 'Emphasis':
            ranges.push(emphasis.range(node.from, node.to))
            break
          case 'InlineCode':
            ranges.push(inlineCode.range(node.from, node.to))
            break
          case 'Strikethrough':
            ranges.push(strike.range(node.from, node.to))
            break
          case 'EmphasisMark':
          case 'CodeMark':
          case 'StrikethroughMark':
            if (node.to > node.from) ranges.push(conceal.range(node.from, node.to))
            break
          case 'HeaderMark':
          case 'QuoteMark':
            concealWithSpace(node.from, node.to)
            break
          case 'TaskMarker': {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to))
            ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }).range(node.from, node.to))
            if (state.doc.sliceString(node.to, node.to + 1) === ' ') ranges.push(conceal.range(node.to, node.to + 1))
            break
          }
          case 'ListMark': {
            const mark = state.doc.sliceString(node.from, node.to)
            if (!/^[-*+]$/.test(mark)) break // leave ordered-list markers ("1.") alone
            // A task item ("- [ ] …") gets a checkbox, so hide its dash; a plain item gets a bullet.
            if (/^\s\[[ xX]\]/.test(state.doc.sliceString(node.to, node.to + 4))) concealWithSpace(node.from, node.to)
            else ranges.push(bullet.range(node.from, node.to))
            break
          }
        }
      },
    })
  }
  return Decoration.set(ranges, true)
}

/** A CodeMirror extension that renders markdown as formatted text (markers concealed). */
export function markdownLive() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
