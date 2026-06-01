import { createFileRoute, redirect } from '@tanstack/react-router'

// Default view is the chat app.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/chat' })
  },
})
