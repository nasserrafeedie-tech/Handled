import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaybookArchetype } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePlaybookDoc, renderPlaybookDoc } from './playbook-doc';
import { normalizeBusinessType } from './playbook.types';

/**
 * The archetype store: read, import, and mirror back to Markdown.
 *
 * The DB is the source of truth; `social-playbook.md` is a rendered view of it
 * (engine spec, "The core idea"). The seed copy of that doc ships inside the
 * repo so a fresh deploy can import without the operator's home folder — the
 * copy in ~/handled-hq stays Nasser's editable working copy and can be
 * re-imported over the top.
 */
@Injectable()
export class PlaybookService {
  private readonly log = new Logger(PlaybookService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The in-repo seed copy, resolved from this module's own location rather
   * than cwd — the backend is started from the repo root on Render, from
   * apps/backend in scripts, and from dist/ in production. Two levels up from
   * `playbook/` is `apps/backend/` in both the src and dist layouts.
   */
  private seedDocPath(): string {
    return join(__dirname, '..', '..', 'prisma', 'seed', 'social-playbook.md');
  }

  /** Where to import FROM. Overridable to pull in the ~/handled-hq copy. */
  private docPath(): string {
    return process.env.PLAYBOOK_DOC_PATH ?? this.seedDocPath();
  }

  async all(): Promise<PlaybookArchetype[]> {
    return this.prisma.playbookArchetype.findMany({ orderBy: { slug: 'asc' } });
  }

  async bySlug(slug: string): Promise<PlaybookArchetype | null> {
    return this.prisma.playbookArchetype.findUnique({ where: { slug } });
  }

  /**
   * Import every archetype from the Markdown doc.
   *
   * Upsert, not insert: re-running is safe, and it's how Nasser's hand edits
   * get pulled back in (last-writer-wins, per the spec). Researched rows are
   * NOT downgraded back to "seed" by a re-import of the seed file.
   */
  async importFromDoc(path?: string): Promise<{ imported: number; slugs: string[] }> {
    const file = path ?? this.docPath();
    if (!existsSync(file)) {
      throw new Error(`Playbook doc not found at ${file}`);
    }
    const parsed = parsePlaybookDoc(readFileSync(file, 'utf8'));

    const slugs: string[] = [];
    for (const a of parsed) {
      const fields = {
        title: a.title,
        mapsFrom: a.mapsFrom,
        platforms: a.platforms,
        pillars: a.pillars,
        topFormats: a.topFormats,
        cadence: a.cadence,
        reels: a.reels,
        photoStyle: a.photoStyle,
        captionHooks: a.captionHooks,
        discovery: a.discovery,
        offers: a.offers,
        seasonal: a.seasonal,
        mistakes: a.mistakes,
        revenueMetric: a.revenueMetric,
        researchedAt: a.researchedAt,
      };
      await this.prisma.playbookArchetype.upsert({
        where: { slug: a.slug },
        create: { slug: a.slug, ...fields, status: a.status, confidence: 1 },
        // Content updates on re-import, but never clobber a row that research
        // has since enriched (status/confidence/sources/usageCount stay put).
        update: fields,
      });
      slugs.push(a.slug);
    }
    this.log.log(`playbook import: ${slugs.length} archetypes from ${file}`);
    return { imported: slugs.length, slugs };
  }

  /**
   * Regenerate the human-readable doc from the DB (engine Flow 2 step 4 /
   * task 13). Writes both the in-repo seed copy and, when present, the
   * operator's working copy in ~/handled-hq.
   */
  async regenerateDoc(): Promise<{ written: string[] }> {
    const rows = await this.all();
    const seedPath = this.seedDocPath();
    if (!existsSync(seedPath)) {
      throw new Error(`Cannot regenerate: template missing at ${seedPath}`);
    }
    const rendered = renderPlaybookDoc(
      readFileSync(seedPath, 'utf8'),
      rows.map((r) => ({
        title: r.title,
        mapsFrom: r.mapsFrom,
        platforms: r.platforms,
        pillars: r.pillars,
        topFormats: r.topFormats,
        cadence: r.cadence,
        reels: r.reels,
        photoStyle: r.photoStyle,
        captionHooks: r.captionHooks,
        discovery: r.discovery,
        offers: r.offers,
        seasonal: r.seasonal,
        mistakes: r.mistakes,
        revenueMetric: r.revenueMetric,
        researchedAt: r.researchedAt,
        status: r.status,
        confidence: r.confidence,
      })),
    );

    const written: string[] = [];
    for (const target of [seedPath, process.env.PLAYBOOK_DOC_PATH].filter(
      (p): p is string => Boolean(p),
    )) {
      try {
        writeFileSync(target, rendered, 'utf8');
        written.push(target);
      } catch (err) {
        // A read-only filesystem (Render) must never fail the research job.
        this.log.warn(`could not write playbook doc to ${target}: ${String(err)}`);
      }
    }
    return { written };
  }

  /** Attach an archetype to a customer and count the usage. */
  async attach(
    customerId: string,
    slug: string,
    confidence: number,
  ): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { archetypeSlug: slug, archetypeConfidence: confidence },
    });
    await this.prisma.playbookArchetype.update({
      where: { slug },
      data: { usageCount: { increment: 1 } },
    });
    this.log.log(`archetype ${slug} attached to ${customerId} (${confidence.toFixed(2)})`);
  }

  /**
   * Does an archetype already cover this business type? Cheap pre-check that
   * keeps two "axe-throwing venue" signups from researching the same thing
   * twice (engine Flow 2 step 1).
   */
  async findByBusinessType(businessType: string): Promise<PlaybookArchetype | null> {
    const needle = normalizeBusinessType(businessType);
    if (!needle) return null;
    const rows = await this.all();
    for (const row of rows) {
      const haystack = [row.title, ...row.mapsFrom].map(normalizeBusinessType);
      if (haystack.some((h) => h === needle)) return row;
    }
    // Looser pass: the owner's words contain a synonym, or vice versa.
    for (const row of rows) {
      const haystack = row.mapsFrom.map(normalizeBusinessType).filter((h) => h.length >= 4);
      if (haystack.some((h) => needle.includes(h) || h.includes(needle))) return row;
    }
    return null;
  }
}
