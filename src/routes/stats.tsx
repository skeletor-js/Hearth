import { createFileRoute } from '@tanstack/react-router'
import { StatsPage } from '@/app/stats/StatsPage'

export const Route = createFileRoute('/stats')({
  component: StatsPage,
})
