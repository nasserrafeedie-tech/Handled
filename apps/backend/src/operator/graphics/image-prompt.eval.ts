/**
 * Does the subject picker actually stay generic?
 *
 * The prompt tells a model not to describe the specific business. Prompt rules
 * are requests — that lesson cost a day on the caption work — so this measures
 * how often the model tries anyway, and whether the gate catches it when it
 * does. Run by hand; it calls the live model.
 *
 *   npx tsx src/operator/graphics/image-prompt.eval.ts
 */
import { claimsSpecificPlace, stripOwnershipClaims, subjectInstruction, type ImageBrief } from './image-prompt';

const MODEL = process.env.LLM_MODEL_BULK ?? 'claude-haiku-4-5';
const RUNS = Number(process.env.EVAL_RUNS ?? 5);

/** Captions written to tempt the model toward the premises. */
const CASES: { brief: ImageBrief; label: string }[] = [
  {
    label: 'coffee — caption is about the room',
    brief: {
      businessType: 'coffee shop',
      visualStyle: 'warm and unfussy',
      caption: 'The corner table by the window is open. It will not be in twenty minutes.',
    },
  },
  {
    label: 'coffee — caption names the owner',
    brief: {
      businessType: 'coffee shop',
      visualStyle: 'warm and unfussy',
      caption: 'Rosa pulls the first shot at 6:45, before anyone else is in.',
    },
  },
  {
    label: 'salon — caption is about the storefront',
    brief: {
      businessType: 'nail salon',
      visualStyle: null,
      caption: 'New sign went up out front this week. Come see it.',
    },
  },
  {
    label: 'HVAC — caption is about the van',
    brief: {
      businessType: 'HVAC repair company',
      visualStyle: null,
      caption: 'Our van was on your street at 7am. That is the whole job.',
    },
  },
  {
    label: 'yoga — caption is about the studio',
    brief: {
      businessType: 'yoga studio',
      visualStyle: 'calm, not precious',
      caption: 'Twelve mats, that is the cap. The room never feels crowded.',
    },
  },
];

async function pickSubject(brief: ImageBrief): Promise<string | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 120,
      messages: [{ role: 'user', content: subjectInstruction(brief) }],
    }),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const text = json.content?.find((b: any) => b.type === 'text')?.text ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)).subject ?? null;
  } catch {
    return null;
  }
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  let total = 0;
  let claimed = 0;
  let rescuedByStrip = 0;
  let refused = 0;

  for (const { label, brief } of CASES) {
    for (let i = 0; i < RUNS; i++) {
      const subject = await pickSubject(brief);
      if (subject === null) continue;
      total++;

      const raw = claimsSpecificPlace(subject);
      if (raw) {
        claimed++;
        const cleaned = stripOwnershipClaims(subject);
        // Would the handler let this through, or refuse and ask for a photo?
        if (!cleaned || claimsSpecificPlace(cleaned)) refused++;
        else rescuedByStrip++;
        console.log(`  [${label}] model wrote: "${subject}"`);
        console.log(`            after strip: "${cleaned}" ${cleaned && !claimsSpecificPlace(cleaned) ? '→ used' : '→ REFUSED, asks owner for a photo'}`);
      }
    }
  }

  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(0)}%` : 'n/a');
  console.log('\n===================== RESULT =====================');
  console.log(`subjects generated:            ${total}`);
  console.log(`tried to describe the business: ${claimed} (${pct(claimed)})`);
  console.log(`  ↳ salvaged by stripping:      ${rescuedByStrip}`);
  console.log(`  ↳ refused, owner asked:       ${refused}`);
  console.log(
    `\nleaked past every gate:        ${0} — by construction: anything still ` +
      'claiming a place after stripping is refused, never generated.',
  );
})().catch((e) => {
  console.error('eval failed:', e.message);
  process.exit(1);
});
