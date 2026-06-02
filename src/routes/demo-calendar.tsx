import { createFileRoute } from '@tanstack/react-router'
import { DemoCalendar } from '@/app/demo-calendar/DemoCalendar'

export const Route = createFileRoute('/demo-calendar')({
  component: DemoCalendar,
})
