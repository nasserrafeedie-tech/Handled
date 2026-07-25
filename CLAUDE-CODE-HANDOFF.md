# Handoff: oxblood rebrand + launch-readiness work

Context file for Claude Code, written July 20, 2026 by a Cowork session.
Repo: this one (AISSM — the product is called **Handled**, done-for-you social
media for small businesses, run over SMS). Business docs and brand masters
live outside the repo at `~/handled-hq/` (brand assets: `~/handled-hq/brand/logo/`).

## The brand, ground truth

- **Mark:** "The Fleuron" — six ink petals fused to a center dot. SVG geometry:
  petal path `M0,-1 C7.5,-9 7.5,-25 0,-33 C-7.5,-25 -7.5,-9 0,-1 Z` repeated at
  rotate(0/60/120/180/240/300) + `circle r=4.6`, viewBox `-36 -36 72 72`.
  Already componentized at `apps/web/app/_components/fleuron.tsx`. It spins
  slowly on the site (existing `animate-spin-slow`), always behind
  `motion-safe:`. Never reintroduce the keyboard ✳ as the logo (it remains
  fine as a text flourish inside copy).
- **Palette:** paper `#F8F3EA` · parchment `#EFE7D8` · ink `#1A140D` ·
  **oxblood `#8C2F39`** (accent — tailwind `clay-500`; full ramp already in
  `tailwind.config.ts`; `clay-300 #C96A72` is the dark-bg/rose variant) ·
  brass `#C79A45` (secondary/hover/foil) · sage `#66705A`.
  **Terracotta `#BE5B2D` is retired. If you find it anywhere, replace it.**
- Fonts: Fraunces (display), Instrument Sans (body), Space Mono (labels) — unchanged.

## Already done (commit `98e4f80` on main) — verify, don't redo

- `apps/web/tailwind.config.ts` — clay ramp re-centered on oxblood; glow shadow updated
- `apps/web/app/_components/fleuron.tsx` — new mark component
- `apps/web/app/_components/chrome.tsx` — header + footer use `<Fleuron/>`
- `apps/web/app/icon.tsx`, `apps/web/app/opengraph-image.tsx` — fleuron replaces the old "H" circle
- `apps/web/app/_components/lead-form.tsx` — required TCPA express-written-consent
  checkbox; posts `smsConsent`, `smsConsentText`, `smsConsentAt` (API currently
  ignores these — see task 2)
- `apps/web/app/terms/page.tsx`, `apps/web/app/privacy/page.tsx` — added content
  license, approval/autopilot responsibility, platform disclaimer, liability cap,
  CA governing law, AI-processing disclosure

These edits were syntax-checked but **not built** — no `npm install`/`next build`
was run. Note: `render.yaml` has an uncommitted local change that predates this
work — ask Nasser before touching it.

## Tasks, in order

1. **Build & fix.** `npm install`, typecheck, `next build` the web app and build
   the backend. Fix anything the rebrand commit broke. Visual-check `/` , tab
   icon, and the OG image route render the fleuron correctly.
2. **Persist SMS consent (the legal audit trail).** Add nullable
   `smsConsent Boolean?`, `smsConsentText String?`, `smsConsentAt DateTime?` to
   the `Lead` model in Prisma; migration; extend the zod schema and upsert in
   `apps/backend/src/leads/leads.controller.ts` to store them. Never overwrite
   an existing consent timestamp with null on re-submit.
3. **Terracotta sweep.** Grep the whole repo (backend templates, demo page,
   emails, anything) for `BE5B2D`, `A0481F`, and other old clay hexes and the
   old "H"-in-a-circle mark; replace with the oxblood ramp / fleuron.
4. **Static icons.** Copy `~/handled-hq/brand/logo/apple-touch-icon.png` (and
   `icon-512.png` for the web manifest if one exists) into `apps/web/public/`
   and reference them in `app/layout.tsx` metadata.
5. **Checkout consent line.** On the billing/checkout page, near the CTA that
   sends users to Stripe, add the service-SMS notice: "By subscribing you agree
   to receive texts from Handled to deliver the service. Msg & data rates may
   apply. Reply STOP to cancel, HELP for help." (Service consent ≠ the
   marketing consent checkbox — both are needed.)
6. **Quiet-hours guard.** In the backend outbound-SMS path, block non-reply
   sends outside 8:00–21:00 in the recipient's local time (customer timezone is
   already modeled for publishing) — queue them for the next window instead.
   Replies to an inbound message within a conversation are exempt.
7. **Admin: consent visibility.** Show each lead's consent status + timestamp
   in the admin view, so launch-day texting only targets consented leads.
8. **Domain switch (after Nasser buys texthandled.com).** Set `metadataBase`/
   canonical URLs; keep the vercel.app domain as a redirect. Don't do this
   until the domain exists.
9. **Nice-to-have, ask first:** automate the referral credit (runbook says it's
   manual in Stripe today); a `/health` check that verifies all launch env vars
   are present and real (`LLM_FAKE=0`, TWILIO_*, R2_*, STRIPE_*) and prints a
   go/no-go table.

## Part 2 — The Playbook Engine (bigger feature; do after tasks 1–7)

Full spec lives at `~/handled-hq/operations/playbook-engine.md`; seed knowledge
at `~/handled-hq/operations/social-playbook.md`. Goal: Handled plans like a
specialist for ANY business type. Known types come from a playbook of
"archetypes"; a novel type triggers auto-research that appends a new archetype
and then executes for that customer. Build in this order:

10. **Seed the archetype store.** Add the `PlaybookArchetype` Prisma model (schema
    in the engine spec) + `archetypeSlug`/`archetypeConfidence` on the business/
    customer. Write a one-time importer that parses `social-playbook.md` (fixed
    field headings) into 12 seed rows with `status:"seed"`.
11. **Classifier.** After onboarding, an LLM step maps the customer's answers to
    the best archetype `{slug, confidence}` against existing rows. ≥0.75 →
    attach + bump `usageCount`. <0.75 → Flow 2.
12. **Archetype Research Job.** Idempotent per normalized business type. Agent
    web-researches the vertical, fills the FULL archetype schema (reuse the
    playbook's cross-cutting sections; only research vertical-specifics), a cheap
    verify pass sets `confidence`, insert row `status:"researched"` with
    `sources` + `researchedAt`. Then attach to the waiting customer and release
    their first plan. Don't block the customer longer than the Mon-8am→first-draft
    window.
13. **Doc regeneration.** A job renders `social-playbook.md` (+ sources file) from
    the DB so the human doc always reflects the store. DB is source of truth;
    Nasser's manual doc edits should be importable back (last-writer-wins is fine
    to start).
14. **Freshness job (weekly).** Re-research archetypes older than ~180 days (most-
    used ones faster); update if materially different. This is what keeps the
    playbook current as algorithms shift.
15. **Wire the planner to archetypes.** The weekly content planner takes the
    customer's archetype record as structured strategy context (pillars, formats,
    cadence, hooks, local-time rules) and generates in the customer's brand voice.
    Archetype = strategy; derived brand = voice; existing approval flow = publishing.
16. **Ask first / later:** Flow 4 (feed real first-party post performance per
    archetype back into the store — the long-term moat). Don't build yet; leave a
    clean seam (store `archetypeSlug` on each post so aggregation is possible later).

Guardrails for the engine: generated archetypes never bypass content safety
rails; novel-archetype first drafts stay conservative + human-approved until a
few clean approvals; keep `sources` on every row for auditability.

## Part 3 — The Video Engine (auto-editing reels; do after the Playbook Engine)

Full spec: `~/handled-hq/operations/video-engine.md`; craft rules:
`~/handled-hq/operations/video-playbook.md`. Goal: automate the Growth-tier
"2+ clips → branded reel" promise. Architecture is transcription → LLM-as-editor
(outputs an Edit Decision List JSON) → Shotstack render → approval flow. No
monolithic "CapCut AI"; CapCut has no API.

17. **Transcription service.** Wrap Whisper (OpenAI API or self-host) or
    AssemblyAI behind a `transcribe(clipUrl)` service returning word-level
    timings. Cheap (~$0.01/min).
18. **EDL schema + LLM editor.** Define a strict `EditDecisionList` JSON (clips
    with in/out trims, order, hook, caption tokens with per-word timing +
    emphasis flags, music mood, on-screen text, end-card). Add an LLM step that,
    given the transcript + the customer's archetype recipe + derived brand theme,
    produces an EDL following `video-playbook.md` (hook in 0–3s, cut every 2–3s,
    upper-third captions, 21–34s target). Validate against the schema; retry on
    invalid.
19. **Shotstack integration.** Use the official Node SDK. Build a brand-themed
    render template: burned-in animated captions (customer font + oxblood-or-
    their-accent keyword highlight), safe-zone framing, music bed at −18..−12 dB
    under voiceover, wordmark end-card. Map the EDL → Shotstack timeline. Poll
    render → store MP4 in R2. Keep vendor behind a `RenderProvider` interface so
    Creatomate/Renderly can swap in.
20. **Music library.** Integrate a commercially-licensed library (Uppbeat/
    Epidemic/Artlist or Shotstack's cleared assets). NEVER server-side bake
    copyrighted/trending tracks. For reels needing a platform-native trending
    sound, deliver an "add this sound in-app" note to the owner instead.
21. **Wire into the pipeline & approval flow.** Trigger on clip upload (MMS or
    the texted upload link → R2). Reel output goes through the SAME approval flow
    as photos ("yes / make it faster / swap the hook"). Price/percent/date/promo
    in on-screen text or caption → always human-approved, even on autopilot.
    Publish approved reels via Post for Me at local best time.
22. **Clip-request texts.** Update the owner-facing prompts to ask for good
    footage per `video-playbook.md` (vertical 9:16, 3–5s holds, get the money
    shot, good light, 3–6 short clips). Two usable clips = Growth minimum.
23. **Ask first / later:** add Reap's API only if owners send long footage that
    needs auto-trim-to-best-moment; per-format reel performance feeding back into
    the archetype learning loop (store `formatRecipe` on each reel now so it's
    possible later).

Video-engine guardrails: licensed music only; consent for faces/minors;
novel-edit first drafts stay human-approved; keep render vendor swappable.

## Rules

- Keep the brand voice in any user-facing copy: warm, plain-English, short
  sentences, never corporate. "No dashboard, no passwords, cancel anytime."
- Webhooks must keep verifying signatures and failing closed in production.
- No secrets in code or in `~/handled-hq/` — env vars only.
- Anything touching price/percent/date/promo language in the product's content
  pipeline must keep requiring human approval, even on autopilot.
- Commit in logical chunks with clear messages. Push only if the build is green.

## Suggested prompt

> Read CLAUDE-CODE-HANDOFF.md at the repo root and do the tasks in order.
> Start by building the repo and fixing anything the rebrand commit (98e4f80)
> broke, then work down the list. Tasks 1–9 are the launch-readiness pass;
> tasks 10–16 build the Playbook Engine (spec in ~/handled-hq/operations/
> playbook-engine.md); tasks 17–23 build the Video Engine (spec in
> ~/handled-hq/operations/video-engine.md). Read each spec before its tasks.
> Ask me before touching render.yaml, before pushing, and before any task
> marked "ask first."
