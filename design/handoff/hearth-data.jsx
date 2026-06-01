// hearth-data.jsx — mock content for the Hearth workspace prototype.

const BACKENDS = {
  "claude-code": {
    id: "claude-code", name: "Claude Code", short: "Claude Code · ACP",
    icon: "terminal-window",
    models: [
      { id: "sonnet", name: "claude-sonnet-4.5", sub: "Balanced · fast edits" },
      { id: "opus",   name: "claude-opus-4.1",   sub: "Deep reasoning" },
    ],
    activeModel: "sonnet",
  },
  "codex": {
    id: "codex", name: "Codex", short: "Codex · ACP",
    icon: "brackets-curly",
    models: [
      { id: "gpt5",      name: "gpt-5-codex",     sub: "Default coding model" },
      { id: "gpt5-high", name: "gpt-5-codex-high",sub: "Extended thinking" },
    ],
    activeModel: "gpt5",
  },
};

// Workspaces = local repos/folders Hearth is connected to.
const WORKSPACES = [
  { id: "w-hearth", name: "hearth", branch: "evolve/sidebar-heading", status: "run",
    sessions: [
      { id: "s-rename",  title: "Rename the sidebar heading", self: true },
      { id: "s-palette", title: "Add a command palette to yourself", self: true },
      { id: "s-theme",   title: "Warm up the dark theme" },
    ] },
  { id: "w-ledger", name: "ledger-api", branch: "main", status: "ok",
    sessions: [
      { id: "s-webhook", title: "Stripe webhook retries" },
      { id: "s-migrate", title: "Migrate auth to sessions" },
    ] },
  { id: "w-atlas", name: "atlas-web", branch: "feat/onboarding", status: "ok",
    sessions: [
      { id: "s-onboard", title: "Onboarding empty states" },
    ] },
];

// Recent standalone sessions (not tied to the tree above)
const RECENTS = [
  { id: "s-rename",  title: "Rename the sidebar heading", ws: "hearth", self: true, when: "now" },
  { id: "s-palette", title: "Add a command palette to yourself", ws: "hearth", self: true, when: "1h" },
  { id: "s-webhook", title: "Stripe webhook retries", ws: "ledger-api", when: "2h" },
  { id: "s-flaky",   title: "Why is the queue test flaky", ws: "ledger-api", when: "yest" },
  { id: "s-onboard", title: "Onboarding empty states", ws: "atlas-web", when: "2d" },
];

const SKILLS = [
  { id: "sk-review", name: "Code review", icon: "magnifying-glass" },
  { id: "sk-pr",     name: "Draft pull request", icon: "git-pull-request" },
  { id: "sk-test",   name: "Write tests first", icon: "test-tube" },
];

// ─────────────── The ongoing conversation (self-evolve session) ───────────────
// Each message: {role, time, blocks:[...]}. Blocks render in order.
const CONVERSATION = [
  {
    role: "user", time: "9:41",
    blocks: [{ kind: "text", html: "You don't have a command palette yet. Add one to yourself — ⌘K should open it, fuzzy-search every nav destination and skill, and run the selection. Match the rest of the UI." }],
  },
  {
    role: "hearth", time: "9:41",
    blocks: [
      { kind: "text", html: "On it. I'll add this to my <b>own</b> source — a new <code>CommandPalette.jsx</code>, a ⌘K listener in the shell, and an index of nav routes + skills. Let me look at how the shell wires global shortcuts first." },
      { kind: "tool", icon: "magnifying-glass", sum: "Read <b>hearth-shell.jsx</b>, <b>hearth-app.jsx</b>", meta: "2 files",
        lines: [
          { ic: "file", t: "hearth-app.jsx", n: "575 ln" },
          { ic: "file", t: "hearth-shell.jsx", n: "267 ln" },
          { ic: "magnifying-glass", t: "grep  \"keydown\"  → 1 match", n: "" },
        ] },
      { kind: "plan-ref", title: "Plan · 4 steps", done: 1, total: 4 },
    ],
  },
  {
    role: "hearth", time: "9:42",
    blocks: [
      { kind: "text", html: "Here's the plan. I'll build the palette component, register the shortcut, then show you a diff against my own files before anything is applied." },
      { kind: "tool", icon: "pencil-simple", sum: "Edited <b>2 files</b>, created <b>1</b>", meta: "+128 −4", open: true,
        lines: [
          { ic: "plus", cls: "add", t: "src/CommandPalette.jsx", n: "+96" },
          { ic: "pencil-simple", t: "hearth-shell.jsx", n: "+24 −2" },
          { ic: "pencil-simple", t: "hearth-app.jsx", n: "+8 −2" },
          { ic: "brain", cls: "mem", t: "Memory · noted your ⌘K preference", n: "" },
        ] },
      { kind: "wb-ref", icon: "git-diff", label: "Review changes", detail: "3 files · self-edit", tab: "review" },
    ],
  },
  {
    role: "hearth", time: "9:43",
    blocks: [
      { kind: "text", html: "I ran the renderer build to make sure nothing broke. It compiles. One command needs your sign-off before I apply it to a running copy of myself:" },
      { kind: "approve",
        title: "Apply edits and hot-reload Hearth?",
        cmd: "hearth self apply --session s-palette --reload",
        why: "This rewrites 3 files in Hearth's own source and reloads the renderer. Your current session is preserved.",
        scope: "Sandbox: hearth repo · reversible" },
    ],
  },
];

// What renders in Workbench → Review tab (the self-edit diff)
const DIFFS = [
  {
    file: "src/CommandPalette.jsx", tag: "new", add: 96, del: 0,
    rows: [
      { t: "hunk", ln: "", code: "@@ new file · 96 lines @@" },
      { t: "add", ln: 1,  code: "function CommandPalette({ open, onClose, routes, skills, onRun }) {" },
      { t: "add", ln: 2,  code: "  const [q, setQ] = React.useState('');" },
      { t: "add", ln: 3,  code: "  const items = React.useMemo(() => index(routes, skills), [routes, skills]);" },
      { t: "add", ln: 4,  code: "  const hits = fuzzy(items, q);" },
      { t: "add", ln: 5,  code: "  if (!open) return null;" },
      { t: "add", ln: 6,  code: "  return (" },
      { t: "add", ln: 7,  code: "    <div className=\"cmdk-mask\" onClick={onClose}>" },
      { t: "add", ln: 8,  code: "      <div className=\"cmdk\" onClick={(e) => e.stopPropagation()}>" },
      { t: "add", ln: 9,  code: "        <input autoFocus placeholder=\"Search Hearth…\" value={q}" },
      { t: "add", ln: 10, code: "               onChange={(e) => setQ(e.target.value)} />" },
      { t: "add", ln: 11, code: "        {hits.map((h) => <Row key={h.id} hit={h} onRun={onRun} />)}" },
      { t: "add", ln: 12, code: "      </div>" },
      { t: "add", ln: 13, code: "    </div>" },
      { t: "add", ln: 14, code: "  );" },
      { t: "add", ln: 15, code: "}" },
    ],
  },
  {
    file: "hearth-shell.jsx", tag: "modified", add: 24, del: 2,
    rows: [
      { t: "hunk", ln: "", code: "@@ -41,6 +41,28 @@ function Shell() {" },
      { t: "ctx", ln: 41, code: "  const [route, setRoute] = useRoute();" },
      { t: "del", ln: 42, code: "  // TODO: global shortcuts" },
      { t: "add", ln: 42, code: "  const [cmdk, setCmdk] = React.useState(false);" },
      { t: "add", ln: 43, code: "  React.useEffect(() => {" },
      { t: "add", ln: 44, code: "    const onKey = (e) => {" },
      { t: "add", ln: 45, code: "      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {" },
      { t: "add", ln: 46, code: "        e.preventDefault(); setCmdk((v) => !v);" },
      { t: "add", ln: 47, code: "      }" },
      { t: "add", ln: 48, code: "    };" },
      { t: "add", ln: 49, code: "    window.addEventListener('keydown', onKey);" },
      { t: "add", ln: 50, code: "    return () => window.removeEventListener('keydown', onKey);" },
      { t: "add", ln: 51, code: "  }, []);" },
      { t: "ctx", ln: 52, code: "  return (" },
    ],
  },
];

const FILE_TREE = [
  { name: "src", icon: "folder", indent: 0, open: true },
  { name: "CommandPalette.jsx", icon: "file-jsx", indent: 1, tag: "a", active: true },
  { name: "App.jsx", icon: "file-jsx", indent: 1 },
  { name: "router.js", icon: "file-js", indent: 1 },
  { name: "hearth-shell.jsx", icon: "file-jsx", indent: 0, tag: "m" },
  { name: "hearth-app.jsx", icon: "file-jsx", indent: 0, tag: "m" },
  { name: "hearth-chat.jsx", icon: "file-jsx", indent: 0 },
  { name: "skills", icon: "folder", indent: 0 },
  { name: "package.json", icon: "file-text", indent: 0 },
];

const TERMINAL = [
  { c: "pfx", t: "hearth ▸ " }, { t: "bun run build:renderer" },
  { t: "" },
  { cls: "dim", t: "  vite v5.4.0  building renderer for production…" },
  { cls: "dim", t: "  ✓ 412 modules transformed." },
  { t: "  dist/assets/CommandPalette-9f2a.js   3.41 kB │ gzip: 1.5 kB" },
  { t: "  dist/assets/shell-7b18.js           48.2 kB │ gzip: 14 kB" },
  { cls: "ok", t: "  ✓ built in 1.84s" },
  { t: "" },
  { c: "pfx", t: "hearth ▸ " }, { t: "self apply --session s-palette --reload", cursor: true },
];

const PLAN = [
  { state: "done", t: "Read shell + app to find shortcut wiring", s: "hearth-shell.jsx, hearth-app.jsx" },
  { state: "done", t: "Build CommandPalette.jsx with fuzzy index", s: "routes + skills, ⌘K toggle" },
  { state: "now",  t: "Wire ⌘K listener into the shell", s: "awaiting your approval to apply" },
  { state: "todo", t: "Hot-reload and verify in a live copy", s: "preserves current session" },
];

// ─────────────── Agent tool-calling trace (the "rename heading" turn) ───────────────
// Each step is one tool call, rendered as a node on a vertical timeline.
// kind: search | read | edit | run | think ; status: done | run | err
const RENAME_TRACE = [
  { kind: "think", status: "done", title: "Read the request",
    detail: "One-line copy change in the sidebar heading. I'll locate the exact line before editing." },
  { kind: "search", status: "done", verb: "Searched", target: "Hearth", scope: "src/shell", meta: "3 matches" },
  { kind: "read",   status: "done", verb: "Read", target: "Sidebar.tsx", meta: "L14–18" },
  { kind: "edit",   status: "done", verb: "Edited", target: "Sidebar.tsx", meta: "+1 −1",
    diff: [
      { t: "ctx", ln: 15, code: "      <div className=\"rail-brand\">" },
      { t: "del", ln: 16, code: "        <span>Hearth</span>" },
      { t: "add", ln: 16, code: "        <span>Hearth 🔥</span>" },
      { t: "ctx", ln: 17, code: "      </div>" },
    ] },
  { kind: "run", status: "done", verb: "Typecheck", target: "tsc --noEmit", meta: "passed" },
];

// The conversation for the rename session
const RENAME_CONVO = [
  { role: "user", time: "9:48", blocks: [{ kind: "text",
    html: "In <code>src/shell/Sidebar.tsx</code>, change the sidebar heading from “Hearth” to “Hearth 🔥”. Just that one line." }] },
  { role: "hearth", time: "9:48", blocks: [
    { kind: "trace", steps: RENAME_TRACE, elapsed: "6s",
      result: { text: "Changed the heading on line 16 — one line touched, nothing else.", file: "Sidebar.tsx", add: 1, del: 1 } },
    { kind: "approve",
      title: "Apply edit and hot-reload Hearth?",
      cmd: "hearth self apply --session s-rename --reload",
      why: "Rewrites one line in Hearth's own sidebar and reloads the renderer.",
      scope: "Sandbox: hearth repo · reversible" },
  ] },
];

const CONVERSATIONS = { "s-rename": RENAME_CONVO, "s-palette": CONVERSATION };

// Per-session Workbench data so the panel never contradicts the chat
const RENAME_DIFF = [{
  file: "src/shell/Sidebar.tsx", tag: "modified", add: 1, del: 1,
  rows: [
    { t: "hunk", ln: "", code: "@@ -14,5 +14,5 @@ export function Sidebar() {" },
    { t: "ctx", ln: 14, code: "    <aside className=\"rail\">" },
    { t: "ctx", ln: 15, code: "      <div className=\"rail-brand\">" },
    { t: "del", ln: 16, code: "        <span>Hearth</span>" },
    { t: "add", ln: 16, code: "        <span>Hearth 🔥</span>" },
    { t: "ctx", ln: 17, code: "      </div>" },
  ],
}];
const SESSION_DATA = {
  "s-rename": {
    branch: "evolve/sidebar-heading", add: 1, del: 1,
    diffs: RENAME_DIFF,
    selfFiles: [{ f: "src/shell/Sidebar.tsx", t: "the sidebar heading copy", tag: "m", ic: "pencil-simple" }],
    applyLabel: "Apply & hot-reload Hearth",
    plan: [
      { state: "done", t: "Locate the heading line", s: "grep \"Hearth\" in src/shell" },
      { state: "done", t: "Edit Sidebar.tsx", s: "Hearth → Hearth 🔥, line 16" },
      { state: "now",  t: "Apply & hot-reload", s: "awaiting your approval" },
    ],
    terminal: [
      { c: "pfx", t: "hearth ▸ " }, { t: "self apply --session s-rename --reload" },
      { t: "" },
      { cls: "dim", t: "  patching src/shell/Sidebar.tsx (1 hunk)…" },
      { cls: "ok", t: "  ✓ applied · 1 file, +1 −1" },
      { cls: "dim", t: "  reloading renderer…" },
      { cls: "ok", t: "  ✓ Hearth reloaded in 0.4s" },
      { t: "" },
      { c: "pfx", t: "hearth ▸ ", cursor: true },
    ],
  },
  "s-palette": {
    branch: "evolve/command-palette", add: 128, del: 4,
    diffs: DIFFS,
    selfFiles: [
      { f: "src/CommandPalette.jsx", t: "new file · the palette UI + fuzzy index", tag: "a", ic: "file-plus" },
      { f: "hearth-shell.jsx", t: "registers the ⌘K global shortcut", tag: "m", ic: "pencil-simple" },
      { f: "hearth-app.jsx", t: "passes routes + skills into the palette", tag: "m", ic: "pencil-simple" },
    ],
    applyLabel: "Apply & hot-reload Hearth",
    plan: PLAN,
  },
};

Object.assign(window, {
  BACKENDS, WORKSPACES, RECENTS, SKILLS, CONVERSATION, CONVERSATIONS, DIFFS, FILE_TREE, TERMINAL, PLAN,
  RENAME_TRACE, SESSION_DATA,
});
