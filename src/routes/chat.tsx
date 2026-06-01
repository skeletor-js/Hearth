import { createFileRoute } from '@tanstack/react-router'
import { ChatView } from '@/app/chat/ChatView'

// A sidebar app = a route file + a folder under src/app. The agent adds new
// sidebar apps by dropping these two; the router plugin regenerates the tree
// and HMR folds it in. This is the "modular frontend" seam.
export const Route = createFileRoute('/chat')({
  component: ChatView,
})
