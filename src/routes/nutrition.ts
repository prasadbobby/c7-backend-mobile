import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import { isAdminRole, type AppEnv } from "../lib/auth.js";
import { badRequest, body, forbidden, notFound, query, ymdSchema } from "../lib/http.js";
import { getUsers, displayName } from "../lib/users.js";
import { midnightUTC, noonUTC, now, uuid } from "../lib/util.js";

export const SLOTS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export const CATEGORIES = ["vegetarian", "seafood", "high-protein", "keto", "vegan", "breakfast", "snack", "other"] as const;
export const DEFAULT_GOAL = { kcal: 2000, protein: 120, carbs: 220, fat: 65, waterMl: 2500 };

export async function goalFor(userId: string) {
  const g = await db.selectFrom("NutritionGoal").selectAll().where("userId", "=", userId).executeTakeFirst();
  return g ? { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat, waterMl: g.waterMl, assigned: true, notes: g.notes } : { ...DEFAULT_GOAL, assigned: false, notes: null };
}

export async function daySummary(userId: string, date: string) {
  const day = noonUTC(date);
  const [goal, meals, water, burned] = await Promise.all([
    goalFor(userId),
    db
      .selectFrom("MealLog as m")
      .leftJoin("Recipe as r", "r.id", "m.recipeId")
      .select(["m.id", "m.slot", "m.name", "m.kcal", "m.protein", "m.carbs", "m.fat", "m.servings", "m.recipeId", "m.createdAt", "m.photoUrl", "r.imageUrl"])
      .where("m.userId", "=", userId)
      .where("m.date", "=", day)
      .orderBy("m.createdAt", "asc")
      .execute(),
    db.selectFrom("WaterLog").select(["amountMl"]).where("userId", "=", userId).where("date", "=", day).executeTakeFirst(),
    db.selectFrom("CaloriesData").select(["caloriesBurned", "activeCalories"]).where("userId", "=", userId).where("date", "=", midnightUTC(date)).executeTakeFirst(),
  ]);
  const total = (k: "kcal" | "protein" | "carbs" | "fat") => Math.round(meals.reduce((a, m) => a + m[k], 0) * 10) / 10;
  return {
    date,
    goal,
    totals: { kcal: total("kcal"), protein: total("protein"), carbs: total("carbs"), fat: total("fat") },
    waterMl: water?.amountMl ?? 0,
    burned: Math.round(burned?.activeCalories ?? burned?.caloriesBurned ?? 0),
    meals,
  };
}

export const nutrition = new Hono<AppEnv>();

nutrition.get("/summary", async (c) => {
  const { date } = query(c, z.object({ date: ymdSchema }));
  return c.json(await daySummary(c.get("user").userId, date));
});

nutrition.get("/history", async (c) => {
  const u = c.get("user");
  const { days, to } = query(c, z.object({ days: z.coerce.number().int().min(1).max(90).default(7), to: ymdSchema }));
  const end = noonUTC(to);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const rows = await db
    .selectFrom("MealLog")
    .select(["date", sql<number>`sum(kcal)`.as("kcal"), sql<number>`sum(protein)`.as("protein")])
    .where("userId", "=", u.userId)
    .where("date", ">=", start)
    .where("date", "<=", end)
    .groupBy("date")
    .execute();
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const r = rows.find((x) => x.date.getTime() === d.getTime());
    out.push({ date: d.toISOString().slice(0, 10), kcal: Math.round(Number(r?.kcal ?? 0)), protein: Math.round(Number(r?.protein ?? 0)) });
  }
  return c.json({ days: out, goal: await goalFor(u.userId) });
});

const mealSchema = z
  .object({
    date: ymdSchema,
    slot: z.enum(SLOTS),
    recipeId: z.string().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    kcal: z.number().min(0).max(10000).optional(),
    protein: z.number().min(0).max(1000).optional(),
    carbs: z.number().min(0).max(1000).optional(),
    fat: z.number().min(0).max(1000).optional(),
    servings: z.number().positive().max(20).default(1),
    photoUrl: z.string().regex(/^(data:image\/|https:\/\/)/).max(8 * 1024 * 1024).optional(),
  })
  .refine((b) => b.recipeId || (b.name && b.kcal !== undefined), { message: "Provide a recipeId, or a name and kcal" });

nutrition.post("/meals", async (c) => {
  const u = c.get("user");
  const b = await body(c, mealSchema);
  let row = { name: b.name ?? "", kcal: b.kcal ?? 0, protein: b.protein ?? 0, carbs: b.carbs ?? 0, fat: b.fat ?? 0 };
  if (b.recipeId) {
    const r = await db.selectFrom("Recipe").select(["title", "kcal", "protein", "carbs", "fat", "isPublished"]).where("id", "=", b.recipeId).executeTakeFirst();
    if (!r || !r.isPublished) throw notFound("Recipe not found");
    row = { name: r.title, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat };
  }
  const s = b.servings;
  const id = uuid();
  await db
    .insertInto("MealLog")
    .values({
      id,
      userId: u.userId,
      date: noonUTC(b.date),
      slot: b.slot,
      recipeId: b.recipeId ?? null,
      name: row.name,
      kcal: Math.round(row.kcal * s),
      protein: Math.round(row.protein * s * 10) / 10,
      carbs: Math.round(row.carbs * s * 10) / 10,
      fat: Math.round(row.fat * s * 10) / 10,
      servings: s,
      photoUrl: b.photoUrl ?? null,
    })
    .execute();
  return c.json({ id, summary: await daySummary(u.userId, b.date) }, 201);
});

nutrition.delete("/meals/:id", async (c) => {
  const u = c.get("user");
  const m = await db.selectFrom("MealLog").select(["id", "date"]).where("id", "=", c.req.param("id")).where("userId", "=", u.userId).executeTakeFirst();
  if (!m) throw notFound("Meal not found");
  await db.deleteFrom("MealLog").where("id", "=", m.id).execute();
  return c.json({ success: true, summary: await daySummary(u.userId, m.date.toISOString().slice(0, 10)) });
});

/** Set or adjust today's water. `deltaMl` adds (can be negative), `amountMl` sets absolutely. */
nutrition.post("/water", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ date: ymdSchema, deltaMl: z.number().int().min(-5000).max(5000).optional(), amountMl: z.number().int().min(0).max(10000).optional() }));
  if (b.deltaMl === undefined && b.amountMl === undefined) throw badRequest("Provide deltaMl or amountMl");
  const day = noonUTC(b.date);
  const cur = await db.selectFrom("WaterLog").select(["amountMl"]).where("userId", "=", u.userId).where("date", "=", day).executeTakeFirst();
  const amountMl = Math.min(10000, Math.max(0, b.amountMl ?? (cur?.amountMl ?? 0) + (b.deltaMl ?? 0)));
  await db
    .insertInto("WaterLog")
    .values({ id: uuid(), userId: u.userId, date: day, amountMl })
    .onConflict((oc) => oc.columns(["userId", "date"]).doUpdateSet({ amountMl, updatedAt: now() }))
    .execute();
  return c.json({ waterMl: amountMl });
});

/* ------------------------------------------------------------ recipes ---- */

async function shapeRecipes(userId: string, rows: { id: string; createdBy: string }[]) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { users: new Map(), likes: [], saves: [], comments: [], mine: { likes: new Set<string>(), saves: new Set<string>() }, following: new Set<string>() };
  const [likes, saves, comments, myLikes, mySaves, following] = await Promise.all([
    db.selectFrom("RecipeLike").select(["recipeId", db.fn.countAll<number>().as("n")]).where("recipeId", "in", ids).groupBy("recipeId").execute(),
    db.selectFrom("RecipeSave").select(["recipeId", db.fn.countAll<number>().as("n")]).where("recipeId", "in", ids).groupBy("recipeId").execute(),
    db.selectFrom("RecipeComment").select(["recipeId", db.fn.countAll<number>().as("n")]).where("recipeId", "in", ids).groupBy("recipeId").execute(),
    db.selectFrom("RecipeLike").select("recipeId").where("userId", "=", userId).where("recipeId", "in", ids).execute(),
    db.selectFrom("RecipeSave").select("recipeId").where("userId", "=", userId).where("recipeId", "in", ids).execute(),
    db.selectFrom("UserFollow").select("followingId").where("followerId", "=", userId).execute(),
  ]);
  return {
    users: await getUsers(rows.map((r) => r.createdBy)),
    likes,
    saves,
    comments,
    mine: { likes: new Set(myLikes.map((x) => x.recipeId)), saves: new Set(mySaves.map((x) => x.recipeId)) },
    following: new Set(following.map((f) => f.followingId)),
  };
}

const recipeCols = ["id", "title", "description", "category", "imageUrl", "kcal", "protein", "carbs", "fat", "minutes", "servings", "ingredients", "steps", "tags", "createdBy", "createdAt"] as const;

export const recipes = new Hono<AppEnv>();

recipes.get("/", async (c) => {
  const u = c.get("user");
  const q = query(
    c,
    z.object({
      category: z.enum(CATEGORIES).optional(),
      search: z.string().max(80).optional(),
      sort: z.enum(["recent", "popular", "protein", "kcal", "quick"]).default("recent"),
      saved: z.enum(["true", "false"]).default("false"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  );
  let w = db.selectFrom("Recipe as r").where("r.isPublished", "=", true);
  if (q.category) w = w.where("r.category", "=", q.category);
  if (q.search) {
    const s = `%${q.search.replace(/[%_]/g, "")}%`;
    w = w.where((eb) => eb.or([eb("r.title", "ilike", s), eb("r.description", "ilike", s), eb(sql`array_to_string(r.ingredients, ' ')`, "ilike", s)]));
  }
  if (q.saved === "true") w = w.where(sql<boolean>`exists (select 1 from "RecipeSave" s where s."recipeId" = r.id and s."userId" = ${u.userId})`);
  const order =
    q.sort === "popular"
      ? sql`(select count(*) from "RecipeLike" l where l."recipeId" = r.id) desc, r."createdAt" desc`
      : q.sort === "protein"
        ? sql`r.protein desc`
        : q.sort === "kcal"
          ? sql`r.kcal asc`
          : q.sort === "quick"
            ? sql`r.minutes asc`
            : sql`r."createdAt" desc`;
  const [rows, total] = await Promise.all([
    w.select(recipeCols.map((k) => `r.${k}` as const)).orderBy(order).offset((q.page - 1) * q.limit).limit(q.limit).execute(),
    w.select(db.fn.countAll<number>().as("n")).executeTakeFirstOrThrow(),
  ]);
  const meta = await shapeRecipes(u.userId, rows);
  return c.json({
    recipes: rows.map((r) => ({
      ...r,
      author: { userId: r.createdBy, name: displayName(meta.users.get(r.createdBy)!), imageUrl: meta.users.get(r.createdBy)!.imageUrl, isFollowing: meta.following.has(r.createdBy) },
      likes: meta.likes.find((x) => x.recipeId === r.id)?.n ?? 0,
      saves: meta.saves.find((x) => x.recipeId === r.id)?.n ?? 0,
      comments: meta.comments.find((x) => x.recipeId === r.id)?.n ?? 0,
      liked: meta.mine.likes.has(r.id),
      saved: meta.mine.saves.has(r.id),
    })),
    total: total.n,
    page: q.page,
    totalPages: Math.ceil(total.n / q.limit),
  });
});

recipes.get("/:id", async (c) => {
  const u = c.get("user");
  const r = await db.selectFrom("Recipe").select([...recipeCols, "isPublished"]).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!r || (!r.isPublished && !isAdminRole(u.role))) throw notFound("Recipe not found");
  const meta = await shapeRecipes(u.userId, [r]);
  const comments = await db.selectFrom("RecipeComment").selectAll().where("recipeId", "=", r.id).orderBy("createdAt", "asc").execute();
  const commenters = await getUsers(comments.map((x) => x.userId));
  return c.json({
    recipe: {
      ...r,
      author: { userId: r.createdBy, name: displayName(meta.users.get(r.createdBy)!), imageUrl: meta.users.get(r.createdBy)!.imageUrl, isFollowing: meta.following.has(r.createdBy) },
      likes: meta.likes[0]?.n ?? 0,
      saves: meta.saves[0]?.n ?? 0,
      liked: meta.mine.likes.has(r.id),
      saved: meta.mine.saves.has(r.id),
      comments: comments.map((x) => ({ id: x.id, content: x.content, createdAt: x.createdAt, author: { userId: x.userId, name: displayName(commenters.get(x.userId)!), imageUrl: commenters.get(x.userId)!.imageUrl }, isMine: x.userId === u.userId })),
    },
  });
});

async function toggle(table: "RecipeLike" | "RecipeSave", userId: string, recipeId: string) {
  const r = await db.selectFrom("Recipe").select("id").where("id", "=", recipeId).where("isPublished", "=", true).executeTakeFirst();
  if (!r) throw notFound("Recipe not found");
  const existing = await db.selectFrom(table).select("id").where("userId", "=", userId).where("recipeId", "=", recipeId).executeTakeFirst();
  if (existing) await db.deleteFrom(table).where("id", "=", existing.id).execute();
  else await db.insertInto(table).values({ id: uuid(), userId, recipeId }).execute();
  const count = await db.selectFrom(table).select(db.fn.countAll<number>().as("n")).where("recipeId", "=", recipeId).executeTakeFirstOrThrow();
  return { active: !existing, count: count.n };
}

recipes.post("/:id/like", async (c) => {
  const t = await toggle("RecipeLike", c.get("user").userId, c.req.param("id"));
  return c.json({ liked: t.active, likes: t.count });
});
recipes.post("/:id/save", async (c) => {
  const t = await toggle("RecipeSave", c.get("user").userId, c.req.param("id"));
  return c.json({ saved: t.active, saves: t.count });
});

recipes.post("/:id/comments", async (c) => {
  const u = c.get("user");
  const r = await db.selectFrom("Recipe").select("id").where("id", "=", c.req.param("id")).where("isPublished", "=", true).executeTakeFirst();
  if (!r) throw notFound("Recipe not found");
  const b = await body(c, z.object({ content: z.string().trim().min(1).max(1000) }));
  const id = uuid();
  await db.insertInto("RecipeComment").values({ id, recipeId: r.id, userId: u.userId, content: b.content }).execute();
  return c.json({ comment: { id, content: b.content, createdAt: now(), author: { userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim(), imageUrl: u.imageUrl }, isMine: true } }, 201);
});

export const recipeComments = new Hono<AppEnv>();
recipeComments.delete("/:id", async (c) => {
  const u = c.get("user");
  const cm = await db.selectFrom("RecipeComment").select(["id", "userId"]).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!cm) throw notFound("Comment not found");
  if (cm.userId !== u.userId && !isAdminRole(u.role)) throw forbidden();
  await db.deleteFrom("RecipeComment").where("id", "=", cm.id).execute();
  return c.json({ success: true });
});

export const follows = new Hono<AppEnv>();
follows.post("/:id/follow", async (c) => {
  const u = c.get("user");
  const target = c.req.param("id");
  if (target === u.userId) throw badRequest("You can't follow yourself");
  const known = await db.selectFrom("UserInfo").select("userId").where("userId", "=", target).executeTakeFirst();
  if (!known) throw notFound("Member not found");
  const existing = await db.selectFrom("UserFollow").select("followerId").where("followerId", "=", u.userId).where("followingId", "=", target).executeTakeFirst();
  if (existing) await db.deleteFrom("UserFollow").where("followerId", "=", u.userId).where("followingId", "=", target).execute();
  else await db.insertInto("UserFollow").values({ followerId: u.userId, followingId: target }).execute();
  const followers = await db.selectFrom("UserFollow").select(db.fn.countAll<number>().as("n")).where("followingId", "=", target).executeTakeFirstOrThrow();
  return c.json({ following: !existing, followers: followers.n });
});
