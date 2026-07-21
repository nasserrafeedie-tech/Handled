/**
 * How often does a real generation read as machine-written, and does the
 * pipeline actually fix it?
 *
 * Not a unit test — it costs money and calls the live model, so it is run by
 * hand when the prompt or the detector changes:
 *
 *   npx tsx src/operator/llm/slop.eval.ts
 *
 * It exists because the first version of the anti-slop work was shipped on a
 * single sample from a single business, which showed a difference that turned
 * out to be noise. Thin brand profiles are where models reach for filler, so
 * the sample here deliberately spans well-specified and bare businesses.
 */
import { playbookFor } from './playbook';
import { polishCaption } from './caption-polish';
import { detectSlop, shouldRegenerate, slopFeedback } from './slop';

const MODEL = process.env.LLM_MODEL_BULK ?? 'claude-haiku-4-5';
const RUNS = Number(process.env.EVAL_RUNS ?? 3);

/** Spread across verticals and across how much we know about the business. */
const BRANDS = [
  {
    label: 'coffee (rich profile)',
    brand: `Business: Rosa's Coffee, an independent coffee shop in Highland Park, Los Angeles.
Voice: warm, unfussy, a bit dry. Rosa has run it for nine years.
Detail: espresso pulled on beans roasted eight blocks away. The corner table by the window is the good one. Open 7am-4pm.`,
  },
  {
    label: 'nail salon (bare profile)',
    brand: `Business: a nail salon in Fresno.\nVoice: unknown.`,
  },
  {
    label: 'HVAC (bare profile)',
    brand: `Business: an HVAC repair company in Phoenix.\nVoice: unknown.`,
  },
  {
    label: 'yoga studio (medium profile)',
    brand: `Business: Still Point, a yoga studio in Austin.
Voice: calm, not precious. Owner teaches most classes herself.
Detail: 12 mats maximum. Two beginner classes a week.`,
  },
];

const ARCHETYPES = ['behind_the_scenes', 'promotional', 'educational'];

async function call(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 200)}`);

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`API returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (json.stop_reason === 'max_tokens') {
    throw new Error('hit max_tokens before finishing the JSON');
  }
  const text = json.content?.find((b: any) => b.type === 'text')?.text ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`no JSON object in model output: ${text.slice(0, 200)}`);
  }
  const caption = JSON.parse(text.slice(start, end + 1)).caption;
  if (typeof caption !== 'string') throw new Error('no caption field');
  return caption;
}

/**
 * One sample, or null if the model misbehaved — a bad draw shouldn't end the
 * run. Retries transient overloads, since dropped samples bias a rate.
 */
async function tryCall(system: string, user: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await call(system, user);
    } catch (e) {
      const msg = (e as Error).message;
      const transient = /529|overloaded|429|rate.limit|500|502|503/i.test(msg);
      if (!transient || attempt === 3) {
        console.warn(`  (skipped a sample: ${msg.slice(0, 120)})`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  return null;
}

/** The playbook with the anti-slop guidance stripped, as a control. */
function withoutSlopRules(platform: 'instagram'): string {
  return playbookFor(platform)
    .split('\n')
    .filter((l) => !/read as machine-written|Vary sentence length/.test(l))
    .join('\n');
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const rules = playbookFor('instagram');
  const control = withoutSlopRules('instagram');
  const tally = {
    control: { total: 0, dirty: 0, findings: [] as string[] },
    prompt: { total: 0, dirty: 0, findings: [] as string[] },
    pipeline: { total: 0, dirty: 0, findings: [] as string[] },
  };
  // Does corrective feedback actually repair a caption that has already tripped?
  // The prompt rules catch most slop before the retry ever runs, so the repair
  // path is measured directly against control drafts that did trip.
  const repair = { attempted: 0, fixed: 0, improved: 0 };

  for (const { label, brand } of BRANDS) {
    for (const archetype of ARCHETYPES) {
      for (let i = 0; i < RUNS; i++) {
        const user = `Write one ${archetype} post for instagram.\nReturn JSON: {"caption": string, "hashtags": string[]}`;

        // 1. No anti-slop rules at all.
        const rawA = await tryCall(`${brand}\n\n${control}`, user);
        if (rawA === null) continue;
        const a = polishCaption(rawA);
        const fa = detectSlop(a);
        tally.control.total++;
        if (fa.length) { tally.control.dirty++; tally.control.findings.push(...fa.map((f) => f.name)); }

        // 1b. Hand that tripped control draft to the repair path, so the retry
        //     is measured on the cases it exists for.
        if (shouldRegenerate(fa)) {
          repair.attempted++;
          const fixedRaw = await tryCall(
            `${brand}\n\n${control}`,
            `${user}\n\n${slopFeedback(fa, a)}`,
          );
          if (fixedRaw !== null) {
            const after = detectSlop(polishCaption(fixedRaw));
            if (after.length === 0) repair.fixed++;
            if (after.length < fa.length) repair.improved++;
          }
        }

        // 2. Rules in the prompt only.
        const rawB = await tryCall(`${brand}\n\n${rules}`, user);
        if (rawB === null) continue;
        const b = polishCaption(rawB);
        const fb = detectSlop(b);
        tally.prompt.total++;
        if (fb.length) { tally.prompt.dirty++; tally.prompt.findings.push(...fb.map((f) => f.name)); }

        // 3. Full pipeline: rules, then a corrective retry when it still trips.
        let c = b;
        let fc = fb;
        if (shouldRegenerate(fb)) {
          const rawRetry = await tryCall(
            `${brand}\n\n${rules}`,
            `${user}\n\n${slopFeedback(fb, b)}`,
          );
          if (rawRetry !== null) {
            const retry = polishCaption(rawRetry);
            const after = detectSlop(retry);
            if (after.length < fb.length) { c = retry; fc = after; }
          }
        }
        tally.pipeline.total++;
        if (fc.length) { tally.pipeline.dirty++; tally.pipeline.findings.push(...fc.map((f) => f.name)); }

        if (fa.length !== fc.length) {
          console.log(`\n[${label} / ${archetype}]`);
          if (fa.length) console.log(`  control  (${fa.map((f) => f.name).join(',')}): ${a.slice(0, 110)}…`);
          if (fc.length) console.log(`  pipeline (${fc.map((f) => f.name).join(',')}): ${c.slice(0, 110)}…`);
          else console.log(`  pipeline (clean): ${c.slice(0, 110)}…`);
        }
      }
    }
  }

  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(0)}%`;
  const top = (xs: string[]) => {
    const counts = new Map<string, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}×${v}`).join(', ') || '(none)';
  };

  console.log('\n======================= RESULT =======================');
  for (const [name, t] of Object.entries(tally)) {
    console.log(
      `${name.padEnd(9)} ${String(t.dirty).padStart(3)}/${t.total} captions tripped (${pct(t.dirty, t.total)})  ${top(t.findings)}`,
    );
  }
  console.log(
    `\nrepair path: ${repair.attempted} attempted, ${repair.fixed} came back clean` +
      (repair.attempted
        ? ` (${pct(repair.fixed, repair.attempted)}), ${repair.improved} improved`
        : ' — never triggered, so unmeasured'),
  );
})().catch((e) => {
  console.error('eval failed:', e.message);
  process.exit(1);
});
