# Comadre Landing Enrichment — Design

**Date:** 2026-06-11
**Status:** Approved (user, auto mode; direction and motion chosen via visual companion)
**Builds on:** `2026-06-11-landing-page-design.md` (base landing, shipped)

## Goal

Fill out the lower half of the landing so it feels fuller and more trustworthy, following the "living product" direction: the page demonstrates Comadre working instead of describing it. Motion style: chats that type themselves.

## Decisions made during brainstorming

- **Direction:** "Producto vivo" (option C) — more product demonstration, chosen over trust-FAQ and character-spotlight directions.
- **Motion:** self-typing chats (option A) — chosen over scroll reveals and ambient micro-animations.
- **Implementation constraint:** pure CSS animation, zero client-side JavaScript, `prefers-reduced-motion` honored (animations disabled, final state shown).
- **Real WhatsApp demo screenshots stay out** (show "Twilio" + crypto links; violate brand rule of hiding the crypto layer). HTML mockups instead.

## Page structure after this change

1. **Hero** — unchanged.
2. **Qué hace (dark band)** — same three cards; each gains an illustration slot (placeholder until brand art is generated).
3. **Mira cómo funciona** 🆕 — replaces the single chat mockup. Three conversations side by side (stacked on mobile), each self-typing in an infinite loop with staggered timing and a typing indicator:
   - 💸 Mandar plata: "Mándale $20 a mi mamá" → confirm → "Listo, ya lo mandé"
   - 🌱 El guardadito: "Guárdame $10 por semana" → "Anotado, mija" → "Esta semana ahorraste $50"
   - 🤝 La tanda: "Arma una tanda con mis primas" → "¿Cuántas son y cuánto ponen?" → "¡Que la tanda comience!"
4. **Cómo empezar** 🆕 — three numbered steps: save the number and write, Tía Vera greets you, done — send/save/organize from the chat.
5. **El guardadito** 🆕 — savings-as-care section: swaying plant illustration (CSS placeholder), copy "Cada semana, Comadre aparta lo que tú le digas", product quote "Anotado. Esta semana ahorraste $50."
6. **Cómo funciona una tanda** — existing tandas-visual.png moves below the guardadito section as the educational close.
7. **Cierre + CTA, Footer** — unchanged.

## Brand imagery to generate (recommendations, not blockers)

Same hand-drawn style as the existing avatar/hero art: imperfect outlines, Tía Vera palette, papel background. Poses from BRANDING.md:

| Image | Used in | Pose source |
|---|---|---|
| Tía Vera with envelope | "Manda y recibe" card + money chat | Sobre |
| Tía Vera with small plant | "Ahorra de a poquito" card | Plantita |
| Tía Vera with coins | "Organiza tu tanda" card + tanda chat | Monedas |
| Tía Vera waving | "Cómo empezar" step 2 | Saluda |
| Potted plant alone, 3 growth stages | "El guardadito" centerpiece | Plantita (object only) |

Until generated, sections use dignified CSS/SVG placeholders in brand colors sized to the final art so swapping requires no layout change.

## Technical

- All new sections are server components in `apps/web/app/page.tsx`; if the file grows unwieldy, extract section components under `apps/web/app/(sections)/` or a `components/` folder — single-purpose files.
- Chat animation: CSS keyframes (opacity/transform pop-in per bubble + bouncing-dots typing indicator), staggered `animation-delay`, infinite loop via a long cycle; all inside `globals.css` or a colocated CSS module.
- `@media (prefers-reduced-motion: reduce)`: all bubbles visible immediately, no animation.
- No new dependencies. No client components. No JavaScript.
- Accessibility: each chat column keeps the `role="img"` + `aria-label` pattern from the current mockup; animation is purely decorative.

## Out of scope

- Generating the brand images themselves (separate task; placeholders ship first).
- Waitlist, FAQ, admin, testimonials.
- Any change to `/privacy`, `/o/[token]`, hero, or footer.

## Testing / verification

- `pnpm --filter @comadre/web typecheck` and production build pass (build run with the dev server stopped — shared `.next` corrupts otherwise).
- Both routes HTTP 200; screenshot review of full page desktop + 375px mobile width.
- Reduced-motion render verified (emulate via Chrome flag or CSS check).
