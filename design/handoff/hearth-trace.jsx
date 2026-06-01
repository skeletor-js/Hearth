// hearth-trace.jsx — agent tool-calling trace rendered as a clean vertical timeline.
// Replaces a noisy "ToolSearch / grep / ToolSearch / Edit +1 −1" log with readable,
// grouped steps: a connecting spine, status glyphs, relative targets, quiet diff stats,
// and an expandable inline diff. Supports a live "running" state for the last step.

const TRACE_ICON = {
  search: "magnifying-glass",
  read:   "file-text",
  edit:   "pencil-simple",
  run:    "terminal-window",
  think:  "brain",
};

function TraceStep({ step, running, isLast }) {
  const [open, setOpen] = React.useState(false);
  const isRunning = running && isLast;
  const status = isRunning ? "run" : step.status;
  const hasDetail = step.diff || step.detail;

  return (
    <div className={"tstep" + (isLast ? " is-last" : "")}>
      <div className={"tstep-node " + status}>
        {status === "run"
          ? <span className="tspin" />
          : status === "err"
            ? <Icon name="x" className="ico-12" />
            : <Icon name={TRACE_ICON[step.kind] || "dot"} className="ico-12" />}
      </div>
      <div className="tstep-main">
        <div className={"tstep-line" + (hasDetail ? " has-detail" : "")}
             onClick={hasDetail ? () => setOpen((v) => !v) : undefined}>
          {step.verb
            ? <><span className="tverb">{step.verb}</span>
                <span className="ttarget">{step.target}</span>
                {step.scope && <span className="tscope">in {step.scope}</span>}</>
            : <span className="tverb plain">{step.title}</span>}
          {step.meta && (
            <span className={"tmeta" + (step.kind === "edit" ? " diffmeta" : "")}>
              {step.kind === "edit"
                ? <>{step.add != null ? <b className="add">+{step.add}</b> : <b className="add">{step.meta.split(" ")[0]}</b>}
                    {" "}<b className="del">{step.meta.split(" ")[1] || ""}</b></>
                : step.meta}
            </span>
          )}
          {isRunning && <span className="trun-lbl">running…</span>}
          {hasDetail && <Icon name="caret-right" className={"tchev ico-12" + (open ? " open" : "")} />}
        </div>
        {open && step.detail && <div className="tstep-detail note">{step.detail}</div>}
        {open && step.diff && (
          <div className="tstep-detail diff-mini">
            {step.diff.map((r, i) => (
              <div key={i} className={"dm-row " + r.t}>
                <span className="dm-ln">{r.ln}</span>
                <span className="dm-gut">{r.t === "add" ? "+" : r.t === "del" ? "−" : " "}</span>
                <span className="dm-code">{r.code}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentTrace({ steps, backend, running, elapsed, result, ctx }) {
  // When running, reveal steps progressively and mark the frontier as in-flight.
  const [shown, setShown] = React.useState(running ? 1 : steps.length);
  React.useEffect(() => {
    if (!running) { setShown(steps.length); return; }
    setShown(1);
    const id = setInterval(() => setShown((n) => (n < steps.length ? n + 1 : n)), 850);
    return () => clearInterval(id);
  }, [running, steps.length]);

  const visible = steps.slice(0, shown);
  const done = !running && shown >= steps.length;

  return (
    <div className="trace">
      <div className="trace-head">
        <span className={"trace-status" + (running ? " run" : "")}>
          {running ? <span className="tspin big" /> : <Icon name="check-circle" fill className="ico-14" />}
        </span>
        <span className="trace-title">{running ? "Working" : "Worked"}</span>
        <span className="trace-elapsed">· {elapsed}</span>
        <span className="spacer" />
        <span className="trace-be"><Icon name={backend.icon} className="ico-12" /> {backend.name}</span>
      </div>

      <div className="trace-steps">
        {visible.map((s, i) => (
          <TraceStep key={i} step={s} running={running} isLast={i === visible.length - 1} />
        ))}
      </div>

      {done && result && (
        <div className="trace-result">
          <Icon name="check" className="ico-13" />
          <span className="tr-text">{result.text}</span>
          {result.file && (
            <button className="tr-diff" onClick={() => ctx && ctx.openTab("review")}>
              <Icon name="git-diff" className="ico-12" /> View diff
            </button>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AgentTrace, TraceStep });
