// App entry. Wires services and opens the window. Thin by design — all feature
// logic lives in the renderer (which is self-editable) or in the named services.

import { app, dialog, safeStorage, session, BrowserWindow } from 'electron'
import { createMainWindow, createSnapshotWindow } from './window.js'
import { prepareRenderer } from './dev-server.js'
import { registerIpc } from './ipc.js'
import { setupAutoUpdater } from './updater.js'
import { ClaudeAgent } from './agents/claude.js'
import { CodexAgent } from './agents/codex.js'
import { FakeAgent } from './agents/fake.js'
import { AgentHost, type AgentFactory } from './agents/agent-host.js'
import type { Agent, AgentKind } from './agents/agent.js'
import { resolveAuth } from './agents/auth-config.js'
import { SecretStore, safeStorageBackend } from './secrets/secret-store.js'
import { McpRegistry } from './mcp/registry.js'
import { toAcpServers } from './mcp/to-acp.js'
import { SelfModService } from './self-mod/self-mod-service.js'
import { HmrController } from './self-mod/hmr.js'
import { BootWatchdog } from './self-mod/boot-watchdog.js'
import { runTypecheck } from './self-mod/validate.js'
import { revertCommit } from './self-mod/git.js'
import { WorkspaceRegistry } from './workspaces/registry.js'
import { SessionStore } from './sessions/store.js'
import { RoutineStore } from './routines/store.js'
import { RoutineScheduler } from './routines/scheduler.js'
import { BrowserManager } from './browser/browser-view.js'
import { HEARTH_CHANNELS } from '../shared/channels.js'
import { join } from 'node:path'
import { stopAllMicroApps } from './micro-apps/server.js'
import { OverlayWindow } from './windows/overlay-window.js'
import { runMorph } from './self-mod/hmr-morph.js'
import { armRestartCover, consumeRestartCover } from './self-mod/restart-cover.js'
import { captureFrame } from './windows/morph-capture.js'
import { CapabilityStore } from './micro-apps/capabilities.js'
import { CredentialBroker } from './micro-apps/broker.js'
import { installSessionPolicy } from './micro-apps/session-policy.js'
import { startAgentBridge } from './agent-bridge.js'
import { initLogger, log } from './log.js'
import { ensureWorkspaceFromManifest, NeedsNetworkError, ShellTooOldError } from './packaging/payload.js'
import { createBootstrapSplash, type BootstrapSplash } from './packaging/bootstrap-splash.js'

// The repo is the agent's working directory — editing it IS self-modification.
// In dev that's the project root; in a packaged self-evolving build it's the
// app's writable copy of its own source (v2), seeded under userData on first
// launch. Resolved by resolveRepoRoot() at boot.
async function resolveRepoRoot(): Promise<string> {
  if (process.env.HEARTH_REPO_ROOT) return process.env.HEARTH_REPO_ROOT
  if (!app.isPackaged) return process.cwd()
  // Packaged: the renderer source + its node_modules are NOT shipped in the signed
  // bundle. They're downloaded as a workspace payload from R2 (sha256-verified),
  // extracted under userData, and run (Vite root + git) from a writable workspace.
  // A splash shows progress only when a download actually happens. See
  // packaging/payload.ts and docs/PACKAGING-V3-PLAN.md.
  const ui: { splash: BootstrapSplash | null } = { splash: null }
  try {
    return await ensureWorkspaceFromManifest({
      workspaceDir: join(app.getPath('userData'), 'workspace'),
      payloadsDir: join(app.getPath('userData'), 'payloads'),
      shellVersion: app.getVersion(),
      onProgress: (p) => {
        if (!ui.splash) ui.splash = createBootstrapSplash()
        ui.splash.update(p)
      },
    })
  } catch (err) {
    if (err instanceof NeedsNetworkError || err instanceof ShellTooOldError) {
      dialog.showErrorBox('Hearth setup', err.message)
      app.quit()
    }
    throw err
  } finally {
    ui.splash?.close()
  }
}

// Which backend to drive: HEARTH_AGENT=codex selects Codex, otherwise Claude.
function resolveBackend(): AgentKind {
  return process.env.HEARTH_AGENT?.toLowerCase() === 'codex' ? 'codex' : 'claude'
}

// Build the agent factory. Auth resolves per kind (stored BYO key → env key →
// subscription; see auth-config). The user's configured MCP servers are supplied
// to each backend, resolved (secrets injected) lazily at session creation so
// tokens never sit in a config file. HEARTH_FAKE_AGENT=1 forces the scripted
// agent (UI/permission dev without a live model).
function makeAgentFactory(secrets: SecretStore, mcp: McpRegistry, repoRoot: string): AgentFactory {
  const userMcpServers = async () => toAcpServers(mcp.list(), secrets).servers
  return (kind: AgentKind): Agent => {
    if (process.env.HEARTH_FAKE_AGENT) return new FakeAgent()
    const auth = resolveAuth(kind, secrets)
    return kind === 'codex'
      ? new CodexAgent({ kind: 'codex', cwd: repoRoot, auth }, userMcpServers)
      : new ClaudeAgent({ kind: 'claude', cwd: repoRoot, auth }, userMcpServers)
  }
}

async function bootstrap(): Promise<void> {
  // Field observability (U14): a rotating file log + last-resort handlers, so a
  // crash while nobody watched leaves something readable (Settings → Reveal log).
  initLogger(join(app.getPath('userData'), 'Logs'))
  process.on('uncaughtException', (err) => log.error('[hearth] uncaughtException:', err))
  process.on('unhandledRejection', (reason) => log.error('[hearth] unhandledRejection:', reason))

  // Resolve the writable repo root first — in a packaged build this seeds the
  // userData workspace, which everything below (watchdog revert, self-mod, Vite
  // root) operates on.
  const REPO_ROOT = await resolveRepoRoot()

  // Boot watchdog (W6): if the previous self-mod restart never reached ready, it
  // bricked boot — auto-revert that commit and relaunch before anything else runs.
  const watchdog = new BootWatchdog(join(app.getPath('userData'), 'pending-self-mod-restart.json'))
  const decision = watchdog.inspectBoot()
  if (decision.action === 'revert') {
    try {
      await revertCommit(REPO_ROOT, decision.commit)
    } catch (err) {
      // Surface the failure (don't swallow it) but still fall through: the attempt
      // was recorded, so a repeat hits the cap and drops to safe-mode rather than
      // looping forever.
      log.error(`[hearth] boot auto-revert failed for commit ${decision.commit}:`, err)
    }
    if (app.isPackaged) {
      app.relaunch()
      app.exit(0)
      return
    }
  } else if (decision.action === 'safe-mode') {
    log.error(`[hearth] self-mod restart bricked boot repeatedly (commit ${decision.commit}); booting current state without further auto-revert`)
  }

  // Resolve how the renderer loads: dev server URL, or (packaged) our own Vite
  // server rooted at the workspace, falling back to the static bundle. Done after
  // the watchdog's relaunch branch so we never start a server we're about to kill.
  const renderer = await prepareRenderer(REPO_ROOT)
  app.once('before-quit', () => void renderer.close())

  const window = createMainWindow(renderer.target)

  // Pre-warm the transparent morph-overlay window (B1 of the seamless-self-mod
  // plan) so it's ready to cover a structural-self-mod reload with no black flash.
  // It stays invisible + click-through until the morph controller drives it.
  const overlay = new OverlayWindow(renderer.target)
  overlay.webContents().once('did-finish-load', () => log.info('[hearth] morph overlay ready'))
  app.once('before-quit', () => overlay.destroy())

  // B7: if a packaged relaunch armed a restart cover (a main/preload self-mod), show
  // that last frame over this boot so the process restart doesn't flash black, then
  // morph to the new UI once it paints. Inert in dev (nothing arms it). Guarded: a
  // stale frame is ignored, and the cover auto-hides so it can never mask a broken boot.
  try {
    const cover = consumeRestartCover(app.getPath('userData'), overlay.originOffset(), Date.now())
    if (cover) {
      void (async () => {
        await overlay.whenReady(1500)
        overlay.show()
        overlay.sendCover(cover.frame, cover.rect)
        const safetyHide = setTimeout(() => overlay.hide(), 8000)
        window.webContents.once('did-finish-load', () => {
          setTimeout(async () => {
            try {
              overlay.sendHandoff(await captureFrame(window))
              await overlay.awaitSignal('done', 2000)
            } catch {
              // ignore — fall through to hide
            }
            clearTimeout(safetyHide)
            overlay.hide()
          }, 600)
        })
      })()
    }
  } catch {
    // best-effort — a failed restart cover just means a normal boot
  }

  // Encrypted secret store (BYO API keys + MCP env) and the user's MCP server
  // registry. Both live under userData. Created before the host because the agent
  // factory reads them to resolve auth + MCP servers.
  const dataDir = app.getPath('userData')
  const secrets = new SecretStore(join(dataDir, 'secrets.json'), safeStorageBackend(safeStorage))
  const mcp = new McpRegistry(join(dataDir, 'mcp-servers.json'))

  // Micro-app egress hardening: the approved-host store (W6) and the credential
  // broker (W7), plus the session policy (W2 permission deny + W3/W6 CSP headers).
  // The CSP a micro-app gets is enforced here by Hearth's session, not by the
  // app's own (untrusted) Vite config.
  const capabilities = new CapabilityStore(join(dataDir, 'capabilities.json'))
  const broker = new CredentialBroker({ capabilities, secrets })
  broker.start().catch((err) => log.error('[hearth] credential broker failed to start:', err))
  app.once('before-quit', () => void broker.close())
  installSessionPolicy(session.defaultSession, {
    shellOrigins: [renderer.target.url ?? 'file://'],
    capabilities,
    brokerOrigin: () => broker.origin(),
  })

  // The host owns the current backend and swaps it at runtime; IPC talks to it,
  // not to a fixed agent. Starts on the env-selected backend (default Claude).
  const host = new AgentHost(makeAgentFactory(secrets, mcp, REPO_ROOT), resolveBackend())
  log.info(`[hearth] backend: ${host.kind}`)

  const hmr = new HmrController(
    {
      reloadWindow: () => window.webContents.reload(),
      restartApp: () => {
        // In dev, electron-vite owns the process lifecycle and restarts the app
        // when a main-process file is *written* — self-relaunching here would kill
        // the dev session (and its Vite server), leaving a blank window. Only
        // relaunch in a packaged build; in dev a window reload is the safe fallback.
        if (app.isPackaged) {
          // Arm the restart cover (screenshot the UI) before relaunching, so the
          // next boot can morph across the process restart instead of flashing black.
          void armRestartCover(window, dataDir, Date.now()).finally(() => {
            app.relaunch()
            app.exit(0)
          })
        } else {
          window.webContents.reload()
        }
      },
      // Full-reload-tier self-mods reload behind the morph cover — no black flash.
      // runMorph captures the UI, covers, reloads, then crossfades to the new UI.
      coveredReload: () => runMorph({ overlay, mainWindow: window }, () => window.webContents.reload()),
    },
    // Vite serves the renderer whenever we loaded a URL (dev + packaged self-
    // evolving); only the static-bundle fallback loads a file. When Vite serves,
    // it reloads full-reload-tier edits itself — don't double-reload.
    Boolean(renderer.target.url),
  )
  const selfMod = new SelfModService(
    REPO_ROOT,
    hmr,
    // W6 blocking gate: typecheck before a restart-tier edit takes the app down.
    () => runTypecheck(REPO_ROOT),
    // W6: arm the watchdog with the commit about to trigger a restart.
    (commit) => watchdog.arm(commit, new Date().toISOString()),
  )

  // A successful renderer load means boot reached a healthy state — clear the
  // watchdog marker. A bricked main edit never loads, so the marker survives and
  // the next boot auto-reverts it. NOTE: this fires on first renderer paint, so the
  // watchdog covers crash-on-startup only — a main edit that paints then throws
  // later (a deferred timer/IPC handler) has already cleared the marker.
  window.webContents.on('did-finish-load', () => watchdog.confirmReady())

  // Main-anchored recovery net (W3): if the renderer process dies outright (its own
  // ErrorBoundary couldn't catch it), main brings it back. Bounded so a reload loop
  // doesn't spin — after a couple of crashes, leave it for the user to act.
  let rendererCrashes = 0
  window.webContents.on('render-process-gone', (_e, details) => {
    rendererCrashes++
    log.error(`[hearth] renderer gone (${details.reason}); recovery attempt ${rendererCrashes}`)
    if (rendererCrashes <= 2 && !window.isDestroyed()) window.webContents.reload()
  })
  window.webContents.on('did-finish-load', () => {
    rendererCrashes = 0
  })

  // Workspaces + sessions persist under userData so they survive restarts and
  // never pollute the repo. Hearth itself is the built-in workspace at REPO_ROOT.
  const workspaces = new WorkspaceRegistry(join(dataDir, 'workspaces.json'), REPO_ROOT)
  const sessions = new SessionStore(join(dataDir, 'sessions'))
  // Flush any debounced index bumps (U18) so a quit mid-stream can't leave a
  // stale updatedAt/title behind the already-durable transcript appends.
  app.once('before-quit', () => void sessions.flushPending())

  // Routines: scheduled agent tasks. Main only schedules + emits 'due'; the
  // renderer runs the prompt (the agent is never driven from here). The timer is
  // additive and wrapped so a routine can never affect boot or an interactive turn.
  const routines = new RoutineStore(join(dataDir, 'routines'))
  const scheduler = new RoutineScheduler(routines, (r) =>
    window.webContents.send(HEARTH_CHANNELS.routineDue, r),
  )
  scheduler.start()

  // Embedded persistent browser; the agent drives the same view (browser_* tools).
  // The third arg routes the agent's spatial actions to the overlay as a ghost cursor
  // (P6): map global coords into the desktop-spanning overlay, show it click-through,
  // and auto-hide after a few idle seconds.
  let cursorIdle: ReturnType<typeof setTimeout> | null = null
  const browser = new BrowserManager(
    window,
    (state) => window.webContents.send(HEARTH_CHANNELS.browserState, state),
    (action) => {
      const o = overlay.originOffset()
      overlay.showPassive()
      overlay.sendCursor({ kind: action.kind, x: action.x - o.x, y: action.y - o.y })
      if (cursorIdle) clearTimeout(cursorIdle)
      cursorIdle = setTimeout(() => overlay.hidePassive(), 4000)
    },
  )

  // Loopback bridge: lets the agent see (snapshot) AND drive (eval) the live app.
  // Route captures use a hidden window so the user's view is never disturbed.
  startAgentBridge(
    { mainWindow: window, createSnapshotWindow: () => createSnapshotWindow(renderer.target), browser },
    REPO_ROOT,
  )

  // Auto-update: checks a Cloudflare feed, downloads in the background, and lets
  // the user restart into the staged build. Inert (no-op) in dev. See updater.ts.
  const updater = setupAutoUpdater(window)
  app.once('before-quit', () => updater.dispose())

  registerIpc({ repoRoot: REPO_ROOT, host, selfMod, workspaces, sessions, browser, window, secrets, mcp, capabilities, broker, routines, scheduler, updater })

  // Connect the current backend in the background; the UI renders immediately.
  // A failed connect must surface, not crash boot. No session owns a boot-time
  // connect, so the error is global (sessionKey: null).
  host.connect().catch((err) => {
    window.webContents.send(HEARTH_CHANNELS.agentError, {
      sessionKey: null,
      message: String(err instanceof Error ? err.message : err),
    })
  })
}

app.whenReady().then(bootstrap)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void bootstrap()
})

app.on('window-all-closed', () => {
  stopAllMicroApps()
  if (process.platform !== 'darwin') app.quit()
})
