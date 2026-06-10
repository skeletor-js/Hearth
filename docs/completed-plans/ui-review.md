# Hearth — Visual Design Review

Method: drove the **live running app** via the loopback bridge (`.hearth/bridge-url`,
the same mechanism `scripts/view-app.mjs` uses) — real-window screenshots **and**
live `getComputedStyle` reads, across `/ /new /chat /search /history /settings` in
**both themes**, plus forced interaction states (composer focus, backend popover,
git/env panel, command palette, right panel). Computed-style reads let me verify
exact token values and WCAG ratios on the running app, not from source guesses.

Rulers: `docs/design/Hearth.html` and `src/styles/hearth.css` (the `--t-*` scale,
semantic colors, accent `#C8542B`, `--shadow-sm/md/lg`). Core question: does the live
app honor its own system, or drift?

Screenshots referenced below live in `.hearth/review/*.png` (e.g. `light-new.png`,
`dark-chat.png`, `light-backend-pop.png`, `light-gitpanel.png`, `light-cmdk.png`).

---

## ✅ Implementation status — all findings shipped (2026-06-01)

Implemented in four per-phase `Hearth-SelfMod` commits (revertable from the in-app
History view). Each phase passed typecheck + lint + build + 217 tests; color findings
were re-measured live (WCAG ratios below).

| Finding | Status | Phase |
|---|---|---|
| F1 hover too faint | ✅ Done | P3 |
| F1b no hover transition | ✅ Done | P2 |
| F2 light `--subtle` < AA | ✅ Done | P1 |
| F3 `--faint`/accent-as-text | ✅ Done (faint is meta → ≥3:1; added `--accent-text` ≥4.5) | P1 |
| F8 composer no auto-grow | ✅ Done | P3 |
| F9 dead `data-ph` CSS | ✅ Done | P1 |
| F10 "Self-edit on" affordance | ✅ Done (restyled as passive status badge; a real toggle has no backing state) | P3 |
| F11 GitPanel inputs → `.field` | ✅ Done | P1 |
| F16 hero ad-hoc vs dead `.hero` | ✅ Done (adopted `.hero`/`.hero-grid`) | P4 |
| F17 orphaned 3rd starter | ✅ Done (added 4th → 2×2) | P4 |
| F18 hero-card vs card-row hover | ✅ Already consistent (no-op; confirmed) | P4 |
| F19 first section spacing | ✅ Done (`SecLabel`) | P2 |
| F20 settings `11.5` literal | ✅ Done | P1 |
| F21 chip height inline ×3 | ✅ Done (`.chip-sm`) | P2 |
| F22 search `18` literal | ✅ Done | P1 |
| F23 theme toggle hidden | ✅ Done | P3 |
| F-composer-focus weak ring | ✅ Done | P3 |
| F-trace dead `.run-line` | ✅ Done (deleted) | P1 |
| S1 mono token | ✅ Done (`--t-11_5`) | P1 |
| S2 off-scale inline fonts | ✅ Done | P1 |
| S3 radius scale | ◧ Done (structural radii tokenized; one-off 6/9/10/12/13px left literal by design) | P2 |
| S4 hover-transition + primitives | ✅ Done (transition, `Seg` icons, `SecLabel`, `.chip-sm`) | P2 |
| S5 dead CSS | ✅ Done (removed `data-ph`/`.rail-toggle`/`.rail-mark`/`.run-line`; kept `.hero`/`.hero-grid`, now adopted in P4) | P1 |
| S6 light-ramp contrast | ✅ Done (subtle/faint/border strengthened) | P1+P2 |

**Final measured contrast (light / dark), AA target 4.5 for text:**

| Pair | Before (light) | After (light) | After (dark) |
|---|---|---|---|
| `--subtle` / bg | 3.59 ✗ | **5.03** ✓ | **4.98** ✓ |
| `--subtle` / panel | 3.71 ✗ | **5.20** ✓ | **4.62** ✓ |
| `--subtle` / inset | 3.40 ✗ | **4.78** ✓ | **4.79** ✓ |
| `--accent-text` / bg | 4.27 ✗ | **5.43** ✓ | **5.46** ✓ |
| `--accent-text` / panel | 4.41 ✗ | **5.61** ✓ | **5.07** ✓ |
| `--faint` / bg (meta, ≥3) | 2.37 | **3.54** | **3.77** |

### Implementation log

- **P1 — token & contrast fidelity** (`a4c7e8d`). hearth.css (`--subtle`→#726C62,
  `--faint`→#8C8579, per-theme `--accent-text`, `--t-11_5`, dead-CSS removal, accent-text
  routing); FilesTab, ScratchpadTab, ReviewTab, SelfTab, GitPanel(`.field`), search,
  settings, Mascot, Onboarding. WCAG re-measured: `--subtle`/`--accent-text` clear AA both themes.
- **P2 — systemic primitives** (`c32e536`). hearth.css (radius scale + migration, shared
  hover transition, `.chip-sm`, light `--border`/`--border-strong`); controls.tsx
  (`Seg` icons, `SecLabel`); settings.tsx (`SecLabel`); Composer.tsx (`Seg`); History.tsx (`.chip-sm`).
- **P3 — motion & interaction** (`253bff8`). hearth.css (`--hover` light 0.055/dark 0.06,
  dark `--selected` 0.10, composer focus ring, rail-foot toggle `--default`); Composer.tsx
  (auto-grow 46→200→46, Self-edit status badge). Behaviors verified live.
- **P4 — hero restructure** (`e400a68`). new.tsx (adopt `.hero`/`.hero-grid`, 4th starter → 2×2).

---

## Summary

**Polish score: 7 / 10 — "premium in a screenshot, not yet premium in the hand."**
_(Original review below, preserved as the spec. All findings now implemented — see status table above.)_

This is a genuinely well-built system, and credit where due: the CSS is disciplined
(tokenized type scale, semantic colors, correct `--shadow-*` tiers — `sm` on resting
cards, `md` on the composer, `lg` on popovers), there are real shared primitives
(`Seg`/`Switch`/`SetRow`/`.btn`/`.chip`), both themes are fully wired, and empty
states exist on every surface I checked. The floating-card frame reads as intentional
and calm. Most "design systems" drift far worse than this one.

The drift is at the **edges**, and it's exactly the set of things that separate
*looks* premium from *feels* premium:

1. **Hover is nearly invisible.** `--hover` is `rgba(40,32,20,0.035)` — **3.5% opacity**
   in light. Rail items, quiet buttons, panel toggles, file rows all depend on it, and
   it's so faint the whole app feels slightly dead-to-the-touch. Most of these hovers
   also have **no transition**, so the little that does change snaps.
2. **Light-theme secondary text fails WCAG AA.** `--subtle` on `--bg` is **3.59:1**
   live (AA needs 4.5 for the 12–13px text it's used on) — but **4.54:1 in dark**.
   The body of subtitles, metadata, and helper text is sub-AA in light only. Textbook
   "drift shows in one theme."
3. **The composer doesn't grow.** It's a `rows={1}` textarea with `resize:none` and a
   fixed `min-height` — type a paragraph and it scrolls inside ~46px instead of
   expanding. Every premium agent composer auto-grows.
4. **Token drift in components.** A scatter of off-scale inline font sizes (`12.5`,
   `11`, `18`, `28` as raw numbers), un-tokenized radii, and one panel (`GitPanel`)
   reusing `.composer-input` for bordered inputs instead of the `.field` primitive.
5. **The hero is built ad-hoc** while a complete `.hero/.hero-grid` layout sits **dead**
   in the CSS, and three starter cards in a two-column grid orphan the third.

How far from the handoff? **Not far structurally** — the ported token system is intact
and mostly honored. The gap is craft-depth (interaction feedback, motion, optical
legibility) plus a thin layer of component-level token drift. Fix the five above and
this jumps to a 9.

**5 highest-leverage fixes:** F1 (hover feedback), F2 (light `--subtle` contrast),
F8 (composer auto-grow), F11+F12+F13 (token-drift cluster), F16 (hero layout / retire
dead `.hero` CSS).

---

## Per-surface findings

### Cross-cutting color & interaction (affect every route)

#### F1 — Hover feedback is effectively invisible · **Major**
- **Element:** every hover-able surface — `.rail-item`, `.btn-quiet`, `.pbtn`,
  `.ricon`, `.ftree-row`, `.foot-settings`, `.wb-tab`, `.more-item`.
- **Screenshot:** seen across all (`light-chat.png`, `light-new.png`). Hover can't be
  forced via scripted events (real-pointer-only), so measured from tokens.
- **What's wrong:** `--hover` resolves live to `rgba(40,32,20,0.035)` (light, **3.5%**)
  and `rgba(255,248,235,0.045)` (dark, **4.5%**). On the warm-paper bg this is below
  the threshold of perception. Pointing at a rail item barely registers.
- **Why it breaks the system:** the rail/buttons are the primary navigation surface;
  if hover doesn't respond, the whole app feels unresponsive regardless of how clean
  the resting state is. This is the #1 thing keeping it off "premium."
- **Code:** `src/styles/hearth.css:47` (light `--hover`), `:71` (dark `--hover`).
- **Fix:**
  - `--hover: rgba(40,32,20,0.035)` → `rgba(40,32,20,0.055)` (light, ~5.5%)
  - dark `--hover: rgba(255,248,235,0.045)` → `rgba(255,248,235,0.07)`
  - Pair with F1b (transition) below.

#### F1b — Hover/selection changes have no transition · **Minor**
- **Element:** `.rail-item`, `.btn`, `.pbtn`, `.foot-settings`, `.wb-tab`, `.card-row`.
- **What's wrong:** background changes on hover are instant. Only a few elements
  transition (`.resizer` `.15s`, `.composer` border `.15s`, `.rail-group-label .ph-thin`
  opacity `.15s`). Combined with the near-zero `--hover`, the little movement that
  exists snaps in.
- **Code:** `src/styles/hearth.css:164-175` (`.rail-item`), `:464-467` (`.btn`),
  `:258-260` (`.pbtn`).
- **Fix:** add `transition: background .12s ease, color .12s ease;` to `.rail-item`,
  `.btn`, `.btn-icon`, `.pbtn`, `.ricon`, `.foot-settings`, `.wb-tab`, `.ftree-row`,
  `.more-item`, `.card-row`. (One shared declaration; see Systemic S2.)

#### F2 — Light-theme `--subtle` text fails WCAG AA · **Major**
- **Element:** `.screen-sub`, `.set-h`, `.pi-sub`, `.cr-sub`, `.msg-role`, `.sec-label`
  text, `.ts-head .ts-sum` — all secondary text.
- **Screenshot:** `light-settings.png` (subtitles), `light-new.png` (card subs).
- **What's wrong:** measured live, `--subtle` (`#8A847B`) on `--bg` (`#FCFBFA`) =
  **3.59:1**; on `--bg-panel` = **3.71:1**; on `--bg-inset` = **3.40:1**. AA for the
  12–13px text it's applied to needs **4.5:1**. In **dark** the same token is
  **4.54:1** (passes), so this is a light-only legibility regression.
- **Why it breaks the system:** secondary text is half the words on Settings/New/
  History. Sub-AA in one theme is a real accessibility + polish defect and a
  theme-parity break.
- **Code:** `src/styles/hearth.css:43` (`--subtle:#8A847B`).
- **Fix:** darken light `--subtle` to **`#726C62`** (≈4.6:1 on `--bg`, ≈4.7:1 on panel).
  Leave dark `--subtle` (`#877F73`) as-is. Re-check `--faint` users that are real
  content (F3).

#### F3 — `--faint` and `--accent`-as-text are below AA · **Minor**
- **Element:** `--faint` → timestamps (`.msg-role .time`), `kbd`, `.ri-end`,
  `.crumbs .sep`, placeholders. `--accent` as text → `.chip-accent` label (12px),
  `.md-preview a`, selected-item accents.
- **What's wrong (live):** `--faint`/bg = **2.37:1** light / **2.79:1** dark.
  `--accent`/bg = **4.27:1** light / **4.06:1** dark, `--accent`/panel = **4.41 / 3.77**
  — all just under the 4.5 needed for the small accent text in `.chip-accent`.
- **Why it matters:** `--faint` is mostly decorative (acceptable), but timestamps and
  `kbd` are content. Accent text at 12px is borderline in both themes.
- **Code:** `hearth.css:45/68` (`--faint`), `:22` (`--accent`), `:484` (`.chip-accent`).
- **Fix:** (a) bump light `--faint` to `#9A9388` (≈3.0:1) for content uses; (b) introduce
  a dedicated **`--accent-text`** token a notch darker than the icon/fill accent —
  e.g. `#B0461F` (≈5.2:1 light) — and use it for `.chip-accent` label, `.md-preview a`,
  `.sresult mark`; keep `#C8542B` for icons/fills/large.

---

### `/new` — New-session hero

Screenshots: `light-new.png`, `dark-new.png`.

#### F16 — Hero is rebuilt ad-hoc; a full `.hero` layout sits dead in the CSS · **Major**
- **Element:** the "What are we building?" block.
- **What's wrong:** `src/routes/new.tsx:45-69` builds the hero from `.screen-inner` +
  inline `display:flex; flexDirection:column; alignItems:center; marginBottom` (line 48)
  and overrides `.screen-title` to `fontSize: var(--t-28)` inline (line 52). Meanwhile
  `hearth.css:618-623` defines a complete `.hero / .hero h1 / .hero p / .hero-grid`
  system — **0 usages** in any `.tsx`. The ruler has the hero; the app reimplements it.
- **Why it breaks the system:** two sources of truth for the same screen; the inline
  copy will drift from the handoff's intended hero spacing/centering.
- **Code:** `src/routes/new.tsx:45-58`; dead CSS `src/styles/hearth.css:618-623`.
- **Fix:** either (a) render `<div className="hero">…<div className="hero-grid">` and
  delete the inline styles (use the system), or (b) delete the dead `.hero/.hero-grid`
  CSS and keep `.screen`-based layout — but then move the `--t-28` size into a class,
  not an inline override. Pick one; don't keep both.

#### F17 — Three starters in a two-column grid orphan the third card · **Major**
- **Element:** "Evolve Hearth / Work in a folder / Explore an idea".
- **Screenshot:** `light-new.png` — "Explore an idea" sits alone on row 2, big empty gap
  to its right.
- **What's wrong:** `STARTERS` has 3 items (`new.tsx:11-15`) in `.tile-grid`
  (`grid-template-columns:repeat(2,…)`, `hearth.css:698`). Odd count → lonely card.
- **Why it breaks the system:** asymmetry reads as unfinished; it's the first screen a
  new user sees.
- **Code:** `src/routes/new.tsx:11-15,60`.
- **Fix:** either add a 4th starter (e.g. "Continue last session") for a clean 2×2, or
  give the starter grid its own `grid-template-columns:repeat(3,1fr)` so three sit in a
  row, or center a 3-up row. 2×2 is the lowest-risk.

#### F18 — Two card vocabularies on one screen · **Minor**
- **Element:** hero starters use `.hero-card`; "Continue"/"Workspaces" use `.card-row`.
- **What's wrong:** same screen mixes a soft borderless tile (`.hero-card`) with a
  bordered row (`.card-row`). Defensible (different roles) but the visual languages
  aren't obviously related.
- **Code:** `new.tsx:62` (`.hero-card`) vs `:77,101` (`.card-row click`).
- **Fix:** unify hover treatment at minimum — `.hero-card:hover` and `.card-row.click:hover`
  should use the same border/bg delta so they feel like one family.

---

### `/chat` — Session (the primary surface)

Screenshots: `light-chat.png`, `dark-chat.png`, `light-composer-focus.png`,
`light-backend-pop.png`, `light-gitpanel.png`.

#### F8 — Composer textarea doesn't auto-grow · **Major**
- **Element:** `.composer-input`.
- **What's wrong:** it's `<textarea rows={1}>` (`Composer.tsx:172-179`) with
  `.composer-input { min-height:46px }` and global `textarea{resize:none}`
  (`hearth.css:93,446`). There's no `scrollHeight` auto-resize, so multi-line input
  scrolls inside a fixed ~46px box instead of expanding.
- **Why it breaks the system:** every reference-class agent composer (Linear, Codex,
  Claude) grows with content; a fixed one-liner feels cramped and untrustworthy for the
  long prompts this app is built around.
- **Code:** `src/app/chat/Composer.tsx:172-179`.
- **Fix:** on `onChange`, set `el.style.height='auto'; el.style.height=Math.min(el.scrollHeight, 200)+'px'`
  (cap ~200px, then internal scroll). Keep `min-height:46px` as the floor.

#### F9 — Dead placeholder CSS for a contenteditable that doesn't exist · **Nit**
- **What's wrong:** `hearth.css:649` `.composer-input[data-ph]:empty::before{content:attr(data-ph)}`
  targets a contenteditable placeholder pattern. The composer is a real `<textarea>`
  using native `placeholder` (`Composer.tsx:178`). **0** `data-ph` usages anywhere.
- **Code:** delete `src/styles/hearth.css:649`.

#### F10 — "Self-edit on" chip looks like a toggle but is inert · **Minor**
- **Element:** `.chip.chip-accent` "Self-edit on" in the composer.
- **Screenshot:** `light-chat.png` (between branch chip and backend chip).
- **What's wrong:** it's a non-interactive `<span>` (`Composer.tsx:160-162`) styled
  accent ("on") next to two real button-chips (branch, backend). The word "on" + accent
  treatment reads as a switch; clicking does nothing.
- **Why it breaks the system:** affordance lie — accent + "on" implies toggleable state.
- **Fix:** either make it a real toggle, or restyle as a passive status badge (drop the
  accent fill, use a neutral `.chip` with a small `flame` + "Self-edit" and no "on").

#### F11 — `GitPanel` inputs reuse `.composer-input` instead of the `.field` primitive · **Major**
- **Element:** commit-message + new-branch inputs in the git/env popover.
- **Screenshot:** `light-gitpanel.png` (the "new-branch-name" field).
- **What's wrong:** both inputs use `className="composer-input"` then override with inline
  `border:1px solid var(--border); borderRadius:7; padding:'7px 9px'`
  (`GitPanel.tsx:104-105,130-131`). `.composer-input` is the borderless chat textarea;
  a bordered form input is exactly what `.field` (`hearth.css:743-745`) is for — and
  `.field` uses `border-radius:8`, `height:32`, `border:var(--border-strong)`, focus ring.
- **Why it breaks the system:** reinvents `.field` inline, with a different radius (7 vs
  8) and weaker border, so the panel's inputs don't match Settings' inputs.
- **Code:** `src/app/workbench/GitPanel.tsx:103-109,129-135`.
- **Fix:** replace both with `className="field"` and drop the inline border/radius/padding.
  Add `flex:1` via a class or keep just that one inline.

#### F-composer-focus — Focus ring on the composer is too subtle · **Minor**
- **Element:** `.composer:focus-within`.
- **Screenshot:** `light-composer-focus.png` (border barely shifts vs resting
  `light-chat.png`).
- **What's wrong:** `:focus-within` sets border to `color-mix(in srgb, var(--accent) 55%,
  var(--border-strong))` (`hearth.css:443`) — measured live it lands ~`rgb(213,147,121)`,
  a muted salmon that barely separates from the resting `--border-strong`. The composer
  is the focal control; focus should be unambiguous.
- **Fix:** raise the mix to ~`70%` accent and/or add `box-shadow:0 0 0 3px var(--accent-soft)`
  on `:focus-within` (matches the `.pick.on` focus-ring idiom already in the system,
  `hearth.css:795`).

#### F-trace — Trace timeline is solid; verify running-state motion · **Nit**
- The tool-call trace (`.trace`, `dark-chat.png`) is well-tokenized and reads cleanly.
  Note the `.run-line` style block (`hearth.css:337-341`) is **dead** (0 usages — the
  live running indicator uses `.tspin`/`.trace-status.run`); fold it into Systemic S3.

---

### `/settings`

Screenshots: `light-settings.png`, `dark-settings.png`.

Strongest surface — built entirely on `SetRow`/`Seg`/`Switch`, consistent rhythm.

#### F19 — First section lacks the section spacing the others have · **Nit**
- **What's wrong:** "Account" renders its `.sec-label` directly (`settings.tsx:58-60`),
  while "Agent / Appearance / Personality / Memory" each wrap the label in an empty
  `<div className="sec">` (`:72-76, 103-107, 127-131, 150-154`) purely for the
  `.sec{margin-top:30px}`. So Account sits tighter under the subtitle than the inter-
  section gap elsewhere — uneven vertical rhythm.
- **Code:** `src/routes/settings.tsx:58-60`.
- **Fix:** wrap Account's label in `.sec` too (or, cleaner, make a `<SecLabel>` primitive
  that owns its own top margin — see Systemic S4).

#### F20 — `fontSize: 11.5` raw literal on the memory `<pre>` · **Nit**
- **Code:** `settings.tsx:161` → use the mono token from Systemic S1.

---

### `/history`

Screenshots: `light-history.png`, `dark-history.png`.

Clean. Undone entries get a proper dashed/hatched `.evo-undone` treatment with
strikethrough; empty state reuses `.wb-empty`. Good.

#### F21 — Chip height overridden inline in three places · **Minor**
- **Element:** "Undone" / "Applied" / "N parallel edits" badges.
- **What's wrong:** `.chip` is `height:22` by system; History forces `style={{height:18}}`
  inline at `History.tsx:108,112,201` to make them look like small badges.
- **Why it breaks the system:** a magic `18` repeated inline is exactly the kind of
  un-tokenized one-off that accumulates.
- **Fix:** add a `.chip-sm{ height:18px; font-size:11px; padding:0 7px }` variant to
  `hearth.css` and use `className="chip chip-sm"`. Reuse anywhere small badges recur.

---

### `/search`

Screenshot: `light-search.png`, `dark-history.png` (rail in dark).

Clean: accent focus ring on `.search-field`, `All sessions / Hearth` `Seg`, result cards.

#### F22 — `fontSize: 18` raw literal in search · **Nit**
- **Code:** `src/routes/search.tsx:35` → `fontSize: 'var(--t-18)'`.

---

### Rail (all routes)

#### F23 — Theme toggle is real but nearly undiscoverable · **Minor**
- **Element:** the `.ricon` crescent-moon/​sun in the rail footer
  (`Rail.tsx:119-121`).
- **Screenshot:** `light-search.png` — bottom-left, a faint icon right of "Settings".
- **What's wrong:** it works (toggles `theme`), but it's `color:var(--subtle)` with the
  same near-zero `--hover`, so it disappears next to the Settings label. Theme is also
  controllable from Settings and cmdk, so this is a redundant-but-hidden control.
- **Fix:** lift resting color to `--default`, give it a tooltip-backed hover (covered by
  F1/F1b), or drop it in favor of the Settings/cmdk paths. Low priority.

---

## Systemic issues (fix once at the root)

#### S1 — No token for the "dense mono" size (`11.5`) · the most common off-scale value
The `--t-*` scale stops at `11`; the system's dense mono text is **11.5px** and appears
as a raw literal in CSS (`.ts-sum b`, `.diff`, `.tstep-line .ttarget`, `.term`…) **and**
inline in components (`GitPanel.tsx:74,93`, `SelfTab.tsx:50`, `settings.tsx:161`).
**Fix:** add `--t-11_5: 11.5px;` (or rename the intent: `--t-mono: 11.5px`) to
`hearth.css:12-13` and replace the literals. This alone resolves most of the "off-scale
font" findings.

#### S2 — Off-scale inline font sizes scattered through components
Beyond 11.5: `fontSize:12.5` (`FilesTab.tsx:119`, `ScratchpadTab.tsx:148`),
`fontSize:11` (`Onboarding.tsx:108`, `ReviewTab.tsx:99`), `fontSize:18`
(`search.tsx:35`), `fontSize:28` (`SelfTab.tsx:87`), `fontSize:14` (`Mascot.tsx:62`).
`12.5` isn't anywhere in the scale (use `--t-12` or `--t-13`); the rest map cleanly to
existing tokens. **Fix:** sweep `grep -rnoE "fontSize: ?[0-9.]+" src` and route each to a
`--t-*`. (Intentional exception: `CrashSurface.tsx` — it must render without the design
system, so its hardcoded px/hex are correct; leave it.)

#### S3 — No radius scale; radii are literal px everywhere
The system uses `14 / 13 / 11 / 9 / 8 / 7 / 6 / 5` px radii as literals in CSS and inline
(`GitPanel.tsx:105,131` `borderRadius:7`). There are **no `--radius-*` tokens**, so radii
drift (e.g. GitPanel's 7 vs `.field`'s 8 for the same kind of input).
**Fix:** add `--r-card:14px; --r-pop:11px; --r-ctl:8px; --r-chip:7px; --r-pill:999px`
to `:root` and migrate. This also makes the "card vs control vs chip" hierarchy explicit.

#### S4 — Shared hover transition + a couple of missing primitives
- Add one hover-transition declaration (F1b) applied to the interactive-row/button
  classes rather than per-element.
- `Seg` (`controls.tsx:3`) can't render icons, so the **composer reimplements** the
  segmented control inline (`Composer.tsx:181-188`). Extend `Seg` to accept an optional
  icon per option and delete the inline copy.
- Introduce `<SecLabel>` (owns its `margin-top`) to kill the empty `<div className="sec">`
  label-wrappers in Settings (F19) and the inconsistent first-section spacing.
- Add `.chip-sm` variant (F21).

#### S5 — Dead CSS to retire (a full layout system among it)
Confirmed **0 usages** in any `.tsx`: `.hero`, `.hero h1`, `.hero p`, `.hero-grid`
(`hearth.css:618-623`), `.composer-input[data-ph]…` (`:649`), `.rail-toggle`
(`:147-149`), `.rail-mark` (`:150-152`), `.run-line` (`:337-341`).
**Fix:** either adopt `.hero/.hero-grid` in `new.tsx` (preferred — it's the handoff's
hero, see F16) or delete it; delete the other four outright.

#### S6 — Theme parity: light is the weaker theme
Light `--subtle` (F2) fails AA where dark passes; light `--faint` and light card
`--border` (`#F0EDE7`, very low delta from `--bg`) are both fainter than their dark
counterparts relative to their backgrounds. The floating-card frame leans on
`border + shadow-sm`; in light the borders nearly vanish and only the shadow separates
cards. **Fix:** as part of F2/F3, audit the light ramp for a consistent ~1 step more
contrast across `--subtle/--faint/--border`.

---

## Phased plan

**P1 — Token/fidelity quick wins (low effort, high ratio).** Mechanical, low-risk.
- F2 (light `--subtle` → `#726C62`), F3 (`--faint` bump + `--accent-text` token)
- S1 (`--t-11_5`/mono token) + S2 (sweep off-scale inline fonts) → resolves F20, F22 and
  the FilesTab/ReviewTab/SelfTab/Onboarding literals
- F9, S5 (delete dead CSS; decide hero adoption with F16)
- F11 (GitPanel → `.field`)

**P2 — Systemic (missing tokens & shared primitives).**
- S3 (radius scale) + migrate inline `borderRadius`
- S4 (shared hover transition; `Seg` icons → delete composer inline seg; `<SecLabel>`;
  `.chip-sm`) → resolves F1b, F19, F21
- S6 (light-ramp contrast audit)

**P3 — Motion & interaction polish.**
- F1 (raise `--hover`) — pair with F1b from P2
- F8 (composer auto-grow)
- F-composer-focus (stronger focus ring), F10 (Self-edit chip affordance)
- F23 (theme-toggle discoverability)

**P4 — Higher-effort restructures.**
- F16 (commit to one hero implementation — adopt `.hero/.hero-grid` and delete inline
  layout) + F17 (fix the orphaned third starter, ideally 2×2) + F18 (unify card hover)
- Optional: a `Field`/`Input` React primitive so panels never reach for
  `.composer-input` again (root cause of F11).

---

### Notes on coverage / what I could not force
- **True `:hover`** can't be triggered by scripted events (real-pointer only), so F1/F1b
  are assessed from exact token values + the absence of transitions in source, not a
  hover screenshot. A real-pointer pass (computer-use, which dropped mid-session) would
  confirm visually but wouldn't change the numbers.
- **Verified, not assumed:** cmdk **does** close on Escape (handler on the input's
  `onKeyDown`, `CommandPalette.tsx:97,122`) — flagged-then-cleared. `TerminalTab`'s
  hardcoded hex are **fallbacks** behind `getComputedStyle` var reads + re-theme on flip
  (`TerminalTab.tsx:8-17,74-76`) — **not** drift; not flagged.
- Shadows are used at the correct tiers throughout; no `--shadow-*` misuse found.
- Empty states present on rail, history, settings; the composer busy/stop state and
  trace spinners cover loading. No dedicated skeletons on search/history list load
  (acceptable for a local app; out of scope to flag as a defect).
