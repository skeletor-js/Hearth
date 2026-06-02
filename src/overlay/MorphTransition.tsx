// The morph transition surface (B3 fills this in: old frame → animated → new
// frame). For B1 it renders nothing — the overlay window is transparent and
// invisible until a morph is driven. Kept as its own component so the transition
// is swappable without touching the window/entry plumbing.
export function MorphTransition() {
  return null
}
