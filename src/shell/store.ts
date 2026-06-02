import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'
export type Layout = 'companion' | 'split' | 'focus'
export type Accent = '#C8542B' | '#C8902B' | '#5E7A5C' | '#A6603F'

// Accent palette (matches the handoff): Ember / Amber / Sage / Clay.
export const ACCENTS: Record<Accent, string> = {
  '#C8542B': 'Ember',
  '#C8902B': 'Amber',
  '#5E7A5C': 'Sage',
  '#A6603F': 'Clay',
}
export const ACCENT_OPTIONS = Object.keys(ACCENTS) as Accent[]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface ShellState {
  // appearance
  theme: Theme
  accent: Accent
  reduceMotion: boolean
  // layout
  layout: Layout
  railHidden: boolean
  railW: number
  wbW: number
  panelH: number
  // panels
  rightOpen: boolean
  bottomOpen: boolean
  rightTab: string
  bottomTab: string
  // scratchpad: auto-attach toggle, per-workspace (keyed by cwd) so it doesn't bleed between repos
  scratchpadAttach: Record<string, boolean>
  setScratchpadAttach: (cwd: string, on: boolean) => void
  // agent
  approval: 'auto' | 'commands' | 'always'
  setApproval: (v: 'auto' | 'commands' | 'always') => void
  // first-run
  onboarded: boolean
  setOnboarded: (v: boolean) => void
  // actions
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setAccent: (a: Accent) => void
  setReduceMotion: (v: boolean) => void
  setLayout: (l: Layout) => void
  toggleRailHidden: () => void
  resizeRail: (delta: number) => void
  resizeWb: (delta: number) => void
  resizePanel: (delta: number) => void
  setRightOpen: (v: boolean) => void
  setBottomOpen: (v: boolean) => void
  openRightTab: (tab: string) => void
  setBottomTab: (tab: string) => void
}

export const useShell = create<ShellState>()(
  persist(
    (set) => ({
      theme: 'light',
      accent: '#C8542B',
      reduceMotion: false,
      layout: 'companion',
      railHidden: false,
      railW: 244,
      wbW: 620,
      panelH: 260,
      rightOpen: true,
      bottomOpen: false,
      rightTab: 'review',
      bottomTab: 'terminal',
      scratchpadAttach: {},
      setScratchpadAttach: (cwd, on) => set((s) => ({ scratchpadAttach: { ...s.scratchpadAttach, [cwd]: on } })),
      approval: 'commands',
      setApproval: (approval) => set({ approval }),
      onboarded: false,
      setOnboarded: (onboarded) => set({ onboarded }),

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setAccent: (accent) => set({ accent }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setLayout: (layout) => set({ layout, rightOpen: layout !== 'focus' ? true : false }),
      toggleRailHidden: () => set((s) => ({ railHidden: !s.railHidden })),
      resizeRail: (d) => set((s) => ({ railW: clamp(s.railW + d, 190, 380) })),
      resizeWb: (d) => set((s) => ({ wbW: clamp(s.wbW - d, 360, Math.round(window.innerWidth * 0.7)) })),
      resizePanel: (d) => set((s) => ({ panelH: clamp(s.panelH - d, 130, Math.round(window.innerHeight * 0.7)) })),
      setRightOpen: (rightOpen) => set({ rightOpen }),
      setBottomOpen: (bottomOpen) => set({ bottomOpen }),
      openRightTab: (rightTab) => set({ rightTab, rightOpen: true }),
      setBottomTab: (bottomTab) => set({ bottomTab }),
    }),
    { name: 'hearth-ui' },
  ),
)

// Apply theme + accent to the document root (call from the shell root).
export function applyTheme(theme: Theme, accent: Accent, reduceMotion: boolean): void {
  const r = document.documentElement
  r.setAttribute('data-theme', theme)
  r.style.setProperty('--accent', accent)
  r.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 12%, transparent)`)
  r.style.setProperty('--accent-fg', '#FFFFFF')
  // Drives the CSS below in hearth.css that neutralizes ambient animation.
  r.setAttribute('data-reduce-motion', reduceMotion ? '1' : '0')
}
