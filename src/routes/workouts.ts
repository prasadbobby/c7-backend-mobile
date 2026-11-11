import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { isAdminRole, type AppEnv } from "../lib/auth.js";
import { badRequest, body, forbidden, notFound, query } from "../lib/http.js";
import { getUsers, displayName } from "../lib/users.js";
import { now, pgArray, uuid } from "../lib/util.js";

export const imageUrl = (p: string | null | undefined) => (!p ? null : /^(https?:|data:)/.test(p) ? p : `${env.webAssetBaseUrl}${p.startsWith("/") ? "" : "/"}${p}`);

async function planWithExercises(planId: string) {
  const plan = await db.selectFrom("WorkoutPlan").select(["id", "name", "notes", "trainingType", "userId", "createdAt"]).where("id", "=", planId).executeTakeFirst();
  if (!plan) return null;
  const exercises = await db
    .selectFrom("WorkoutPlanExercise as wpe")
    .innerJoin("Exercise as e", "e.id", "wpe.exerciseId")
    .select([
      "wpe.id", "wpe.exerciseId", "wpe.sets", "wpe.reps", "wpe.exerciseDuration", "wpe.order", "wpe.trackingType",
      "e.name", "e.category", "e.image", "e.equipment",
      sql<string>`e.primary_muscles::text`.as("primaryMuscles"),
    ])
    .where("wpe.workoutPlanId", "=", planId)
    .orderBy(sql`wpe."order" asc nulls last`)
    .execute();
  const timers = await db
    .selectFrom("RestTimer")
    .select(["exerciseId", "workoutPlanId", "defaultRestSeconds", "minRestSeconds", "maxRestSeconds", "autoStart"])
    .where((eb) => eb.or([eb("workoutPlanId", "=", planId), eb("exerciseId", "in", exercises.length ? exercises.map((e) => e.exerciseId) : ["-"])]))
    .execute();
  const restFor = (exerciseId: string) => {
    const t = timers.find((x) => x.exerciseId === exerciseId) ?? timers.find((x) => x.workoutPlanId === planId && !x.exerciseId);
    return t ? { defaultRestSeconds: t.defaultRestSeconds, minRestSeconds: t.minRestSeconds, maxRestSeconds: t.maxRestSeconds, autoStart: t.autoStart } : { defaultRestSeconds: 60, minRestSeconds: 30, maxRestSeconds: 300, autoStart: true };
  };
  return {
    ...plan,
    exercises: exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.name,
      category: e.category,
      equipment: e.equipment,
      image: imageUrl(e.image),
      primaryMuscles: pgArray(e.primaryMuscles),
      sets: e.sets,
      reps: e.reps,
      exerciseDuration: e.exerciseDuration,
      order: e.order,
      trackingType: e.trackingType,
      rest: restFor(e.exerciseId),
    })),
  };
}

export const workouts = new Hono<AppEnv>();

/** Mirrors FitForge workout page: members see their assignments (PENDING / IN_PROGRESS by default). */
workouts.get("/assigned", async (c) => {
  const u = c.get("user");
  const { status } = query(c, z.object({ status: z.enum(["active", "all"]).default("active") }));
  let q = db
    .selectFrom("AssignedWorkout as aw")
    .innerJoin("WorkoutPlan as p", "p.id", "aw.workoutPlanId")
    .select(["aw.id", "aw.status", "aw.notes", "aw.dueDate", "aw.assignedAt", "aw.assignedBy", "p.id as planId", "p.name", "p.trainingType", "p.notes as planNotes"])
    .where("aw.userId", "=", u.userId)
    .orderBy("aw.assignedAt", "desc");
  if (status === "active") q = q.where("aw.status", "in", ["PENDING", "IN_PROGRESS"]);
  const rows = await q.execute();
  const planIds = [...new Set(rows.map((r) => r.planId))];
  const ex = planIds.length
    ? await db
        .selectFrom("WorkoutPlanExercise as wpe")
        .innerJoin("Exercise as e", "e.id", "wpe.exerciseId")
        .select(["wpe.workoutPlanId", "wpe.sets", "e.name", "e.image", "e.category"])
        .where("wpe.workoutPlanId", "in", planIds)
        .orderBy(sql`wpe."order" asc nulls last`)
        .execute()
    : [];
  const admins = await getUsers(rows.map((r) => r.assignedBy));
  return c.json({
    assignments: rows.map((r) => {
      const list = ex.filter((e) => e.workoutPlanId === r.planId);
      return {
        id: r.id,
        status: r.status,
        notes: r.notes,
        dueDate: r.dueDate,
        assignedAt: r.assignedAt,
        assignedBy: { userId: r.assignedBy, name: displayName(admins.get(r.assignedBy)!) },
        plan: {
          id: r.planId,
          name: r.name,
          trainingType: r.trainingType,
          notes: r.planNotes,
          exerciseCount: list.length,
          totalSets: list.reduce((a, e) => a + e.sets, 0),
          estimatedMinutes: Math.max(10, Math.round(list.reduce((a, e) => a + e.sets, 0) * 2.5)),
          image: imageUrl(list.find((e) => e.image)?.image),
          exercises: list.slice(0, 6).map((e) => ({ name: e.name, sets: e.sets, category: e.category })),
        },
      };
    }),
  });
});

/** Mirrors PATCH /api/user/assigned-workouts. */
workouts.patch("/assigned/:id", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]) }));
  const r = await db.updateTable("AssignedWorkout").set({ status: b.status }).where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!r.numUpdatedRows) throw notFound("Assignment not found");
  return c.json({ success: true, status: b.status });
});

/** Plan detail. Access rule mirrors /api/workouts/[id] (admin, own, system) plus assigned plans. */
workouts.get("/plans/:id", async (c) => {
  const u = c.get("user");
  const plan = await planWithExercises(c.req.param("id"));
  if (!plan) throw notFound("Workout not found");
  const assigned = await db.selectFrom("AssignedWorkout").select(["id", "status"]).where("userId", "=", u.userId).where("workoutPlanId", "=", plan.id).orderBy("assignedAt", "desc").executeTakeFirst();
  if (!(isAdminRole(u.role) || plan.userId === u.userId || plan.userId === null || assigned)) throw forbidden("Access denied");
  const exerciseIds = plan.exercises.map((e) => e.exerciseId);
  // Previous performance for prefilling the logger + PBs.
  const [lastSets, pbs] = await Promise.all([
    exerciseIds.length
      ? db
          .selectFrom("SetLog as s")
          .innerJoin("WorkoutLogExercise as le", "le.id", "s.workoutLogExerciseId")
          .innerJoin("WorkoutLog as l", "l.id", "le.workoutLogId")
          .select(["le.exerciseId", "s.weight", "s.reps", "s.exerciseDuration", "s.order", "l.date"])
          .where("l.userId", "=", u.userId)
          .where("le.exerciseId", "in", exerciseIds)
          .orderBy("l.date", "desc")
          .limit(300)
          .execute()
      : [],
    exerciseIds.length ? db.selectFrom("UserExercisePB").selectAll().where("userId", "=", u.userId).where("exerciseId", "in", exerciseIds).execute() : [],
  ]);
  const totalSets = plan.exercises.reduce((a, e) => a + e.sets, 0);
  return c.json({
    plan: {
      ...plan,
      assignment: assigned ?? null,
      totalSets,
      estimatedMinutes: Math.max(10, Math.round(totalSets * 2.5)),
      exercises: plan.exercises.map((e) => {
        const prev = lastSets.filter((s) => s.exerciseId === e.exerciseId);
        const lastDate = prev[0]?.date?.getTime();
        const previous = prev.filter((s) => s.date.getTime() === lastDate).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const pb = pbs.find((p) => p.exerciseId === e.exerciseId);
        return {
          ...e,
          previous: previous.map((s) => ({ weight: s.weight, reps: s.reps, exerciseDuration: s.exerciseDuration })),
          pb: pb ? { weight: pb.weight, reps: pb.reps, exerciseDuration: pb.exerciseDuration } : null,
        };
      }),
    },
  });
});

const setSchema = z.object({
  weight: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  exerciseDuration: z.number().int().min(0).max(36000).nullable().optional(),
  isWarmUp: z.boolean().optional(),
  restTimeSeconds: z.number().int().min(0).max(36000).nullable().optional(),
  setStartTime: z.string().datetime().nullable().optional(),
  setEndTime: z.string().datetime().nullable().optional(),
});

/**
 * Save a completed workout. Mirrors FitForge POST /api/workout-logs (sets get an
 * order, PBs upserted with the same rules) and marks the assignment COMPLETED.
 * Only completed sets should be sent (FitForge filters uncompleted sets client-side).
 */
workouts.post("/logs", async (c) => {
  const u = c.get("user");
  const b = await body(
    c,
    z.object({
      workoutPlanId: z.string().min(1),
      assignmentId: z.string().optional(),
      date: z.string().datetime().optional(),
      duration: z.number().int().min(0).max(86400),
      totalRestTime: z.number().int().min(0).max(86400).default(0),
      totalActiveTime: z.number().int().min(0).max(86400).default(0),
      exercises: z
        .array(z.object({ exerciseId: z.string().min(1), trackingType: z.enum(["reps", "duration"]), sets: z.array(setSchema).min(1).max(50) }))
        .min(1, "Complete at least one set to save the workout"),
    }),
  );
  const plan = await db.selectFrom("WorkoutPlan").select(["id", "name"]).where("id", "=", b.workoutPlanId).executeTakeFirst();
  if (!plan) throw notFound("Workout plan not found");
  const known = await db.selectFrom("Exercise").select("id").where("id", "in", b.exercises.map((e) => e.exerciseId)).execute();
  if (known.length !== new Set(b.exercises.map((e) => e.exerciseId)).size) throw badRequest("Unknown exercise in workout");

  const logId = uuid();
  const newPBs: { exerciseId: string; weight: number; reps: number | null; exerciseDuration: number | null }[] = [];
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("WorkoutLog")
      .values({
        id: logId,
        userId: u.userId,
        workoutPlanId: b.workoutPlanId,
        date: b.date ? new Date(b.date) : now(),
        duration: b.duration,
        inProgress: false,
        totalRestTimeSeconds: b.totalRestTime,
        totalActiveTimeSeconds: b.totalActiveTime,
      })
      .execute();
    for (const ex of b.exercises) {
      const leId = uuid();
      await trx.insertInto("WorkoutLogExercise").values({ id: leId, workoutLogId: logId, exerciseId: ex.exerciseId, trackingType: ex.trackingType }).execute();
      await trx
        .insertInto("SetLog")
        .values(
          ex.sets.map((s, i) => ({
            id: uuid(),
            workoutLogExerciseId: leId,
            weight: s.weight ?? null,
            reps: s.reps ?? null,
            exerciseDuration: s.exerciseDuration ?? null,
            order: i + 1,
            isWarmUp: s.isWarmUp ?? false,
            restTimeSeconds: s.restTimeSeconds ?? null,
            setStartTime: s.setStartTime ? new Date(s.setStartTime) : null,
            setEndTime: s.setEndTime ? new Date(s.setEndTime) : null,
          })),
        )
        .execute();
      // PB rule from /api/workout-logs: heavier weight, or same weight with more reps / longer duration.
      for (const s of ex.sets) {
        if (!s.weight || !(s.reps || s.exerciseDuration)) continue;
        const weight = s.weight;
        const reps = s.reps ?? null;
        const duration = s.exerciseDuration ?? null;
        const existing = await trx.selectFrom("UserExercisePB").selectAll().where("userId", "=", u.userId).where("exerciseId", "=", ex.exerciseId).executeTakeFirst();
        const better =
          !existing ||
          weight > existing.weight ||
          (weight === existing.weight && !!reps && !!existing.reps && reps > existing.reps) ||
          (weight === existing.weight && !!duration && !!existing.exerciseDuration && duration > existing.exerciseDuration);
        if (!better) continue;
        await trx
          .insertInto("UserExercisePB")
          .values({ userId: u.userId, exerciseId: ex.exerciseId, weight, reps, exerciseDuration: duration, workoutLogId: logId })
          .onConflict((oc) => oc.columns(["userId", "exerciseId"]).doUpdateSet({ weight, reps, exerciseDuration: duration, workoutLogId: logId }))
          .execute();
        const prior = newPBs.findIndex((p) => p.exerciseId === ex.exerciseId);
        const rec = { exerciseId: ex.exerciseId, weight, reps, exerciseDuration: duration };
        if (prior >= 0) newPBs[prior] = rec;
        else newPBs.push(rec);
      }
    }
    if (b.assignmentId) {
      await trx.updateTable("AssignedWorkout").set({ status: "COMPLETED" }).where("id", "=", b.assignmentId).where("userId", "=", u.userId).execute();
    }
  });
  const volume = b.exercises.reduce((a, e) => a + e.sets.reduce((s, x) => s + (x.weight ?? 0) * (x.reps ?? 0), 0), 0);
  return c.json(
    {
      success: true,
      workoutLog: {
        id: logId,
        workoutPlanName: plan.name,
        duration: b.duration,
        totalRestTime: b.totalRestTime,
        totalActiveTime: b.totalActiveTime,
        exerciseCount: b.exercises.length,
        setCount: b.exercises.reduce((a, e) => a + e.sets.length, 0),
        volume,
      },
      newPBs,
    },
    201,
  );
});

/** Activity history (completed logs), newest first. */
workouts.get("/logs", async (c) => {
  const u = c.get("user");
  const { page, limit } = query(c, z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }));
  const [rows, total] = await Promise.all([
    db
      .selectFrom("WorkoutLog as l")
      .innerJoin("WorkoutPlan as p", "p.id", "l.workoutPlanId")
      .select(["l.id", "l.date", "l.duration", "l.totalRestTimeSeconds", "l.totalActiveTimeSeconds", "p.name as planName", "p.id as planId"])
      .where("l.userId", "=", u.userId)
      .where("l.inProgress", "=", false)
      .orderBy("l.date", "desc")
      .offset((page - 1) * limit)
      .limit(limit)
      .execute(),
    db.selectFrom("WorkoutLog").select(db.fn.countAll<number>().as("n")).where("userId", "=", u.userId).where("inProgress", "=", false).executeTakeFirstOrThrow(),
  ]);
  const ids = rows.map((r) => r.id);
  const sets = ids.length
    ? await db
        .selectFrom("SetLog as s")
        .innerJoin("WorkoutLogExercise as le", "le.id", "s.workoutLogExerciseId")
        .select(["le.workoutLogId", "le.exerciseId", "s.weight", "s.reps"])
        .where("le.workoutLogId", "in", ids)
        .execute()
    : [];
  return c.json({
    logs: rows.map((r) => {
      const mine = sets.filter((s) => s.workoutLogId === r.id);
      return {
        ...r,
        exerciseCount: new Set(mine.map((s) => s.exerciseId)).size,
        setCount: mine.length,
        volume: mine.reduce((a, s) => a + (s.weight ?? 0) * (s.reps ?? 0), 0),
      };
    }),
    total: total.n,
    page,
    limit,
  });
});

workouts.get("/logs/:id", async (c) => {
  const u = c.get("user");
  const log = await db
    .selectFrom("WorkoutLog as l")
    .innerJoin("WorkoutPlan as p", "p.id", "l.workoutPlanId")
    .select(["l.id", "l.userId", "l.date", "l.duration", "l.totalRestTimeSeconds", "l.totalActiveTimeSeconds", "p.name as planName", "p.id as planId"])
    .where("l.id", "=", c.req.param("id"))
    .executeTakeFirst();
  if (!log || (log.userId !== u.userId && !isAdminRole(u.role))) throw notFound("Workout not found");
  const ex = await db
    .selectFrom("WorkoutLogExercise as le")
    .innerJoin("Exercise as e", "e.id", "le.exerciseId")
    .select(["le.id", "le.exerciseId", "le.trackingType", "e.name", "e.image"])
    .where("le.workoutLogId", "=", log.id)
    .execute();
  const sets = ex.length
    ? await db.selectFrom("SetLog").selectAll().where("workoutLogExerciseId", "in", ex.map((e) => e.id)).orderBy(sql`"order" asc nulls last`).execute()
    : [];
  return c.json({
    log: {
      ...log,
      exercises: ex.map((e) => ({ ...e, image: imageUrl(e.image), sets: sets.filter((s) => s.workoutLogExerciseId === e.id) })),
    },
  });
});

workouts.delete("/logs/:id", async (c) => {
  const u = c.get("user");
  const r = await db.deleteFrom("WorkoutLog").where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!r.numDeletedRows) throw notFound("Workout not found");
  return c.json({ success: true });
});
