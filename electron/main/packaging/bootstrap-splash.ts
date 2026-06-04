// Minimal first-run/upgrade splash for the packaged build. The real UI lives in
// the downloaded workspace payload, so before that exists we show a tiny static
// window with download/extract progress. Created lazily (only when a download is
// actually happening) so a normal reuse-launch never flashes it.

import { BrowserWindow } from 'electron'
import type { Progress } from './payload.js'

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { color-scheme: light dark; }
  html,body { margin:0; height:100%; font:13px -apple-system,system-ui,sans-serif;
    background:#1a1714; color:#e7e2da; -webkit-user-select:none; cursor:default; }
  .wrap { height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
  .flame { font-size:30px }
  .title { font-size:14px; font-weight:600 }
  .sub { font-size:12px; opacity:.6 }
  .bar { width:240px; height:5px; border-radius:3px; background:rgba(255,255,255,.12); overflow:hidden }
  .fill { height:100%; width:0%; background:#d4734a; transition:width .15s ease }
</style></head><body><div class="wrap">
  <div class="flame">🔥</div>
  <div class="title">Setting up Hearth</div>
  <div class="sub" id="sub">Preparing…</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
</div></body></html>`

export interface BootstrapSplash {
  update(p: Progress): void
  close(): void
}

export function createBootstrapSplash(): BootstrapSplash {
  const win = new BrowserWindow({
    width: 360,
    height: 240,
    resizable: false,
    frame: false,
    show: true,
    backgroundColor: '#1a1714',
    title: 'Hearth',
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)

  const label = (p: Progress): string =>
    p.phase === 'download'
      ? `Downloading${typeof p.percent === 'number' ? ` ${p.percent}%` : '…'}`
      : p.phase === 'extract'
        ? 'Unpacking…'
        : 'Finishing…'

  return {
    update(p) {
      if (win.isDestroyed()) return
      const pct = p.phase === 'download' ? (p.percent ?? 0) : p.phase === 'extract' ? 100 : 100
      const js = `(() => { const f=document.getElementById('fill'), s=document.getElementById('sub');
        if (f) f.style.width='${pct}%'; if (s) s.textContent=${JSON.stringify(label(p))}; })()`
      win.webContents.executeJavaScript(js).catch(() => {})
    },
    close() {
      if (!win.isDestroyed()) win.close()
    },
  }
}
