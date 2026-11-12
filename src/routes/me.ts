import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { body, notFound } from "../lib/http.js";
import { getUsers, updateClerkUser } from "../lib/users.js";
import { daysRemainingIST, now, utcToIST, uuid } from "../lib/util.js";

export const EQUIPMENT = ["body only", "machine", "other", "foam roll", "kettlebells", "dumbbell", "cable", "barbell", "bands", "medicine ball", "exercise ball", "e-z curl bar"] as const;

export const me = new Hono<AppEnv>();

me.get("/", async (c) => {
  const u = c.get("user");
  const [info, equipment, prefs, followers, following] = await Promise.all([
    db
      .selectFrom("UserInfo")
      .select(["c7UserId", "age", "height", "weight", "dateOfBirth", "role", "membershipStatus", "membershipEndDate", "createdAt"])
      .where("userId", "=", u.userId)
      .executeTakeFirstOrThrow(),
    db.selectFrom("UserEquipment").select("equipmentType").where("userId", "=", u.userId).execute(),
    db.selectFrom("UserPreference").selectAll().where("userId", "=", u.userId).executeTakeFirst(),
    db.selectFrom("UserFollow").select(db.fn.countAll<number>().as("n")).where("followingId", "=", u.userId).executeTakeFirstOrThrow(),
    db.selectFrom("UserFollow").select(db.fn.countAll<number>().as("n")).where("followerId", "=", u.userId).executeTakeFirstOrThrow(),
  ]);
  return c.json({
    user: {
      id: u.userId,
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      email: u.email ?? null,
      imageUrl: u.imageUrl,
      role: u.role,
      memberId: info.c7UserId,
      age: info.age,
      height: info.height,
      weight: info.weight,
      dateOfBirth: info.dateOfBirth,
      memberSince: info.createdAt,
      membershipStatus: info.membershipStatus,
      membershipEndDate: info.membershipEndDate,
      /** MEMBER: full app · GUEST: packages only · EXPIRED: renew to continue */
      access: u.access,
    },
    equipment: equipment.map((e) => e.equipmentType),
    preferences: {
      fitnessGoal: prefs?.fitnessGoal ?? null,
      experienceLevel: prefs?.experienceLevel ?? null,
      onboardingCompleted: !!prefs?.onboardingCompletedAt,
      pushEnabled: prefs?.pushEnabled ?? true,
      remindersEnabled: prefs?.remindersEnabled ?? true,
      hapticsEnabled: prefs?.hapticsEnabled ?? true,
      metricUnits: prefs?.metricUnits ?? true,
    },
    social: { followers: followers.n, following: following.n },
  });
});

/** Mirrors FitForge handleUpdateUserDetails + handleUpdateUserMeasurements. */
me.patch("/", async (c) => {
  const u = c.get("user");
  const b = await body(
    c,
    z.object({
      firstName: z.string().trim().min(1).max(60).optional(),
      lastName: z.string().trim().max(60).optional(),
      username: z.string().trim().min(3).max(40).optional(),
      dateOfBirth: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
      age: z.number().int().min(10).max(110).nullable().optional(),
      height: z.number().min(50).max(260).nullable().optional(),
      weight: z.number().min(20).max(400).nullable().optional(),
    }),
  );
  if (b.firstName !== undefined || b.lastName !== undefined || b.username !== undefined) {
    await updateClerkUser(u.userId, { firstName: b.firstName, lastName: b.lastName, username: b.username });
  }
  const patch: Record<string, unknown> = {};
  if (b.dateOfBirth !== undefined) patch.dateOfBirth = b.dateOfBirth ? new Date(b.dateOfBirth) : null;
  if (b.age !== undefined) patch.age = b.age;
  if (b.height !== undefined) patch.height = b.height;
  if (b.weight !== undefined) patch.weight = b.weight;
  if (Object.keys(patch).length) {
    await db.updateTable("UserInfo").set({ ...patch, updatedAt: now() }).where("userId", "=", u.userId).execute();
  }
  return c.json({ success: true });
});

/** Mirrors handleUpdateUserEquipment (replace the whole set). */
me.put("/equipment", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ equipment: z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length) }));
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("UserEquipment").where("userId", "=", u.userId).execute();
    const unique = [...new Set(b.equipment)];
    if (unique.length) await trx.insertInto("UserEquipment").values(unique.map((e) => ({ userId: u.userId, equipmentType: e }))).execute();
  });
  return c.json({ success: true, equipment: b.equipment });
});

me.patch("/preferences", async (c) => {
  const u = c.get("user");
  const b = await body(
    c,
    z.object({
      fitnessGoal: z.enum(["lose", "tone", "muscle", "endurance"]).optional(),
      experienceLevel: z.enum(["Beginner", "Intermediate", "Advanced"]).optional(),
      completeOnboarding: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      remindersEnabled: z.boolean().optional(),
      hapticsEnabled: z.boolean().optional(),
      metricUnits: z.boolean().optional(),
    }),
  );
  const { completeOnboarding, ...rest } = b;
  const values = { ...rest, ...(completeOnboarding ? { onboardingCompletedAt: now() } : {}), updatedAt: now() };
  await db
    .insertInto("UserPreference")
    .values({ userId: u.userId, ...values })
    .onConflict((oc) => oc.column("userId").doUpdateSet(values))
    .execute();
  return c.json({ success: true });
});

/** Mirrors FitForge GET /api/membership, including auto-applying a due upcoming extension and expiring. */
me.get("/membership", async (c) => {
  const u = c.get("user");
  const info = await db
    .selectFrom("UserInfo")
    .select([
      "id", "membershipStartDate", "membershipEndDate", "membershipDuration", "membershipStatus", "membershipNotes",
      "upcomingStartDate", "upcomingEndDate", "upcomingDuration", "upcomingNotes", "originalEndDate",
      "pausedFrom", "pausedUntil", "pauseReason",
    ])
    .where("userId", "=", u.userId)
    .executeTakeFirst();
  if (!info) throw notFound("User not found");
  const m = { ...info };
  if (m.upcomingStartDate && m.upcomingEndDate) {
    const nowIst = utcToIST(new Date());
    if (nowIst >= new Date(m.upcomingStartDate)) {
      const originalEndDate = m.membershipEndDate;
      await db
        .updateTable("UserInfo")
        .set({
          membershipStartDate: m.upcomingStartDate,
          membershipEndDate: m.upcomingEndDate,
          membershipDuration: m.upcomingDuration,
          membershipStatus: "ACTIVE",
          originalEndDate,
          upcomingStartDate: null,
          upcomingEndDate: null,
          upcomingDuration: null,
          upcomingNotes: null,
          updatedAt: now(),
        })
        .where("userId", "=", u.userId)
        .execute();
      await db
        .insertInto("MembershipLog")
        .values({
          id: uuid(),
          userInfoId: m.id,
          changeType: "EXTENSION",
          previousStatus: m.membershipStatus,
          newStatus: "ACTIVE",
          previousEndDate: originalEndDate,
          newEndDate: m.upcomingEndDate,
          previousDuration: m.membershipDuration,
          newDuration: m.upcomingDuration,
          changeDate: now(),
          notes: `Scheduled extension automatically applied on ${nowIst.toISOString()}. ${m.upcomingNotes || ""}`.trim(),
          recordedBy: "SYSTEM",
          updatedAt: now(),
        })
        .execute();
      Object.assign(m, {
        membershipStartDate: m.upcomingStartDate,
        membershipEndDate: m.upcomingEndDate,
        membershipDuration: m.upcomingDuration,
        membershipStatus: "ACTIVE",
        originalEndDate,
        upcomingStartDate: null,
        upcomingEndDate: null,
        upcomingDuration: null,
        upcomingNotes: null,
      });
    }
  }
  let daysRemaining = 0;
  let isExpired = false;
  let isActive = false;
  if (m.membershipEndDate && m.membershipStartDate) {
    const nowIst = utcToIST(new Date());
    daysRemaining = daysRemainingIST(new Date(m.membershipEndDate));
    isExpired = daysRemaining <= 0;
    isActive = nowIst >= new Date(m.membershipStartDate) && nowIst <= new Date(m.membershipEndDate) && m.membershipStatus === "ACTIVE";
  }
  if (isExpired && m.membershipStatus === "ACTIVE") {
    await db.updateTable("UserInfo").set({ membershipStatus: "EXPIRED", updatedAt: now() }).where("userId", "=", u.userId).execute();
    m.membershipStatus = "EXPIRED";
  }
  return c.json({
    membership: {
      startDate: m.membershipStartDate,
      endDate: m.membershipEndDate,
      duration: m.membershipDuration,
      status: m.membershipStatus,
      notes: m.membershipNotes,
      daysRemaining: Math.max(0, daysRemaining),
      isExpired,
      isActive,
      hasValidMembership: !!(m.membershipStartDate && m.membershipEndDate),
      pausedFrom: m.pausedFrom,
      pausedUntil: m.pausedUntil,
      pauseReason: m.pauseReason,
      upcoming: m.upcomingStartDate ? { startDate: m.upcomingStartDate, endDate: m.upcomingEndDate, duration: m.upcomingDuration } : null,
    },
  });
});

/** Mirrors FitForge GET /api/payments. */
me.get("/payments", async (c) => {
  const u = c.get("user");
  const info = await db
    .selectFrom("UserInfo")
    .select(["id", "packagePrice", "discountedPrice", "totalAmountPaid", "remainingAmount", "nextPaymentDue", "paymentNotes"])
    .where("userId", "=", u.userId)
    .executeTakeFirstOrThrow();
  const logs = await db
    .selectFrom("PaymentLog")
    .select(["id", "amount", "paymentDate", "paymentMethod", "transactionId", "notes", "recordedBy", "createdAt"])
    .where("userInfoId", "=", info.id)
    .orderBy("paymentDate", "desc")
    .execute();
  const names = await getUsers(logs.map((l) => l.recordedBy).filter((x) => x && x !== "SYSTEM"));
  return c.json({
    paymentInfo: {
      packagePrice: info.packagePrice,
      discountedPrice: info.discountedPrice,
      totalAmountPaid: info.totalAmountPaid,
      remainingAmount: info.remainingAmount,
      nextPaymentDue: info.nextPaymentDue,
      paymentNotes: info.paymentNotes,
    },
    paymentLogs: logs.map((l) => ({
      ...l,
      recordedByName: !l.recordedBy?.trim() || l.recordedBy === "SYSTEM" ? "System" : names.get(l.recordedBy)?.firstName || "Gym staff",
    })),
  });
});

me.get("/membership-history", async (c) => {
  const u = c.get("user");
  const info = await db.selectFrom("UserInfo").select(["id"]).where("userId", "=", u.userId).executeTakeFirstOrThrow();
  const logs = await db
    .selectFrom("MembershipLog")
    .select(["id", "changeType", "previousStatus", "newStatus", "previousEndDate", "newEndDate", "previousDuration", "newDuration", "changeDate", "notes", "recordedBy"])
    .where("userInfoId", "=", info.id)
    .orderBy("changeDate", "desc")
    .execute();
  return c.json({ membershipLogs: logs });
});
