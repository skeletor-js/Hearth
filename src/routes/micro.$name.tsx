import { createFileRoute } from '@tanstack/react-router'
import { MicroAppFrame } from '@/shell/MicroAppFrame'

// /micro/<name> embeds a standalone micro-app (its own Vite server) in a
// sandboxed iframe. The name is the folder under micro-apps/.
export const Route = createFileRoute('/micro/$name')({
  component: MicroAppRoute,
})

function MicroAppRoute() {
  const { name } = Route.useParams()
  return <MicroAppFrame name={name} />
}
