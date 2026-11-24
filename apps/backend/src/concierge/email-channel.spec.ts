import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { forEmail } from './concierge.service';
import { postableAttachments, inboundText, EmailInboundController } from './email-inbound.controller';

describe('copy sent by email talks about email', () => {
  it('turns texting words into emailing words', () => {
    assert.equal(
      forEmail('📸 Text me a photo and I’ll put it on this post. I\'ll text you the second it\'s ready.'),
      '📸 Email me a photo and I’ll put it on this post. I\'ll email you the second it\'s ready.',
    );
    assert.equal(forEmail('Anything you text me can become a post.'), 'Anything you email me can become a post.');
  });

  it('leaves words that only contain "text" alone', () => {
    assert.equal(forEmail('Reply yes to post as text-only. Context matters.'), 'Reply yes to post as text-only. Context matters.');
  });
});

describe('photos emailed back are kept like an MMS', () => {
  const big = Buffer.alloc(20 * 1024, 1).toString('base64');
  it('keeps images and video, skips documents and signature icons', () => {
    const got = postableAttachments([
      { Name: 'shop.jpg', ContentType: 'image/jpeg', Content: big },
      { Name: 'clip.mov', ContentType: 'video/quicktime', Content: big },
      { Name: 'menu.pdf', ContentType: 'application/pdf', Content: big },
      { Name: 'icon.png', ContentType: 'image/png', Content: Buffer.alloc(800).toString('base64') },
    ]);
    assert.deepEqual(got.map((g) => g.contentType), ['image/jpeg', 'video/quicktime']);
    assert.equal(got[0].bytes.length, 20 * 1024);
  });

  it('handles an email with no attachments', () => {
    assert.deepEqual(postableAttachments(undefined), []);
  });
});

describe('the words of an inbound email', () => {
  it('reads a fresh email, where Postmark sends StrippedTextReply as ""', () => {
    assert.equal(inboundText({ StrippedTextReply: '', TextBody: 'Hi, can you post about our sale?\n' }), 'Hi, can you post about our sale?');
  });
  it('prefers the stripped reply when there is one', () => {
    assert.equal(inboundText({ StrippedTextReply: 'YES', TextBody: 'YES\n\nOn Mon, Handled wrote: ...' }), 'YES');
  });
  it('falls back to the subject when the body is empty', () => {
    assert.equal(inboundText({ StrippedTextReply: '', TextBody: '  ', Subject: 'Post the new menu' }), 'Post the new menu');
  });
  it('is empty only when there is nothing at all', () => {
    assert.equal(inboundText({}), '');
  });

  it('hands a fresh email to the concierge instead of dropping it', async () => {
    const handled: Array<{ from: string; body: string }> = [];
    const c = new EmailInboundController(
      { handleInbound: async (m: { from: string; body: string }) => void handled.push(m) } as never,
      { put: async () => undefined, publicUrl: (k: string) => k } as never,
    );
    const prev = process.env.EMAIL_INBOUND_SECRET;
    process.env.EMAIL_INBOUND_SECRET = 's';
    try {
      await c.inbound('s', { From: 'owner@example.com', StrippedTextReply: '', TextBody: 'hello there', MessageID: 'm1' });
    } finally {
      if (prev === undefined) delete process.env.EMAIL_INBOUND_SECRET;
      else process.env.EMAIL_INBOUND_SECRET = prev;
    }
    assert.deepEqual(handled.map((h) => [h.from, h.body]), [['owner@example.com', 'hello there']]);
  });
});
