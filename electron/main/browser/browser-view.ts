// A real, persistent embedded browser backed by a WebContentsView. It floats as a
// native layer above the renderer, so the renderer reports the content-area rect
// and main keeps the view's bounds in sync. The `persist:hearth-browser` session
// partition makes cookies/logins survive restarts. The same webContents is what
// the agent drives via the browser_* MCP tools (see agent-bridge), so the agent
// acts inside the user's authenticated sessions.

import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { normalizeUrl } from './url.js'

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A spatial action the agent took in the browser, in GLOBAL screen coords (DIP),
 * so the caller can map it into the desktop-spanning overlay for the cursor (P6). */
export interface BrowserAction {
  kind: 'click' | 'fill' | 'nav'
  x: number
  y: number
}

// JS run in the page: act on the element AND report its on-screen centre (CSS px,
// viewport coords) so main can place the presence cursor where the action landed.
const clickJS = (sel: string) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { ok:false, error:'no element for selector' };` +
  ` el.scrollIntoView({ block:'center', inline:'center' }); const r = el.getBoundingClientRect();` +
  ` const x = r.left + r.width/2, y = r.top + r.height/2; el.click(); return { ok:true, x, y }; })()`
const fillJS = (sel: string, value: string) =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { ok:false, error:'no element' };` +
  ` el.scrollIntoView({ block:'center', inline:'center' }); el.focus(); el.value = ${JSON.stringify(value)};` +
  ` el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));` +
  ` const r = el.getBoundingClientRect(); return { ok:true, x: r.left + r.width/2, y: r.top + r.height/2 }; })()`

export class BrowserManager {
  private view: WebContentsView | null = null
  private visible = false
  /** Last bounds the renderer reported, so a page-viewport point can be mapped to
   * screen coords for the presence cursor. */
  private bounds: Rect | null = null
  /** Last URL per workspace id, so reopening a workspace's browser resumes it. */
  private lastUrl = new Map<string, string>()

  constructor(
    private readonly window: BrowserWindow,
    private readonly onState: (state: BrowserState) => void,
    /** Notified when the agent acts spatially in the browser (P6); coords are global. */
    private readonly onAction?: (action: BrowserAction) => void,
  ) {}

  // Map a page-viewport point (CSS px) to global screen coords (DIP) via the view
  // bounds (window-content-relative) + the window's content origin.
  private emitAction(kind: BrowserAction['kind'], vx: number, vy: number): void {
    if (!this.onAction || !this.bounds) return
    const cb = this.window.getContentBounds()
    this.onAction({ kind, x: cb.x + this.bounds.x + vx, y: cb.y + this.bounds.y + vy })
  }

  /** Click a selector and report where it landed for the cursor. */
  async click(selector: string): Promise<{ ok: boolean; error?: string }> {
    const r = (await this.contents().executeJavaScript(clickJS(selector), true)) as {
      ok: boolean
      error?: string
      x?: number
      y?: number
    }
    if (r.ok && r.x != null && r.y != null) this.emitAction('click', r.x, r.y)
    return { ok: r.ok, error: r.error }
  }

  /** Fill an input by selector and report where it landed for the cursor. */
  async fill(selector: string, value: string): Promise<{ ok: boolean; error?: string }> {
    const r = (await this.contents().executeJavaScript(fillJS(selector, value), true)) as {
      ok: boolean
      error?: string
      x?: number
      y?: number
    }
    if (r.ok && r.x != null && r.y != null) this.emitAction('fill', r.x, r.y)
    return { ok: r.ok, error: r.error }
  }

  private emit(): void {
    const wc = this.view?.webContents
    if (!wc) return
    this.onState({
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
  }

  private ensure(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:hearth-browser', // cookies/logins persist across restarts
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const wc = view.webContents
    const emit = () => this.emit()
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    // Open target=_blank / window.open in the same view rather than spawning windows.
    // Run it through normalizeUrl so a page can't pop a file:/chrome: URL.
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(normalizeUrl(url))
      return { action: 'deny' }
    })
    this.window.contentView.addChildView(view)
    this.view = view
    return view
  }

  /** The browser webContents, for agent control. Creates the view if needed. */
  contents(): WebContents {
    return this.ensure().webContents
  }

  setBounds(rect: Rect): void {
    const view = this.ensure()
    this.visible = true
    view.setVisible(true)
    const b = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
    this.bounds = b
    view.setBounds(b)
  }

  hide(): void {
    if (!this.view || !this.visible) return
    this.visible = false
    this.view.setVisible(false)
  }

  navigate(url: string, workspaceId?: string): void {
    const target = normalizeUrl(url)
    if (workspaceId) this.lastUrl.set(workspaceId, target)
    void this.contents().loadURL(target)
  }

  /** Show the nav cursor indicator — called only from the agent path (the bridge),
   * so a user typing in the URL bar doesn't trigger the agent's cursor (P6). */
  signalNav(): void {
    if (this.bounds) this.emitAction('nav', this.bounds.width / 2, 22)
  }

  /** Open the remembered URL for a workspace, or `fallback` if none. */
  open(workspaceId: string | undefined, fallback: string): void {
    const remembered = workspaceId ? this.lastUrl.get(workspaceId) : undefined
    const wc = this.contents()
    const current = wc.getURL()
    const want = remembered ?? fallback
    if (!current || current === 'about:blank') this.navigate(want, workspaceId)
    this.emit()
  }

  back(): void {
    const wc = this.contents()
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }
  forward(): void {
    const wc = this.contents()
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }
  reload(): void {
    this.contents().reload()
  }

  dispose(): void {
    if (!this.view) return
    this.window.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = null
  }
}
