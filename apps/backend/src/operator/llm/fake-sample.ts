import { z } from 'zod';

/**
 * A plain, valid value for a zod schema: what offline mode (no Anthropic key,
 * or LLM_FAKE=1) answers when its canned replies don't fit the shape asked
 * for. Without it every structured call other than a plan or a caption failed
 * offline, so local test runs never reached carousels, design checks or any
 * other step behind one; now they run end to end on placeholder words.
 */
export function fakeSample(schema: z.ZodTypeAny, depth = 0): unknown {
  if (depth > 12) return null;
  const def = (schema as { _def: { typeName: string } & Record<string, any> })._def;
  switch (def.typeName) {
    case 'ZodString': {
      const min = def.checks?.find((c: any) => c.kind === 'min')?.value ?? 0;
      const max = def.checks?.find((c: any) => c.kind === 'max')?.value ?? 200;
      if (def.checks?.some((c: any) => c.kind === 'url')) return 'https://example.com';
      if (def.checks?.some((c: any) => c.kind === 'uuid')) return '00000000-0000-4000-8000-000000000000';
      if (def.checks?.some((c: any) => c.kind === 'datetime')) return new Date().toISOString();
      let s = 'Fresh look, same friendly faces';
      while (s.length < min) s += ' and more';
      return s.slice(0, Math.max(min, Math.min(max, s.length)));
    }
    case 'ZodNumber': {
      const min = def.checks?.find((c: any) => c.kind === 'min')?.value;
      const max = def.checks?.find((c: any) => c.kind === 'max')?.value;
      return min ?? (max !== undefined ? Math.min(0, max) : 0);
    }
    case 'ZodBoolean':
      return false;
    case 'ZodLiteral':
      return def.value;
    case 'ZodEnum':
      return def.values[0];
    case 'ZodNativeEnum':
      return Object.values(def.values)[0];
    case 'ZodArray': {
      const n = Math.max(def.minLength?.value ?? 0, def.exactLength?.value ?? 0, 1);
      const capped = def.maxLength ? Math.min(n, def.maxLength.value) : n;
      return Array.from({ length: capped }, () => fakeSample(def.type, depth + 1));
    }
    case 'ZodObject': {
      const shape = def.shape();
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const t = (v as any)._def.typeName;
        if (t === 'ZodOptional') continue;
        out[k] = fakeSample(v as z.ZodTypeAny, depth + 1);
      }
      return out;
    }
    case 'ZodOptional':
    case 'ZodNullable':
      return fakeSample(def.innerType, depth + 1);
    case 'ZodDefault':
      return def.defaultValue();
    case 'ZodEffects':
      return fakeSample(def.schema, depth + 1);
    case 'ZodPipeline':
      return fakeSample(def.in, depth + 1);
    case 'ZodUnion':
      return fakeSample(def.options[0], depth + 1);
    case 'ZodDiscriminatedUnion':
      return fakeSample(def.options[0] ?? [...def.optionsMap.values()][0], depth + 1);
    case 'ZodRecord':
      return {};
    case 'ZodTuple':
      return def.items.map((i: z.ZodTypeAny) => fakeSample(i, depth + 1));
    case 'ZodLazy':
      return fakeSample(def.getter(), depth + 1);
    default:
      return null;
  }
}
