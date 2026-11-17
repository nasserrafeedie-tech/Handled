# Backlog: what moves Handled toward paying customers

Ranked by how much each item matters to the first paying customer. The top
section covers things that stop a customer from paying or staying. The ones
below make the product better than "fine". Each item is meant to be one
small, tested commit. Tick an item when it lands, and put its commit hash
beside it.

The bar for launch (Nasser, Nov 17): a product he'd happily use for his own
business. Each QA round is judged against that, not only against "no bugs".

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
- [x] **Animated reels (Pro only).** Built (`cb8833d`, `04c12fe`), behind `ANIMATED_REELS=1`. Two templates drawn by Handled's own engine (SVG frames through resvg, encoded with ffmpeg): a promo (kicker, headline, old price struck through, new price, end card with the next step) and a before-and-after reveal (two photos, a wipe, captions, end card). A Pro owner texts "make a promo reel for kids cuts $20 on weekdays" or "do a before and after reel"; it's queued, rendered in the worker (about 22s for a promo, 13s for a reveal), checked by moderation and the risk gate, and texted for approval like any post. Words come from a model spec with a retry, checked to fit the frame and to print no number the owner didn't give; with no key, an offline writer does the same job. Also `POST /admin/reel/animated`. Rendered for the four sample businesses and on the sample page to rate.
  - Fixed on the way: a "yes" right after a reel arrived scheduled an older draft instead (yes answers the oldest waiting draft). Reel texts now say when other drafts are ahead, for clip reels too.
- [x] **Animated reels in the weekly plan.** Pro customers get one promo reel a week from their own offers without asking, behind the same flag. The Monday plan queues it, turning through the priced offers week by week; it lands behind the week's drafts and comes up for its yes in turn, so Monday brings no extra text. Skipped with no offers or if a promo reel was made in the last six days. Checked end to end on a Pro barber.
- [x] **Texting two photos makes the reveal.** Two photos sent with "before and after reel" become that reel, before first, instead of landing in the photo library. With no tagged pair the reveal uses the two photos the owner just sent together, and the photo walk now asks for the after right after the before. Checked end to end on a Pro customer.
- [ ] **Live check of the model-written reel words.** Once the Anthropic key is in, render a few promos from the model's spec and compare with the offline writer.
- [x] **Light review step for graphics.** Each photo slide is read for where its subject is (the part whose colour stands out). If a card or caption would sit on it, the slide moves to the framed layout, and crops lean toward the subject. Checked on 8 real photos: both dogs had been half under the card and are now in full view. Before a carousel goes to the owner, run a cheap automatic check that the photo isn't covered by the card in the spot where the subject is.
- [x] **Unsourced claim in copy (F9).** Softened to "tend to get more response" in the text, the hint and the photo-walk page. The photo-walk nudge says photos get "roughly double the response". Drop the claim or soften it.

## 4. Housekeeping

- [x] **Schema drift (F10).** Fixed in the schema, not the database: the three ids now declare the database's own uuid default, and the unique index keeps its existing name. `prisma migrate diff` is empty against both the migrations and a live database, so nothing needs deploying. An `archetype_performance` index name and three id defaults differ from what Prisma expects. Add a migration so `prisma migrate diff` comes back empty.
- [x] **README is out of date.** Now names Handled, the real test commands, the real model defaults and what each key turns on. `.env.example` gained the R2, Postmark and admin variables the code reads. It still calls Anthropic, Post for Me, R2 and the crons "stubs". They are all wired now.
- [x] **Admin overview journey.** Customers by status, MRR by tier, leads, the media mix and photo asks all matched the database. Fixed: the failed-post count stopped at 25. Check that every number on the admin page matches the database for a seeded customer.
- [x] **Two clean QA rounds in a row.** Rerun every journey after the fixes. It's done when two rounds in a row turn up nothing new. Round 2 found 6, round 3 found 4, round 4 found 3, round 5 found 5, round 6 found 3 (all fixed). Rounds 7 and 8 were both clean.

## 5. Handled runs its own Instagram (dogfooding)

Handled should post and promote itself through the product, as a customer
would. Everything up to linking the account can be built now.

- [x] **A house account.** Built: `POST /admin/house-account` and a button on the admin page. One customer row for Handled itself: Pro tier, owner phone set to Nasser's, marked paid without a Stripe charge (a `house` customer id) and left out of MRR and lead counts. Made by an admin-only setup route, so nobody signs up or pays.
- [x] **Its brand profile, pre-filled.** Business type, voice, audience (local service owners with no time for social), offers ($95/$349/$699 plans, the free taste), the brand colours and fonts from the site, and do's and don'ts (no fake testimonials, no invented numbers). Written from the site's own copy, so onboarding has nothing left to ask.
- [x] **Its content plan.** Five starter posts are queued as owner requests, so the first plans build around them. Posts that sell by showing: before/after of a real small-business feed, a "this post was planned, written and designed by text" carousel, the text thread itself as a screenshot-style graphic, pricing, the free-taste offer. Uses the four sample businesses as the "after".
- [x] **Approvals go to Nasser by text,** like any owner, so nothing posts without his yes.
- [ ] **Nasser:** create the Instagram account (and a Facebook page if wanted), then link it through the normal connect link. That's the only step that needs him.
- [ ] **Promotion** (boosting posts) is spending money, so it stays off until he says yes and names a budget.

## Done in this pass

- [x] Post for Me linking recovers from a stale link, STOP and START work, the card-update link, re-subscribe after a cancel (`b6cf397`)
- [x] Referral credits land in Stripe on their own (`aab0ca5`)
- [x] Five text layouts, a framed photo layout and real font measuring (`0dc38dd`)
- [x] Reel hooks and captions wrap to fit, readable colours, the end card no longer squashed (`ffb7539`)
- [x] Captions moved off faces, bigger hooks, an end card that names the next step (`6c65f22`)
- [x] The homepage demo reel is re-cut through the real pipeline (`e404a00`)
- [x] Cancelling: a plan-cancel ask gets the billing link, and an ended plan no longer reads as a failed card (`26b084d`)
- [x] A yes to a draft whose slot has passed schedules it ahead, not in the past (`b0eaa58`)
- [x] Carousel covers and graphics are designed from scratch per post (Fable 5.2), checked for words, fit, colours, photo, contrast and hidden text, with the templates as the fallback (`87922b8`, `1ce57c2`). It only runs with a real Anthropic key.
- [x] QA round 2: six fixes, including a dropped "make the next one about…" ask, a free-taste "how do I sign up" that got the paywall, and quiet-hours texts that outlived a STOP.
- [x] QA round 3: four fixes, including "shift it to Friday" not moving the post and a paused account's posts never coming back.
- [x] A texted photo goes on the draft the owner was just shown, and that draft comes back with the photo for a yes (`7ccf21f`).
- [x] Times read "today", "tomorrow", a weekday within the week, or the date past that, so two different Tuesdays no longer look the same.
- [x] Coming back (START, paying again, a fixed card) with nothing lined up plans the week right away instead of waiting for Monday.
- [x] QA round 5: posts start the day after signup (a starter week) and the Monday run never plans a week twice; "at 7am instead" keeps the post's day; a queued graphic says how many drafts are ahead; a failed answer no longer promises a follow-up; a bare "I want to cancel" asks draft or plan.
- [x] QA round 6: three fixes. "Do one about our new beard trims" while a draft waits is saved for an upcoming post instead of being dropped, a bare "thanks" gets a short reply instead of the generic one, and "what do you actually do" gets the explanation instead of the paywall.
- [x] QA rounds 7 and 8: both clean. All three round 6 fixes held up.
- [x] A reel up for its yes comes with its watch link and says it's a reel (it used to be shown as a caption only, so the owner approved a video blind). A post with no slot of its own takes the first open time instead of tomorrow 9:00 on top of a planned post.
- [x] A new Growth or Pro owner's first week gets the same carousel safety net as the Monday plan: a post that came out with no visual gets a carousel instead of shipping as text. Before, the first week (the one that decides whether they stay) could be mostly text with a photo ask under each.
- [x] Offline mode (no key, or `LLM_FAKE=1`) answers any structured call with a valid placeholder, so local test runs now reach carousels and the steps behind them.
- [x] The email sign-up on `/start` is hidden, and refused by the backend, until Postmark works both ways. The page offers "email us" instead, so the no-phone path stays.
- [x] QA rounds 9 and 10: four reel fixes, then a clean Pro and Starter run. "Show me the reel" resends its link and says where it sits, a plain "make a reel" says where to send clips (and the no-footage options), a before and after with one photo asks for both instead of tacking it on a draft, and a bare "yes" after a reel text shows the draft that's up first instead of doing nothing.

## Only Nasser can do these

- Merge the PR and run `prisma migrate deploy` on the production database (new migrations, including `20261117c_post_requests`).
- Handled's own Instagram: create the account, press "Handled's own account" on the admin page and give it your phone, then open the connect link it shows and log in.
- Turn on the Stripe customer portal, so the "update your card" link works.
- Set the Post for Me redirect URL and run one live account-linking test.
- Add the Anthropic and OpenAI keys when you're ready for the all-out look (designed posts and top-quality photos).
- Sign in to Postmark and finish setting it up (sending and the inbound webhook), then set `NEXT_PUBLIC_EMAIL_SIGNUP=1` on the web app to show the email sign-up form again.
- Check the Twilio opt-out wording.
- When you want animated reels live: set `ANIMATED_REELS=1` on both Render services (aissm-backend and aissm-worker).
- Clean up the stray Vercel projects.
