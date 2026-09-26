/**
 * Semantic search: embeddings for matching resume text to job requirements. Retrieval, not
 * generation — an embedding model can only RANK text that already exists on the resume, so it
 * can't invent anything. Vectors are cached; when no embedding provider works the callers fall
 * back to the deterministic matcher (this returns null — it never returns made-up similarities).
 */
import "server-only";
import { createCache } from "./cache";
import { AiHttpError, AiNotConfiguredError, chainFor, embedWith, runChain, type AiConfig } from "./client";

// 6 hours: resume bullets and posting lines are re-matched constantly while editing.
const vectors = createCache(4000, 6 * 60 * 60_000);
export const clearEmbeddingCache = () => vectors.clear();

const BATCH = 32;
const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 2000);

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function embedAll(cfg: AiConfig, texts: string[], kind: "query" | "passage", timeoutMs: number): Promise<number[][]> {
  const out: (number[] | undefined)[] = texts.map((t) => vectors.get<number[]>(vectors.key([cfg.provider, cfg.model, kind, t])));
  const missing = [...new Set(texts.filter((_, i) => !out[i]))];
  const fresh = new Map<string, number[]>();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const vs = await embedWith(cfg, batch, kind, timeoutMs);
    batch.forEach((t, j) => { fresh.set(t, vs[j]); vectors.set(vectors.key([cfg.provider, cfg.model, kind, t]), vs[j]); });
  }
  return texts.map((t, i) => out[i] ?? fresh.get(t)!);
}

export type Embedded = { queries: number[][]; passages: number[][]; model: string };

/**
 * Embed requirement text (queries) and resume text (passages) with ONE model — vectors from
 * different models aren't comparable, so a fallback model re-embeds both. Returns null when no
 * embedding provider is configured or every one failed (the failure is logged, never thrown).
 */
export async function embedForMatching(queryTexts: string[], passageTexts: string[]): Promise<Embedded | null> {
  const queries = queryTexts.map(clip);
  const passages = passageTexts.map(clip);
  if (!queries.length || !passages.length) return null;
  const chain = chainFor("semantic_search", { generic: false });
  if (!chain.length) return null;
  try {
    const { value, cfg } = await runChain("semantic_search", chain, async (cfg, timeoutMs) => ({
      queries: await embedAll(cfg, queries, "query", timeoutMs),
      passages: await embedAll(cfg, passages, "passage", timeoutMs),
    }), { timeoutMs: 20_000, budgetMs: 30_000 });
    return { ...value, model: `${cfg.provider}:${cfg.model}` };
  } catch (e) {
    if (e instanceof AiHttpError || e instanceof AiNotConfiguredError) return null;
    throw e;
  }
}

/** For each query, the best-scoring passage at or above `min`. */
export function bestMatches(e: Embedded, min: number): { query: number; passage: number; score: number }[] {
  const out: { query: number; passage: number; score: number }[] = [];
  e.queries.forEach((q, qi) => {
    let best = -1, bi = -1;
    e.passages.forEach((p, pi) => { const s = cosine(q, p); if (s > best) { best = s; bi = pi; } });
    if (bi >= 0 && best >= min) out.push({ query: qi, passage: bi, score: Math.round(best * 1000) / 1000 });
  });
  return out;
}
