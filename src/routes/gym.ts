import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv, Access } from "../lib/auth.js";
import { body, forbidden, notFound, query, ymdSchema } from "../lib/http.js";
import { displayName, getUser } from "../lib/users.js";
import { now, uuid } from "../lib/util.js";

/** Member/guest-facing gym features: packages, invoices, attendance, announcements, reports, videos, photos, BMI. */
export const gym = new Hono<AppEnv>();

const DAY = 86_400_000;
export const GYM = {
  name: "C7 Personal Fitness Studio",
  address: process.env.GYM_ADDRESS ?? "",
  phone: process.env.GYM_PHONE ?? "",
  email: process.env.GYM_EMAIL ?? "",
  gstin: process.env.GYM_GSTIN ?? "",
};

/* ------------------------------------------------------------------ packages */

export const packageOut = (p: { id: string; name: string; mode: string; durationDays: number; price: number; offerPrice: number | null; description: string | null; features: string[]; imageUrl: string | null; highlight: boolean }) => ({
  id: p.id,
  name: p.name,
  mode: p.mode,
  durationDays: p.durationDays,
  price: p.price,
  offerPrice: p.offerPrice,
  description: p.description,
  features: p.features,
  imageUrl: p.imageUrl,
  highlight: p.highlight,
  perMonth: Math.round(((p.offerPrice ?? p.price) / Math.max(1, p.durationDays)) * 30),
});

gym.get("/packages", async (c) => {
  const u = c.get("user");
  const { mode } = query(c, z.object({ mode: z.enum(["ONLINE", "OFFLINE"]).optional() }));
  let q = db.selectFrom("Package").selectAll().where("isActive", "=", true);
  if (mode) q = q.where("mode", "=", mode);
  const [rows, mine] = await Promise.all([
    q.orderBy("sortOrder").orderBy("price").execute(),
    db.selectFrom("PackageEnquiry").select(["id", "packageId", "status", "createdAt"]).where("userId", "=", u.userId).orderBy("createdAt", "desc").execute(),
  ]);
  return c.json({
    access: u.access,
    packages: rows.map((p) => ({ ...packageOut(p), enquiry: mine.find((e) => e.packageId === p.id && e.status !== "CLOSED") ?? null })),
  });
});

gym.get("/packages/:id", async (c) => {
  const p = await db.selectFrom("Package").selectAll().where("id", "=", c.req.param("id")).where("isActive", "=", true).executeTakeFirst();
  if (!p) throw notFound("Package not found");
  const enquiry = await db.selectFrom("PackageEnquiry").select(["id", "status", "createdAt"]).where("userId", "=", c.get("user").userId).where("packageId", "=", p.id).where("status", "!=", "CLOSED").executeTakeFirst();
  return c.json({ package: packageOut(p), enquiry: enquiry ?? null, contact: { phone: GYM.phone, email: GYM.email } });
});

gym.get("/enquiries", async (c) => {
  const rows = await db
    .selectFrom("PackageEnquiry as e")
    .innerJoin("Package as p", "p.id", "e.packageId")
    .select(["e.id", "e.status", "e.createdAt", "e.packageId", "p.name as packageName"])
    .where("e.userId", "=", c.get("user").userId)
    .orderBy("e.createdAt", "desc")
    .execute();
  return c.json({ enquiries: rows });
});

gym.post("/enquiries", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ packageId: z.string(), phone: z.string().trim().regex(/^[0-9+\-\s]{7,16}$/, "Enter a valid phone number").optional(), message: z.string().trim().max(500).optional() }));
  const pkg = await db.selectFrom("Package").select(["id"]).where("id", "=", b.packageId).where("isActive", "=", true).executeTakeFirst();
  if (!pkg) throw notFound("Package not found");
  const open = await db.selectFrom("PackageEnquiry").select(["id", "status", "createdAt"]).where("userId", "=", u.userId).where("packageId", "=", b.packageId).where("status", "in", ["NEW", "CONTACTED"]).executeTakeFirst();
  if (open) return c.json({ success: true, enquiry: open, duplicate: true });
  const row = { id: uuid(), userId: u.userId, packageId: b.packageId, phone: b.phone ?? null, message: b.message ?? null, status: "NEW", updatedAt: now() };
  await db.insertInto("PackageEnquiry").values(row).execute();
  return c.json({ success: true, enquiry: { id: row.id, status: row.status, createdAt: now() } }, 201);
});

/* ------------------------------------------------------------------ invoices */

export async function invoiceDetail(id: string) {
  const inv = await db.selectFrom("Invoice").selectAll().where("id", "=", id).executeTakeFirst();
  if (!inv) return null;
  const [member, info] = await Promise.all([getUser(inv.userId), db.selectFrom("UserInfo").select(["c7UserId"]).where("userId", "=", inv.userId).executeTakeFirst()]);
  return { ...inv, balance: Math.max(0, inv.total - inv.amountPaid), billTo: { name: displayName(member), email: member.email ?? null, memberId: info?.c7UserId ?? null }, gym: GYM };
}

gym.get("/invoices", async (c) => {
  const rows = await db
    .selectFrom("Invoice")
    .select(["id", "number", "description", "total", "amountPaid", "status", "issuedAt", "dueDate"])
    .where("userId", "=", c.get("user").userId)
    .where("status", "!=", "VOID")
    .orderBy("issuedAt", "desc")
    .execute();
  const due = rows.filter((r) => r.status !== "PAID").reduce((s, r) => s + Math.max(0, r.total - r.amountPaid), 0);
  return c.json({ invoices: rows, totals: { paid: rows.reduce((s, r) => s + r.amountPaid, 0), due } });
});

gym.get("/invoices/:id", async (c) => {
  const inv = await invoiceDetail(c.req.param("id"));
  if (!inv || inv.userId !== c.get("user").userId) throw notFound("Invoice not found");
  return c.json({ invoice: inv });
});

/* ---------------------------------------------------------------- attendance */

gym.get("/attendance", async (c) => {
  const u = c.get("user");
  const { month } = query(c, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }));
  const m = month ?? new Date().toISOString().slice(0, 7);
  const start = `${m}-01`;
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const rows = await db
    .selectFrom("Attendance")
    .select([sql<string>`to_char("date", 'YYYY-MM-DD')`.as("date"), "status", "checkInAt", "notes"])
    .where("userId", "=", u.userId)
    .where("date", ">=", sql<Date>`${start}::date`)
    .where("date", "<", sql<Date>`${end}::date`)
    .orderBy("date")
    .execute();
  // Streak of consecutive PRESENT days (ignores days with no record — gym closed / not marked).
  const all = await db.selectFrom("Attendance").select([sql<string>`to_char("date", 'YYYY-MM-DD')`.as("date"), "status"]).where("userId", "=", u.userId).orderBy("date", "desc").limit(400).execute();
  let streak = 0;
  for (const r of all) {
    if (r.status !== "PRESENT") break;
    streak++;
  }
  const present = rows.filter((r) => r.status === "PRESENT").length;
  const marked = rows.length;
  return c.json({ month: m, days: rows, stats: { present, absent: rows.filter((r) => r.status === "ABSENT").length, leave: rows.filter((r) => r.status === "LEAVE").length, rate: marked ? Math.round((present / marked) * 100) : 0, streak, totalVisits: all.filter((r) => r.status === "PRESENT").length } });
});

/* ------------------------------------------------------------- announcements */

export function audienceFilter(access: Access) {
  return access === "GUEST" ? ["ALL", "GUESTS"] : ["ALL", "MEMBERS"];
}

gym.get("/announcements", async (c) => {
  const u = c.get("user");
  const rows = await db
    .selectFrom("Announcement as a")
    .leftJoin("AnnouncementRead as r", (j) => j.onRef("r.announcementId", "=", "a.id").on("r.userId", "=", u.userId))
    .select(["a.id", "a.title", "a.body", "a.kind", "a.imageUrl", "a.pinned", "a.publishedAt", "a.expiresAt", "a.audience", "r.readAt"])
    .where((eb) => eb.or([eb("a.audience", "in", audienceFilter(u.access)), eb.and([eb("a.audience", "=", "USER"), eb("a.targetUserId", "=", u.userId)])]))
    .where("a.publishedAt", "<=", now())
    .where((eb) => eb.or([eb("a.expiresAt", "is", null), eb("a.expiresAt", ">", now())]))
    .orderBy("a.pinned", "desc")
    .orderBy("a.publishedAt", "desc")
    .limit(100)
    .execute();
  return c.json({ announcements: rows.map(({ readAt, ...a }) => ({ ...a, personal: a.audience === "USER", read: !!readAt })), unread: rows.filter((r) => !r.readAt).length });
});

gym.post("/announcements/:id/read", async (c) => {
  await db.insertInto("AnnouncementRead").values({ id: uuid(), userId: c.get("user").userId, announcementId: c.req.param("id") }).onConflict((oc) => oc.columns(["userId", "announcementId"]).doNothing()).execute().catch(() => {
    throw notFound("Announcement not found");
  });
  return c.json({ success: true });
});

gym.post("/announcements/read-all", async (c) => {
  const u = c.get("user");
  const ids = await db
    .selectFrom("Announcement")
    .select("id")
    .where((eb) => eb.or([eb("audience", "in", audienceFilter(u.access)), eb.and([eb("audience", "=", "USER"), eb("targetUserId", "=", u.userId)])]))
    .execute();
  if (ids.length) await db.insertInto("AnnouncementRead").values(ids.map((a) => ({ id: uuid(), userId: u.userId, announcementId: a.id }))).onConflict((oc) => oc.columns(["userId", "announcementId"]).doNothing()).execute();
  return c.json({ success: true });
});

/* ----------------------------------------------------------- medical reports */

export const REPORT_CATEGORIES = ["BLOOD", "SCAN", "PRESCRIPTION", "FITNESS", "OTHER"] as const;
const MAX_REPORT = 10 * 1024 * 1024;
export const reportInput = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.enum(REPORT_CATEGORIES).default("OTHER"),
  fileUrl: z.string().regex(/^data:(application\/pdf|image\/(png|jpeg|jpg|webp|heic));base64,/, "Upload a PDF or an image").max(Math.ceil(MAX_REPORT * 1.37)),
  reportDate: ymdSchema,
  notes: z.string().trim().max(1000).optional(),
});
export const reportRow = (b: z.infer<typeof reportInput>, userId: string, by: string) => {
  const fileType = b.fileUrl.slice(5, b.fileUrl.indexOf(";"));
  const fileSize = Math.round(((b.fileUrl.length - b.fileUrl.indexOf(",") - 1) * 3) / 4);
  return { id: uuid(), userId, title: b.title, category: b.category, fileUrl: b.fileUrl, fileType, fileSize, reportDate: new Date(`${b.reportDate}T12:00:00.000Z`), notes: b.notes ?? null, uploadedBy: by };
};
const reportList = (userId: string) =>
  db.selectFrom("MedicalReport").select(["id", "title", "category", "fileType", "fileSize", "reportDate", "notes", "uploadedBy", "createdAt"]).where("userId", "=", userId).orderBy("reportDate", "desc").execute();

gym.get("/reports", async (c) => {
  const u = c.get("user");
  const rows = await reportList(u.userId);
  return c.json({ reports: rows.map((r) => ({ ...r, byCoach: r.uploadedBy !== u.userId })) });
});
gym.get("/reports/:id", async (c) => {
  const r = await db.selectFrom("MedicalReport").selectAll().where("id", "=", c.req.param("id")).where("userId", "=", c.get("user").userId).executeTakeFirst();
  if (!r) throw notFound("Report not found");
  return c.json({ report: r });
});
gym.post("/reports", async (c) => {
  const u = c.get("user");
  const row = reportRow(await body(c, reportInput), u.userId, u.userId);
  await db.insertInto("MedicalReport").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});
gym.delete("/reports/:id", async (c) => {
  const u = c.get("user");
  const r = await db.selectFrom("MedicalReport").select(["uploadedBy"]).where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!r) throw notFound("Report not found");
  if (r.uploadedBy !== u.userId) throw forbidden("Reports added by your coach can only be removed by the gym");
  await db.deleteFrom("MedicalReport").where("id", "=", c.req.param("id")).execute();
  return c.json({ success: true });
});

/* -------------------------------------------------------------------- videos */

export const VIDEO_CATEGORIES = ["warmup", "cardio", "strength", "mobility", "core", "other"] as const;
gym.get("/videos", async (c) => {
  const { category, exerciseId } = query(c, z.object({ category: z.enum(VIDEO_CATEGORIES).optional(), exerciseId: z.string().optional() }));
  let q = db.selectFrom("WorkoutVideo").select(["id", "title", "description", "category", "videoUrl", "thumbnailUrl", "durationSec", "sizeBytes", "exerciseId", "isAnimated", "updatedAt"]).where("isPublished", "=", true);
  if (category) q = q.where("category", "=", category);
  if (exerciseId) q = q.where("exerciseId", "=", exerciseId);
  return c.json({ videos: await q.orderBy("sortOrder").orderBy("createdAt", "desc").execute() });
});
gym.get("/videos/:id", async (c) => {
  const v = await db.selectFrom("WorkoutVideo").selectAll().where("id", "=", c.req.param("id")).where("isPublished", "=", true).executeTakeFirst();
  if (!v) throw notFound("Video not found");
  return c.json({ video: v });
});

/* ----------------------------------------------------------- progress photos */

gym.get("/progress-photos", async (c) => {
  const rows = await db.selectFrom("ProgressPhoto").selectAll().where("userId", "=", c.get("user").userId).orderBy("takenAt", "desc").execute();
  return c.json({ photos: rows });
});
gym.post("/progress-photos", async (c) => {
  const u = c.get("user");
  const b = await body(
    c,
    z.object({ imageUrl: z.string().regex(/^(data:image\/|https:\/\/)/).max(8 * 1024 * 1024), pose: z.enum(["FRONT", "SIDE", "BACK"]).default("FRONT"), takenAt: ymdSchema, weight: z.number().min(20).max(400).optional(), notes: z.string().trim().max(300).optional() }),
  );
  const row = { id: uuid(), userId: u.userId, imageUrl: b.imageUrl, pose: b.pose, takenAt: new Date(`${b.takenAt}T12:00:00.000Z`), weight: b.weight ?? null, notes: b.notes ?? null };
  await db.insertInto("ProgressPhoto").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});
gym.delete("/progress-photos/:id", async (c) => {
  const r = await db.deleteFrom("ProgressPhoto").where("id", "=", c.req.param("id")).where("userId", "=", c.get("user").userId).executeTakeFirst();
  if (!Number(r.numDeletedRows)) throw notFound("Photo not found");
  return c.json({ success: true });
});

/* ------------------------------------------------------------- BMI & check-ups */

export function bmiCategory(bmi: number) {
  // WHO adult cut-offs, with the Asian-Indian overweight band (23–24.9) used by Indian clinicians.
  if (bmi < 18.5) return { key: "UNDER", label: "Underweight" };
  if (bmi < 23) return { key: "HEALTHY", label: "Healthy" };
  if (bmi < 25) return { key: "OVER", label: "Overweight" };
  if (bmi < 30) return { key: "OBESE1", label: "Obese (class I)" };
  return { key: "OBESE2", label: "Obese (class II+)" };
}
export const bmiOf = (weightKg: number, heightCm: number) => Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;

export async function checkupFor(userId: string) {
  const s = await db.selectFrom("CheckupSchedule").select(["nextDate", "intervalDays", "notes"]).where("userId", "=", userId).executeTakeFirst();
  let nextDate = s?.nextDate ?? null;
  if (!nextDate) {
    const last = await db.selectFrom("BodyMeasurement").select("recordedDate").where("userId", "=", userId).where("measurementType", "=", "WEIGHT").orderBy("recordedDate", "desc").executeTakeFirst();
    nextDate = last ? new Date(last.recordedDate.getTime() + 30 * DAY) : null;
  }
  if (!nextDate) return null;
  const daysLeft = Math.ceil((nextDate.getTime() - Date.now()) / DAY);
  return { nextDate, intervalDays: s?.intervalDays ?? 30, notes: s?.notes ?? null, setByCoach: !!s, daysLeft, overdue: daysLeft < 0 };
}

gym.get("/bmi", async (c) => {
  const u = c.get("user");
  const [info, ms] = await Promise.all([
    db.selectFrom("UserInfo").select(["height", "weight"]).where("userId", "=", u.userId).executeTakeFirstOrThrow(),
    db.selectFrom("BodyMeasurement").select(["measurementType", "value", "recordedDate"]).where("userId", "=", u.userId).where("measurementType", "in", ["WEIGHT", "HEIGHT", "BODY_FAT_PERCENTAGE"]).orderBy("recordedDate", "asc").execute(),
  ]);
  const heights = ms.filter((m) => m.measurementType === "HEIGHT");
  const weights = ms.filter((m) => m.measurementType === "WEIGHT");
  const height = heights.at(-1)?.value ?? info.height ?? null;
  const weight = weights.at(-1)?.value ?? info.weight ?? null;
  // Month-wise: last weigh-in of each month, with the height known at that time.
  const byMonth = new Map<string, { month: string; weight: number; date: Date }>();
  for (const w of weights) byMonth.set(w.recordedDate.toISOString().slice(0, 7), { month: w.recordedDate.toISOString().slice(0, 7), weight: w.value, date: w.recordedDate });
  const history = [...byMonth.values()].slice(-12).map((m) => {
    const h = [...heights].reverse().find((x) => x.recordedDate <= m.date)?.value ?? height;
    const bmi = h ? bmiOf(m.weight, h) : null;
    return { month: m.month, weight: m.weight, bmi, category: bmi ? bmiCategory(bmi).label : null };
  });
  const bmi = height && weight ? bmiOf(weight, height) : null;
  const healthy = height ? { min: Math.round(18.5 * (height / 100) ** 2 * 10) / 10, max: Math.round(22.9 * (height / 100) ** 2 * 10) / 10 } : null;
  return c.json({ height, weight, bmi, category: bmi ? bmiCategory(bmi) : null, healthyWeight: healthy, bodyFat: ms.filter((m) => m.measurementType === "BODY_FAT_PERCENTAGE").at(-1)?.value ?? null, history, checkup: await checkupFor(u.userId) });
});
