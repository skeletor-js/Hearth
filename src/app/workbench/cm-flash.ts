import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'

// A transient line highlight for the editor change-reveal (P7): when the agent edits
// a file you have open, we live-reload it and flash the changed line range so you see
// *where* the change landed — the honest version of "watch the agent's hands", since
// the agent emits whole diffs, not keystrokes. See docs/PRESENCE.md.

const setFlash = StateEffect.define<{ from: number; to: number } | null>()
const flashLine = Decoration.line({ class: 'cm-flash' })

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue
      if (!e.value) return Decoration.none
      const marks = []
      for (let pos = e.value.from; pos <= e.value.to; ) {
        const line = tr.state.doc.lineAt(pos)
        marks.push(flashLine.range(line.from))
        if (line.to + 1 > e.value.to) break
        pos = line.to + 1
      }
      return Decoration.set(marks)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const flashExtension = flashField

/** Scroll to and flash a 1-based, inclusive line range, clearing after ~1.6s. */
export function flashRange(view: EditorView, startLine: number, endLine: number): void {
  const lines = view.state.doc.lines
  const from = view.state.doc.line(Math.min(Math.max(1, startLine), lines)).from
  const to = view.state.doc.line(Math.min(Math.max(1, endLine), lines)).to
  view.dispatch({ effects: [setFlash.of({ from, to }), EditorView.scrollIntoView(from, { y: 'center' })] })
  setTimeout(() => view.dispatch({ effects: setFlash.of(null) }), 1600)
}
