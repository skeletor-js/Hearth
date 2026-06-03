import { Icon } from '@/shell/Icon'
import { useSession } from '../session-store'

export function PlanTab() {
  const plan = useSession((s) => s.plan)

  if (plan.length === 0) {
    return (
      <div className="wb-empty">
        <Icon name="list-checks" />
        <h3>No plan yet</h3>
        <p>When the agent shares a task plan, its steps appear here.</p>
      </div>
    )
  }

  return (
    <div className="plan">
      {plan.map((p, i) => {
        const state = p.status === 'completed' ? 'done' : p.status === 'in_progress' ? 'now' : 'pending'
        return (
          <div key={i} className={'plan-item' + (state === 'done' ? ' is-done' : '')}>
            <span className={'plan-check ' + (state === 'done' ? 'done' : state === 'now' ? 'now' : '')}>
              {state === 'done' && <Icon name="check" className="ico-12" fill />}
            </span>
            <div className="plan-body">
              <div className="pt">{p.content}</div>
              <div className="ps">
                Step {i + 1} of {plan.length}
                {p.priority === 'high' ? ' · high priority' : ''}
              </div>
            </div>
            {state === 'now' && <span className="plan-now-tag">now</span>}
          </div>
        )
      })}
    </div>
  )
}
