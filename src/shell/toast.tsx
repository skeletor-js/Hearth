import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './Icon'

interface ToastState {
  message: string | null
  seq: number
  show: (m: string) => void
  clear: () => void
}

const useToast = create<ToastState>((set) => ({
  message: null,
  seq: 0,
  show: (message) => set((s) => ({ message, seq: s.seq + 1 })),
  clear: () => set({ message: null }),
}))

/** Fire a toast from anywhere (including non-React code). */
export function toast(message: string): void {
  useToast.getState().show(message)
}

export function Toaster() {
  const { message, seq, clear } = useToast()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2600)
    const t2 = setTimeout(clear, 2900)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
    }
  }, [message, seq, clear])

  if (!message || !visible) return null
  return (
    <div className="toast">
      <Icon name="flame" fill className="ico-13" />
      {message}
    </div>
  )
}
