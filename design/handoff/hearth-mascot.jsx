// hearth-mascot.jsx — Hearth's flame identity.
// Brand mark uses the Phosphor flame glyph; the signature flourish is a
// small animated ASCII ember (Hearth's own take on a living ASCII creature).

const FlameMark = ({ size = 19, fill = true, className = "", style }) => (
  <i className={`ph-${fill ? "fill" : "thin"} ph-flame ${className}`}
     style={{ fontSize: size, ...(style || {}) }} />
);

// ── Animated ASCII ember ──────────────────────────────────────────────
// Flame tongues flicker over a glowing ember bed. Frames keep equal width
// so the column doesn't jump. Driven by a single interval.
const EMBER_FRAMES = [
  [" (   ", "  ) )", " ( ( )", "( ) ) "],
  ["  )  ", " ( ( ", ") ) ( ", " ( ) )"],
  [" ( ) ", "  ) ( ", " ( ) )", ") ( ) "],
  ["  (  ", " ) ) (", "( ( ) ", " ) ( )"],
];

function AsciiEmber({ fontSize = 15, paused = false, className = "" }) {
  const [f, setF] = React.useState(0);
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setF((v) => (v + 1) % EMBER_FRAMES.length), 220);
    return () => clearInterval(id);
  }, [paused]);
  const frame = EMBER_FRAMES[f];
  return (
    <div className={`ember ${className}`} style={{ fontSize, lineHeight: 1.0 }} aria-hidden="true">
      <div className="glow">
        {frame.map((row, i) => (
          <div key={i} style={{ opacity: 0.55 + i * 0.15 }}>{row}</div>
        ))}
        <div style={{ opacity: 0.85, letterSpacing: "1px" }}>≋≋≋≋≋</div>
      </div>
    </div>
  );
}

// Inline "thinking" flame — a flickering flame glyph + label.
function ThinkingEmber({ label = "Hearth is thinking" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7,
                   fontSize: "var(--t-12)", color: "var(--subtle)" }}>
      <i className="ph-fill ph-flame thinking-flame"
         style={{ color: "var(--accent)", fontSize: 14 }} />
      <span>{label}</span>
      <span className="typing">
        <span></span><span></span><span></span>
      </span>
      <style>{`
        .thinking-flame{ animation: flicker 1.1s ease-in-out infinite; transform-origin:bottom center; }
        @keyframes flicker{
          0%,100%{ opacity:1; transform:scale(1) rotate(-1.5deg); }
          45%{ opacity:.7; transform:scale(.9) rotate(2deg); }
          70%{ opacity:.92; transform:scale(1.04) rotate(-1deg); }
        }
        .typing{ display:inline-flex;gap:3px;align-items:center; }
        .typing span{ width:4px;height:4px;border-radius:50%;background:var(--faint);
          animation: tb 1.2s infinite ease-in-out both; }
        .typing span:nth-child(2){ animation-delay:.15s; }
        .typing span:nth-child(3){ animation-delay:.3s; }
        @keyframes tb{ 0%,80%,100%{ transform:scale(.6);opacity:.4; } 40%{ transform:scale(1);opacity:1; } }
      `}</style>
    </span>
  );
}

Object.assign(window, { FlameMark, AsciiEmber, ThinkingEmber });
