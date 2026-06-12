# Onboarding Page Branding — Design

**Date:** 2026-06-12
**Status:** Approved (user picked this work item; auto mode)
**Scope:** Visual + copy-register restyle of `apps/web/app/o/[token]/page.tsx`. Zero logic changes.

## Goal

The magic-link onboarding page is the user's highest-trust moment (wallet creation). It currently renders generic Tailwind colors (emerald-600 buttons, gray backgrounds) and voseo copy. Align it with the Tía Vera brand so the WhatsApp experience and the browser step feel like the same person.

## Changes (presentational only)

- **Shell:** page background `bg-papel`; card stays white/rounded; add brand header inside the card — wordmark `Comadre.` (Petrona, barro dot) + Tía Vera avatar (`/brand/tia-vera.png`, 72px, rounded-full) above the step content.
- **Buttons (Continuar / Abrir WhatsApp / Reintentar):** `bg-olivo text-papel` (WCAG AA 6.74:1, same combo as landing CTAs), `rounded-full`, `active:bg-hoja`, `disabled:opacity-50` kept.
- **Headings:** `font-headline` (Petrona), color inherits hoja.
- **Secondary text:** `text-gray-600` → `text-olivo`.
- **Spinner:** `border-olivo/25 border-t-olivo` instead of gray/emerald.
- **Copy register:** voseo → brand tuteo: "Tocá Continuar y seguí los pasos" → "Toca Continuar y sigue los pasos"; "Volvé a WhatsApp" → "Vuelve a WhatsApp". No other copy changes.

## Explicitly out of scope

- State machine, Privy config, fetch calls, session-key approval — untouched.
- No new components, no layout restructure, no new dependencies.

## Verification

- `pnpm --filter @comadre/web typecheck` passes; production build passes (dev server stopped).
- Visual check via screenshot: without the API running, the page boots into the styled error state ("Algo salió mal") — this exercises Shell + ErrorView + button. Other states require Privy and are styling-identical (same Shell/classes), reviewed by code read.
