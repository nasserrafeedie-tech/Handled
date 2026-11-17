# Backlog: what moves Handled toward paying customers

Ranked by how much each item matters to the first paying customer. The top
section covers things that stop a customer from paying or staying. The ones
below make the product better than "fine". Each item is meant to be one
small, tested commit. Tick an item when it lands, and put its commit hash
beside it.

Last re-ranked: 2026-11-17.

## 1. The core loop works end to end (blocks the first customer)

- [ ] **Weekly loop journey.** Simulate a whole week for one customer: plan the week, draft the posts, text them for approval, the owner says yes, the posts publish, metrics come back. Mock Twilio, Stripe, Post for Me and the LLM. Fix whatever breaks.
- [ ] **Risk gate on publishing.** Check that a post the risk check flags (health claims, prices the owner never gave, blackout topics) waits for the owner, even when they have turned on auto-approve.
- [ ] **Plan changes in Stripe.** Make sure `customer.subscription.updated` (an upgrade, a downgrade or a card that is fixed) moves the customer's tier and status, not just `checkout.session.completed`.
- [ ] **Unpaid price question (F3).** Someone who hasn't paid asks "how much is it?" and gets the paywall text with no price in it. Give them the plan prices and the link.
- [ ] **Email signup re-asks the business name (F18).** Someone who signs up on the web with a business name gets asked for it again over text.
- [ ] **"What's coming up" hides drafts (F17).** The answer lists scheduled posts only. It leaves out drafts that are waiting on the owner, and those are the ones that need them.
- [ ] **Duplicates and gibberish.** Twilio sends the same message twice, or the owner sends "asdfgh" or only an emoji. Make sure there's no double reply and no confused answer.

## 2. Results the owner can see (keeps them paying)

- [ ] **Post for Me metrics path.** The code reads metrics from a path that has never been called live. Check it against Post for Me's docs and make the parser forgiving of missing fields, so a weekly results text never says zero because a field was renamed.
- [ ] **Weekly results text.** Read a week of fake metrics and check that the text names the best post and why, in plain words, without making up a number.
- [ ] **Facebook connection.** Confirm whether the Post for Me Quickstart project allows the `facebook` connection type, and if it doesn't, make linking say so plainly instead of failing.

## 3. Content that is worth paying for

- [ ] **Quote and CTA slide variety.** The covers now rotate through five layouts. Quote and call-to-action slides still use one look each.
- [ ] **Real footage reel test.** The sample reels use still photos. Cut one from real phone clips and check the trims, captions and hook against it.
- [ ] **Light review step for graphics.** Before a carousel goes to the owner, run a cheap automatic check that the photo isn't covered by the card in the spot where the subject is.
- [ ] **Unsourced claim in copy (F9).** The photo-walk nudge says photos get "roughly double the response". Drop the claim or soften it.

## 4. Housekeeping

- [ ] **Schema drift (F10).** An `archetype_performance` index name and three id defaults differ from what Prisma expects. Add a migration so `prisma migrate diff` comes back empty.
- [ ] **README is out of date.** It still calls Anthropic, Post for Me, R2 and the crons "stubs". They are all wired now.
- [ ] **Admin overview journey.** Check that every number on the admin page matches the database for a seeded customer.
- [ ] **Two clean QA rounds in a row.** Rerun every journey after the fixes. It's done when two rounds in a row turn up nothing new.

## Done in this pass

- [x] Post for Me linking recovers from a stale link, STOP and START work, the card-update link, re-subscribe after a cancel (`b6cf397`)
- [x] Referral credits land in Stripe on their own (`aab0ca5`)
- [x] Five text layouts, a framed photo layout and real font measuring (`0dc38dd`)
- [x] Reel hooks and captions wrap to fit, readable colours, the end card no longer squashed (`ffb7539`)
- [x] Captions moved off faces, bigger hooks, an end card that names the next step (`6c65f22`)
- [x] The homepage demo reel is re-cut through the real pipeline (`e404a00`)

## Only Nasser can do these

- Merge the PR and run `prisma migrate deploy` on the production database (two new migrations).
- Turn on the Stripe customer portal, so the "update your card" link works.
- Set the Post for Me redirect URL and run one live account-linking test.
- Sign in to Postmark and finish setting it up.
- Check the Twilio opt-out wording.
- Clean up the stray Vercel projects.
- Decide what happens to the `/start` form.
