/**
 * Small in-memory TTL cache for model results and embeddings (per server instance). Keys are
 * SHA-1 hashes of the request, so the cache never stores or exposes a readable prompt as a key.
 */
import { createHash } from "node:crypto";

type Entry = { at: number; value: unknown };

export function createCache(maxEntries: number, ttlMs: number) {
  const store = new Map<string, Entry>();
  return {
    key: (parts: unknown) => createHash("sha1").update(JSON.stringify(parts)).digest("hex"),
    get<T>(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at >= ttlMs) { store.delete(key); return undefined; }
      return hit.value as T;
    },
    set(key: string, value: unknown) {
      store.set(key, { at: Date.now(), value });
      if (store.size > maxEntries) store.delete(store.keys().next().value as string);
    },
    clear: () => store.clear(),
    get size() { return store.size; },
  };
}

/** Model answers: identical requests within 30 minutes reuse the previous answer. */
const results = createCache(300, 30 * 60_000);

export async function cached<T>(parts: unknown, fn: () => Promise<T>): Promise<T> {
  const key = results.key(parts);
  const hit = results.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  results.set(key, value);
  return value;
}

export const clearAiCache = () => results.clear();
