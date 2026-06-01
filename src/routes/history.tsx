import { createFileRoute } from '@tanstack/react-router'
import { History } from '@/app/history/History'

export const Route = createFileRoute('/history')({
  component: History,
})
