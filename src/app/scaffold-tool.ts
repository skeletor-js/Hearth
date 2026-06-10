// Scaffold a micro-app with the shared failure toast (U21) — the "Already
// exists" wording lived copy-pasted in ChatView and the Tools gallery.
import { toast } from '@/shell/toast'

/** True when the scaffold succeeded; failures toast and return false. */
export async function scaffoldTool(slug: string, starter?: string): Promise<boolean> {
  try {
    await window.hearth.microApps.create(slug, starter)
    return true
  } catch (e) {
    const msg = String(e)
    toast(msg.includes('Already exists') ? `A tool named “${slug}” already exists` : `Couldn’t create tool: ${msg}`)
    return false
  }
}
