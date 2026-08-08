'use client';

import { useEffect, useState } from 'react';

/**
 * Universal-link suppression interstitial. iOS hands instagram.com links to
 * the Instagram APP when the navigation comes straight from a user tap — and
 * the app's OAuth picker is broken ("Something went wrong", seen live), while
 * the web picker works. A navigation that happens WITHOUT fresh user
 * activation (this page's automatic forward) stays in Safari, where the web
 * OAuth flow renders like it does on desktop.
 *
 * The destination is allowlisted to the OAuth hosts we actually use — this
 * page must never become an open redirect.
 */
const ALLOWED_HOSTS = [
  'www.instagram.com',
  'instagram.com',
  'www.facebook.com',
  'facebook.com',
  'm.facebook.com',
  'www.tiktok.com',
  'accounts.google.com',
  'app.postforme.dev',
  'api.postforme.dev',
];

export default function ConnectGoPage() {
  const [target, setTarget] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('u');
    if (!raw) {
      setBad(true);
      return;
    }
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.host)) {
        setBad(true);
        return;
      }
      setTarget(url.toString());
      // The beat matters: forwarding outside the tap's activation window is
      // what keeps iOS from bouncing to the native app.
      const t = setTimeout(() => window.location.replace(url.toString()), 350);
      return () => clearTimeout(t);
    } catch {
      setBad(true);
    }
  }, []);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-28 text-center">
      {!bad ? (
        <>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-parchment text-xl">
            🔐
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Taking you to sign in…
          </h1>
          <p className="text-ink/60">
            You&rsquo;ll sign in on the platform&rsquo;s own website — that&rsquo;s
            the reliable route on phones.
          </p>
          {target && (
            <a href={target} className="link-draw text-sm font-medium text-clay-600">
              Nothing happening? Tap here.
            </a>
          )}
        </>
      ) : (
        <p className="text-ink/60">
          That link didn&rsquo;t look right — head back and tap Connect again.
        </p>
      )}
    </main>
  );
}
