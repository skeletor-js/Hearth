// URL normalization for the embedded browser. Kept electron-free so it unit-tests
// without an Electron runtime. The scheme allowlist is a security boundary: the
// embedded view shares the user's logged-in session and is scriptable by the
// agent, so it must never load file:/chrome:/devtools: URLs.

export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (s.startsWith('about:')) return s
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme) {
    // Only real web schemes load. file:, chrome:, devtools:, etc. would expose
    // local files / privileged pages, so refuse them rather than navigate.
    const proto = scheme[1].toLowerCase()
    return proto === 'http' || proto === 'https' ? s : 'about:blank'
  }
  // A bare domain/path → https; anything with spaces → a search.
  if (/\s/.test(s) || !/\.[a-z]{2,}/i.test(s)) return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
  return `https://${s}`
}
