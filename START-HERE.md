# START HERE — run Claude Code on Handled

1. Open a terminal.
2. `cd` into this repo (the `social-media-manager` folder).
3. Run: `claude`
4. Paste the prompt below and hit enter. Approve steps as it asks.

---

## The prompt (copy everything in this block)

You are working on **Handled**, a done-for-you social media service for small
businesses run over SMS. This repo is the product (Next.js web in `apps/web`,
NestJS backend in `apps/backend`, Prisma, Postgres/Neon, Redis/Upstash,
Cloudflare R2, Twilio, Stripe). A companion knowledge folder lives at
`~/handled-hq/` — read what it says; it's the source of truth for brand,
strategy, and the two big features below.

First, read these files completely before doing anything:
- `CLAUDE-CODE-HANDOFF.md` (repo root) — the full task list, tasks 1–23.
- `~/handled-hq/brand/brand.md` — the oxblood palette + Fleuron mark rules.
- `~/handled-hq/operations/playbook-engine.md` — the self-updating archetype system.
- `~/handled-hq/operations/video-engine.md` and `video-playbook.md` — the auto-reel system.
- `~/handled-hq/operations/social-playbook.md` — the seed strategy knowledge.

Context on current state:
- A prior session already committed the oxblood rebrand + Fleuron mark to the
  web app (commit `98e4f80`) — verify it, don't redo it. It was syntax-checked
  but NOT built.
- `render.yaml` has an uncommitted local change that predates this work — do
  NOT touch it without asking me.
- Nothing else in the handoff has been built yet.

Do the work in this order, committing in logical chunks with clear messages:

PHASE A — launch readiness (handoff tasks 1–9):
1. `npm install`, typecheck, and build both the web app and backend. Fix
   anything the rebrand commit broke. Confirm the homepage, tab icon, and OG
   image render the Fleuron and oxblood correctly.
2. Persist SMS consent: add `smsConsent`, `smsConsentText`, `smsConsentAt` to
   the Prisma `Lead` model + migration; store them in the leads controller;
   never overwrite an existing consent timestamp with null.
3. Sweep the whole repo for retired terracotta hexes (`BE5B2D`, `A0481F`, old
   clay values) and the old "H"-in-a-circle mark; replace with the oxblood ramp
   / Fleuron.
4. Copy the static icons from `~/handled-hq/brand/logo/` into `apps/web/public/`
   and reference them in layout metadata.
5. Add the service-SMS consent line to the billing/checkout page (separate from
   the marketing checkbox already on the lead form).
6. Add a quiet-hours guard (8:00–21:00 recipient-local) on outbound non-reply
   SMS in the backend; queue for the next window otherwise.
7. Show each lead's consent status + timestamp in the admin view.
8. Domain switch to texthandled.com — ONLY if I confirm the domain is bought.
9. Ask me before building the "nice-to-have" items (auto referral credit,
   env-var go/no-go health check).

PHASE B — the Playbook Engine (handoff tasks 10–16, spec in
`~/handled-hq/operations/playbook-engine.md`): add the `PlaybookArchetype`
model, seed it from `social-playbook.md`, build the onboarding classifier, the
auto-research job for novel business types, doc regeneration, the weekly
freshness job, and wire the content planner to use a customer's archetype.

PHASE C — the Video Engine (handoff tasks 17–23, spec in
`~/handled-hq/operations/video-engine.md`): transcription service, the Edit
Decision List JSON schema + LLM-as-editor step, Shotstack render integration
with brand-themed burned-in captions and end-card, a licensed music library
(never bake copyrighted/trending audio), and wire rendered reels into the
existing approval flow.

Rules the whole time:
- Keep Handled's voice in any user-facing copy: warm, plain-English, short
  sentences. "No dashboard, no passwords, cancel anytime."
- Webhooks (Twilio, Stripe) must keep verifying signatures and failing closed
  in production.
- No secrets in code — env vars only. Don't put keys in `~/handled-hq/`.
- Any content containing a price, percent, date, or promo must always require
  human approval, even on autopilot — including auto-generated reels.
- Ask me before: touching `render.yaml`, pushing anything, the domain switch,
  and any task marked "ask first."
- After each phase, stop and give me a short summary + how to test it locally.

Start with Phase A, task 1. If the build reveals problems, fix them before
moving on. Go.

---

That's it. Claude Code will ask permission before risky steps — just say yes as
it goes. It'll take real time (Phases B and C are full features), so expect a
few back-and-forths, not one click.
