import { tierHasCarousel } from './carousel-content';

interface Deps {
  findMedia: (postId: string) => Promise<{ mediaRefs: string[] } | null>;
  makeCarousel: (postId: string) => Promise<unknown>;
}

/**
 * The carousel safety net, shared by the first week and the Monday plan. A
 * post that should have had a visual but came out with none (an AI image the
 * place-guard declined, no image key, an archetype the carousel set doesn't
 * know) would ship as bare text. On a carousel plan that's never right: a
 * carousel needs no photo and can't be declined, so make one. Posts waiting
 * on the owner's own photo are left alone.
 *
 * It used to live only in the Monday plan, so a new Growth or Pro owner's
 * first week (the week that decides whether they stay) came out mostly as
 * text with a "text me a photo" under each.
 */
export async function ensureVisual(
  deps: Deps,
  post: { id: string; needsAsset: boolean; planTier: string },
): Promise<boolean> {
  if (post.needsAsset || !tierHasCarousel(post.planTier)) return false;
  const persisted = await deps.findMedia(post.id);
  if (!persisted || persisted.mediaRefs.length > 0) return false;
  await deps.makeCarousel(post.id);
  return true;
}
