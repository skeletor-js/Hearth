// hearth-screens.jsx — full screens beyond the Session view: Home, Agents, Evolve.

const STARTERS = [
  ["git-diff", "Review a diff", "Point Hearth at a branch and walk the changes together."],
  ["bug-beetle", "Track down a bug", "Describe the symptom; Hearth reproduces it, then fixes it."],
  ["flame", "Evolve Hearth", "Ask Hearth to change its own UI, prompts, or skills."],
  ["test-tube", "Write tests first", "Spec the behaviour, let Hearth build it to green."],
];

// ── Home / New session ────────────────────────────────────────────────
function HomeScreen({ backend, onStart, onPickSession, onOpenWorkspace }) {
  return (
    <div className="screen scroll" data-screen-label="Home">
      <div className="screen-inner">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 10 }}>
          <div style={{ marginBottom: 14 }}><AsciiEmber fontSize={16} /></div>
          <h1 className="screen-title" style={{ fontSize: "var(--t-28)" }}>What are we building?</h1>
          <p className="screen-sub" style={{ textAlign: "center" }}>
            One ongoing relationship with your coding agent — it keeps the repo, the plan,
            and how you like to work. Currently on <b>{backend.name}</b>.
          </p>
        </div>

        <div className="tile-grid">
          {STARTERS.map((c, i) => (
            <div className="hero-card" key={i} onClick={onStart}>
              <div className="hc-t"><Icon name={c[0]} fill={c[0] === "flame"} /> {c[1]}</div>
              <div className="hc-s">{c[2]}</div>
            </div>
          ))}
        </div>

        <div className="sec">
          <div className="sec-label"><Icon name="clock-counter-clockwise" /> Continue</div>
          {RECENTS.map((r) => (
            <div className="card-row click" key={r.id + r.when} onClick={() => onPickSession(r.id)}>
              <span className="cr-mark"><Icon name={r.self ? "flame" : "chat-circle"} fill={r.self} /></span>
              <div className="cr-body">
                <div className="cr-title">{r.title}</div>
                <div className="cr-sub">{r.ws} · {r.when === "now" ? "active now" : r.when + " ago"}</div>
              </div>
              <Icon name="arrow-right" style={{ color: "var(--faint)" }} />
            </div>
          ))}
        </div>

        <div className="sec">
          <div className="sec-label"><Icon name="stack" /> Workspaces</div>
          <div className="tile-grid">
            {WORKSPACES.map((w) => (
              <div className="card-row click" key={w.id} style={{ marginBottom: 0 }} onClick={() => onOpenWorkspace(w.id)}>
                <span className="cr-mark"><Icon name="git-branch" /></span>
                <div className="cr-body">
                  <div className="cr-title">{w.name} <span className={"rail-dot " + w.status} /></div>
                  <div className="cr-sub">{w.branch} · {w.sessions.length} session{w.sessions.length > 1 ? "s" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agents (ACP connections) ──────────────────────────────────────────
function AgentsScreen({ current, onPick }) {
  return (
    <div className="screen scroll" data-screen-label="Agents">
      <div className="screen-inner narrow">
        <h1 className="screen-title">Agents</h1>
        <p className="screen-sub">
          Hearth talks to coding agents over the Agent Client Protocol. Bring a subscription you
          already pay for and switch any time — even mid-session.
        </p>

        <div className="sec-label"><Icon name="plugs-connected" /> Connected</div>
        {Object.values(BACKENDS).map((b) => {
          const active = current === b.id;
          return (
            <div className="card-row" key={b.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 0, padding: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 15px" }}>
                <span className="cr-mark"><Icon name={b.icon} className="ico-18" /></span>
                <div className="cr-body">
                  <div className="cr-title">{b.name}
                    <span className="chip" style={{ height: 18 }}>ACP</span>
                    {active && <span className="chip chip-accent" style={{ height: 18 }}><span className="dot ok" /> Active</span>}
                  </div>
                  <div className="cr-sub">Local ACP server · authenticated</div>
                </div>
                {!active && <button className="btn btn-sm" onClick={() => onPick(b.id)}>Set as default</button>}
                <button className="btn-icon" title="Configure" onClick={() => window.__hearthToast && window.__hearthToast(`Opening ${b.name} settings…`)}><Icon name="gear" /></button>
              </div>
              <div style={{ borderTop: "1px solid var(--border)", padding: "11px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
                {b.models.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: "var(--t-12)" }}>
                    <Icon name="cube" className="ico-13" style={{ color: "var(--subtle)" }} />
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--strong)" }}>{m.name}</span>
                    <span style={{ color: "var(--subtle)" }}>{m.sub}</span>
                    {b.activeModel === m.id && <span className="chip" style={{ marginLeft: "auto", height: 18 }}>default</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="sec">
          <div className="sec-label"><Icon name="plus" /> Add</div>
          <div className="card-row click">
            <span className="cr-mark"><Icon name="plugs" className="ico-18" /></span>
            <div className="cr-body">
              <div className="cr-title">Connect an ACP agent</div>
              <div className="cr-sub">Point Hearth at any Agent Client Protocol server endpoint.</div>
            </div>
            <button className="btn btn-sm" onClick={() => window.__hearthToast && window.__hearthToast("Connect any ACP server by its endpoint.")}><Icon name="plus" /> Add agent</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── History (self-modification timeline + undo/redo) ──────────────────
// Linear timeline, newest first. `head` = how many of the most-recent edits
// are currently undone. An edit at index i is undone when i < head.
const EVOLUTIONS = [
  { id: "e0", icon: "pencil-simple", title: "Rename sidebar heading to “Hearth 🔥”", files: 1, add: 1, del: 1,
    when: "just now", note: "One-line copy change in src/shell/Sidebar.tsx." },
  { id: "e1", icon: "magnifying-glass", title: "Add a command palette (⌘K)", files: 3, add: 128, del: 4,
    when: "1h ago", note: "Fuzzy search over nav destinations and workspaces; ⌘K toggles it." },
  { id: "e2", icon: "moon-stars", title: "Warm up the dark theme", files: 2, add: 34, del: 30,
    when: "yesterday", note: "Shifted dark surfaces from cool slate to warm charcoal to match the ember accent." },
  { id: "e3", icon: "list-checks", title: "Add a Plan tab to the Workbench", files: 2, add: 56, del: 2,
    when: "3 days ago", note: "An inline task checklist that tracks the agent's plan for the session." },
  { id: "e4", icon: "rows", title: "Compact rail density", files: 1, add: 18, del: 6,
    when: "5 days ago", note: "26px rows for denser navigation on small displays." },
];

function HistoryScreen({ onOpenDiff, onNewEvolution }) {
  const [head, setHead] = React.useState(0);          // # of newest edits undone
  const total = EVOLUTIONS.length;
  const canUndo = head < total;
  const canRedo = head > 0;

  const undo = () => { if (head >= total) return; window.__hearthToast && window.__hearthToast(`Undone · ${EVOLUTIONS[head].title}`); setHead((h) => Math.min(h + 1, total)); };
  const redo = () => { if (head <= 0) return; window.__hearthToast && window.__hearthToast(`Redone · ${EVOLUTIONS[head - 1].title}`); setHead((h) => Math.max(h - 1, 0)); };

  return (
    <div className="screen scroll" data-screen-label="History">
      <div className="screen-inner narrow">
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 7 }}>
          <span style={{ color: "var(--accent)", display: "inline-flex" }}><Icon name="clock-counter-clockwise" className="ico-20" /></span>
          <h1 className="screen-title" style={{ margin: 0 }}>History</h1>
        </div>
        <p className="screen-sub">
          Every time Hearth changes its own UI, prompts, or skills, it lands here as a commit.
          Step backward and forward through the timeline — the live app follows.
        </p>

        {/* Undo / redo toolbar */}
        <div className="evo-toolbar">
          <button className={"btn btn-sm" + (canUndo ? "" : " is-off")} onClick={undo} disabled={!canUndo}>
            <Icon name="arrow-u-up-left" /> Undo
          </button>
          <button className={"btn btn-sm" + (canRedo ? "" : " is-off")} onClick={redo} disabled={!canRedo}>
            <Icon name="arrow-u-up-right" /> Redo
          </button>
          <span className="evo-state">
            {head === 0
              ? <><span className="dot ok" /> Up to date · {total} self-edits</>
              : <><span className="dot warn" /> {head} change{head > 1 ? "s" : ""} undone · Hearth is running an earlier build</>}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={onNewEvolution}>
            <Icon name="flame" fill /> Ask Hearth to change itself
          </button>
        </div>

        <div className="sec" style={{ marginTop: 22 }}>
          {EVOLUTIONS.map((e, i) => {
            const undone = i < head;
            const isUndoHead = i === head;        // most-recent applied (next to undo)
            const isRedoHead = i === head - 1;    // most-recently undone (next to redo)
            return (
              <React.Fragment key={e.id}>
                {isUndoHead && head > 0 && (
                  <div className="evo-boundary"><span>current build</span></div>
                )}
                <div className={"card-row evo-row" + (undone ? " evo-undone" : "")} style={{ alignItems: "flex-start" }}>
                  <span className="cr-mark"><Icon name={undone ? "arrow-counter-clockwise" : e.icon} /></span>
                  <div className="cr-body">
                    <div className="cr-title">
                      <span className="evo-name">{e.title}</span>
                      {undone
                        ? <span className="chip evo-badge-undone" style={{ height: 18 }}><Icon name="arrow-counter-clockwise" className="ico-12" /> Undone</span>
                        : <span className="chip chip-accent" style={{ height: 18 }}><Icon name="check" className="ico-12" /> Applied</span>}
                    </div>
                    <div className="cr-sub" style={{ whiteSpace: "normal", marginTop: 3 }}>{e.note}</div>
                    <div className="evo-stats">
                      <span>{e.files} file{e.files > 1 ? "s" : ""}</span>
                      <span style={{ color: "var(--add)" }}>+{e.add}</span>
                      <span style={{ color: "var(--del)" }}>−{e.del}</span>
                      <span>{e.when}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                    <button className="btn btn-sm" onClick={onOpenDiff}><Icon name="git-diff" /> Diff</button>
                    {isUndoHead && <button className="btn btn-sm btn-quiet" style={{ justifyContent: "center" }} onClick={undo}>Undo</button>}
                    {isRedoHead && <button className="btn btn-sm btn-primary" style={{ justifyContent: "center" }} onClick={redo}>Redo</button>}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen, AgentsScreen, HistoryScreen });
