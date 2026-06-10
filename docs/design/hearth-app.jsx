// hearth-app.jsx — routing, state, theme, layout directions, tweaks, wiring.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme":   "light",
  "accent":  "#C8542B",
  "layout":  "companion",
  "rowH":    30,
  "railCollapsed": false,
  "backend": "claude-code",
  "streamingDemo": false,
  "traceRunning": false
}/*EDITMODE-END*/;

const ACCENTS = {
  "#C8542B": "Ember",
  "#C8902B": "Amber",
  "#5E7A5C": "Sage",
  "#A6603F": "Clay",
};
const ACCENT_OPTIONS = ["#C8542B", "#C8902B", "#5E7A5C", "#A6603F"];

// ─────────────────────────────────────────────────────────────
// Backend picker popover
// ─────────────────────────────────────────────────────────────
function BackendPop({ current, onPick, onClose, anchor }) {
  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={anchor || { left: 30, bottom: 86 }}>
        <div className="pop-sect">Agent backend · ACP</div>
        {Object.values(BACKENDS).map((b) => (
          <React.Fragment key={b.id}>
            <div className="pop-item" onClick={() => { onPick(b.id); onClose(); }}>
              <span className="pi-mark"><Icon name={b.icon} /></span>
              <div className="pi-body">
                <div className="pi-name">{b.name}</div>
                <div className="pi-sub">{b.models.find((m) => m.id === b.activeModel)?.name}</div>
              </div>
              {current === b.id && <Icon name="check" className="pi-check" />}
            </div>
          </React.Fragment>
        ))}
        <div className="ctxmenu-sep" />
        <div className="pop-item" onClick={onClose}>
          <span className="pi-mark"><Icon name="plus" /></span>
          <div className="pi-body"><div className="pi-name">Connect ACP agent…</div>
            <div className="pi-sub">Any Agent Client Protocol server</div></div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// ⌘K command palette — the very feature Hearth "builds" in the demo.
// ─────────────────────────────────────────────────────────────
function CommandPalette({ open, onClose, onRun }) {
  const [q, setQ] = React.useState("");
  React.useEffect(() => { if (open) setQ(""); }, [open]);
  if (!open) return null;
  const cmds = [
    { id: "new", ic: "plus", label: "New session", grp: "Navigate" },
    { id: "review", ic: "git-diff", label: "Go to Review", grp: "Workbench" },
    { id: "__panel", ic: "terminal-window", label: "Open Terminal panel", grp: "Workbench" },
    { id: "browser", ic: "globe", label: "Open Browser preview", grp: "Workbench" },
    { id: "self", ic: "flame", label: "Open Self (edit Hearth)", grp: "Workbench" },
    { id: "history", ic: "clock-counter-clockwise", label: "History of self-edits", grp: "Navigate" },
    ...WORKSPACES.map((w) => ({ id: "ws:" + w.id, ic: "git-branch", label: "Switch workspace · " + w.name, grp: "Workspaces" })),
    { id: "theme", ic: "moon-stars", label: "Toggle light / dark", grp: "Settings" },
  ];
  const hits = q.trim()
    ? cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
    : cmds;
  const run = (c) => { onRun(c); onClose(); };
  const onKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && hits[0]) run(hits[0]);
  };
  return (
    <div className="cmdk-mask" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icon name="magnifying-glass" />
          <input autoFocus placeholder="Search Hearth — destinations, skills, workspaces…"
                 value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list scroll">
          {hits.length === 0 && <div className="cmdk-empty">No matches for “{q}”</div>}
          {hits.map((c, i) => (
            <div key={c.id} className={"cmdk-row" + (i === 0 ? " is-first" : "")} onClick={() => run(c)}>
              <Icon name={c.ic} />
              <span className="cl">{c.label}</span>
              <span className="cg">{c.grp}</span>
            </div>
          ))}
        </div>
        <div className="cmdk-foot"><span>↑↓ navigate</span><span>↵ run</span>
          <span style={{ marginLeft: "auto", color: "var(--accent)" }}>
            <Icon name="flame" fill className="ico-12" /> built by Hearth</span></div>
      </div>
      <style>{`
        .cmdk-mask{ position:fixed;inset:0;z-index:500;background:rgba(15,11,6,.28);
          display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;
          animation:cmdkin .14s ease; }
        @keyframes cmdkin{ from{opacity:0} to{opacity:1} }
        .cmdk{ width:560px;max-width:92vw;background:var(--bg-panel);border:1px solid var(--border-strong);
          border-radius:14px;box-shadow:var(--shadow-lg);overflow:hidden;
          animation:cmdkpop .16s cubic-bezier(.3,.8,.4,1); }
        @keyframes cmdkpop{ from{transform:translateY(-6px) scale(.99);opacity:.6} to{transform:none;opacity:1} }
        .cmdk-input{ display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--border); }
        .cmdk-input .ph-thin{ color:var(--subtle);font-size:17px; }
        .cmdk-input input{ flex:1;border:0;outline:0;background:transparent;font-size:var(--t-16);
          color:var(--strong);caret-color:var(--accent); }
        .cmdk-input input::placeholder{ color:var(--faint); }
        .cmdk-list{ max-height:48vh;overflow:auto;padding:6px; }
        .cmdk-row{ display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:8px;color:var(--strong); }
        .cmdk-row .ph-thin{ color:var(--subtle);font-size:15px; }
        .cmdk-row .cl{ flex:1;font-size:var(--t-13); }
        .cmdk-row .cg{ font-size:var(--t-11);color:var(--faint); }
        .cmdk-row:hover,.cmdk-row.is-first{ background:var(--accent-soft); }
        .cmdk-row:hover .ph-thin,.cmdk-row.is-first .ph-thin{ color:var(--accent); }
        .cmdk-empty{ padding:22px;text-align:center;color:var(--subtle);font-size:var(--t-13); }
        .cmdk-foot{ display:flex;align-items:center;gap:16px;padding:9px 16px;border-top:1px solid var(--border);
          font-size:var(--t-11);color:var(--faint); }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// New-session hero (chat side) + simple placeholder views
// ─────────────────────────────────────────────────────────────
function CenteredView({ icon, title, sub, children }) {
  return (
    <div className="chat-col">
      <div className="chat-scroll scroll">
        <div className="wb-empty" style={{ minHeight: "70vh" }}>
          <Icon name={icon} />
          <h3>{title}</h3>
          <p>{sub}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────
// Three-dots session menu (top of the chat box)
function MoreMenu({ onClose, onPick }) {
  const items = [
    ["Renaming session…", "pencil-simple", "Rename session"],
    ["Duplicated session", "copy", "Duplicate"],
    ["Exporting transcript…", "export", "Export transcript…"],
    ["Copied share link", "link-simple", "Copy share link"],
    ["sep"],
    ["Archived session", "archive", "Archive"],
    ["Deleted session", "trash", "Delete session", true],
  ];
  return (
    <>
      <div className="menu-mask" onClick={onClose} />
      <div className="more-menu">
        {items.map((it, i) => it[0] === "sep"
          ? <div key={i} className="more-sep" />
          : (
            <div key={i} className={"more-item" + (it[3] ? " danger" : "")}
                 onClick={() => { onPick(it[0]); onClose(); }}>
              <Icon name={it[1]} /><span>{it[2]}</span>
            </div>
          ))}
      </div>
    </>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState("session");
  const [activeSession, setActiveSession] = React.useState("s-rename");
  const [openWs, setOpenWs] = React.useState({ "w-hearth": true });
  const [rightOpen, setRightOpen] = React.useState(true);
  const [bottomOpen, setBottomOpen] = React.useState(false);
  const [rightTab, setRightTab] = React.useState("review");
  const [bottomTab, setBottomTab] = React.useState("terminal");
  const [railW, setRailW] = React.useState(244);
  const [wbW, setWbW] = React.useState(620);
  const [panelH, setPanelH] = React.useState(260);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const [approveStatus, setApproveStatus] = React.useState("pending");
  const [mode, setMode] = React.useState("auto");
  const [backendPop, setBackendPop] = React.useState(false);
  const [cmdk, setCmdk] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [activeWsId, setActiveWsId] = React.useState("w-hearth");

  const backend = BACKENDS[t.backend] || BACKENDS["claude-code"];
  const streaming = !!t.streamingDemo;
  const sessionData = (window.SESSION_DATA && window.SESSION_DATA[activeSession]) || (window.SESSION_DATA && window.SESSION_DATA["s-palette"]);

  // Apply theme + tokens
  React.useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.theme === "dark" ? "dark" : "light");
    r.style.setProperty("--accent", t.accent);
    r.style.setProperty("--accent-soft", `color-mix(in srgb, ${t.accent} 12%, transparent)`);
    r.style.setProperty("--accent-fg", "#FFFFFF");
    r.style.setProperty("--row-h", (t.rowH || 30) + "px");
  }, [t.theme, t.accent, t.rowH]);

  // Focus layout: right panel starts as a closed overlay
  React.useEffect(() => { setRightOpen(t.layout !== "focus"); }, [t.layout]);

  // ⌘K global shortcut (the feature Hearth shipped to itself)
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk((v) => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); setRoute("new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showToast = (msg, action) => { setToast({ msg, action }); setTimeout(() => setToast(null), 4200); };
  window.__hearthToast = showToast;

  const openTab = (tab) => { setRightTab(tab); setRightOpen(true); };

  const onApprove = () => {
    setTweak("streamingDemo", true);
    setRightOpen(true);
    setBottomOpen(true);
    setBottomTab("terminal");
    setTimeout(() => {
      setTweak("streamingDemo", false);
      setApproveStatus("approved");
      if (activeSession === "s-rename") showToast("Hearth reloaded — the sidebar now reads “Hearth 🔥”.");
      else showToast("Hearth reloaded — ⌘K is live. Try it.", "Open palette");
    }, 1700);
  };
  const onDecline = () => setApproveStatus("declined");

  const onSwapBackend = () => setBackendPop(true);
  const pickBackend = (id) => setTweak("backend", id);

  const onSend = () => {
    if (streaming) { setTweak("streamingDemo", false); return; }
    setTweak("streamingDemo", true);
    setTimeout(() => setTweak("streamingDemo", false), 1800);
  };

  const runCmd = (c) => {
    if (c.id === "new") setRoute("new");
    else if (c.id === "history") setRoute("history");
    else if (c.id === "theme") setTweak("theme", t.theme === "dark" ? "light" : "dark");
    else if (c.id === "__panel") { setRoute("session"); setBottomOpen(true); setBottomTab("terminal"); }
    else if (["review", "terminal", "browser", "self", "plan", "files"].includes(c.id)) { setRoute("session"); openTab(c.id); }
    else if (c.id.startsWith("ws:")) { openWorkspace(c.id.slice(3)); }
  };

  const pickSession = (id) => { setActiveSession(id); setRoute("session"); };
  const startSession = () => { setActiveSession("s-palette"); setApproveStatus("pending"); setRightTab("self"); setRightOpen(true); setRoute("session"); };
  const openWorkspace = (id) => { setActiveWsId(id); setRoute("workspace"); };

  const ctx = {
    backend, mode, setMode, onOpenBackend: onSwapBackend, streaming, onSend,
    openTab, approveStatus, onApprove, onDecline,
    layout: t.layout,
    activeSession, sessionData, traceRunning: !!t.traceRunning,
  };

  const panelBtns = route === "session" ? (
    <div className="pbtn-group">
      <PanelBtn side="bottom" on={bottomOpen} title="Toggle bottom panel" onClick={() => setBottomOpen((v) => !v)} />
      <PanelBtn side="right" on={rightOpen} title="Toggle right panel" onClick={() => setRightOpen((v) => !v)} />
    </div>
  ) : null;

  // ── Topbar per route ──
  const themeBtn = null;

  let topbar, body;
  const activeWs = WORKSPACES.find((w) => w.sessions.some((s) => s.id === activeSession)) || WORKSPACES[0];
  const sessionTitle = (activeWs.sessions.find((s) => s.id === activeSession) ||
    RECENTS.find((r) => r.id === activeSession) || { title: "Session" }).title;
  const isSelf = !!(activeWs.sessions.find((s) => s.id === activeSession)?.self ||
    RECENTS.find((r) => r.id === activeSession)?.self);

  if (route === "session") {
    topbar = (
      <Topbar right={<>
        <span className="more-wrap">
          <button className={"btn-icon" + (moreOpen ? " is-active" : "")} title="Session options"
                  onClick={() => setMoreOpen((v) => !v)}><Icon name="dots-three" /></button>
          {moreOpen && <MoreMenu onClose={() => setMoreOpen(false)}
                        onPick={(a) => showToast(a)} />}
        </span>
        {panelBtns}
      </>}>
        <Icon name="git-branch" className="ico-13" style={{ color: "var(--subtle)" }} />
        <span>{activeWs.name}</span>
        <span className="sep">/</span>
        {isSelf && <span className="flame" style={{ color: "var(--accent)", display: "inline-flex" }}><FlameMark size={13} /></span>}
        <span className="head">{sessionTitle}</span>
      </Topbar>
    );
    body = (
      <div className="workspace">
        <ChatView ctx={ctx} />
      </div>
    );
  } else if (route === "new") {
    topbar = <Topbar right={<>{themeBtn}<span className="chip" style={{ marginLeft: 2 }}><Icon name={backend.icon} /> {backend.name}</span></>}><span className="head">New session</span></Topbar>;
    body = <HomeScreen backend={backend} onStart={startSession} onPickSession={pickSession} onOpenWorkspace={openWorkspace} />;
  } else if (route === "history" || route === "evolve") {
    topbar = <Topbar right={<>{themeBtn}</>}><span style={{ color: "var(--accent)", display: "inline-flex" }}><Icon name="clock-counter-clockwise" className="ico-14" /></span><span className="head">History</span></Topbar>;
    body = <HistoryScreen onOpenDiff={() => { setRoute("session"); openTab("review"); }}
             onNewEvolution={() => { setActiveSession("s-rename"); setApproveStatus("pending"); setRightTab("review"); setRightOpen(true); setRoute("session"); }} />;
  } else if (route === "search") {
    topbar = <Topbar right={<>{themeBtn}</>}><span className="head">Search</span></Topbar>;
    body = <SearchScreen onPickSession={() => pickSession("s-webhook")} />;
  } else if (route === "workspace" || route === "workspaces") {
    const ws = WORKSPACES.find((w) => w.id === activeWsId) || WORKSPACES[0];
    topbar = <Topbar right={<>{themeBtn}<button className="btn btn-sm btn-primary" onClick={() => pickSession(ws.sessions[0].id)}><Icon name="plus" /> New session</button></>}>
      <span style={{ color: "var(--subtle)" }}>Workspaces</span><span className="sep">/</span><span className="head">{ws.name}</span></Topbar>;
    body = <WorkspaceScreen ws={ws} onPickSession={pickSession} onNewSession={() => pickSession(ws.sessions[0].id)} />;
  } else if (route === "settings") {
    topbar = <Topbar right={<>{themeBtn}</>}><span className="head">Settings</span></Topbar>;
    body = <SettingsScreen t={t} setTweak={setTweak} backend={backend} />;
  } else {
    topbar = <Topbar right={<>{themeBtn}</>}><span className="head">{route}</span></Topbar>;
    body = <CenteredView icon="circle" title={route} sub="" />;
  }

  if (route === "onboarding") {
    return (
      <>
        <OnboardingScreen t={t} setTweak={setTweak} onFinish={() => setRoute("session")} />
        <TweaksUI t={t} setTweak={setTweak} onOnboarding={() => setRoute("onboarding")} />
      </>
    );
  }

  return (
    <>
      <div className="app" data-rail-collapsed={!!t.railCollapsed}
           data-layout={route === "session" ? t.layout : null} data-screen-label="Hearth">
        <Sidebar route={route} go={setRoute} collapsed={!!t.railCollapsed}
                 onToggle={() => setTweak("railCollapsed", !t.railCollapsed)}
                 railW={railW} onRailResize={(d) => setRailW((w) => clamp(w + d, 190, 380))}
                 theme={t.theme} onToggleTheme={() => setTweak("theme", t.theme === "dark" ? "light" : "dark")}
                 openWs={openWs} setOpenWs={setOpenWs}
                 activeSession={activeSession} onPickSession={pickSession}
                 backend={backend} onSwapBackend={onSwapBackend}
                 onSettings={() => setRoute("settings")} />
        <div className="stage">
          <div className="stage-row">
            <main className="main main-chat">{topbar}{body}</main>
            {route === "session" && (t.layout === "focus" || rightOpen) && (
              <div className={"wb-col" + (t.layout === "focus" && !rightOpen ? " is-hidden" : "")}
                   style={t.layout === "split" ? null : { width: wbW }}>
                {t.layout !== "focus" && <Resizer axis="x" className="resizer-wb"
                           onResize={(d) => setWbW((w) => clamp(w - d, 360, Math.round(window.innerWidth * 0.7)))} />}
                <WorkPanel ctx={ctx} orientation="right" tab={rightTab} setTab={setRightTab}
                           onClose={() => setRightOpen(false)} />
              </div>
            )}
            {route === "session" && t.layout === "focus" && rightOpen &&
              <div className="focus-scrim" onClick={() => setRightOpen(false)} />}
          </div>
          {route === "session" && bottomOpen && (
            <div className="wb-panel" style={{ height: panelH }}>
              <Resizer axis="y" className="resizer-panel"
                       onResize={(d) => setPanelH((h) => clamp(h - d, 130, Math.round(window.innerHeight * 0.7)))} />
              <WorkPanel ctx={ctx} orientation="bottom" tab={bottomTab} setTab={setBottomTab}
                         onClose={() => setBottomOpen(false)} />
            </div>
          )}
        </div>
      </div>

      {backendPop && <BackendPop current={t.backend} onPick={pickBackend} onClose={() => setBackendPop(false)} />}
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} onRun={runCmd} />

      {toast && (
        <div className="toast">
          <Icon name="flame" fill /><span>{toast.msg}</span>
          {toast.action && <a onClick={() => { setToast(null); setCmdk(true); }}>{toast.action}</a>}
        </div>
      )}

      <TweaksUI t={t} setTweak={setTweak} onOnboarding={() => setRoute("onboarding")} />
    </>
  );
}

function TweaksUI({ t, setTweak, onOnboarding }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" value={t.theme}
        options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
        onChange={(v) => setTweak("theme", v)} />
      <TweakColor label="Accent" value={t.accent} options={ACCENT_OPTIONS}
        onChange={(v) => setTweak("accent", v)} />

      <TweakSection label="Layout" />
      <TweakRadio label="Shell" value={t.layout}
        options={[{ value: "companion", label: "Companion" }, { value: "split", label: "Split" }, { value: "focus", label: "Focus" }]}
        onChange={(v) => setTweak("layout", v)} />
      <TweakSlider label="Row height" value={t.rowH} min={26} max={36} unit="px"
        onChange={(v) => setTweak("rowH", v)} />
      <TweakToggle label="Collapse sidebar" value={!!t.railCollapsed}
        onChange={(v) => setTweak("railCollapsed", v)} />

      <TweakSection label="Agent" />
      <TweakRadio label="Backend" value={t.backend}
        options={[{ value: "claude-code", label: "Claude Code" }, { value: "codex", label: "Codex" }]}
        onChange={(v) => setTweak("backend", v)} />
      <TweakToggle label="Streaming state" value={!!t.streamingDemo}
        onChange={(v) => setTweak("streamingDemo", v)} />
      <TweakToggle label="Agent working (live trace)" value={!!t.traceRunning}
        onChange={(v) => setTweak("traceRunning", v)} />

      <TweakSection label="Flows" />
      <TweakButton label="Show onboarding" onClick={onOnboarding} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
