// hearth-chat.jsx — conversation rendering + composer.

function ToolStrip({ icon, sum, meta, lines, open: open0 }) {
  const [open, setOpen] = React.useState(!!open0);
  return (
    <div className={"tool-strip" + (open ? " open" : "")}>
      <div className="ts-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={icon || "wrench"} className="tsi" />
        <span className="ts-sum" dangerouslySetInnerHTML={{ __html: sum }} />
        {meta && <span className="ts-meta">{meta}</span>}
        <Icon name="caret-right" className="ts-chev ico-12" />
      </div>
      {lines && (
        <div className="ts-body">
          {lines.map((l, i) => (
            <div key={i} className={"ts-line " + (l.cls || "")}>
              <Icon name={l.ic || "dot"} />
              <span>{l.t}</span>
              {l.n && <span className="num">{l.n}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunLine({ label, end }) {
  return (
    <div className="run-line">
      <span className="spinner" />
      <span className="lbl">{label}</span>
      {end && <span className="end">{end}</span>}
    </div>
  );
}

function WbRef({ icon, label, detail, onClick }) {
  return (
    <div className="wb-ref" onClick={onClick}>
      <Icon name={icon || "cards"} />
      <span><b>{label}</b>{detail && <span style={{ color: "var(--subtle)" }}> · {detail}</span>}</span>
      <Icon name="arrow-up-right" className="arrow" />
    </div>
  );
}

function PlanRef({ title, done, total, onClick }) {
  return (
    <div className="wb-ref" onClick={onClick}>
      <Icon name="list-checks" />
      <span><b>{title}</b><span style={{ color: "var(--subtle)" }}> · {done}/{total} done</span></span>
      <Icon name="arrow-up-right" className="arrow" />
    </div>
  );
}

function ApproveCard({ data, status, onApprove, onDecline }) {
  return (
    <div className="approve">
      <div className="approve-head">
        <Icon name="seal-question" fill />
        <span>{data.title}</span>
      </div>
      <div className="approve-body">
        <div className="cmd">{data.cmd}</div>
        <div className="why">{data.why}</div>
      </div>
      <div className="approve-foot">
        <span className="scope"><Icon name="shield-check" className="ico-13" /> {data.scope}</span>
        {status === "pending" ? (
          <>
            <button className="btn btn-sm btn-quiet" onClick={onDecline}>Decline</button>
            <button className="btn btn-sm btn-primary" onClick={onApprove}>
              <Icon name="check" /> Approve &amp; run
            </button>
          </>
        ) : status === "approved" ? (
          <span className="chip chip-accent"><Icon name="check-circle" fill /> Approved · applied</span>
        ) : (
          <span className="chip"><Icon name="x-circle" /> Declined</span>
        )}
      </div>
    </div>
  );
}

function Block({ b, ctx }) {
  switch (b.kind) {
    case "text":     return <div className="msg-body" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case "tool":     return <ToolStrip {...b} />;
    case "wb-ref":   return <WbRef icon={b.icon} label={b.label} detail={b.detail}
                                   onClick={() => ctx.openTab(b.tab)} />;
    case "plan-ref": return <PlanRef title={b.title} done={b.done} total={b.total}
                                     onClick={() => ctx.openTab("plan")} />;
    case "approve":  return <ApproveCard data={b} status={ctx.approveStatus}
                                   onApprove={ctx.onApprove} onDecline={ctx.onDecline} />;
    case "trace":    return <AgentTrace steps={b.steps} backend={ctx.backend} running={ctx.traceRunning}
                                   elapsed={b.elapsed} result={b.result} ctx={ctx} />;
    default:         return null;
  }
}

function MessageView({ m, ctx }) {
  const isUser = m.role === "user";
  return (
    <div className={"msg " + (isUser ? "user" : "hearth")}>
      <div className="msg-role">
        {isUser
          ? <span className="who">You</span>
          : <><span className="flame"><FlameMark size={14} /></span><span className="who">Hearth</span></>}
        <span className="time">{m.time}</span>
      </div>
      {m.blocks.map((b, i) => <Block key={i} b={b} ctx={ctx} />)}
    </div>
  );
}

function Composer({ backend, mode, setMode, onOpenBackend, streaming, onSend, branch }) {
  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="ctx-chips">
          <span className="chip"><Icon name="git-branch" /> {branch || "evolve/command-palette"}</span>
          <span className="chip chip-accent"><Icon name="flame" fill /> Self-edit on</span>
        </div>
        <div className="composer-input" contentEditable suppressContentEditableWarning
             data-ph="true" data-x="Reply to Hearth, or ask it to change itself…"
             style={{ outline: "none" }} />
        <div className="composer-bar">
          <div className="mini-seg">
            {[["plan", "Plan", "list-bullets"], ["auto", "Auto", "lightning"], ["ask", "Ask", "hand"]].map(([v, l, ic]) => (
              <span key={v} className={"seg" + (mode === v ? " is-active" : "")} onClick={() => setMode(v)}>
                <Icon name={ic} />{l}
              </span>
            ))}
          </div>
          <span className="spacer" />
          <button className={"send" + (streaming ? " is-disabled" : "")} onClick={onSend}
                  title={streaming ? "Working…" : "Send"}>
            <Icon name={streaming ? "stop" : "arrow-up"} fill={streaming} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatView({ ctx }) {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight + 400;
  }, [ctx.streaming, ctx.approveStatus, ctx.activeSession, ctx.traceRunning]);

  return (
    <div className="chat-col" data-screen-label="Chat">
      <div className="chat-scroll scroll" ref={scrollRef} id="chat-scroll">
        <div className="chat-wrap">
          {(window.CONVERSATIONS && window.CONVERSATIONS[ctx.activeSession] || CONVERSATION).map((m, i) => <MessageView key={i} m={m} ctx={ctx} />)}
          {ctx.streaming && (
            <div className="msg hearth">
              <div className="msg-role">
                <span className="flame"><FlameMark size={14} /></span>
                <span className="who">Hearth</span>
              </div>
              <div style={{ marginBottom: 9 }}><ThinkingEmber label="Applying edits to myself" /></div>
              <RunLine label="hearth self apply --reload" end="rewriting 3 files…" />
            </div>
          )}
        </div>
      </div>
      <Composer backend={ctx.backend} mode={ctx.mode} setMode={ctx.setMode}
                onOpenBackend={ctx.onOpenBackend} streaming={ctx.streaming} onSend={ctx.onSend}
                branch={ctx.sessionData && ctx.sessionData.branch} />
      <style>{`
        .composer-input[data-ph="true"]:empty::before{ content:attr(data-x); color:var(--faint); }
        .composer-input{ caret-color: var(--accent); }
      `}</style>
    </div>
  );
}

Object.assign(window, { ToolStrip, RunLine, WbRef, PlanRef, ApproveCard, MessageView, Composer, ChatView });
