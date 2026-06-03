// Shared validation for micro-app names. A name becomes a path segment under
// micro-apps/<name> and a capability-store key, so every entry point that takes a
// renderer-supplied name must validate it — not just scaffold (create). Without
// this, names like "../../x" escape the micro-apps dir (arbitrary dir spawn /
// file read) or poison the capability store.

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Throw on a name that isn't a safe micro-app identifier. Returns the trimmed name. */
export function assertAppName(rawName: string): string {
  const name = (rawName ?? '').trim()
  if (!NAME_RE.test(name)) {
    throw new Error('Invalid app name. Use lowercase letters, numbers, "-" and "_".')
  }
  return name
}
