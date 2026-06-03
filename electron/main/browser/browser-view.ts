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

export class BrowserManager {
  private view: WebContentsView | null = null
  private visible = false
  /** Last URL per workspace id, so reopening a workspace's browser resumes it. */
  private lastUrl = new Map<string, string>()

  constructor(
    private readonly window: BrowserWindow,
    private readonly onState: (state: BrowserState) => void,
  ) {}

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
    view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
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
