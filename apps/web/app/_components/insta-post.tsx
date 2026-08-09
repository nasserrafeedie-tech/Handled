/**
 * A sample rendered as the thing it actually is: an Instagram post. The old
 * abstract tiles read as "content marketing"; a post frame — header, photo,
 * action row, caption under a handle — lets a shop owner picture this exact
 * thing on their own feed. Deliberately NO like counts or comment numbers:
 * we don't fabricate engagement any more than we fabricate reviews.
 */
export function InstaPost({
  handle,
  accent,
  image,
  alt,
  label,
  caption,
  hashtags,
}: {
  handle: string;
  /** Brand dot color for the avatar ring. */
  accent: string;
  image: string;
  alt: string;
  label: string;
  caption: string;
  hashtags?: string;
}) {
  return (
    <figure className="flex h-full w-full flex-col overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-soft">
      {/* Post header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {handle[0]?.toUpperCase()}
        </span>
        <span className="text-[13px] font-semibold text-ink">{handle}</span>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-clay-600">
          {label}
        </span>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={alt} loading="lazy" className="aspect-square w-full object-cover" />

      {/* Action row — icons only, no invented counts */}
      <div className="flex items-center gap-4 px-4 pt-3 text-ink/70" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l2-5.1a8.38 8.38 0 0 1-.9-3.9 8.5 8.5 0 0 1 8.4-8.5 8.38 8.38 0 0 1 8.5 8Z" />
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
        <svg className="ml-auto" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
        </svg>
      </div>

      {/* Caption, the way IG sets it: handle bolded into the first line */}
      <figcaption className="flex flex-1 flex-col px-4 pb-5 pt-2.5">
        <p className="line-clamp-[8] whitespace-pre-line text-[14px] leading-[1.55] text-ink/85">
          <span className="font-semibold text-ink">{handle}</span> {caption}
        </p>
        {hashtags && (
          <p className="mt-auto pt-2 text-[12px] leading-relaxed text-[#3b6ea5]/70">{hashtags}</p>
        )}
      </figcaption>
    </figure>
  );
}
