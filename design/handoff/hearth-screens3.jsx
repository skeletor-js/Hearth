// hearth-screens3.jsx — Settings + Onboarding.

// ── Settings ───────────────────────────────────────────────────────────
const ACCENT_SWATCHES = ["#C8542B", "#C8902B", "#5E7A5C", "#A6603F"];

function SettingsScreen({ t, setTweak, backend }) {
  const [approval, setApproval] = React.useState("commands");
  const [length, setLength] = React.useState("balanced");
  const [directness, setDirectness] = React.useState("direct");
  const [density, setDensity] = React.useState("compact");
  const [allowSelf, setAllowSelf] = React.useState(true);
  const [requireApproval, setRequireApproval] = React.useState(true);
  const [autoCommit, setAutoCommit] = React.useState(true);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  return (
    <div className="screen scroll" data-screen-label="Settings">
      <div className="screen-inner narrow">
        <h1 className="screen-title">Settings</h1>
        <p className="screen-sub">Your files and conversations stay on your machine. Hearth only talks to the agents you connect.</p>

        <div className="sec-label"><Icon name="user-circle" /> Account</div>
        <SetRow k="Signed in" h="Local profile · this machine">
          <span className="chip"><Icon name="user" /> you@hearth.local</span>
        </SetRow>
        <SetRow k="Plan" h="Optional — covers managed media, voice, and texting. Nothing core is gated.">
          <span className="chip"><span className="dot ok" /> Bring-your-own keys</span>
          <button className="btn btn-sm" onClick={() => window.__hearthToast && window.__hearthToast("Billing covers managed media, voice, and texting.")}>Manage</button>
        </SetRow>

        <div className="sec"><div className="sec-label"><Icon name="plugs-connected" /> Agent</div></div>
        <SetRow k="Default backend" h="Which ACP agent new sessions start with.">
          <Seg value={t.backend} options={[["claude-code", "Claude Code"], ["codex", "Codex"]]}
               onChange={(v) => setTweak("backend", v)} />
        </SetRow>
        <SetRow k="Default model" h={`Models exposed by ${backend.name}.`}>
          <select className="field">
            {backend.models.map((m) => <option key={m.id}>{m.name}</option>)}
          </select>
        </SetRow>
        <SetRow k="Command approval" h="When Hearth wants to run a shell command or write files.">
          <Seg value={approval} options={[["never", "Auto"], ["commands", "Ask on commands"], ["always", "Ask always"]]}
               onChange={setApproval} />
        </SetRow>

        <div className="sec"><div className="sec-label"><Icon name="palette" /> Appearance</div></div>
        <SetRow k="Theme">
          <Seg value={t.theme} options={[["light", "Light"], ["dark", "Dark"]]} onChange={(v) => setTweak("theme", v)} />
        </SetRow>
        <SetRow k="Accent">
          <div className="swatch-row">
            {ACCENT_SWATCHES.map((c) => (
              <button key={c} className={"swatch" + (t.accent === c ? " on" : "")}
                      style={{ background: c }} onClick={() => setTweak("accent", c)} />
            ))}
          </div>
        </SetRow>
        <SetRow k="Reduce motion" h="Pause the ember and other ambient animation.">
          <Switch on={reduceMotion} onChange={setReduceMotion} />
        </SetRow>

        <div className="sec"><div className="sec-label"><Icon name="chat-text" /> Personality</div></div>
        <SetRow k="Response length">
          <Seg value={length} options={[["short", "Short"], ["balanced", "Balanced"], ["thorough", "Thorough"]]} onChange={setLength} />
        </SetRow>
        <SetRow k="Directness">
          <Seg value={directness} options={[["gentle", "Gentle"], ["direct", "Direct"]]} onChange={setDirectness} />
        </SetRow>
        <SetRow k="Formatting density" h="These compile to a soul.md Hearth reads — you don't edit it directly.">
          <Seg value={density} options={[["compact", "Compact"], ["roomy", "Roomy"]]} onChange={setDensity} />
        </SetRow>

        <div className="sec"><div className="sec-label"><Icon name="brain" /> Memory</div></div>
        <SetRow k="Long-term memory" h="Plain markdown on your computer. Managed through chat — say “remember this” or “forget that”.">
          <button className="btn btn-sm" onClick={() => window.__hearthToast && window.__hearthToast("memory.md — plain markdown on your machine.")}><Icon name="file-text" /> Open memory file</button>
        </SetRow>

        <div className="sec"><div className="sec-label"><Icon name="flame" /> Self-evolution</div></div>
        <SetRow k="Let Hearth edit itself" h="Hearth can change its own UI, prompts, and skills.">
          <Switch on={allowSelf} onChange={setAllowSelf} />
        </SetRow>
        <SetRow k="Approve before applying" h="Review every self-edit diff before it reloads.">
          <Switch on={requireApproval} onChange={setRequireApproval} />
        </SetRow>
        <SetRow k="Commit each change" h="So every evolution is reversible from the Evolve screen.">
          <Switch on={autoCommit} onChange={setAutoCommit} />
        </SetRow>
      </div>
    </div>
  );
}

// ── Onboarding ─────────────────────────────────────────────────────────
const OB_STEPS = ["Connect an agent", "Choose a workspace", "Personality", "Ready"];

function OnboardingScreen({ onFinish, t, setTweak }) {
  const [step, setStep] = React.useState(0);
  const [ws, setWs] = React.useState(null);
  const [tone, setTone] = React.useState("direct");

  const next = () => (step < OB_STEPS.length - 1 ? setStep(step + 1) : onFinish());
  const canNext = step !== 1 || ws;

  return (
    <div className="ob" data-screen-label="Onboarding">
      <div className="ob-side">
        <div className="ob-brand"><span className="flame"><FlameMark size={20} /></span> Hearth</div>
        <div className="ob-steps">
          {OB_STEPS.map((s, i) => (
            <div key={s} className={"ob-step " + (i === step ? "now" : i < step ? "done" : "")}>
              <span className="ob-num">{i < step ? <Icon name="check" className="ico-12" fill /> : i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto", fontSize: "var(--t-12)", color: "var(--faint)", lineHeight: 1.6 }}>
          Open source · your data stays on your computer.
        </div>
      </div>

      <div className="ob-main">
        <div className="ob-card">
          {step === 0 && (
            <>
              <h1>Bring an agent you already pay for</h1>
              <p className="lead">Hearth connects over the Agent Client Protocol. Pick one to start — you can add more later.</p>
              {Object.values(BACKENDS).map((b) => (
                <div key={b.id} className={"pick" + (t.backend === b.id ? " on" : "")} onClick={() => setTweak("backend", b.id)}>
                  <span className="pk-mark"><Icon name={b.icon} className="ico-18" /></span>
                  <div className="pk-body"><div className="pk-name">{b.name}</div>
                    <div className="pk-sub">{b.models.map((m) => m.name).join(" · ")}</div></div>
                  {t.backend === b.id && <Icon name="check-circle" fill className="pk-check" />}
                </div>
              ))}
              <div className="pick">
                <span className="pk-mark"><Icon name="plugs" className="ico-18" /></span>
                <div className="pk-body"><div className="pk-name">Other ACP agent</div>
                  <div className="pk-sub">Point Hearth at any ACP server endpoint.</div></div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1>Point Hearth at a project</h1>
              <p className="lead">Choose a local repo to begin. Hearth reads it, remembers it, and works inside it.</p>
              {WORKSPACES.map((w) => (
                <div key={w.id} className={"pick" + (ws === w.id ? " on" : "")} onClick={() => setWs(w.id)}>
                  <span className="pk-mark"><Icon name="git-branch" /></span>
                  <div className="pk-body"><div className="pk-name">{w.name}</div>
                    <div className="pk-sub" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>~/dev/{w.name} · {w.branch}</div></div>
                  {ws === w.id && <Icon name="check-circle" fill className="pk-check" />}
                </div>
              ))}
              <button className="btn btn-sm" style={{ marginTop: 2 }}><Icon name="folder-open" /> Open another folder…</button>
            </>
          )}

          {step === 2 && (
            <>
              <h1>How should Hearth talk to you?</h1>
              <p className="lead">A couple of choices now; tune the rest anytime in Settings.</p>
              <SetRow k="Directness" h="How blunt Hearth is with tradeoffs and risks.">
                <Seg value={tone} options={[["gentle", "Gentle"], ["direct", "Direct"]]} onChange={setTone} />
              </SetRow>
              <SetRow k="Approve self-edits" h="Hearth can change its own UI — review diffs before they apply.">
                <Switch on={true} onChange={() => {}} />
              </SetRow>
            </>
          )}

          {step === 3 && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><AsciiEmber fontSize={18} /></div>
              <h1>The hearth is lit</h1>
              <p className="lead" style={{ maxWidth: 380, margin: "0 auto 4px" }}>
                You're on {BACKENDS[t.backend].name}{ws ? `, in ${WORKSPACES.find((w) => w.id === ws)?.name}` : ""}.
                Start a session — or ask Hearth to change itself.
              </p>
            </div>
          )}

          <div className="ob-actions" style={{ justifyContent: step === 3 ? "center" : "flex-start" }}>
            {step > 0 && step < 3 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
            {step < 3
              ? <button className={"btn btn-primary" + (canNext ? "" : " is-disabled")} onClick={canNext ? next : undefined}
                        style={canNext ? null : { opacity: .5 }}>Continue <Icon name="arrow-right" /></button>
              : <button className="btn btn-primary" onClick={onFinish} style={{ height: 36, padding: "0 20px" }}>
                  <Icon name="flame" fill /> Enter Hearth</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen, OnboardingScreen });
