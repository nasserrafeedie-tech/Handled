import { z } from 'zod';

/**
 * Web-search-backed research against the Anthropic Messages API.
 *
 * The rest of the product asks Claude what it already knows. This asks Claude
 * to go and *find out* — the server-side `web_search` tool runs real searches,
 * and every claim comes back with a citation we keep. That distinction is the
 * whole point of the Playbook Engine: what compounds in the archetype store
 * should be researched knowledge with sources, not the model's recall.
 *
 * Kept separate from LlmService because the mechanics genuinely differ:
 * a multi-turn server-tool loop (`pause_turn`), content blocks that must be
 * echoed back byte-identical (`encrypted_content`), and citations to harvest.
 */

/** One source Claude actually cited, kept on the archetype for auditability. */
export const ResearchSource = z.object({
  url: z.string(),
  title: z.string(),
  /** The sentence the model drew from — makes a claim checkable later. */
  quote: z.string().optional(),
  /** How fresh the page was, when the search engine reported it. */
  pageAge: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSource>;

export interface ResearchResult<T> {
  data: T;
  sources: ResearchSource[];
  /** How many billed searches this pass actually used ($0.01 each). */
  searches: number;
}

/**
 * Cap on searches per research pass. Web search bills at $10 per 1,000
 * ($0.01 each), so this is the cost ceiling for one new business type —
 * a one-time spend amortized across every customer of that vertical.
 */
export const MAX_SEARCHES_PER_PASS = 8;

type ContentBlock = {
  type: string;
  text?: string;
  citations?: Array<{
    type?: string;
    url?: string;
    title?: string;
    cited_text?: string;
  }>;
};

type ApiResponse = {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: { server_tool_use?: { web_search_requests?: number } };
};

/** Pull every distinct source Claude cited out of the response blocks. */
export function harvestCitations(blocks: ContentBlock[]): ResearchSource[] {
  const byUrl = new Map<string, ResearchSource>();
  for (const block of blocks) {
    for (const c of block.citations ?? []) {
      if (!c.url) continue;
      if (byUrl.has(c.url)) continue;
      byUrl.set(c.url, {
        url: c.url,
        title: c.title ?? c.url,
        quote: c.cited_text?.slice(0, 300),
      });
    }
    // Search result blocks carry page_age, which citations don't.
    const results = (block as { content?: unknown }).content;
    if (Array.isArray(results)) {
      for (const r of results as Array<Record<string, unknown>>) {
        const url = typeof r.url === 'string' ? r.url : null;
        if (!url) continue;
        const existing = byUrl.get(url);
        const pageAge = typeof r.page_age === 'string' ? r.page_age : undefined;
        if (existing) {
          if (pageAge && !existing.pageAge) existing.pageAge = pageAge;
        } else {
          byUrl.set(url, {
            url,
            title: typeof r.title === 'string' ? r.title : url,
            pageAge,
          });
        }
      }
    }
  }
  return [...byUrl.values()];
}

/** Concatenate the assistant's prose across every block of every turn. */
export function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

/**
 * Pull the outermost JSON object out of mixed prose.
 *
 * Without search the model returns bare JSON; with search it narrates first
 * ("I'll look up how barbershops…") and the JSON lands mid-answer. Scans for a
 * balanced `{...}`, ignoring braces inside strings.
 */
export function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const haystack = fenced ? fenced[1] : text;

  const start = haystack.indexOf('{');
  if (start === -1) return haystack.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return haystack.slice(start).trim();
}

export interface ResearchRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  maxSearches?: number;
  /** Steer the search itself — e.g. bias toward 2025-2026 sources. */
  searchHint?: string;
}

/**
 * Run one research pass and return the raw text plus its citations.
 *
 * Handles the server-tool loop: a long search turn comes back with
 * `stop_reason: "pause_turn"`, and continuing means sending the assistant's
 * blocks back **exactly** as received — `encrypted_content` included, or the
 * API rejects the turn.
 */
export async function researchWithSearch(
  req: ResearchRequest,
): Promise<{ text: string; sources: ResearchSource[]; searches: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('web research requires ANTHROPIC_API_KEY');

  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: req.prompt },
  ];
  const allBlocks: ContentBlock[] = [];
  let searches = 0;

  // Each pause_turn is one more round trip; cap it so a pathological loop
  // can't run up the bill.
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 3000,
        system: req.system,
        messages,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: req.maxSearches ?? MAX_SEARCHES_PER_PASS,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Anthropic API ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }

    const data = (await res.json()) as ApiResponse;
    const blocks = data.content ?? [];
    allBlocks.push(...blocks);
    searches += data.usage?.server_tool_use?.web_search_requests ?? 0;

    if (data.stop_reason !== 'pause_turn') break;

    // Echo the assistant turn back untouched to resume the search.
    messages.push({ role: 'assistant', content: blocks });
  }

  return {
    text: textOf(allBlocks),
    sources: harvestCitations(allBlocks),
    searches,
  };
}
