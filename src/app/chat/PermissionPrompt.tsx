import type { PermissionRequest } from '../../../electron/shared/protocol'

const KIND_STYLES: Record<string, string> = {
  allow: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
  'allow-always': 'bg-emerald-500/10 text-emerald-300/90 hover:bg-emerald-500/20',
  reject: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
}

// Renders a mid-turn permission ask. The agent is blocked until one option is
// chosen, so this is modal-feeling but inline. Answering calls back with the
// option id.
export function PermissionPrompt({
  request,
  onAnswer,
}: {
  request: PermissionRequest
  onAnswer: (optionId: string) => void
}) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 text-sm text-white/80">{request.title}</div>
      <div className="flex flex-wrap gap-2">
        {request.options.map((o) => (
          <button
            key={o.id}
            onClick={() => onAnswer(o.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${KIND_STYLES[o.kind] ?? 'bg-white/10 hover:bg-white/15'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
