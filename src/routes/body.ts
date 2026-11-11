import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { body, notFound, ymdSchema } from "../lib/http.js";
import { istToUTC, now, parseISTDate, uuid } from "../lib/util.js";

export const MEASUREMENT_TYPES = [
  "METABOLIC_AGE", "HEIGHT", "WEIGHT", "BODY_FAT_PERCENTAGE", "VISCERAL_FAT", "SKELETAL_MUSCLE_MASS", "FAT_MASS",
  "NECK", "SHOULDERS", "CHEST", "UPPER_ARM_RIGHT", "UPPER_ARM_LEFT", "FOREARM_RIGHT", "FOREARM_LEFT", "WRIST",
  "WAIST", "ABDOMEN", "HIPS", "THIGH_RIGHT", "THIGH_LEFT", "CALF_RIGHT", "CALF_LEFT",
] as const;

export const measurements = new Hono<AppEnv>();

measurements.get("/", async (c) => {
  const u = c.get("user");
  const [rows, goals] = await Promise.all([
    db.selectFrom("BodyMeasurement").selectAll().where("userId", "=", u.userId).orderBy("recordedDate", "desc").execute(),
    db.selectFrom("MeasurementGoal").selectAll().where("userId", "=", u.userId).where("isActive", "=", true).execute(),
  ]);
  const latest: Record<string, (typeof rows)[number]> = {};
  for (const r of rows) if (!latest[r.measurementType]) latest[r.measurementType] = r;
  return c.json({ measurements: rows, latest, goals });
});

/**
 * Mirrors POST /api/measurements: one value per type per IST day (upsert).
 * FitForge keys the upsert on istToUTC(parseISTDate(day)); we use that same value for create too.
 */
measurements.post("/", async (c) => {
  const u = c.get("user");
  const b = await body(
    c,
    z.object({ measurementType: z.enum(MEASUREMENT_TYPES), value: z.number().positive().max(1000), unit: z.string().min(1).max(10), recordedDate: ymdSchema, notes: z.string().max(500).nullable().optional() }),
  );
  const recordedDate = istToUTC(parseISTDate(b.recordedDate));
  const values = { value: b.value, unit: b.unit, notes: b.notes ?? null, updatedAt: now() };
  await db
    .insertInto("BodyMeasurement")
    .values({ id: uuid(), userId: u.userId, measurementType: b.measurementType, recordedDate, dataSource: "MANUAL", ...values })
    .onConflict((oc) => oc.columns(["userId", "measurementType", "recordedDate"]).doUpdateSet(values))
    .execute();
  // Keep the profile's weight/height in sync like FitForge's profile page shows them.
  if (b.measurementType === "WEIGHT") await db.updateTable("UserInfo").set({ weight: b.value, updatedAt: now() }).where("userId", "=", u.userId).execute();
  if (b.measurementType === "HEIGHT") await db.updateTable("UserInfo").set({ height: b.value, updatedAt: now() }).where("userId", "=", u.userId).execute();
  const measurement = await db.selectFrom("BodyMeasurement").selectAll().where("userId", "=", u.userId).where("measurementType", "=", b.measurementType).where("recordedDate", "=", recordedDate).executeTakeFirstOrThrow();
  return c.json({ success: true, measurement }, 201);
});

measurements.delete("/:id", async (c) => {
  const u = c.get("user");
  const r = await db.deleteFrom("BodyMeasurement").where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!r.numDeletedRows) throw notFound("Measurement not found");
  return c.json({ success: true });
});

measurements.put("/goals", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ measurementType: z.enum(MEASUREMENT_TYPES), targetValue: z.number().positive().max(1000), targetDate: ymdSchema.nullable().optional() }));
  const latest = await db.selectFrom("BodyMeasurement").select("value").where("userId", "=", u.userId).where("measurementType", "=", b.measurementType).orderBy("recordedDate", "desc").executeTakeFirst();
  const values = { targetValue: b.targetValue, currentValue: latest?.value ?? null, targetDate: b.targetDate ? new Date(b.targetDate) : null, isActive: true, updatedAt: now() };
  await db
    .insertInto("MeasurementGoal")
    .values({ id: uuid(), userId: u.userId, measurementType: b.measurementType, ...values })
    .onConflict((oc) => oc.columns(["userId", "measurementType"]).doUpdateSet(values))
    .execute();
  return c.json({ success: true });
});
