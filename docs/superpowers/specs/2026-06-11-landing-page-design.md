# Comadre Landing Page — Design

**Date:** 2026-06-11
**Status:** Approved (user, auto mode)
**Scope:** Static presentation page + privacy policy page in `apps/web`, deployable to Vercel.

## Goal

A single-page landing that presents Comadre with the existing brand identity and funnels visitors to WhatsApp via a `wa.me` button. Plus a `/privacy` page required for Meta WhatsApp Business verification. No dashboard, no login, no client-side state.

## Context

- `apps/web` is an existing Next.js 15 app with a real onboarding flow (`/o/[token]`) and placeholder landing/admin pages.
- `apps/web` was missing from `pnpm-workspace.yaml` (added as part of this change).
- Tailwind is declared in `package.json` but not wired: no `tailwind.config`, no `postcss.config`, no global stylesheet. This change wires it.
- Brand identity is fully defined in `docs/BRANDING.md` (Tía Vera palette, typography, voice rules, base copy) with ready assets in `docs/assets/branding/` and demo screenshots in `docs/assets/demo/`.

## Page structure (`app/page.tsx`)

1. **Hero** — Papel `#eee8d2` background. Logo wordmark `Comadre.` (final dot in Barro `#a86b3c`). Headline "Tu dinero, en buenas manos." in Newsreader Italic. Subtitle "Como si te ayudara una vecina, no un banco." Tía Vera illustration (from `hero-banner.png` art). Primary CTA button in Nopal `#7c8c4f`: "Escribile a Comadre" → `https://wa.me/<number>?text=<greeting>`.
2. **Qué hace** — three simple cards: send money (Sobre), save little by little (Plantita), tandas (Monedas). Short, warm copy. No crypto jargon.
3. **Cómo se ve** — one WhatsApp demo screenshot (`whatsapp-tandas-demo.png` or `whatsapp-guardadito-demo.png`) showing the product is literally a chat.
4. **Cierre** — repeat WhatsApp CTA + manifesto line "De a poquito, todo se logra."
5. **Footer** — link to `/privacy`, nothing else.

## Privacy page (`app/privacy/page.tsx`)

Plain-text privacy policy in Spanish covering: data collected (phone number, conversation content needed to operate), use, third parties (WhatsApp/Twilio infrastructure), retention, contact. Required by Meta for WhatsApp Business verification.

## Voice constraints (from BRANDING.md — hard rules)

- Never say: wallet, chain, staking, yield, smart contract, on-chain.
- No crypto/futuristic aesthetics, no neon, no gradients, no blockchain logos.
- Warm, short, clear. "Tu dinero", "tu ahorrito", "la tanda".

## Technical

- **Rendering:** pure server components, zero client JS.
- **Styling:** Tailwind CSS 3.4 — add `tailwind.config.ts` with brand tokens (hoja, nopal, olivo, barro, miel, papel), `postcss.config.mjs`, `app/globals.css`. Add `postcss` + `autoprefixer` devDeps.
- **Fonts:** `next/font/google` — Newsreader (display italic), Petrona (headlines), Outfit (body), Caveat (hand details).
- **Assets:** copy needed images from `docs/assets/` into `apps/web/public/`.
- **Config:** WhatsApp number from `NEXT_PUBLIC_WA_NUMBER` (same convention as the onboarding page). Update stale root metadata (currently mentions Solana — pre-pivot leftover).
- **Deploy:** Vercel auto-detects Next.js; workspace fix makes the build possible.

## Out of scope

- Admin page, dashboard, any authenticated surface.
- Onboarding page changes beyond none.
- Analytics, SEO beyond basic metadata, i18n.

## Error handling

Static pages — no runtime failure modes. Missing `NEXT_PUBLIC_WA_NUMBER` falls back to the placeholder used by the onboarding page so the link is never broken.

## Testing

- `pnpm --filter @comadre/web typecheck` passes.
- Dev server renders `/` and `/privacy` with HTTP 200 and visible brand styling (manual/screenshot verification).
