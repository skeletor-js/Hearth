// hearth-screens2.jsx — Search, Workspace detail, Settings, Onboarding.

// Small shared controls -------------------------------------------------
function Seg({ value, options, onChange }) {
  return (
    <div className="mini-seg">
      {options.map(([v, l]) => (
        <span key={v} className={"seg" + (value === v ? " is-active" : "")} onClick={() => onChange(v)}>{l}</span>
      ))}
    </div>
  );
}
function Switch({ on, onChange }) {
  return <button className={"sw" + (on ? " on" : "")} role="switch" aria-checked={on}
                 onClick={() => onChange(!on)}><i /></button>;
}
function SetRow({ k, h, children }) {
  return (
    <div className="set-row">
      <div><div className="set-k">{k}</div>{h && <div className="set-h">{h}</div>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

// ── Search ─────────────────────────────────────────────────────────────
const SEARCH_RESULTS = [
  { title: "Add a command palette to yourself", ws: "hearth", when: "active now",
    snip: "…⌘K should open it, fuzzy-search every nav destination, and run the selection…" },
  { title: "Stripe webhook retries", ws: "ledger-api", when: "2h ago",
    snip: "…use exponential backoff with a max of 5 attempts, then route to a dead-letter queue…" },
  { title: "Why is the queue test flaky", ws: "ledger-api", when: "yesterday",
    snip: "…the test asserts ordering but the worker pool drains concurrently, so…" },
  { title: "Onboarding empty states", ws: "atlas-web", when: "2 days ago",
    snip: "…show the ember and a single prompt rather than a dashboard on first run…" },
  { title: "Warm up the dark theme", ws: "hearth", when: "yesterday",
    snip: "…shift dark surfaces from cool slate toward a warm charcoal to match the ember accent…" },
];

function highlight(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function SearchScreen({ onPickSession }) {
  const [q, setQ] = React.useState("");
  const [scope, setScope] = React.useState("all");
  const base = scope === "hearth" ? SEARCH_RESULTS.filter((r) => r.ws === "hearth") : SEARCH_RESULTS;
  const hits = q.trim()
    ? base.filter((r) => (r.title + " " + r.snip).toLowerCase().includes(q.toLowerCase()))
    : base;
  return (
    <div className="screen scroll" data-screen-label="Search">
      <div className="screen-inner narrow">
        <div className="search-field">
          <Icon name="magnifying-glass" style={{ color: "var(--subtle)", fontSize: 18 }} />
          <input autoFocus placeholder="Search sessions by title or message…" value={q}
                 onChange={(e) => setQ(e.target.value)} />
          {q && <button className="btn-icon" onClick={() => setQ("")}><Icon name="x" /></button>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0 14px" }}>
          <Seg value={scope} options={[["all", "All sessions"], ["hearth", "hearth"]]} onChange={setScope} />
          <span style={{ marginLeft: "auto", fontSize: "var(--t-12)", color: "var(--faint)" }}>
            {hits.length} result{hits.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ fontSize: "var(--t-12)", color: "var(--faint)", marginBottom: 10 }}>
          Search covers session titles and messages.
        </div>
        {hits.map((r, i) => (
          <div className="sresult" key={i} onClick={() => onPickSession && onPickSession(r)}>
            <div className="sr-top">
              <Icon name="chat-circle" style={{ color: "var(--subtle)" }} />
              {highlight(r.title, q)}
              <span className="sr-scope">{r.ws} · {r.when}</span>
            </div>
            <div className="sr-snip">{highlight(r.snip, q)}</div>
          </div>
        ))}
        {hits.length === 0 && (
          <div className="wb-empty" style={{ minHeight: 180 }}>
            <Icon name="magnifying-glass" /><h3>No matches</h3>
            <p>Nothing in your sessions matches “{q}”.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Workspace detail ───────────────────────────────────────────────────
const WS_CHANGES = {
  "w-hearth": [
    { f: "src/CommandPalette.jsx", tag: "a", s: "+96" },
    { f: "hearth-shell.jsx", tag: "m", s: "+24 −2" },
    { f: "hearth-app.jsx", tag: "m", s: "+8 −2" },
  ],
  "w-ledger": [{ f: "src/webhooks/stripe.ts", tag: "m", s: "+41 −7" }],
  "w-atlas": [],
};
const WS_BRANCHES = {
  "w-hearth": ["main", "evolve/command-palette", "evolve/dark-theme"],
  "w-ledger": ["main", "fix/webhook-retries"],
  "w-atlas": ["main", "feat/onboarding"],
};

function WorkspaceScreen({ ws, onPickSession, onNewSession }) {
  const changes = WS_CHANGES[ws.id] || [];
  const branches = WS_BRANCHES[ws.id] || ["main"];
  return (
    <div className="screen scroll" data-screen-label="Workspace">
      <div className="screen-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 22 }}>
          <span className="cr-mark" style={{ width: 42, height: 42 }}><Icon name="git-branch" className="ico-20" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="screen-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              {ws.name} <span className={"rail-dot " + ws.status} />
            </h1>
            <div style={{ fontSize: "var(--t-12)", color: "var(--subtle)", fontFamily: "var(--mono)", marginTop: 3 }}>
              ~/dev/{ws.name} · on {ws.branch}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => window.__hearthToast && window.__hearthToast(`Opening a terminal in ${ws.name}…`)}><Icon name="terminal-window" /> Terminal</button>
          <button className="btn btn-sm" onClick={() => window.__hearthToast && window.__hearthToast(`Pulling latest on ${ws.branch}…`)}><Icon name="arrow-down" /> Pull</button>
          <button className="btn btn-sm btn-primary" onClick={onNewSession}><Icon name="plus" /> New session</button>
        </div>

        <div className="sec" style={{ marginTop: 4 }}>
          <div className="sec-label"><Icon name="chats-circle" /> Sessions</div>
          {ws.sessions.map((s) => (
            <div className="card-row click" key={s.id} onClick={() => onPickSession(s.id)}>
              <span className="cr-mark"><Icon name={s.self ? "flame" : "chat-circle"} fill={s.self} /></span>
              <div className="cr-body"><div className="cr-title">{s.title}</div>
                <div className="cr-sub">{s.self ? "self-evolution" : "session"}</div></div>
              <Icon name="arrow-right" style={{ color: "var(--faint)" }} />
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26 }}>
          <div className="sec">
            <div className="sec-label"><Icon name="git-diff" /> Working tree</div>
            {changes.length === 0
              ? <div style={{ fontSize: "var(--t-13)", color: "var(--subtle)", padding: "6px 2px" }}>Clean — no uncommitted changes.</div>
              : changes.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px",
                      borderBottom: i < changes.length - 1 ? "1px solid var(--border)" : "0", fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  <span className={"ftree-row " + ""} style={{ padding: 0, height: "auto", gap: 8 }}>
                    <Icon name={c.tag === "a" ? "file-plus" : "pencil-simple"}
                          style={{ color: c.tag === "a" ? "var(--add)" : "var(--warn)" }} />
                  </span>
                  <span style={{ color: "var(--strong)", flex: 1 }}>{c.f}</span>
                  <span style={{ color: "var(--subtle)" }}>{c.s}</span>
                </div>
              ))}
          </div>
          <div className="sec">
            <div className="sec-label"><Icon name="git-fork" /> Branches</div>
            {branches.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 2px",
                    borderBottom: i < branches.length - 1 ? "1px solid var(--border)" : "0", fontSize: "var(--t-13)" }}>
                <Icon name="git-branch" style={{ color: b === ws.branch ? "var(--accent)" : "var(--subtle)" }} />
                <span style={{ color: b === ws.branch ? "var(--strong)" : "var(--default)",
                      fontFamily: "var(--mono)", fontSize: 11.5, flex: 1 }}>{b}</span>
                {b === ws.branch && <span className="chip chip-accent" style={{ height: 18 }}>current</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Seg, Switch, SetRow, SearchScreen, WorkspaceScreen });
