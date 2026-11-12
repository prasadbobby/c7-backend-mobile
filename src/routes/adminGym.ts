import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { badRequest, body, notFound, query, ymdSchema } from "../lib/http.js";
import { displayName, getUsers } from "../lib/users.js";
import { now, uuid } from "../lib/util.js";
import { checkupFor, invoiceDetail, packageOut, REPORT_CATEGORIES, reportInput, reportRow, VIDEO_CATEGORIES } from "./gym.js";

/** Admin API behind FitForge's packages / payments / attendance / announcements / reports / videos pages. */
export const adminGym = new Hono<AppEnv>();

const DAY = 86_400_000;
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
const ymdDate = (s: string) => new Date(`${s}T12:00:00.000Z`);

async function people(ids: string[]) {
  const map = await getUsers(ids);
  return (id: string) => {
    const p = map.get(id);
    return p ? { userId: id, name: displayName(p), email: p.email ?? null, imageUrl: p.imageUrl } : { userId: id, name: "Member", email: null, imageUrl: "" };
  };
}

/* --------------------------------------------------------------- people list */

/** Everyone with an app account — members and self-signed-up guests — for admin pickers. */
adminGym.get("/people", async (c) => {
  const [users, guests] = await Promise.all([
    db.selectFrom("UserInfo").select(["userId", "c7UserId", "role", "membershipStatus", "membershipEndDate", "nextPaymentDue", "remainingAmount"]).orderBy("createdAt", "desc").execute(),
    db.selectFrom("AppAccount").select(["userId", "accountType"]).execute(),
  ]);
  const who = await people(users.map((u) => u.userId));
  return c.json({
    people: users.map((u) => ({
      ...who(u.userId),
      memberId: u.c7UserId,
      role: u.role,
      membershipStatus: u.membershipStatus,
      membershipEndDate: u.membershipEndDate,
      nextPaymentDue: u.nextPaymentDue,
      remainingAmount: u.remainingAmount,
      isGuest: guests.some((g) => g.userId === u.userId && g.accountType === "GUEST") && !["ACTIVE", "PAUSED", "UPCOMING"].includes(u.membershipStatus),
    })),
  });
});

/* ------------------------------------------------------------------ packages */

const packageInput = z.object({
  name: z.string().trim().min(2).max(80),
  mode: z.enum(["ONLINE", "OFFLINE"]),
  durationDays: z.number().int().min(1).max(1095),
  price: z.number().min(0).max(10_000_000),
  offerPrice: z.number().min(0).max(10_000_000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  imageUrl: z.string().max(7 * 1024 * 1024).nullable().optional(),
  highlight: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

adminGym.get("/packages", async (c) => {
  const [rows, counts] = await Promise.all([
    db.selectFrom("Package").selectAll().orderBy("sortOrder").orderBy("createdAt").execute(),
    db.selectFrom("PackageEnquiry").select(["packageId", "status", db.fn.countAll<number>().as("n")]).groupBy(["packageId", "status"]).execute(),
  ]);
  const n = (id: string, s: string) => Number(counts.find((x) => x.packageId === id && x.status === s)?.n ?? 0);
  return c.json({ packages: rows.map((p) => ({ ...packageOut(p), isActive: p.isActive, sortOrder: p.sortOrder, updatedAt: p.updatedAt, enquiries: { open: n(p.id, "NEW") + n(p.id, "CONTACTED"), converted: n(p.id, "CONVERTED") } })) });
});

adminGym.post("/packages", async (c) => {
  const b = await body(c, packageInput);
  if (b.offerPrice != null && b.offerPrice > b.price) throw badRequest("Offer price can't be higher than the price");
  const row = { id: uuid(), ...b, offerPrice: b.offerPrice ?? null, description: b.description ?? null, imageUrl: b.imageUrl ?? null, createdBy: c.get("user").userId, updatedAt: now() };
  await db.insertInto("Package").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});

adminGym.put("/packages/:id", async (c) => {
  const b = await body(c, packageInput);
  if (b.offerPrice != null && b.offerPrice > b.price) throw badRequest("Offer price can't be higher than the price");
  const r = await db.updateTable("Package").set({ ...b, offerPrice: b.offerPrice ?? null, description: b.description ?? null, imageUrl: b.imageUrl ?? null, updatedAt: now() }).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound("Package not found");
  return c.json({ success: true });
});

adminGym.delete("/packages/:id", async (c) => {
  // Packages that were invoiced or enquired about are archived, not deleted, to keep history intact.
  const id = c.req.param("id");
  const used = await db.selectFrom("Invoice").select("id").where("packageId", "=", id).executeTakeFirst();
  const enq = await db.selectFrom("PackageEnquiry").select("id").where("packageId", "=", id).executeTakeFirst();
  if (used || enq) {
    await db.updateTable("Package").set({ isActive: false, updatedAt: now() }).where("id", "=", id).execute();
    return c.json({ success: true, archived: true });
  }
  const r = await db.deleteFrom("Package").where("id", "=", id).executeTakeFirst();
  if (!Number(r.numDeletedRows)) throw notFound("Package not found");
  return c.json({ success: true, archived: false });
});

/* ----------------------------------------------------------------- enquiries */

adminGym.get("/enquiries", async (c) => {
  const { status } = query(c, z.object({ status: z.enum(["NEW", "CONTACTED", "CONVERTED", "CLOSED", "OPEN"]).optional() }));
  let q = db.selectFrom("PackageEnquiry as e").innerJoin("Package as p", "p.id", "e.packageId").select(["e.id", "e.userId", "e.phone", "e.message", "e.status", "e.createdAt", "e.updatedAt", "p.id as packageId", "p.name as packageName", "p.mode", "p.durationDays", "p.price", "p.offerPrice"]);
  if (status === "OPEN") q = q.where("e.status", "in", ["NEW", "CONTACTED"]);
  else if (status) q = q.where("e.status", "=", status);
  const rows = await q.orderBy("e.createdAt", "desc").limit(300).execute();
  const who = await people(rows.map((r) => r.userId));
  const open = await db.selectFrom("PackageEnquiry").select(db.fn.countAll<number>().as("n")).where("status", "=", "NEW").executeTakeFirstOrThrow();
  return c.json({ enquiries: rows.map((r) => ({ ...r, person: who(r.userId) })), newCount: Number(open.n) });
});

adminGym.patch("/enquiries/:id", async (c) => {
  const b = await body(c, z.object({ status: z.enum(["NEW", "CONTACTED", "CLOSED"]) }));
  const r = await db.updateTable("PackageEnquiry").set({ status: b.status, handledBy: c.get("user").userId, updatedAt: now() }).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound("Enquiry not found");
  return c.json({ success: true });
});

/** Converts the guest into a member and starts the chosen package's membership. */
adminGym.post("/enquiries/:id/convert", async (c) => {
  const admin = c.get("user");
  const b = await body(c, z.object({ startDate: ymdSchema, price: z.number().min(0).optional(), notes: z.string().max(500).optional() }));
  const e = await db.selectFrom("PackageEnquiry as e").innerJoin("Package as p", "p.id", "e.packageId").select(["e.id", "e.userId", "p.durationDays", "p.price", "p.offerPrice", "p.name"]).where("e.id", "=", c.req.param("id")).executeTakeFirst();
  if (!e) throw notFound("Enquiry not found");
  const info = await db.selectFrom("UserInfo").selectAll().where("userId", "=", e.userId).executeTakeFirstOrThrow();
  const start = ymdDate(b.startDate);
  const end = new Date(start.getTime() + e.durationDays * DAY);
  const price = b.price ?? e.offerPrice ?? e.price;
  const status = start.getTime() > Date.now() + DAY ? "UPCOMING" : "ACTIVE";
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable("UserInfo")
      .set({ membershipStartDate: start, membershipEndDate: end, membershipDuration: e.durationDays, membershipStatus: status, membershipSetBy: admin.userId, membershipNotes: b.notes ?? `Package: ${e.name}`, originalEndDate: end, packagePrice: e.price, discountedPrice: price, remainingAmount: Math.max(0, price - (info.totalAmountPaid ?? 0)), updatedAt: now() })
      .where("userId", "=", e.userId)
      .execute();
    await tx
      .insertInto("MembershipLog")
      .values({ id: uuid(), userInfoId: info.id, changeType: "INITIAL_SETUP", previousStatus: info.membershipStatus, newStatus: status, previousStartDate: info.membershipStartDate, newStartDate: start, previousEndDate: info.membershipEndDate, newEndDate: end, previousDuration: info.membershipDuration, newDuration: e.durationDays, changeDate: now(), notes: `Joined via app enquiry: ${e.name}`, recordedBy: admin.userId, updatedAt: now() })
      .execute();
    await tx
      .insertInto("AppAccount")
      .values({ id: uuid(), userId: e.userId, accountType: "MEMBER", source: "SELF_SIGNUP", convertedAt: now(), convertedBy: admin.userId })
      .onConflict((oc) => oc.column("userId").doUpdateSet({ accountType: "MEMBER", convertedAt: now(), convertedBy: admin.userId }))
      .execute();
    await tx.updateTable("PackageEnquiry").set({ status: "CONVERTED", handledBy: admin.userId, updatedAt: now() }).where("id", "=", e.id).execute();
  });
  return c.json({ success: true, membership: { status, start, end, price } });
});

/* ------------------------------------------------------------------ invoices */

async function nextInvoiceNumber(issuedAt: Date) {
  const y = issuedAt.getUTCFullYear();
  const last = await db.selectFrom("Invoice").select("number").where("number", "like", `C7-${y}-%`).orderBy("number", "desc").executeTakeFirst();
  const n = last ? Number(last.number.split("-")[2]) + 1 : 1;
  return `C7-${y}-${String(n).padStart(4, "0")}`;
}

const invoiceInput = z.object({
  userId: z.string(),
  description: z.string().trim().min(2).max(200),
  packageId: z.string().nullable().optional(),
  paymentLogId: z.string().nullable().optional(),
  periodStart: ymdSchema.nullable().optional(),
  periodEnd: ymdSchema.nullable().optional(),
  subtotal: z.number().min(0).max(10_000_000),
  taxPercent: z.number().min(0).max(28).default(0),
  discount: z.number().min(0).default(0),
  amountPaid: z.number().min(0).default(0),
  paymentMethod: z.string().max(40).nullable().optional(),
  issuedAt: ymdSchema.optional(),
  dueDate: ymdSchema.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export function computeInvoice(b: { subtotal: number; taxPercent: number; discount: number; amountPaid: number }) {
  const taxable = Math.max(0, b.subtotal - b.discount);
  const taxAmount = Math.round(taxable * b.taxPercent) / 100;
  const total = Math.round((taxable + taxAmount) * 100) / 100;
  const status = b.amountPaid >= total ? "PAID" : b.amountPaid > 0 ? "PARTIAL" : "DUE";
  return { taxAmount, total, status };
}

async function createInvoice(b: z.infer<typeof invoiceInput>, by: string) {
  const exists = await db.selectFrom("UserInfo").select("userId").where("userId", "=", b.userId).executeTakeFirst();
  if (!exists) throw notFound("Member not found");
  if (b.discount > b.subtotal) throw badRequest("Discount can't be more than the amount");
  const issuedAt = b.issuedAt ? ymdDate(b.issuedAt) : now();
  const calc = computeInvoice(b);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = {
      id: uuid(),
      number: await nextInvoiceNumber(issuedAt),
      userId: b.userId,
      paymentLogId: b.paymentLogId ?? null,
      packageId: b.packageId ?? null,
      description: b.description,
      periodStart: b.periodStart ? ymdDate(b.periodStart) : null,
      periodEnd: b.periodEnd ? ymdDate(b.periodEnd) : null,
      subtotal: b.subtotal,
      taxPercent: b.taxPercent,
      taxAmount: calc.taxAmount,
      discount: b.discount,
      total: calc.total,
      amountPaid: Math.min(b.amountPaid, calc.total),
      status: calc.status,
      paymentMethod: b.paymentMethod ?? null,
      issuedAt,
      dueDate: b.dueDate ? ymdDate(b.dueDate) : null,
      notes: b.notes ?? null,
      createdBy: by,
      updatedAt: now(),
    };
    try {
      await db.insertInto("Invoice").values(row).execute();
      return row;
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg.includes("Invoice_paymentLogId_key")) throw badRequest("An invoice already exists for this payment");
      if (!msg.includes("Invoice_number_key")) throw e;
    }
  }
  throw badRequest("Couldn't allocate an invoice number, try again");
}

adminGym.get("/invoices", async (c) => {
  const { userId, month } = query(c, z.object({ userId: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }));
  let q = db.selectFrom("Invoice").select(["id", "number", "userId", "description", "total", "amountPaid", "status", "issuedAt", "dueDate", "paymentLogId"]);
  if (userId) q = q.where("userId", "=", userId);
  if (month) q = q.where(sql<string>`to_char("issuedAt", 'YYYY-MM')`, "=", month);
  const rows = await q.orderBy("issuedAt", "desc").limit(500).execute();
  const who = await people(rows.map((r) => r.userId));
  return c.json({ invoices: rows.map((r) => ({ ...r, person: who(r.userId) })) });
});

adminGym.get("/invoices/:id", async (c) => {
  const inv = await invoiceDetail(c.req.param("id"));
  if (!inv) throw notFound("Invoice not found");
  return c.json({ invoice: inv });
});

adminGym.post("/invoices", async (c) => {
  const row = await createInvoice(await body(c, invoiceInput), c.get("user").userId);
  return c.json({ success: true, id: row.id, number: row.number }, 201);
});

/** One click from a recorded FitForge payment → a numbered, paid invoice. */
adminGym.post("/invoices/from-payment/:paymentLogId", async (c) => {
  const p = await db
    .selectFrom("PaymentLog as p")
    .innerJoin("UserInfo as u", "u.id", "p.userInfoId")
    .select(["p.id", "p.amount", "p.paymentDate", "p.paymentMethod", "p.notes", "u.userId", "u.membershipStartDate", "u.membershipEndDate", "u.membershipDuration"])
    .where("p.id", "=", c.req.param("paymentLogId"))
    .executeTakeFirst();
  if (!p) throw notFound("Payment not found");
  const b = await body(c, z.object({ taxPercent: z.number().min(0).max(28).default(0) }).partial()).catch(() => ({ taxPercent: 0 }));
  const taxPercent = b.taxPercent ?? 0;
  // The payment is the amount received incl. tax, so back out the taxable value.
  const subtotal = Math.round((p.amount / (1 + taxPercent / 100)) * 100) / 100;
  const row = await createInvoice(
    {
      userId: p.userId,
      description: p.membershipDuration ? `C7 membership — ${p.membershipDuration} days` : "C7 membership payment",
      paymentLogId: p.id,
      periodStart: p.membershipStartDate?.toISOString().slice(0, 10) ?? null,
      periodEnd: p.membershipEndDate?.toISOString().slice(0, 10) ?? null,
      subtotal,
      taxPercent,
      discount: 0,
      amountPaid: p.amount,
      paymentMethod: p.paymentMethod,
      issuedAt: p.paymentDate.toISOString().slice(0, 10),
      notes: p.notes,
    },
    c.get("user").userId,
  );
  return c.json({ success: true, id: row.id, number: row.number }, 201);
});

adminGym.patch("/invoices/:id", async (c) => {
  const b = await body(c, z.object({ amountPaid: z.number().min(0).optional(), void: z.boolean().optional(), paymentMethod: z.string().max(40).optional() }));
  const inv = await db.selectFrom("Invoice").selectAll().where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!inv) throw notFound("Invoice not found");
  const amountPaid = Math.min(b.amountPaid ?? inv.amountPaid, inv.total);
  const status = b.void ? "VOID" : amountPaid >= inv.total ? "PAID" : amountPaid > 0 ? "PARTIAL" : "DUE";
  await db.updateTable("Invoice").set({ amountPaid, status, paymentMethod: b.paymentMethod ?? inv.paymentMethod, updatedAt: now() }).where("id", "=", inv.id).execute();
  return c.json({ success: true, status });
});

/* ------------------------------------------------- monthly payments overview */

adminGym.get("/payments/monthly", async (c) => {
  const { month } = query(c, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }));
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const [payments, dues, expiring, invoices] = await Promise.all([
    db.selectFrom("PaymentLog as p").innerJoin("UserInfo as u", "u.id", "p.userInfoId").select(["p.id", "p.amount", "p.paymentDate", "p.paymentMethod", "u.userId"]).where("p.paymentDate", ">=", from).where("p.paymentDate", "<", to).orderBy("p.paymentDate", "desc").execute(),
    db.selectFrom("UserInfo").select(["userId", "nextPaymentDue", "remainingAmount"]).where("remainingAmount", ">", 0).where((eb) => eb.or([eb("nextPaymentDue", "<", to), eb("nextPaymentDue", "is", null)])).execute(),
    db.selectFrom("UserInfo").select(["userId", "membershipEndDate", "membershipStatus"]).where("membershipEndDate", ">=", from).where("membershipEndDate", "<", to).execute(),
    db.selectFrom("Invoice").select(["paymentLogId", "number", "id"]).where("paymentLogId", "is not", null).execute(),
  ]);
  const who = await people([...payments.map((p) => p.userId), ...dues.map((d) => d.userId), ...expiring.map((e) => e.userId)]);
  return c.json({
    month,
    summary: { collected: payments.reduce((s, p) => s + p.amount, 0), payments: payments.length, outstanding: dues.reduce((s, d) => s + (d.remainingAmount ?? 0), 0), dueMembers: dues.length, expiring: expiring.length },
    payments: payments.map((p) => ({ ...p, person: who(p.userId), invoice: invoices.find((i) => i.paymentLogId === p.id) ?? null })),
    dues: dues.map((d) => ({ ...d, person: who(d.userId), overdue: !!d.nextPaymentDue && d.nextPaymentDue.getTime() < Date.now() })),
    expiring: expiring.map((e) => ({ ...e, person: who(e.userId) })),
  });
});

/** Sends a payment / renewal reminder as a personal announcement (shows in the member's app). */
adminGym.post("/payments/remind/:userId", async (c) => {
  const userId = c.req.param("userId");
  const info = await db.selectFrom("UserInfo").select(["remainingAmount", "nextPaymentDue", "membershipEndDate"]).where("userId", "=", userId).executeTakeFirst();
  if (!info) throw notFound("Member not found");
  const b = await body(c, z.object({ kind: z.enum(["PAYMENT", "RENEWAL"]).default("PAYMENT"), message: z.string().trim().max(500).optional() })).catch(() => ({ kind: "PAYMENT" as const, message: undefined }));
  const due = Math.round(info.remainingAmount ?? 0).toLocaleString("en-IN");
  const title = b.kind === "RENEWAL" ? "Time to renew your package" : "Payment reminder";
  const text =
    b.message ??
    (b.kind === "RENEWAL"
      ? `Your C7 package ${info.membershipEndDate ? `ends on ${info.membershipEndDate.toDateString()}` : "is ending"}. Renew to keep your access.`
      : `₹${due} is due${info.nextPaymentDue ? ` by ${info.nextPaymentDue.toDateString()}` : ""}. Pay at the front desk or via UPI.`);
  const row = { id: uuid(), title, body: text, kind: "PAYMENT", audience: "USER", targetUserId: userId, createdBy: c.get("user").userId, updatedAt: now() };
  await db.insertInto("Announcement").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});

/* ---------------------------------------------------------------- attendance */

adminGym.get("/attendance", async (c) => {
  const { date } = query(c, z.object({ date: ymdSchema }));
  const [users, marks, guests] = await Promise.all([
    db.selectFrom("UserInfo").select(["userId", "c7UserId", "membershipStatus"]).where("role", "=", "USER").execute(),
    db.selectFrom("Attendance").select(["userId", "status", "checkInAt", "notes"]).where("date", "=", sql<Date>`${date}::date`).execute(),
    db.selectFrom("AppAccount").select("userId").where("accountType", "=", "GUEST").execute(),
  ]);
  const members = users.filter((u) => !guests.some((g) => g.userId === u.userId) || ["ACTIVE", "PAUSED", "UPCOMING"].includes(u.membershipStatus));
  const who = await people(members.map((u) => u.userId));
  return c.json({
    date,
    members: members.map((u) => ({ ...who(u.userId), memberId: u.c7UserId, membershipStatus: u.membershipStatus, attendance: marks.find((m) => m.userId === u.userId) ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
    stats: { present: marks.filter((m) => m.status === "PRESENT").length, absent: marks.filter((m) => m.status === "ABSENT").length, leave: marks.filter((m) => m.status === "LEAVE").length, unmarked: members.length - marks.length },
  });
});

adminGym.put("/attendance", async (c) => {
  const b = await body(c, z.object({ date: ymdSchema, entries: z.array(z.object({ userId: z.string(), status: z.enum(["PRESENT", "ABSENT", "LEAVE"]).nullable(), notes: z.string().max(200).optional() })).min(1).max(500) }));
  if (b.date > new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10)) throw badRequest("Attendance can't be marked for a future date");
  const by = c.get("user").userId;
  await db.transaction().execute(async (tx) => {
    for (const e of b.entries) {
      if (!e.status) {
        await tx.deleteFrom("Attendance").where("userId", "=", e.userId).where("date", "=", sql<Date>`${b.date}::date`).execute();
        continue;
      }
      const v = { status: e.status, notes: e.notes ?? null, markedBy: by, checkInAt: e.status === "PRESENT" ? now() : null, updatedAt: now() };
      await tx.insertInto("Attendance").values({ id: uuid(), userId: e.userId, date: sql<Date>`${b.date}::date`, ...v }).onConflict((oc) => oc.columns(["userId", "date"]).doUpdateSet(v)).execute();
    }
  });
  return c.json({ success: true });
});

adminGym.get("/attendance/summary", async (c) => {
  const { month } = query(c, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }));
  const rows = await db
    .selectFrom("Attendance")
    .select(["userId", "status", db.fn.countAll<number>().as("n")])
    .where(sql<string>`to_char("date", 'YYYY-MM')`, "=", month)
    .groupBy(["userId", "status"])
    .execute();
  const byDay = await db.selectFrom("Attendance").select([sql<string>`to_char("date", 'YYYY-MM-DD')`.as("date"), db.fn.countAll<number>().as("n")]).where("status", "=", "PRESENT").where(sql<string>`to_char("date", 'YYYY-MM')`, "=", month).groupBy("date").orderBy("date").execute();
  const ids = [...new Set(rows.map((r) => r.userId))];
  const who = await people(ids);
  return c.json({
    month,
    daily: byDay.map((d) => ({ date: d.date, present: Number(d.n) })),
    members: ids
      .map((id) => {
        const n = (s: string) => Number(rows.find((r) => r.userId === id && r.status === s)?.n ?? 0);
        const present = n("PRESENT");
        const total = present + n("ABSENT") + n("LEAVE");
        return { ...who(id), present, absent: n("ABSENT"), leave: n("LEAVE"), rate: total ? Math.round((present / total) * 100) : 0 };
      })
      .sort((a, b) => b.present - a.present),
  });
});

/* ------------------------------------------------------------- announcements */

const announcementInput = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(4000),
  kind: z.enum(["GENERAL", "EVENT", "OFFER", "PAYMENT", "CLOSURE"]).default("GENERAL"),
  imageUrl: z.string().max(7 * 1024 * 1024).nullable().optional(),
  audience: z.enum(["ALL", "MEMBERS", "GUESTS", "USER"]).default("MEMBERS"),
  targetUserId: z.string().nullable().optional(),
  pinned: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

adminGym.get("/announcements", async (c) => {
  const rows = await db.selectFrom("Announcement").selectAll().orderBy("pinned", "desc").orderBy("publishedAt", "desc").limit(200).execute();
  const reads = await db.selectFrom("AnnouncementRead").select(["announcementId", db.fn.countAll<number>().as("n")]).groupBy("announcementId").execute();
  const who = await people(rows.filter((r) => r.targetUserId).map((r) => r.targetUserId!));
  return c.json({ announcements: rows.map((r) => ({ ...r, reads: Number(reads.find((x) => x.announcementId === r.id)?.n ?? 0), target: r.targetUserId ? who(r.targetUserId) : null })) });
});

function announcementValues(b: z.infer<typeof announcementInput>) {
  if (b.audience === "USER" && !b.targetUserId) throw badRequest("Pick the member this message is for");
  return { title: b.title, body: b.body, kind: b.kind, imageUrl: b.imageUrl ?? null, audience: b.audience, targetUserId: b.audience === "USER" ? b.targetUserId! : null, pinned: b.pinned, publishedAt: b.publishedAt ? new Date(b.publishedAt) : now(), expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, updatedAt: now() };
}
adminGym.post("/announcements", async (c) => {
  const row = { id: uuid(), ...announcementValues(await body(c, announcementInput)), createdBy: c.get("user").userId };
  await db.insertInto("Announcement").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});
adminGym.put("/announcements/:id", async (c) => {
  const r = await db.updateTable("Announcement").set(announcementValues(await body(c, announcementInput))).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound("Announcement not found");
  return c.json({ success: true });
});
adminGym.delete("/announcements/:id", async (c) => {
  const r = await db.deleteFrom("Announcement").where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numDeletedRows)) throw notFound("Announcement not found");
  return c.json({ success: true });
});

/* ----------------------------------------------------------- medical reports */

adminGym.get("/members/:userId/reports", async (c) => {
  const rows = await db.selectFrom("MedicalReport").select(["id", "title", "category", "fileType", "fileSize", "reportDate", "notes", "uploadedBy", "createdAt"]).where("userId", "=", c.req.param("userId")).orderBy("reportDate", "desc").execute();
  return c.json({ reports: rows, categories: REPORT_CATEGORIES });
});
adminGym.get("/reports/:id", async (c) => {
  const r = await db.selectFrom("MedicalReport").selectAll().where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!r) throw notFound("Report not found");
  return c.json({ report: r });
});
adminGym.post("/members/:userId/reports", async (c) => {
  const userId = c.req.param("userId");
  const exists = await db.selectFrom("UserInfo").select("userId").where("userId", "=", userId).executeTakeFirst();
  if (!exists) throw notFound("Member not found");
  const row = reportRow(await body(c, reportInput), userId, c.get("user").userId);
  await db.insertInto("MedicalReport").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});
adminGym.delete("/reports/:id", async (c) => {
  const r = await db.deleteFrom("MedicalReport").where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numDeletedRows)) throw notFound("Report not found");
  return c.json({ success: true });
});

/* ----------------------------------------------------------- check-up dates */

adminGym.get("/members/:userId/checkup", async (c) => c.json({ checkup: await checkupFor(c.req.param("userId")) }));
adminGym.put("/members/:userId/checkup", async (c) => {
  const userId = c.req.param("userId");
  const b = await body(c, z.object({ nextDate: ymdSchema, intervalDays: z.number().int().min(7).max(365).default(30), notes: z.string().max(300).nullable().optional() }));
  const v = { nextDate: ymdDate(b.nextDate), intervalDays: b.intervalDays, notes: b.notes ?? null, setBy: c.get("user").userId, updatedAt: now() };
  await db.insertInto("CheckupSchedule").values({ id: uuid(), userId, ...v }).onConflict((oc) => oc.column("userId").doUpdateSet(v)).execute();
  return c.json({ success: true, checkup: await checkupFor(userId) });
});

/* -------------------------------------------------------------------- videos */

const videoInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(VIDEO_CATEGORIES),
  videoUrl: z.string().url().regex(/^https?:\/\//, "Use a direct http(s) video link"),
  thumbnailUrl: z.string().max(7 * 1024 * 1024).nullable().optional(),
  durationSec: z.number().int().min(0).max(4 * 3600).default(0),
  sizeBytes: z.number().int().min(0).default(0),
  exerciseId: z.string().nullable().optional(),
  isAnimated: z.boolean().default(false),
  isPublished: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
const videoValues = (b: z.infer<typeof videoInput>) => ({ ...b, description: b.description ?? null, thumbnailUrl: b.thumbnailUrl ?? null, exerciseId: b.exerciseId ?? null, updatedAt: now() });

adminGym.get("/videos", async (c) => c.json({ videos: await db.selectFrom("WorkoutVideo").selectAll().orderBy("sortOrder").orderBy("createdAt", "desc").execute() }));
adminGym.post("/videos", async (c) => {
  const row = { id: uuid(), ...videoValues(await body(c, videoInput)), createdBy: c.get("user").userId };
  await db.insertInto("WorkoutVideo").values(row).execute();
  return c.json({ success: true, id: row.id }, 201);
});
adminGym.put("/videos/:id", async (c) => {
  const r = await db.updateTable("WorkoutVideo").set(videoValues(await body(c, videoInput))).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numUpdatedRows)) throw notFound("Video not found");
  return c.json({ success: true });
});
adminGym.delete("/videos/:id", async (c) => {
  const r = await db.deleteFrom("WorkoutVideo").where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!Number(r.numDeletedRows)) throw notFound("Video not found");
  return c.json({ success: true });
});

/** Upload an MP4/WebM to the backend's /files store so members can stream and download it for offline use. */
const MAX_VIDEO = Number(process.env.MAX_VIDEO_BYTES ?? 300 * 1024 * 1024);
adminGym.post("/videos/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("No file uploaded");
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) throw badRequest("Upload an MP4, WebM or MOV video");
  if (file.size > MAX_VIDEO) throw badRequest(`Video must be smaller than ${Math.round(MAX_VIDEO / 1024 / 1024)}MB`);
  const ext = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
  const name = `${uuid()}.${ext}`;
  await mkdir(join(UPLOAD_DIR, "videos"), { recursive: true });
  await writeFile(join(UPLOAD_DIR, "videos", name), Buffer.from(await file.arrayBuffer()));
  const base = (process.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  return c.json({ success: true, url: `${base}/files/videos/${name}`, sizeBytes: file.size }, 201);
});

/* ------------------------------------------------------------ counts / badges */

adminGym.get("/badges", async (c) => {
  const [enq, unmarked] = await Promise.all([
    db.selectFrom("PackageEnquiry").select(db.fn.countAll<number>().as("n")).where("status", "=", "NEW").executeTakeFirstOrThrow(),
    db.selectFrom("UserInfo").select(db.fn.countAll<number>().as("n")).where("remainingAmount", ">", 0).where("nextPaymentDue", "<", now()).executeTakeFirstOrThrow(),
  ]);
  return c.json({ newEnquiries: Number(enq.n), overduePayments: Number(unmarked.n) });
});
