import type { Context } from "hono";
import { z, type ZodTypeAny } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}
export const badRequest = (msg: string) => new HttpError(400, "BAD_REQUEST", msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new HttpError(404, "NOT_FOUND", msg);

export async function body<T extends ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

export function query<T extends ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
