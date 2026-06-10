// hearth-shell.jsx — left rail, topbar, shared primitives.

const Icon = ({ name, className = "", style, fill = false }) => (
  <i className={`ph-${fill ? "fill" : "thin"} ph-${name} ${className}`} style={style} />
);

function RailItem({ icon, label, end, selected, onClick, indent = 0, dot, fill }) {
  return (
    <div className={"rail-item" + (selected ? " is-selected" : "")}
         style={indent ? { paddingLeft: 9 + indent * 14 } : null} onClick={onClick}>
      {dot && <span className={"rail-dot " + dot} />}
      {icon && <Icon name={icon} fill={fill} />}
      <span className="ri-label">{label}</span>
      {end != null && <span className="ri-end">{end}</span>}
    </div>
  );
}

const COLLAPSED_NAV = [
  { icon: "plus", route: "new", title: "New session" },
  { icon: "magnifying-glass", route: "search", title: "Search" },
  { icon: "clock-counter-clockwise", route: "history", title: "History" },
  { icon: "stack", route: "workspaces", title: "Workspaces" },
];

function Sidebar({ route, go, collapsed, onToggle, openWs, setOpenWs,
                   activeSession, onPickSession, backend, onSwapBackend, onSettings, railW, onRailResize,
                   theme, onToggleTheme }) {
  if (collapsed) {
    return (
      <aside className="rail" data-screen-label="Rail (collapsed)">
        <div className="rail-top">
          <button className="rail-mark" title="Expand sidebar" onClick={onToggle}>
            <RailIcon side="left" size={20} />
          </button>
        </div>
        <div className="rail-scroll scroll">
          <div className="rail-collapsed-only">
            {COLLAPSED_NAV.map((it) => (
              <RailItem key={it.route} icon={it.icon} selected={route === it.route}
                        onClick={() => go(it.route)} />
            ))}
          </div>
        </div>
        <div className="rail-foot">
          <button className={"foot-settings" + (route === "settings" ? " is-selected" : "")} title="Settings" onClick={onSettings}>
            <Icon name="gear" />
          </button>
          <button className="ricon" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={onToggleTheme}>
            <Icon name={theme === "dark" ? "sun" : "moon-stars"} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rail" data-screen-label="Rail" style={{ width: railW }}>
      <div className="rail-top">
        <div className="rail-brand" title="Hearth">
          <span className="flame"><FlameMark size={19} /></span>
          <span>Hearth</span>
        </div>
        <PanelBtn side="left" on={true} title="Collapse sidebar" onClick={onToggle} />
      </div>

      <div className="rail-scroll scroll">
        <div className="rail-group">
          <RailItem icon="plus" label="New session" end={<kbd>⌘N</kbd>}
                    selected={route === "new"} onClick={() => go("new")} />
          <RailItem icon="magnifying-glass" label="Search" end={<kbd>⌘K</kbd>}
                    selected={route === "search"} onClick={() => go("search")} />
          <RailItem icon="clock-counter-clockwise" label="History"
                    selected={route === "history"} onClick={() => go("history")} />
        </div>

        <div className="rail-group">
          <div className="rail-group-label"><span>Workspaces</span><Icon name="folder-simple-plus" /></div>
          {WORKSPACES.map((w) => {
            const isOpen = !!openWs[w.id];
            return (
              <React.Fragment key={w.id}>
                <div className="rail-item" onClick={() => setOpenWs((s) => ({ ...s, [w.id]: !s[w.id] }))}>
                  <Icon name={isOpen ? "caret-down" : "caret-right"} />
                  <span className="ri-label" style={{ color: "var(--strong)", fontWeight: 500 }}>{w.name}</span>
                  <span className={"rail-dot " + w.status} />
                </div>
                {isOpen && (
                  <div className="rail-tree">
                    {w.sessions.map((c) => (
                      <RailItem key={c.id} icon={c.self ? "flame" : "chat-circle"} fill={c.self}
                                label={c.title} selected={activeSession === c.id}
                                onClick={() => onPickSession(c.id)} />
                    ))}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="rail-group">
          <div className="rail-group-label"><span>Recent</span></div>
          {RECENTS.map((r) => (
            <RailItem key={r.id + r.when} icon={r.self ? "flame" : "clock-counter-clockwise"} fill={r.self}
                      label={r.title} end={r.when} selected={activeSession === r.id && route === "session"}
                      onClick={() => onPickSession(r.id)} />
          ))}
        </div>
      </div>

      <div className="rail-foot">
        <button className={"foot-settings" + (route === "settings" ? " is-selected" : "")} onClick={onSettings}>
          <Icon name="gear" /><span>Settings</span>
        </button>
        <button className="ricon" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={onToggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon-stars"} />
        </button>
      </div>
      {onRailResize && <Resizer axis="x" className="resizer-rail" onResize={onRailResize} />}
    </aside>
  );
}

function Topbar({ children, right }) {
  return (
    <div className="topbar">
      <div className="crumbs" style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {right && <div className="tb-actions">{right}</div>}
    </div>
  );
}

// Drag-to-resize handle. axis "x" → horizontal resize (col), "y" → vertical (row).
// Calls onResize(delta) with incremental movement each pointermove.
function Resizer({ axis, onResize, className = "" }) {
  const last = React.useRef(0);
  const onDown = (e) => {
    e.preventDefault();
    last.current = axis === "x" ? e.clientX : e.clientY;
    const move = (ev) => {
      const cur = axis === "x" ? ev.clientX : ev.clientY;
      onResize(cur - last.current);
      last.current = cur;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  return <div className={"resizer resizer-" + axis + " " + className} onPointerDown={onDown} />;
}

// Custom panel-toggle icons (provided SVGs): rounded rect with a bar on one edge.
const RAIL_ICON_PATHS = {
  left:   '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M6.55 6.45V11.55" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
  right:  '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M11.45 6.45V11.55" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
  bottom: '<rect x="3.25" y="4.25" width="11.5" height="9.5" rx="2.1" stroke="currentColor" stroke-width="1.35"></rect><path d="M6.25 11.35H11.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
};
function RailIcon({ side, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none"
         style={{ display: "block" }} aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: RAIL_ICON_PATHS[side] }} />
  );
}
function PanelBtn({ side, on, onClick, title, size }) {
  return (
    <button className={"pbtn" + (on ? " on" : "")} title={title} onClick={onClick}>
      <RailIcon side={side} size={size} />
    </button>
  );
}

Object.assign(window, { Icon, RailItem, Sidebar, Topbar, RailIcon, PanelBtn, Resizer });
