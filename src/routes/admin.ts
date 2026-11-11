import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { body, notFound, query } from "../lib/http.js";
import { getUsers, displayName } from "../lib/users.js";
import { now, uuid } from "../lib/util.js";
import { CATEGORIES, DEFAULT_GOAL, daySummary, goalFor } from "./nutrition.js";

/** Admin API used by FitForge's /admin/nutrition page (Clerk session token from the browser). */
export const admin = new Hono<AppEnv>();

const recipeInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(CATEGORIES),
  imageUrl: z.string().max(7 * 1024 * 1024).nullable().optional(),
  kcal: z.number().int().min(0).max(10000),
  protein: z.number().min(0).max(1000),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(1000),
  minutes: z.number().int().min(0).max(1440),
  servings: z.number().int().min(1).max(50).default(1),
  ingredients: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
  steps: z.array(z.string().trim().min(1).max(1000)).max(40).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  isPublished: z.boolean().default(true),
});

admin.get("/recipes", async (c) => {
  const rows = await db.selectFrom("Recipe").selectAll().orderBy("createdAt", "desc").execute();
  const [likes, logs] = await Promise.all([
    db.selectFrom("RecipeLike").select(["recipeId", db.fn.countAll<number>().as("n")]).groupBy("recipeId").execute(),
    db.selectFrom("MealLog").select(["recipeId", db.fn.countAll<number>().as("n")]).where("recipeId", "is not", null).groupBy("recipeId").execute(),
  ]);
  const authors = await getUsers(rows.map((r) => r.createdBy));
  return c.json({
    recipes: rows.map((r) => ({ ...r, authorName: displayName(authors.get(r.createdBy)!), likes: likes.find((l) => l.recipeId === r.id)?.n ?? 0, timesLogged: logs.find((l) => l.recipeId === r.id)?.n ?? 0 })),
  });
});

admin.post("/recipes", async (c) => {
  const b = await body(c, recipeInput);
  const id = uuid();
  await db.insertInto("Recipe").values({ id, ...b, description: b.description ?? null, imageUrl: b.imageUrl ?? null, createdBy: c.get("user").userId }).execute();
  return c.json({ recipe: await db.selectFrom("Recipe").selectAll().where("id", "=", id).executeTakeFirstOrThrow() }, 201);
});

admin.put("/recipes/:id", async (c) => {
  const b = await body(c, recipeInput);
  const r = await db.updateTable("Recipe").set({ ...b, description: b.description ?? null, imageUrl: b.imageUrl ?? null, updatedAt: now() }).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!r.numUpdatedRows) throw notFound("Recipe not found");
  return c.json({ recipe: await db.selectFrom("Recipe").selectAll().where("id", "=", c.req.param("id")).executeTakeFirstOrThrow() });
});

admin.delete("/recipes/:id", async (c) => {
  const r = await db.deleteFrom("Recipe").where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!r.numDeletedRows) throw notFound("Recipe not found");
  return c.json({ success: true });
});

/** Members with their nutrition goal + today's intake, for the admin overview. */
admin.get("/members", async (c) => {
  const { date } = query(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
  const users = await db.selectFrom("UserInfo").select(["userId", "c7UserId", "role", "membershipStatus"]).orderBy("createdAt", "desc").execute();
  const [goals, profiles] = await Promise.all([db.selectFrom("NutritionGoal").selectAll().execute(), getUsers(users.map((u) => u.userId))]);
  const summaries = await Promise.all(users.map((u) => daySummary(u.userId, date)));
  return c.json({
    defaultGoal: DEFAULT_GOAL,
    members: users.map((u, i) => {
      const p = profiles.get(u.userId)!;
      const g = goals.find((x) => x.userId === u.userId);
      return {
        userId: u.userId,
        memberId: u.c7UserId,
        name: displayName(p),
        email: p.email ?? null,
        imageUrl: p.imageUrl,
        role: u.role,
        membershipStatus: u.membershipStatus,
        goal: g ? { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat, waterMl: g.waterMl, notes: g.notes } : null,
        today: { ...summaries[i]!.totals, waterMl: summaries[i]!.waterMl, meals: summaries[i]!.meals.length },
      };
    }),
  });
});

admin.get("/members/:userId/nutrition", async (c) => {
  const { date } = query(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
  const userId = c.req.param("userId");
  return c.json({ goal: await goalFor(userId), summary: await daySummary(userId, date) });
});

admin.put("/members/:userId/nutrition-goal", async (c) => {
  const userId = c.req.param("userId");
  const exists = await db.selectFrom("UserInfo").select("userId").where("userId", "=", userId).executeTakeFirst();
  if (!exists) throw notFound("Member not found");
  const b = await body(
    c,
    z.object({ kcal: z.number().int().min(800).max(8000), protein: z.number().int().min(0).max(600), carbs: z.number().int().min(0).max(1000), fat: z.number().int().min(0).max(400), waterMl: z.number().int().min(500).max(8000), notes: z.string().max(500).nullable().optional() }),
  );
  const values = { ...b, notes: b.notes ?? null, assignedBy: c.get("user").userId, updatedAt: now() };
  await db.insertInto("NutritionGoal").values({ id: uuid(), userId, ...values }).onConflict((oc) => oc.column("userId").doUpdateSet(values)).execute();
  return c.json({ success: true, goal: await goalFor(userId) });
});

admin.delete("/members/:userId/nutrition-goal", async (c) => {
  await db.deleteFrom("NutritionGoal").where("userId", "=", c.req.param("userId")).execute();
  return c.json({ success: true });
});
