/**
 * Route-handler plumbing: auth guard, zod validation, and honest errors.
 * A missing credential returns 503 { error, notConfigured } — never fake success.
 */
import "server-only";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createSupabaseServer, NotConfiguredError } from "@/lib/supabase/server";
import { AiNotConfiguredError, friendlyAiError } from "@/lib/ai/client";

type Db = Awaited<ReturnType<typeof createSupabaseServer>>;
type Ctx = { user: User; db: Db; req: Request };

export function withUser<P = unknown>(handler: (ctx: Ctx, params: P) => Promise<Response>) {
  return async (req: Request, context: { params: Promise<P> }) => {
    try {
      const db = await createSupabaseServer();
      const { data } = await db.auth.getUser();
      if (!data.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      return await handler({ user: data.user, db, req }, (await context?.params) as P);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof ZodError) return NextResponse.json({ error: "Invalid request", issues: e.issues }, { status: 400 });
  if (e instanceof NotConfiguredError || e instanceof AiNotConfiguredError) {
    return NextResponse.json({ error: `${e.message}. Add it to the server environment to enable this feature.`, notConfigured: true }, { status: 503 });
  }
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  const ai = friendlyAiError(e);
  if (ai) return NextResponse.json({ error: ai }, { status: 502 });
  console.error("[api]", e);
  const message = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const json = await req.json().catch(() => {
    throw new HttpError(400, "Body must be JSON");
  });
  return schema.parse(json);
}

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);
