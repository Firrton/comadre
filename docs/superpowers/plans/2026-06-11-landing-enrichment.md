# Landing Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the lower half of the Comadre landing with three self-typing chat demos, a 3-step getting-started section, and a savings ("guardadito") section — pure CSS animation, zero client JS.

**Architecture:** New server components `ChatDemo` (reusable self-typing chat card) and `glyphs` (SVG brand-art placeholders) under `apps/web/app/components/`; `page.tsx` composes them into new sections. All animation lives in `globals.css` as percentage-window keyframes over a 14s infinite cycle, disabled under `prefers-reduced-motion`.

**Tech Stack:** Next.js 15 app router (server components only), Tailwind CSS 3.4 with brand tokens (hoja/nopal/olivo/barro/miel/papel), CSS keyframes.

**Spec:** `docs/superpowers/specs/2026-06-11-landing-enrichment-design.md`

**Verification model:** This is static presentational markup with no test runner wired in `apps/web`; verification per task = `pnpm --filter @comadre/web typecheck`, route smoke (`curl`), and screenshot review. Production build runs once at the end **with the dev server stopped** (shared `.next` corrupts otherwise — learned incident).

---

### Task 1: Animation foundation in globals.css

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Append the animation CSS**

Append to `apps/web/app/globals.css`:

```css
/* --- Self-typing chat demos (14s cycle: type in ~7s, hold, fade, restart) --- */
.chat-bubble {
  opacity: 0;
}

.chat-b1 { animation: chat-pop-1 14s ease-out infinite; }
.chat-b2 { animation: chat-pop-2 14s ease-out infinite; }
.chat-b3 { animation: chat-pop-3 14s ease-out infinite; }
.chat-b4 { animation: chat-pop-4 14s ease-out infinite; }

@keyframes chat-pop-1 {
  0%, 5%   { opacity: 0; transform: translateY(8px); }
  8%, 93%  { opacity: 1; transform: none; }
  98%, 100% { opacity: 0; transform: translateY(8px); }
}
@keyframes chat-pop-2 {
  0%, 18%  { opacity: 0; transform: translateY(8px); }
  21%, 93% { opacity: 1; transform: none; }
  98%, 100% { opacity: 0; transform: translateY(8px); }
}
@keyframes chat-pop-3 {
  0%, 31%  { opacity: 0; transform: translateY(8px); }
  34%, 93% { opacity: 1; transform: none; }
  98%, 100% { opacity: 0; transform: translateY(8px); }
}
@keyframes chat-pop-4 {
  0%, 44%  { opacity: 0; transform: translateY(8px); }
  47%, 93% { opacity: 1; transform: none; }
  98%, 100% { opacity: 0; transform: translateY(8px); }
}

/* Typing status line: visible in the gaps before Comadre's replies */
.typing-line {
  opacity: 0;
  animation: typing-window 14s linear infinite;
}
@keyframes typing-window {
  0%, 8%   { opacity: 0; }
  10%, 18% { opacity: 1; }
  20%, 33% { opacity: 0; }
  35%, 43% { opacity: 1; }
  45%, 100% { opacity: 0; }
}
.typing-line i {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  display: inline-block;
  animation: typing-bounce 1s ease-in-out infinite;
}
.typing-line i:nth-child(2) { animation-delay: 0.15s; }
.typing-line i:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: none; }
  30% { transform: translateY(-3px); }
}

/* Guardadito plant sways gently */
.plant-sway {
  transform-origin: bottom center;
  animation: plant-sway 4s ease-in-out infinite alternate;
}
@keyframes plant-sway {
  from { transform: rotate(-3deg); }
  to   { transform: rotate(3deg); }
}

/* Reduced motion: everything rests in its final, fully-visible state */
@media (prefers-reduced-motion: reduce) {
  .chat-bubble { animation: none; opacity: 1; }
  .typing-line { animation: none; opacity: 0; }
  .typing-line i { animation: none; }
  .plant-sway { animation: none; }
}
```

- [ ] **Step 2: Verify the dev server still renders**

Run: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000`
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): CSS animation foundation for self-typing chats and plant sway"
```

---

### Task 2: ChatDemo component and placeholder glyphs

**Files:**
- Create: `apps/web/app/components/ChatDemo.tsx`
- Create: `apps/web/app/components/glyphs.tsx`

- [ ] **Step 1: Create `apps/web/app/components/ChatDemo.tsx`**

```tsx
type ChatMessage = {
  from: "user" | "comadre";
  text: string;
};

export function ChatDemo({
  emoji,
  title,
  ariaLabel,
  messages,
}: {
  emoji: string;
  title: string;
  ariaLabel: string;
  messages: ChatMessage[];
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="flex h-full flex-col rounded-2xl bg-olivo/10 p-5"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-olivo">
        <span aria-hidden="true">{emoji}</span> {title}
      </p>
      <div className="space-y-3">
        {messages.map((message, index) => (
          <p
            key={index}
            className={`chat-bubble chat-b${index + 1} w-fit max-w-[85%] rounded-2xl px-4 py-2 ${
              message.from === "user"
                ? "ml-auto rounded-br-sm bg-nopal text-papel"
                : "rounded-bl-sm bg-white"
            }`}
          >
            {message.text}
          </p>
        ))}
      </div>
      <p className="typing-line mt-auto flex items-center gap-1 pt-3 text-xs text-olivo">
        Comadre está escribiendo
        <i className="bg-barro" />
        <i className="bg-barro" />
        <i className="bg-barro" />
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/app/components/glyphs.tsx`**

These are dignified placeholders in brand colors, sized to be swapped 1:1 for
generated illustrations later (see spec, "Brand imagery to generate").

```tsx
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @comadre/web typecheck`
Expected: exits 0 (unused-export warnings do not exist in this config; tsc is silent)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ChatDemo.tsx apps/web/app/components/glyphs.tsx
git commit -m "feat(web): ChatDemo self-typing card and placeholder brand glyphs"
```

---

### Task 3: Compose the new sections in page.tsx

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Add imports at the top of `page.tsx`**

After the existing `Image`/`Link` imports add:

```tsx
import { ChatDemo } from "./components/ChatDemo";
import {
  CoinsGlyph,
  EnvelopeGlyph,
  PlantPotGlyph,
  SproutGlyph,
} from "./components/glyphs";
```

- [ ] **Step 2: Add glyphs to the three "Qué hace" cards**

In the dark band section, each card `<div>` gains its glyph above the `<h2>`. The three cards become:

```tsx
          <div>
            <EnvelopeGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">Manda y recibe</h2>
            <p className="mt-3 text-papel/80">
              Dile a quién y cuánto. Comadre confirma contigo antes de mover un
              solo peso.
            </p>
          </div>
          <div>
            <SproutGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">
              Ahorra de a poquito
            </h2>
            <p className="mt-3 text-papel/80">
              Tu ahorrito crece semana a semana, sin que tengas que pensarlo.
            </p>
          </div>
          <div>
            <CoinsGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">
              Organiza tu tanda
            </h2>
            <p className="mt-3 text-papel/80">
              Cada quien pone un poquito y una recibe el pozo. Las cuentas
              claras, sin enredos.
            </p>
          </div>
```

- [ ] **Step 3: Replace the single-chat "Así se siente" section with the three self-typing chats**

Delete the entire `{/* Así se siente */}` section and the `{/* Cómo funciona una tanda */}` section above it, and in their place insert:

```tsx
      {/* Mira cómo funciona */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-headline text-2xl">
            Mira cómo funciona
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-olivo">
            Tres cosas que le puedes pedir hoy, tal como se ven en tu WhatsApp.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <ChatDemo
              emoji="💸"
              title="Mandar plata"
              ariaLabel="Ejemplo: le pides a Comadre mandar $20 a tu mamá, ella confirma contigo y lo envía."
              messages={[
                { from: "user", text: "Comadre, mándale $20 a mi mamá" },
                { from: "comadre", text: "A ver, mija — ¿$20 para tu mamá, va?" },
                { from: "user", text: "Va 👍" },
                { from: "comadre", text: "Listo, ya lo mandé ✅" },
              ]}
            />
            <ChatDemo
              emoji="🌱"
              title="El guardadito"
              ariaLabel="Ejemplo: le pides a Comadre guardar $10 por semana y ella te avisa cuánto llevas ahorrado."
              messages={[
                { from: "user", text: "Guárdame $10 por semana" },
                { from: "comadre", text: "Anotado, mija. Yo me encargo 🌱" },
                { from: "user", text: "¿Cómo va mi ahorrito?" },
                { from: "comadre", text: "Esta semana ahorraste $50" },
              ]}
            />
            <ChatDemo
              emoji="🤝"
              title="La tanda"
              ariaLabel="Ejemplo: le pides a Comadre armar una tanda con tus primas y ella la organiza."
              messages={[
                { from: "user", text: "Arma una tanda con mis primas" },
                { from: "comadre", text: "¿Cuántas son y cuánto pone cada una?" },
                { from: "user", text: "Somos 4, $25 cada semana" },
                { from: "comadre", text: "¡Que la tanda comience! 🎉" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Cómo empezar */}
      <section className="bg-nopal/15 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center font-headline text-2xl">Cómo empezar</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                1
              </span>
              <p className="mt-4">
                Toca el botón y guarda el número de Comadre.
              </p>
            </li>
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                2
              </span>
              <p className="mt-4">Tía Vera te saluda y te conoce.</p>
            </li>
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                3
              </span>
              <p className="mt-4">
                Listo: manda, ahorra y organiza, todo desde el chat.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* El guardadito */}
      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <PlantPotGlyph />
          <h2 className="mt-6 font-headline text-2xl">El guardadito</h2>
          <p className="mt-4 max-w-xl text-olivo">
            Cada semana, Comadre aparta lo que tú le digas. Tu ahorrito crece
            de a poquito, sin que tengas que pensarlo.
          </p>
          <p className="mt-6 font-hand text-2xl text-barro">
            “Anotado. Esta semana ahorraste $50.”
          </p>
        </div>
      </section>

      {/* Cómo funciona una tanda */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <Image
            src="/brand/tandas-visual.png"
            alt="Cómo funciona una tanda: cuatro vecinas, un pozo, un turno por mes. Cada quien pone un poquito y una recibe el pozo."
            width={1766}
            height={1180}
            className="w-full rounded-2xl"
          />
        </div>
      </section>
```

Note the section order in the final file: Hero → Qué hace → Mira cómo funciona → Cómo empezar → El guardadito → Cómo funciona una tanda → Cierre → Footer. The old "Cierre" section changes its background from `bg-nopal/15` to plain (the `Cómo empezar` band now carries that tint); change the Cierre `<section>` class to `className="bg-hoja px-6 py-20 text-center text-papel"` and its inner headline keeps `font-display text-4xl italic`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @comadre/web typecheck`
Expected: exit 0

Run: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000`
Expected: `200`

Screenshot desktop (1280px) and mobile (375px) with headless Chrome; review: three chats side-by-side (desktop) / stacked (mobile), steps band, plant section, tanda visual at the bottom.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): living-product sections — self-typing chats, steps, guardadito"
```

---

### Task 4: Production build verification and docs

- [ ] **Step 1: Stop the dev server, build, restart**

```bash
pkill -f "next dev"; sleep 1
pnpm --filter @comadre/web build   # expected: exit 0, / static
pnpm --filter @comadre/web dev     # run in background
```

- [ ] **Step 2: Update docs**

- `docs/CHECKLIST.md` Fase 5: extend the landing entry with the enrichment (three animated chat demos, steps, guardadito).
- `docs/COMADRE.md` apps table: no change needed unless wording drifts.

- [ ] **Step 3: Commit**

```bash
git add docs/CHECKLIST.md
git commit -m "docs: record landing enrichment in checklist"
```

---

### Task 5: Adversarial review and fixes

- [ ] **Step 1: Fresh-context multi-perspective review** (Workflow: correctness/a11y-and-motion/brand-voice lenses over `git diff main..HEAD -- apps/web`), verify each finding, apply confirmed fixes, re-run typecheck + build, commit.
