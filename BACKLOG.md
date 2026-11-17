# Backlog: what moves Handled toward paying customers

Ranked by how much each item matters to the first paying customer. The top
section covers things that stop a customer from paying or staying. The ones
below make the product better than "fine". Each item is meant to be one
small, tested commit. Tick an item when it lands, and put its commit hash
beside it.

Last re-ranked: 2026-11-17.

## 1. The core loop works end to end (blocks the first customer)

- [x] **Weekly loop journey.** Ran plan → approve → publish → metrics → Friday text against a fake Post for Me. Found and fixed: a repeated rewrite said "Reworked it" (`bfab2e0`). Simulate a whole week for one customer: plan the week, draft the posts, text them for approval, the owner says yes, the posts publish, metrics come back. Mock Twilio, Stripe, Post for Me and the LLM. Fix whatever breaks.
- [x] **Risk gate on publishing.** Fixed: "#1" claims never matched, health claims weren't flagged, carousel slide text and the reel's burned-in hook skipped the check.
- [x] **Plan changes in Stripe.** The tier already moved. Fixed: the upgrade text always said "carousels are switched on", even on Growth → Pro. It now names what the new plan adds. The homepage said reels come with Growth; code and billing say Pro, so the homepage now says Pro. Make sure `customer.subscription.updated` (an upgrade, a downgrade or a card that is fixed) moves the customer's tier and status, not just `checkout.session.completed`.
- [x] **Unpaid price question (F3).** Fixed: it now gets the three prices and the link, and no longer spends the free draft on the question. Someone who hasn't paid asks "how much is it?" and gets the paywall text with no price in it. Give them the plan prices and the link.
- [x] **Email signup re-asks the business name (F18).** Fixed: the first question and the free-draft intro use the name they gave instead of asking "what's it called". Someone who signs up on the web with a business name gets asked for it again over text.
- [x] **"What's coming up" hides drafts (F17).** Fixed: drafts waiting on the owner are listed first and marked "waiting on your OK". The answer lists scheduled posts only. It leaves out drafts that are waiting on the owner, and those are the ones that need them.
- [x] **Duplicates and gibberish.** Fixed: a repeated Twilio webhook used to throw and get retried, and is now dropped quietly. Keyboard mash gets one short "didn't catch that" and never reaches the intent model. A lone emoji with nothing waiting gets no reply. Twilio sends the same message twice, or the owner sends "asdfgh" or only an emoji. Make sure there's no double reply and no confused answer.

## 2. Results the owner can see (keeps them paying)

- [x] **Post for Me metrics path.** The path was wrong. It now reads the account feed, as Post for Me's own SDK does, and linking asks for the "feeds" permission (`709594a`). Accounts linked before this need relinking once.
- [x] **Weekly results text.** The Friday check-in now names the week's best post with its real views and saves, and says nothing when there are no numbers yet.
- [x] **Facebook connection.** Fixed: if Post for Me turns down the Facebook route, linking retries once with Instagram Login instead of failing. Whether Quickstart allows it still needs one live test. Confirm whether the Post for Me Quickstart project allows the `facebook` connection type, and if it doesn't, make linking say so plainly instead of failing.

## 3. Content that is worth paying for

- [x] **Quote and CTA slide variety.** Quotes now have three looks (centred, a left-aligned pull quote, or set on the accent) and CTAs two (centred, or poster-style on the left), picked by the post's layout. The covers now rotate through five layouts. Quote and call-to-action slides still use one look each.
- [ ] **Real footage reel test.** The sample reels use still photos. Cut one from real phone clips and check the trims, captions and hook against it.
- [ ] **Animated reels (Pro only).** Ranked after the two clean QA rounds and the real-footage test: nothing about paying or staying waits on it, and no Pro customer exists yet.
  - **Scope:** two kinds only. A barber special promo (price, dates, booking line) and a groomer before-and-after reveal (two photos, a wipe, the business name). Both are 10 to 15 seconds, 1080×1920, drafted and texted for approval like any other post, and they go through the same risk gate. Pro only, in the same tier check as reels.
  - **What the API actually does (checked on Anthropic's docs, 2026-11-17):** Claude returns text and code, never video. The docs say nothing about Remotion. The supported pattern is code that draws the frames, rendered and joined with ffmpeg on our side; Anthropic's own "video explainer" agent template works that way. So "Fable 5.2 makes the video" really means Claude writes animation code and we render it.
  - **Plan:** we build the two animations ourselves as fixed templates, drawn with the existing SVG slide engine frame by frame (resvg) and encoded with the ffmpeg we already run. Claude only fills in a small spec: the words, which photo goes where, the timing beats. That keeps the brand look identical to the carousels, adds no Chromium and no new service, and can't produce a broken render. Remotion is the fallback if we later want freer motion. It is free for companies of up to 3 people; past that it's $0.01 a render with a $100 a month minimum.
  - **Rough cost per reel:** with templates, one Opus-tier call of about 4K tokens in and 3K out is about 8 to 10 cents, plus well under a cent of CPU for about 450 frames. Letting Fable 5.2 write fresh animation code for each reel, with a look at stills and one fix round, is more like $1.50 to $3 a reel, and it needs a sandbox for code we didn't write. At 2 animated reels a week, that's under $1 a month against $15 to $25 a month per Pro customer ($699 plan).
  - **Done when:** both templates render for the four sample businesses, the spec is validated (words fit, photos placed off the subject), an approval text goes out with the preview, and it's on the sample page to rate.
- [x] **Light review step for graphics.** Each photo slide is read for where its subject is (the part whose colour stands out). If a card or caption would sit on it, the slide moves to the framed layout, and crops lean toward the subject. Checked on 8 real photos: both dogs had been half under the card and are now in full view. Before a carousel goes to the owner, run a cheap automatic check that the photo isn't covered by the card in the spot where the subject is.
- [x] **Unsourced claim in copy (F9).** Softened to "tend to get more response" in the text, the hint and the photo-walk page. The photo-walk nudge says photos get "roughly double the response". Drop the claim or soften it.

## 4. Housekeeping

- [x] **Schema drift (F10).** Fixed in the schema, not the database: the three ids now declare the database's own uuid default, and the unique index keeps its existing name. `prisma migrate diff` is empty against both the migrations and a live database, so nothing needs deploying. An `archetype_performance` index name and three id defaults differ from what Prisma expects. Add a migration so `prisma migrate diff` comes back empty.
- [x] **README is out of date.** Now names Handled, the real test commands, the real model defaults and what each key turns on. `.env.example` gained the R2, Postmark and admin variables the code reads. It still calls Anthropic, Post for Me, R2 and the crons "stubs". They are all wired now.
- [x] **Admin overview journey.** Customers by status, MRR by tier, leads, the media mix and photo asks all matched the database. Fixed: the failed-post count stopped at 25. Check that every number on the admin page matches the database for a seeded customer.
- [ ] **Two clean QA rounds in a row.** Rerun every journey after the fixes. It's done when two rounds in a row turn up nothing new.

## Done in this pass

- [x] Post for Me linking recovers from a stale link, STOP and START work, the card-update link, re-subscribe after a cancel (`b6cf397`)
- [x] Referral credits land in Stripe on their own (`aab0ca5`)
- [x] Five text layouts, a framed photo layout and real font measuring (`0dc38dd`)
- [x] Reel hooks and captions wrap to fit, readable colours, the end card no longer squashed (`ffb7539`)
- [x] Captions moved off faces, bigger hooks, an end card that names the next step (`6c65f22`)
- [x] The homepage demo reel is re-cut through the real pipeline (`e404a00`)
- [x] Cancelling: a plan-cancel ask gets the billing link, and an ended plan no longer reads as a failed card (`26b084d`)
- [x] A yes to a draft whose slot has passed schedules it ahead, not in the past (`b0eaa58`)
- [x] The email sign-up on `/start` is hidden, and refused by the backend, until Postmark works both ways. The page offers "email us" instead, so the no-phone path stays.

## Only Nasser can do these

- Merge the PR and run `prisma migrate deploy` on the production database (two new migrations).
- Turn on the Stripe customer portal, so the "update your card" link works.
- Set the Post for Me redirect URL and run one live account-linking test.
- Sign in to Postmark and finish setting it up (sending and the inbound webhook), then set `NEXT_PUBLIC_EMAIL_SIGNUP=1` on the web app to show the email sign-up form again.
- Check the Twilio opt-out wording.
- Clean up the stray Vercel projects.
