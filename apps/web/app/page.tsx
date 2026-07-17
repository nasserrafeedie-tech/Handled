export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">
        Your social media, handled.
      </h1>
      <p className="text-neutral-600">
        We run your posts almost entirely on our own — planning, writing,
        scheduling, and publishing. You just reply to our texts. The done-for-you
        alternative to a $1,500/mo agency.
      </p>
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-2 font-medium">Two things to do here</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            <a className="underline" href="/connect">
              Connect your social accounts
            </a>{' '}
            (Instagram, Facebook, TikTok, and more).
          </li>
          <li>Set up billing. Everything else happens over text.</li>
        </ol>
      </div>
      <p className="text-sm text-neutral-500">
        Already set up? Just check your texts — that&apos;s where we live.
      </p>
    </main>
  );
}
