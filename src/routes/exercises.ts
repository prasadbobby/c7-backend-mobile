import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { body, notFound, query } from "../lib/http.js";
import { now, pgArray, uuid } from "../lib/util.js";
import { imageUrl } from "./workouts.js";

const csv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []));

export const exercises = new Hono<AppEnv>();

/** Library browse — mirrors FitForge ExerciseFetch filters (search words AND, category/level/force IN, muscles hasEvery, owned equipment, favourites). */
exercises.get("/", async (c) => {
  const u = c.get("user");
  const q = query(
    c,
    z.object({
      search: z.string().max(80).default(""),
      category: csv,
      level: csv,
      force: csv,
      muscle: csv,
      favourites: z.enum(["true", "false"]).default("false"),
      equipmentOwned: z.enum(["true", "false"]).default("false"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(60).default(20),
    }),
  );
  let w = db.selectFrom("Exercise as e");
  for (const word of q.search.split(" ").filter(Boolean)) w = w.where("e.name", "ilike", `%${word.replace(/[%_]/g, "")}%`);
  if (q.category.length) w = w.where(sql<boolean>`e.category::text = any(${q.category})`);
  if (q.level.length) w = w.where(sql<boolean>`e.level::text = any(${q.level})`);
  if (q.force.length) w = w.where(sql<boolean>`e.force::text = any(${q.force})`);
  if (q.muscle.length)
    w = w.where(sql<boolean>`(e.primary_muscles::text[] @> ${q.muscle}::text[] or e.secondary_muscles::text[] @> ${q.muscle}::text[])`);
  if (q.equipmentOwned === "true") {
    w = w.where(sql<boolean>`e.equipment in (select "equipmentType" from "UserEquipment" where "userId" = ${u.userId})`);
  }
  if (q.favourites === "true") {
    w = w.where(sql<boolean>`exists (select 1 from "FavouriteExercise" f where f."exerciseId" = e.id and f."userId" = ${u.userId})`);
  }
  const [rows, total] = await Promise.all([
    w
      .select([
        "e.id", "e.name", "e.category", "e.level", "e.equipment", "e.force", "e.mechanic", "e.image",
        sql<string>`e.primary_muscles::text`.as("pm"),
        sql<boolean>`exists (select 1 from "FavouriteExercise" f where f."exerciseId" = e.id and f."userId" = ${u.userId})`.as("isFavourite"),
      ])
      .orderBy("e.name", "asc")
      .offset((q.page - 1) * q.limit)
      .limit(q.limit)
      .execute(),
    w.select(db.fn.countAll<number>().as("n")).executeTakeFirstOrThrow(),
  ]);
  return c.json({
    exercises: rows.map(({ pm, ...r }) => ({ ...r, image: imageUrl(r.image), primaryMuscles: pgArray(pm) })),
    total: total.n,
    page: q.page,
    limit: q.limit,
    totalPages: Math.ceil(total.n / q.limit),
  });
});

exercises.get("/:id", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const e = await db
    .selectFrom("Exercise")
    .select([
      "id", "name", "category", "level", "equipment", "force", "mechanic", "image", "description",
      sql<string>`aliases::text`.as("aliases"),
      sql<string>`instructions::text`.as("instructions"),
      sql<string>`tips::text`.as("tips"),
      sql<string>`primary_muscles::text`.as("pm"),
      sql<string>`secondary_muscles::text`.as("sm"),
    ])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!e) throw notFound("Exercise not found");
  const [fav, pb, goal] = await Promise.all([
    db.selectFrom("FavouriteExercise").select("exerciseId").where("userId", "=", u.userId).where("exerciseId", "=", id).executeTakeFirst(),
    db.selectFrom("UserExercisePB").selectAll().where("userId", "=", u.userId).where("exerciseId", "=", id).executeTakeFirst(),
    db.selectFrom("UserGoal").selectAll().where("userId", "=", u.userId).where("exerciseId", "=", id).executeTakeFirst(),
  ]);
  const { pm, sm, ...rest } = e;
  return c.json({
    exercise: {
      ...rest,
      image: imageUrl(e.image),
      aliases: pgArray(e.aliases),
      instructions: pgArray(e.instructions),
      tips: pgArray(e.tips),
      primaryMuscles: pgArray(pm),
      secondaryMuscles: pgArray(sm),
      isFavourite: !!fav,
      pb: pb ? { weight: pb.weight, reps: pb.reps, exerciseDuration: pb.exerciseDuration, date: pb.createdAt } : null,
      goal: goal ? { id: goal.id, goalValue: goal.goalValue } : null,
    },
  });
});

/** Mirrors /api/exercise-history/[exerciseId]: every session the member did this exercise. */
exercises.get("/:id/history", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const rows = await db
    .selectFrom("SetLog as s")
    .innerJoin("WorkoutLogExercise as le", "le.id", "s.workoutLogExerciseId")
    .innerJoin("WorkoutLog as l", "l.id", "le.workoutLogId")
    .innerJoin("WorkoutPlan as p", "p.id", "l.workoutPlanId")
    .select(["l.id as logId", "l.date", "p.name as planName", "s.weight", "s.reps", "s.exerciseDuration", "s.order", "s.isWarmUp"])
    .where("l.userId", "=", u.userId)
    .where("le.exerciseId", "=", id)
    .orderBy("l.date", "desc")
    .orderBy(sql`s."order" asc nulls last`)
    .limit(500)
    .execute();
  const sessions: { logId: string; date: Date; planName: string; sets: { weight: number | null; reps: number | null; exerciseDuration: number | null; isWarmUp: boolean }[]; bestWeight: number; volume: number }[] = [];
  for (const r of rows) {
    let s = sessions.find((x) => x.logId === r.logId);
    if (!s) sessions.push((s = { logId: r.logId, date: r.date, planName: r.planName, sets: [], bestWeight: 0, volume: 0 }));
    s.sets.push({ weight: r.weight, reps: r.reps, exerciseDuration: r.exerciseDuration, isWarmUp: r.isWarmUp });
    s.bestWeight = Math.max(s.bestWeight, r.weight ?? 0);
    s.volume += (r.weight ?? 0) * (r.reps ?? 0);
  }
  return c.json({ sessions });
});

/** Mirrors handleToggleFavouriteExercise. */
exercises.post("/:id/favourite", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const exists = await db.selectFrom("Exercise").select("id").where("id", "=", id).executeTakeFirst();
  if (!exists) throw notFound("Exercise not found");
  const fav = await db.selectFrom("FavouriteExercise").select("exerciseId").where("userId", "=", u.userId).where("exerciseId", "=", id).executeTakeFirst();
  if (fav) await db.deleteFrom("FavouriteExercise").where("userId", "=", u.userId).where("exerciseId", "=", id).execute();
  else await db.insertInto("FavouriteExercise").values({ userId: u.userId, exerciseId: id }).execute();
  return c.json({ isFavourite: !fav });
});

export const goals = new Hono<AppEnv>();

/** Dashboard goals (UserGoal, goalType WEIGHT) with current PB progress. */
goals.get("/", async (c) => {
  const u = c.get("user");
  const rows = await db
    .selectFrom("UserGoal as g")
    .innerJoin("Exercise as e", "e.id", "g.exerciseId")
    .leftJoin("UserExercisePB as pb", (j) => j.onRef("pb.exerciseId", "=", "g.exerciseId").on("pb.userId", "=", u.userId))
    .select(["g.id", "g.exerciseId", "g.goalValue", "g.goalType", "e.name", "e.image", "pb.weight as currentWeight"])
    .where("g.userId", "=", u.userId)
    .orderBy("g.createdAt", "desc")
    .execute();
  return c.json({
    goals: rows.map((r) => ({ ...r, image: imageUrl(r.image), currentWeight: r.currentWeight ?? 0, progress: Math.min(1, (r.currentWeight ?? 0) / r.goalValue) })),
  });
});

goals.post("/", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ exerciseId: z.string().min(1), goalValue: z.number().positive().max(1000) }));
  const ex = await db.selectFrom("Exercise").select("id").where("id", "=", b.exerciseId).executeTakeFirst();
  if (!ex) throw notFound("Exercise not found");
  const id = uuid();
  await db
    .insertInto("UserGoal")
    .values({ id, userId: u.userId, exerciseId: b.exerciseId, goalType: "WEIGHT", goalValue: b.goalValue, updatedAt: now() })
    .onConflict((oc) => oc.columns(["userId", "exerciseId", "goalType"]).doUpdateSet({ goalValue: b.goalValue, updatedAt: now() }))
    .execute();
  return c.json({ success: true }, 201);
});

goals.delete("/:id", async (c) => {
  const u = c.get("user");
  const r = await db.deleteFrom("UserGoal").where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!r.numDeletedRows) throw notFound("Goal not found");
  return c.json({ success: true });
});
