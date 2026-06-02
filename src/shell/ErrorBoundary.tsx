// Renderer error boundary (W3, first line). Catches React render crashes AND
// forwarded build errors / post-edit typecheck failures, and shows the CrashSurface
// with Reload / Repair / Undo. The authoritative recovery net is main-anchored
// (index.ts watches render-process-gone) so it survives even if this boundary is
// itself broken by a self-edit. See docs/completed-plans/SELF-MOD-HARDENING-PLAN.md (W3).

import { Component, type ReactNode } from 'react'
import { CrashSurface } from './CrashSurface'
import { HEARTH_BUILD_ERROR, HEARTH_BUILD_ERROR_CLEARED, type BuildErrorDetail } from '@/lib/vite-error-recovery'

interface State {
  message: string | null
  file: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null, file: null }

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message || String(error), file: null }
  }

  componentDidMount(): void {
    window.addEventListener(HEARTH_BUILD_ERROR, this.onBuildError as EventListener)
    window.addEventListener(HEARTH_BUILD_ERROR_CLEARED, this.onCleared)
    // A post-edit typecheck failure (W5/W6) surfaces here too.
    this.offValidation = window.hearth?.selfMod?.onValidation?.((r) => {
      if (!r.ok) this.setState({ message: `Type error in a self-edit:\n${r.output}`, file: null })
    })
  }

  componentWillUnmount(): void {
    window.removeEventListener(HEARTH_BUILD_ERROR, this.onBuildError as EventListener)
    window.removeEventListener(HEARTH_BUILD_ERROR_CLEARED, this.onCleared)
    this.offValidation?.()
  }

  private offValidation?: () => void

  private onBuildError = (e: CustomEvent<BuildErrorDetail>): void => {
    this.setState({ message: e.detail.message, file: e.detail.file })
  }

  private onCleared = (): void => {
    // Build error cleared (a fix landed) — drop the surface so HMR shows the result.
    if (this.state.message) this.setState({ message: null, file: null })
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return <CrashSurface message={this.state.message} file={this.state.file} />
    }
    return this.props.children
  }
}
