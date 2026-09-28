/**
 * An in-memory stand-in for the parts of the Supabase client the discovery pipeline uses, for integration tests.
 * It is deliberately small: filters (eq/in/is/not/lt/lte/gt/gte/neq), embedded-relation filters like "jobs.status"
 * (resolved through the `<relation>_id` column, mirroring PostgREST's inner join), insert/upsert/update, and an
 * operation log so a test can assert that something was NOT written.
 */
export type Row = Record<string, unknown>;
export type LogEntry = { table: string; op: "select" | "insert" | "upsert" | "update" | "delete" };

const asComparable = (v: unknown): number | string | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}/.test(v) ? v : t;
  }
  return null;
};

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables = seed;
  const log: LogEntry[] = [];
  let id = 0;

  const value = (table: string, r: Row, key: string): unknown => {
    if (!key.includes(".")) return r[key];
    const [rel, col] = key.split(".");
    const related = tables[rel]?.find((t) => t.id === r[`${rel.replace(/s$/, "")}_id`]);
    return related?.[col];
  };
  const conflictKey = (t: string, r: Row, cols: string[]) => tables[t].find((x) => cols.every((c) => x[c] === r[c]));

  return {
    tables,
    log,
    from(name: string) {
      tables[name] ??= [];
      let op: LogEntry["op"] = "select";
      let payload: Row | Row[] | null = null;
      let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let returning = false;
      let window: [number, number] | null = null;
      const filters: ((r: Row) => boolean)[] = [];
      const cmp = (k: string, v: unknown, test: (a: number | string, b: number | string) => boolean) =>
        filters.push((r) => {
          const a = asComparable(value(name, r, k));
          const b = asComparable(v);
          return a !== null && b !== null && test(a, b);
        });
      const q: Record<string, unknown> = {
        select: () => ((returning = true), q),
        insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
        upsert: (p: Row | Row[], o: typeof opts = {}) => ((op = "upsert"), (payload = p), (opts = o), q),
        update: (p: Row) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        eq: (k: string, v: unknown) => (filters.push((r) => value(name, r, k) === v), q),
        neq: (k: string, v: unknown) => (filters.push((r) => value(name, r, k) !== v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(value(name, r, k))), q),
        is: (k: string, v: null) => (filters.push((r) => (v === null ? value(name, r, k) == null : value(name, r, k) === v)), q),
        not: (k: string, _o: string, v: null) => (filters.push((r) => (v === null ? value(name, r, k) != null : value(name, r, k) !== v)), q),
        lt: (k: string, v: unknown) => (cmp(k, v, (a, b) => a < b), q),
        lte: (k: string, v: unknown) => (cmp(k, v, (a, b) => a <= b), q),
        gt: (k: string, v: unknown) => (cmp(k, v, (a, b) => a > b), q),
        gte: (k: string, v: unknown) => (cmp(k, v, (a, b) => a >= b), q),
        // Paging and ordering as far as tests need them: a window over the matched rows, in insertion order.
        range: (from: number, to: number) => ((window = [from, to]), q),
        order: () => q,
        limit: (n: number) => ((window = [0, n - 1]), q),
        single: async () => ({ data: (await run()).data?.[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: (await run()).data?.[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      const run = async (): Promise<{ data: Row[]; error: null }> => {
        log.push({ table: name, op });
        const matched = () => tables[name].filter((r) => filters.every((f) => f(r)));
        // Like the real client, results are COPIES: a later write must not silently change rows a caller already read.
        const copies = (rows: Row[]) => rows.map((r) => ({ ...r }));
        if (op === "select") return { data: copies(window ? matched().slice(window[0], window[1] + 1) : matched()), error: null };
        if (op === "update") {
          const rows = matched();
          for (const r of rows) Object.assign(r, payload);
          return { data: returning ? copies(rows) : [], error: null };
        }
        if (op === "delete") {
          const rows = matched();
          tables[name] = tables[name].filter((r) => !rows.includes(r));
          return { data: returning ? copies(rows) : [], error: null };
        }
        const out: Row[] = [];
        for (const raw of [payload].flat() as Row[]) {
          const cols = opts.onConflict?.split(",").map((c) => c.trim());
          const hit = op === "upsert" && cols ? conflictKey(name, raw, cols) : undefined;
          if (hit) {
            if (!opts.ignoreDuplicates) Object.assign(hit, raw);
            out.push(hit);
          } else {
            const row = { id: `${name}-${++id}`, imported_by: null, ...raw };
            tables[name].push(row);
            out.push(row);
          }
        }
        return { data: returning ? copies(out) : [], error: null };
      };
      return q;
    },
  };
}

export type FakeDb = ReturnType<typeof fakeDb>;
