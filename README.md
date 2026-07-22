# Autonomous Social Media Manager

A subscription SaaS that runs a small business's social media almost on its own.
The owner talks to a **Concierge over SMS**; a backend **Operator** does the real
work (plan, write, generate media, schedule, publish, measure). The two agents
are hard-separated and joined by a strict **Task/Result JSON contract**.

The flagship visual is the **swipeable carousel** — informational posts (tips,
product spotlights, promos) are turned into branded, correctly-spelled slides
automatically. It's the headline Growth+ feature and the main reason to move up
from Starter. See `GENERATE_CAROUSEL` (`operator/handlers/generate-carousel.handler.ts`)
and the tier gate in `operator/graphics/carousel-content.ts`.

> Full product spec: see the project brief. This repo implements the foundation
> and the MVP loop (build order §10, items 1–7).

## Architecture (two agents, hard-separated)

```
OWNER (SMS) ⇄ CONCIERGE (Agent A)  ──Task JSON──▶  OPERATOR (Agent B)
              intent · voice        ◀─Result JSON─  plan · caption · media
                                                    schedule · publish · metrics
                                          │
                          Postgres (source of truth) + BullMQ (scheduler)
```

- **Concierge** (`apps/backend/src/concierge`) — owner-facing, conversational.
  Interprets SMS, runs onboarding, emits exactly one typed Task. Holds no keys.
- **Operator** (`apps/backend/src/operator`) — deterministic handlers, one per
  Task type, with LLM steps inside. Has the real tools. Never talks to the owner.
- **The spine** (`packages/contracts`) — the §4 Task/Result contract as zod
  schemas. Validated on emit and on receive; every Task + Result is logged.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | §4 Task/Result contract (zod), shared enums, LLM-JSON parser |
| `apps/backend` | NestJS: Concierge, Operator, TaskBus (audit spine), BullMQ scheduler |
| `apps/backend/prisma/schema.prisma` | §5 data model |
| `apps/web` | Minimal Next.js: connect-accounts + billing. The SMS is the real UI. |

## Guardrails (§8, built in from v0)

- **Trust ramp** — every customer starts at `approve_all`. `PublishGateService`
  is checked before every publish.
- **Risk gate** — anything with a price/offer/date/claim requires owner
  confirmation *regardless of tier*.
- **Moderation** — every caption is screened before it can publish.
- **Kill switch** — owner texts "STOP" → `PAUSE_CUSTOMER` drains the queue.
- **Token encryption at rest** — AES-256-GCM (`TokenCryptoService`).
- **Paper trail** — nothing publishes without tracing to a Task.

## Getting started

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, REDIS_URL, keys
npm run build:contracts
npm run prisma:generate
npm run build:backend
```

Run the tests / infra-free smoke of the contract + guardrails:

```bash
npm run test --workspace @smm/contracts
npx tsx apps/backend/scripts/smoke.ts
```

Booting the server needs Postgres + Redis reachable via `.env`:

```bash
npm run prisma:migrate --workspace @smm/backend   # create schema
npm run dev:backend                               # NestJS on :3001
npm run dev --workspace @smm/web                  # Next.js on :3000
```

Point a Twilio Messaging Service inbound webhook at
`POST {PUBLIC_BASE_URL}/webhooks/twilio/sms`.

## Model routing (§2)

- Bulk (Concierge chat, captions, hashtags): **Claude Haiku 4.5**
- Voice-critical (final brand voice, weekly planning): **Claude Sonnet 5**
- Each customer's `brand_profile` is sent as a cached system block → ~10x cheaper input.

## Integration seams (wire before production)

These are isolated, clearly-marked stubs (they throw rather than fake output):
`LlmService.rawComplete` (Anthropic), `PostForMeService` (publish + metrics),
`IngestMediaHandler` R2 upload, Concierge Haiku intent classification, cron
triggers for weekly `PLAN_WEEK` / daily `PUBLISH_DUE` + `FETCH_METRICS`.

## Non-goals for v0

Direct Meta/TikTok integrations (rented via Post for Me), AI video generation,
a full web dashboard, multi-language/team seats, and `full_auto` on day one.
