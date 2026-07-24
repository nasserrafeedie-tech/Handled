import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { TranscriptionService, normalizeWhisperResponse } from './transcription.service';

/**
 * The network call cannot run here (no key in the sandbox, and outbound calls
 * to OpenAI have been unreliable from it), so what is tested is the part that
 * breaks silently: parsing whatever the vendor returned, and the promise that
 * a failure costs captions rather than the reel.
 */

describe('parsing the transcription response', () => {
  it('reads word timings out of a normal response', () => {
    const t = normalizeWhisperResponse({
      text: 'fresh bread daily',
      words: [
        { word: 'fresh', start: 0, end: 0.4 },
        { word: 'bread', start: 0.4, end: 0.9 },
        { word: 'daily', start: 0.9, end: 1.3 },
      ],
    });
    assert.equal(t.words.length, 3);
    assert.deepEqual(t.words.map((w) => w.text), ['fresh', 'bread', 'daily']);
  });

  it('trims the padding the API puts around each word', () => {
    // Whisper returns words with leading spaces; left in, every caption line
    // renders with a visible gap before it.
    const t = normalizeWhisperResponse({ words: [{ word: ' hello ', start: 0, end: 1 }] });
    assert.equal(t.words[0].text, 'hello');
  });

  it('discards words with timings that cannot be rendered', () => {
    // A zero-length or reversed word would produce a caption event that libass
    // drops, taking the neighbouring line's timing with it.
    const t = normalizeWhisperResponse({
      words: [
        { word: 'ok', start: 0, end: 0.5 },
        { word: 'zero', start: 1, end: 1 },
        { word: 'reversed', start: 3, end: 2 },
        { word: 'nan', start: NaN, end: 1 },
      ],
    });
    assert.deepEqual(t.words.map((w) => w.text), ['ok']);
  });

  it('survives a response with no words field at all', () => {
    // Silent footage, or a vendor that changed its shape. Either way this must
    // return an empty transcript rather than throw into the reel pipeline.
    const t = normalizeWhisperResponse({ text: '' });
    assert.deepEqual(t.words, []);
    assert.equal(t.text, '');
  });

  it('reconstructs the text when only words came back', () => {
    const t = normalizeWhisperResponse({
      words: [{ word: 'a', start: 0, end: 1 }, { word: 'b', start: 1, end: 2 }],
    });
    assert.equal(t.text, 'a b');
  });
});

describe('degrading without a key', () => {
  it('returns an empty transcript instead of throwing', async () => {
    // The whole contract of this service: no key means no captions, never a
    // failed reel. A throw here would surface to the owner as "I hit a snag".
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const out = await new TranscriptionService().transcribe('/nonexistent/clip.mp4');
      assert.deepEqual(out.words, []);
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });

  it('returns an empty transcript for a file that is not there', async () => {
    process.env.OPENAI_API_KEY = 'test-key-not-used';
    try {
      const out = await new TranscriptionService().transcribe('/nonexistent/clip.mp4');
      assert.deepEqual(out.words, []);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
