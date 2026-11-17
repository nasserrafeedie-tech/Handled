import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { forEmail } from './concierge.service';
import { postableAttachments } from './email-inbound.controller';

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
