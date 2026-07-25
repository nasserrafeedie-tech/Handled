# Handoff: pricing & tier packaging update (web)

Context file for Claude Code, written July 21, 2026 by a Cowork session.
Repo: this one (AISSM — the product is **Handled**, done-for-you social media
over SMS). Planning source of truth lives outside the repo at
`~/handled-hq/business/`: `market-research.md` (pricing rationale) and
`feature-tiers.xlsx` (the finalized packaging). Everything you need is embedded
below — you don't have to open the spreadsheet.

## The goal

Bring the public plans in line with the finalized tier packaging. There is **one
real bug**: Growth's plan card says "7 posts / week", which equals daily — the
same as Pro. That makes Growth and Pro look identical on cadence. Fix the ladder
so each tier is distinct (3 → 5 → 7), and tighten the feature bullets. Do **not**
advertise features the product doesn't actually ship (see Guardrail).

## Where pricing/tiers live (verify current state — things may have moved)

- `apps/web/app/billing/page.tsx` — the public `PLANS` array. **Primary file; this
  is what customers see.**
- `apps/web/app/admin/page.tsx` — `PLAN_PRICE` display labels (internal admin).
- `apps/backend/src/admin/business-metrics.service.ts` — plan price constants for
  revenue metrics (internal).
- `apps/web/app/page.tsx` — homepage; has an "On Growth & Pro" reels note (copy
  only, no prices).

## The target packaging (finalized)

Cumulative — each tier includes everything in the tier below it.

| Tier | Price (live) | Cadence | Platforms | Headline features |
|---|---|---|---|---|
| **Starter** | $95/mo | **3 posts / week** | 1 | Captions + your own photos · text approval · **no carousels/reels** |
| **Growth** ★ most popular | $349/mo | **5 posts / week** | up to 3 | **Swipeable branded carousels** (the flagship) · reels from your clips · weekly tuning |
| **Pro** | $699/mo | **Daily (7 / week)** | all | Everything in Growth · priority drafts · community management (reply to comments & DMs) |

> **Carousels are the headline Growth+ feature and the main reason to move up from Starter.** They ship today: the content pipeline turns informational posts (educational tips, product spotlights, promos, testimonials, seasonal) with no owner photo into swipeable, correctly-spelled, on-brand slides. Handler: `generate-carousel.handler.ts`; gate: `tierHasCarousel()` in `graphics/carousel-content.ts` (growth/pro/premium). Starter gets captions + the owner's own photos only.

## Tasks

1. **[Required] Fix the Growth cadence.** In `billing/page.tsx`, change Growth's
   feature `'7 posts / week'` → `'5 posts / week'`. This is the core fix.

2. **[Required] Clarify Pro cadence.** Change Pro's `'Daily posting'` →
   `'Daily posts (7 / week)'` so the 3 → 5 → 7 ladder reads clearly.

3. **[Recommended] Tighten the feature bullets to the table above — but VERIFY
   each feature against the backend before listing it (see Guardrail).**
   - Growth: lead with **"Swipeable branded carousels"** — this is the flagship
     and now ships (`generate-carousel.handler.ts`, gated growth/pro/premium).
     Keep "Reels cut from your clips" and "Weekly performance tuning" below it.
   - Pro: today it lists `'Auto-publish (once trusted)'` as if Pro-only. Autopilot
     is available on **all** tiers via the trust ramp, so don't imply it's
     exclusive to Pro. Prefer `'Priority drafts'` + (if implemented)
     `'Community management — we reply to comments & DMs'`. If community management
     isn't built, leave Pro's other bullets and just drop the Pro-only autopilot
     implication.

4. **[Flag for Nasser — do NOT change without confirming] Prices.** The site
   currently shows Starter **$95**, Growth **$349**, Pro **$699**. Planning docs
   round these to $99 / $350 / $699. If Nasser wants the round numbers live, note
   that **Stripe Price objects are immutable** — you must create new Prices, update
   the price IDs in the billing backend, AND update the displayed strings in all
   three files above *together*, or the charged amount won't match what's shown.
   **Default: leave the live charm prices as-is.**

## Guardrail — don't advertise vaporware

Only list a feature on the public plans if it's actually implemented in
`apps/backend`. Several items in the planning matrix are explicitly "to build" —
**Google Business Profile management, paid-ads/boosted-posts management, and
seasonal campaigns** — do NOT put any of those on the site. (Carousels DO ship
as of this build and are the Growth+ flagship — advertise them freely.) If you're
unsure whether stories or community management ship today, grep the backend
(`apps/backend/src/operator/handlers`, `apps/backend/src/scheduler`) and omit
anything you can't confirm. When in doubt, leave it off.

## Build & verify

- `npm install` if the lockfile changed, then build the web app (workspace build
  script, or `npm run build` in `apps/web`).
- Typecheck and fix any TS errors you introduce.
- Load `/billing` locally and confirm three visually distinct tiers (3 / 5 / daily).
- Commit with a clear message (e.g. "web: fix Growth cadence, tidy plan features").
- Deploy per the usual Vercel flow, or open a preview. **Confirm with Nasser
  before pushing to production** if deploys aren't automatic.

## Don't touch

- `render.yaml` — has an uncommitted local change that predates this work.
- Anything Stripe / live keys without Nasser confirming.

---

*When done, add a one-line note to `~/handled-hq/journal/2026-07-21.md` (or the
current day) so the business folder stays in sync: what shipped and whether it's
live.*
