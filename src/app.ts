import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { db } from "./db/index.js";
import { env } from "./env.js";
import { requireAdmin, requireAuth, type AppEnv } from "./lib/auth.js";
import { HttpError, badRequest, body } from "./lib/http.js";
import { findTestUserByEmail, registerTestUser } from "./lib/users.js";
import { admin } from "./routes/admin.js";
import { measurements } from "./routes/body.js";
import { challenges, comments, posts } from "./routes/challenge.js";
import { dashboard } from "./routes/dashboard.js";
import { engagement } from "./routes/engagement.js";
import { exercises, goals } from "./routes/exercises.js";
import { me } from "./routes/me.js";
import { follows, nutrition, recipeComments, recipes } from "./routes/nutrition.js";
import { steps } from "./routes/steps.js";
import { workouts } from "./routes/workouts.js";

export function buildApp() {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => (env.corsOrigins.includes("*") ? origin || "*" : env.corsOrigins.includes(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    console.error(err);
    return c.json({ error: "Something went wrong. Please try again.", code: "INTERNAL" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404));

  app.get("/health", async (c) => {
    await db.selectFrom("UserInfo").select("id").limit(1).execute();
    return c.json({ ok: true, authMode: env.authMode });
  });

  if (env.authMode === "test") {
    // Test-only: register a fake Clerk profile. Never mounted outside AUTH_MODE=test.
    app.post("/__test/users", async (c) => {
      const b = await body(c, z.object({ userId: z.string(), firstName: z.string(), lastName: z.string(), email: z.string().email(), imageUrl: z.string().default(""), username: z.string().default("") }));
      registerTestUser(b);
      return c.json({ ok: true });
    });
    // Test-only stand-in for Clerk's "find account by email" step of the email-code sign-in.
    app.get("/__test/lookup", (c) => {
      const u = findTestUserByEmail(c.req.query("email") ?? "");
      return u ? c.json({ userId: u.userId }) : c.json({ error: "Not invited", code: "NOT_INVITED" }, 404);
    });
  }

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireAuth);

  /** Image upload → data URL (same storage format FitForge's /api/upload uses). */
  v1.post("/uploads", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw badRequest("No file uploaded");
    if (!file.type.startsWith("image/")) throw badRequest("Only image files are allowed");
    if (file.size > env.maxUploadBytes) throw badRequest(`File size must be less than ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB`);
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    return c.json({ success: true, url: `data:${file.type};base64,${b64}`, fileType: file.type, fileSize: file.size });
  });

  v1.route("/me", me);
  v1.route("/dashboard", dashboard);
  v1.route("/workouts", workouts);
  v1.route("/exercises", exercises);
  v1.route("/goals", goals);
  v1.route("/steps", steps);
  v1.route("/measurements", measurements);
  v1.route("/challenges", challenges);
  v1.route("/challenge-posts", posts);
  v1.route("/challenge-comments", comments);
  v1.route("/nutrition", nutrition);
  v1.route("/recipes", recipes);
  v1.route("/recipe-comments", recipeComments);
  v1.route("/users", follows);
  v1.route("/", engagement);

  const adminApp = new Hono<AppEnv>();
  adminApp.use("*", requireAdmin);
  adminApp.route("/", admin);
  v1.route("/admin", adminApp);

  app.route("/v1", v1);
  return app;
}
