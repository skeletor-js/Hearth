import { createFileRoute } from '@tanstack/react-router'
import { HistoryApp } from '@/app/history/HistoryApp'

export const Route = createFileRoute('/history')({
  component: HistoryApp,
})
