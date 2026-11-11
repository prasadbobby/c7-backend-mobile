import { randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";

export const uuid = () => randomUUID();
export const now = () => new Date();

/** Parse a Postgres array literal ("{a,\"b c\"}") into string[] — used for enum arrays pg doesn't decode. */
export function pgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string" || v.length < 2) return [];
  const inner = v.slice(1, -1);
  if (!inner) return [];
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '"') quoted = !quoted;
    else if (c === "\\" && quoted) cur += inner[++i];
    else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** "YYYY-MM-DD" → noon UTC, the convention FitForge uses for challenge posts. */
export function noonUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** "YYYY-MM-DD" → 00:00 UTC (FitForge step-log convention on UTC servers). */
export function midnightUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function castArray(col: string): RawBuilder<string[]> {
  return sql<string[]>`${sql.ref(col)}::text[]`;
}

export const IST_OFFSET = 5.5 * 60 * 60 * 1000;
export const utcToIST = (d: Date) => new Date(d.getTime() + IST_OFFSET);
export const istToUTC = (d: Date) => new Date(d.getTime() - IST_OFFSET);
export function parseISTDate(dateString: string): Date {
  const [y, m, d] = dateString.split("-").map(Number) as [number, number, number];
  return utcToIST(new Date(Date.UTC(y, m - 1, d)));
}
/** Mirrors FitForge utils/timezone.ts startOfDayIST exactly (including its offset convention). */
export function startOfDayIST(date: Date): Date {
  const ist = utcToIST(date);
  return utcToIST(new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0)));
}
export function daysRemainingIST(target: Date): number {
  const nowStart = startOfDayIST(utcToIST(new Date()));
  const targetStart = startOfDayIST(utcToIST(target));
  return Math.max(0, Math.ceil((targetStart.getTime() - nowStart.getTime()) / 86400000));
}
