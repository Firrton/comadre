// Placeholder brand glyphs. Each is sized to be replaced by generated
// hand-drawn illustrations (docs/BRANDING.md poses) without layout changes.

function GlyphCircle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-12 w-12 items-center justify-center rounded-full ${className}`}
    >
      {children}
    </span>
  );
}

export function EnvelopeGlyph() {
  return (
    <GlyphCircle className="bg-miel/30">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="6" width="18" height="13" rx="2" stroke="#d49a4a" strokeWidth="2" />
        <path d="M4 8l8 6 8-6" stroke="#d49a4a" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </GlyphCircle>
  );
}

export function SproutGlyph() {
  return (
    <GlyphCircle className="bg-nopal/25">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 21v-8" stroke="#7c8c4f" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6Z" stroke="#7c8c4f" strokeWidth="2" />
        <path d="M12 11c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z" stroke="#7c8c4f" strokeWidth="2" />
      </svg>
    </GlyphCircle>
  );
}

export function CoinsGlyph() {
  return (
    <GlyphCircle className="bg-barro/20">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="9" r="5" stroke="#a86b3c" strokeWidth="2" />
        <circle cx="15" cy="15" r="5" stroke="#a86b3c" strokeWidth="2" />
      </svg>
    </GlyphCircle>
  );
}

export function PlantPotGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="plant-sway"
      width="120"
      height="140"
      viewBox="0 0 120 140"
      fill="none"
    >
      <path d="M60 92V52" stroke="#43542a" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M60 60c0-16 12-24 28-24 0 16-12 24-28 24Z"
        fill="#7c8c4f"
        stroke="#43542a"
        strokeWidth="3"
      />
      <path
        d="M60 52c0-12-10-20-24-20 0 12 10 20 24 20Z"
        fill="#7c8c4f"
        stroke="#43542a"
        strokeWidth="3"
      />
      <path
        d="M34 92h52l-6 38a8 8 0 0 1-8 7H48a8 8 0 0 1-8-7l-6-38Z"
        fill="#a86b3c"
        stroke="#43542a"
        strokeWidth="3"
      />
      <path d="M30 92h60" stroke="#43542a" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
