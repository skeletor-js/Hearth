// hearth-workbench.jsx — the display panel beside chat.
// Tabs mirror the coding-agent genre: Review (diffs), Files, Terminal,
// Browser, Plan, and Self (Hearth editing its own source).

const WB_TABS = [
  { id: "review",  icon: "git-diff",        label: "Review", badge: "3" },
  { id: "self",    icon: "flame",           label: "Self", flame: true },
  { id: "files",   icon: "folder",          label: "Files" },
  { id: "terminal",icon: "terminal-window", label: "Terminal" },
  { id: "browser", icon: "globe",           label: "Browser" },
  { id: "plan",    icon: "list-checks",     label: "Plan" },
];

function DiffView({ diffs }) {
  return (
    <div className="diff">
      {diffs.map((d, i) => (
        <div className="diff-file" key={i}>
          <div className="diff-file-head">
            <Icon name={d.tag === "new" ? "file-plus" : "pencil-simple"} />
            <span className="fname">{d.file}</span>
            <span className="spacer" />
            <span className="badge" style={{ color: "var(--add)" }}>+{d.add}</span>
            {d.del > 0 && <span className="badge" style={{ color: "var(--del)" }}>−{d.del}</span>}
          </div>
          {d.rows.map((r, j) => (
            <div key={j} className={"diff-row " + r.t}>
              <span className="ln">{r.ln}</span>
              <span className="gut">{r.t === "add" ? "+" : r.t === "del" ? "−" : ""}</span>
              <span className="code">{r.code}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReviewTab({ ctx }) {
  const sd = ctx.sessionData || {};
  return (
    <>
      <div className="wb-subhead">
        <Icon name="git-branch" className="ico-13" />
        <span className="path">{sd.branch || "evolve/command-palette"}</span>
        <span className="spacer" />
        <span className="stat add"><Icon name="plus" className="ico-12" />{sd.add != null ? sd.add : 128}</span>
        <span className="stat del"><Icon name="minus" className="ico-12" />{sd.del != null ? sd.del : 4}</span>
        <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => ctx.openTab("self")}
                title="Self-edits are applied from the Self tab">
          <Icon name="flame" /> Open in Self
        </button>
        <button className="btn btn-sm">
          <Icon name="git-pull-request" /> Draft PR
        </button>
      </div>
      <DiffView diffs={sd.diffs || DIFFS} />
    </>
  );
}

function SelfTab({ ctx }) {
  const applied = ctx.approveStatus === "approved";
  const sd = ctx.sessionData || {};
  const files = sd.selfFiles || [
    { f: "src/CommandPalette.jsx", t: "new file · the palette UI + fuzzy index", tag: "a", ic: "file-plus" },
    { f: "hearth-shell.jsx", t: "registers the ⌘K global shortcut", tag: "m", ic: "pencil-simple" },
    { f: "hearth-app.jsx", t: "passes routes + skills into the palette", tag: "m", ic: "pencil-simple" },
  ];
  return (
    <>
      <div className="self-banner">
        <span className="flame"><FlameMark size={17} /></span>
        <span><b>Hearth is editing its own source.</b><br />
          <span className="sub">Changes to the renderer, prompts, and skills live in this repo — and reload into the app you're using.</span></span>
      </div>
      <div className="ftree">
        {files.map((r, i) => (
          <div className="ftree-row" key={i} style={{ height: "auto", padding: "9px 10px", alignItems: "flex-start" }}>
            <Icon name={r.ic} style={{ marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--strong)" }}>{r.f}</div>
              <div style={{ fontSize: "var(--t-12)", color: "var(--subtle)", marginTop: 1 }}>{r.t}</div>
            </div>
            <span className={"tag " + r.tag} style={{ marginLeft: "auto" }}>{r.tag === "a" ? "new" : "mod"}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", marginTop: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: "var(--t-12)",
                      color: "var(--subtle)", marginBottom: 11 }}>
          <Icon name="arrow-counter-clockwise" className="ico-14" />
          Every self-edit is a commit. Roll back from <span style={{ fontFamily: "var(--mono)" }}>History</span> if a change misbehaves.
        </div>
        <button className={"btn " + (applied ? "" : "btn-primary")} style={{ width: "100%", justifyContent: "center", height: 34 }}
                onClick={applied ? undefined : ctx.onApprove}>
          <Icon name={applied ? "check-circle" : "flame"} fill />
          {applied ? "Applied — Hearth reloaded" : (sd.applyLabel || "Apply & hot-reload Hearth")}
        </button>
      </div>
    </>
  );
}

function FilesTab() {
  return (
    <>
      <div className="wb-subhead"><Icon name="folder-open" className="ico-13" />
        <span className="path">~/dev/hearth</span></div>
      <div className="ftree">
        {FILE_TREE.map((n, i) => (
          <div key={i} className={"ftree-row" + (n.active ? " is-active" : "")}
               style={{ paddingLeft: 8 + n.indent * 16 }}>
            <Icon name={n.icon} />
            <span>{n.name}</span>
            {n.tag && <span className={"tag " + n.tag}>{n.tag === "a" ? "A" : "M"}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function TerminalTab({ ctx }) {
  const lines = (ctx && ctx.sessionData && ctx.sessionData.terminal) || TERMINAL;
  return (
    <div className="term scroll">
      {lines.map((l, i) =>
        l.t === "" ? <div key={i} className="ln">&nbsp;</div> : (
          <div key={i} className={"ln " + (l.cls || "")}>
            {l.c === "pfx" ? <span className="pfx">{l.t}</span> : l.t}
            {l.cursor && <span className="cursor" />}
          </div>
        )
      )}
    </div>
  );
}

function BrowserTab() {
  return (
    <div className="bview">
      <div className="bview-url">
        <button className="btn-icon"><Icon name="arrow-left" /></button>
        <button className="btn-icon"><Icon name="arrow-clockwise" /></button>
        <div className="bar"><Icon name="lock-simple" fill /> localhost:5173 · Hearth (dev)</div>
        <button className="btn-icon"><Icon name="arrow-square-out" /></button>
      </div>
      <div className="bview-canvas scroll" style={{ background: "var(--bg-inset)", display: "flex",
            alignItems: "flex-start", justifyContent: "center", paddingTop: 60 }}>
        {/* Live preview of the feature being built: the new ⌘K palette */}
        <div style={{ width: 380, background: "var(--bg-panel)", borderRadius: 12,
              border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 14px",
                borderBottom: "1px solid var(--border)" }}>
            <Icon name="magnifying-glass" style={{ color: "var(--subtle)" }} />
            <span style={{ color: "var(--strong)", fontSize: "var(--t-14)" }}>command pal</span>
            <span className="cursor" style={{ background: "var(--accent)" }} />
            <span className="spacer" style={{ flex: 1 }} />
            <kbd>esc</kbd>
          </div>
          {[["arrow-bend-down-right", "Go to Review", "Navigate", true],
            ["sparkle", "Run skill · Code review", "Skill"],
            ["git-branch", "Switch workspace · ledger-api", "Workspace"]].map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: r[3] ? "var(--accent-soft)" : "transparent" }}>
              <Icon name={r[0]} style={{ color: r[3] ? "var(--accent)" : "var(--subtle)" }} />
              <span style={{ color: "var(--strong)", fontSize: "var(--t-13)", flex: 1 }}>{r[1]}</span>
              <span style={{ fontSize: "var(--t-11)", color: "var(--faint)" }}>{r[2]}</span>
            </div>
          ))}
          <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: "var(--t-11)",
                color: "var(--faint)", display: "flex", gap: 14 }}>
            <span>↑↓ navigate</span><span>↵ run</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanTab({ ctx }) {
  const plan = (ctx && ctx.sessionData && ctx.sessionData.plan) || PLAN;
  return (
    <div className="plan">
      {plan.map((p, i) => (
        <div key={i} className={"plan-item" + (p.state === "done" ? " is-done" : "")}>
          <span className={"plan-check " + (p.state === "done" ? "done" : p.state === "now" ? "now" : "")}>
            {p.state === "done" && <Icon name="check" className="ico-12" fill />}
          </span>
          <div className="plan-body">
            <div className="pt">{p.t}</div>
            <div className="ps">{p.s}</div>
          </div>
          {p.state === "now" && <span className="plan-now-tag">now</span>}
        </div>
      ))}
    </div>
  );
}

function AddTabMenu({ onPick, onClose }) {
  const items = [
    ["review", "git-diff", "Review", "Code changes"],
    ["files", "folder", "Files", "Browse project files"],
    ["terminal", "terminal-window", "Terminal", "Interactive shell"],
    ["browser", "globe", "Browser", "Open a website"],
    ["plan", "list-checks", "Plan", "Task checklist"],
  ];
  return (
    <>
      <div className="pop-mask" onClick={onClose} />
      <div className="pop" style={{ right: 14, top: 46 }}>
        <div className="pop-sect">Open in this panel</div>
        {items.map((it) => (
          <div key={it[0]} className="pop-item" onClick={() => { onPick(it[0]); onClose(); }}>
            <span className="pi-mark"><Icon name={it[1]} /></span>
            <div className="pi-body"><div className="pi-name">{it[2]}</div><div className="pi-sub">{it[3]}</div></div>
          </div>
        ))}
      </div>
    </>
  );
}

// One panel component used for BOTH the right panel and the bottom panel.
// Each instance owns its own active tab; both expose the same tab set.
function WorkPanel({ ctx, orientation, tab, setTab, onClose }) {
  const [addOpen, setAddOpen] = React.useState(false);
  const isBottom = orientation === "bottom";
  const local = { ...ctx, activeTab: tab, openTab: setTab };
  const Body = {
    review: ReviewTab, self: SelfTab, files: FilesTab,
    terminal: TerminalTab, browser: BrowserTab, plan: PlanTab,
  }[tab] || ReviewTab;
  const fileCount = (ctx.sessionData && ctx.sessionData.diffs) ? ctx.sessionData.diffs.length : 3;
  return (
    <div className="wp" data-screen-label={isBottom ? "Bottom panel" : "Right panel"}>
      <div className="wb-tabbar">
        {WB_TABS.map((t) => {
          const badge = t.id === "review" ? String(fileCount) : t.badge;
          return (
            <div key={t.id} className={"wb-tab" + (tab === t.id ? " is-active" : "")} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} fill={t.flame && tab === t.id} />
              {t.label}
              {badge && tab !== t.id && <span className="wb-badge">{badge}</span>}
            </div>
          );
        })}
        <span className="spacer" />
        <div className="wb-actions">
          <button className="btn-icon" title="Open a tab" onClick={() => setAddOpen(true)}><Icon name="plus" /></button>
          <button className="btn-icon" title="Environment & git" onClick={() => window.__hearthToast && window.__hearthToast("Environment: changes, branch, commit, create PR.")}><Icon name="git-fork" /></button>
          <button className="btn-icon" title={isBottom ? "Close bottom panel" : "Close right panel"} onClick={onClose}><Icon name="x" /></button>
        </div>
      </div>
      <div className="wb-body scroll"><Body ctx={local} /></div>
      {addOpen && <AddTabMenu onPick={setTab} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

Object.assign(window, { WorkPanel, DiffView, WB_TABS });
