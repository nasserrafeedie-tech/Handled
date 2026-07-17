const PLATFORMS = [
  'Instagram',
  'Facebook',
  'TikTok',
  'X',
  'LinkedIn',
  'Threads',
  'YouTube',
] as const;

/**
 * Account connect surface. OAuth to each platform is brokered by Post for Me —
 * owners connect *their* accounts to *our* app (§2). The buttons below are the
 * entry points; each kicks off a Post for Me connect flow (wired server-side).
 */
export default function ConnectPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">
        Connect your accounts
      </h1>
      <p className="text-neutral-600">
        Link the platforms you want us to post to. You can revoke access anytime.
      </p>
      <ul className="grid grid-cols-2 gap-3">
        {PLATFORMS.map((p) => (
          <li key={p}>
            <button
              type="button"
              className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left text-sm font-medium hover:border-neutral-400"
            >
              Connect {p}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500">
        Connections are handled securely through Post for Me. We never see your
        passwords; access tokens are encrypted at rest.
      </p>
    </main>
  );
}
