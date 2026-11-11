import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { query, ymdSchema } from "../lib/http.js";
import { getUsers, displayName } from "../lib/users.js";
import { daysRemainingIST, noonUTC } from "../lib/util.js";
import { workoutStreak } from "./dashboard.js";
import { stepStreak } from "./steps.js";

const DAY = 86400000;

export const engagement = new Hono<AppEnv>();

/**
 * Notifications are derived from live data (nothing is stored), so they always
 * reflect what admins configure in FitForge. Read state is kept on the device.
 */
engagement.get("/notifications", async (c) => {
  const u = c.get("user");
  const { date } = query(c, z.object({ date: ymdSchema }));
  const since = new Date(Date.now() - 3 * DAY);
  const items: { id: string; kind: string; title: string; body: string; at: Date; link: string }[] = [];

  const info = await db
    .selectFrom("UserInfo")
    .select(["membershipStatus", "membershipEndDate", "nextPaymentDue", "remainingAmount", "upcomingStartDate"])
    .where("userId", "=", u.userId)
    .executeTakeFirstOrThrow();
  if (info.membershipEndDate && info.membershipStatus === "ACTIVE") {
    const left = daysRemainingIST(info.membershipEndDate);
    if (left <= 7) items.push({ id: `membership-${info.membershipEndDate.toISOString()}`, kind: "membership", title: left === 0 ? "Membership ends today" : `Membership ends in ${left} day${left === 1 ? "" : "s"}`, body: "Talk to the front desk to renew and keep your streak going.", at: new Date(), link: "/membership" });
  }
  if (info.membershipStatus === "EXPIRED") items.push({ id: "membership-expired", kind: "membership", title: "Membership expired", body: "Renew at the gym to keep training with C7.", at: new Date(), link: "/membership" });
  if (info.nextPaymentDue && (info.remainingAmount ?? 0) > 0) {
    const left = Math.ceil((info.nextPaymentDue.getTime() - Date.now()) / DAY);
    if (left <= 3)
      items.push({ id: `payment-${info.nextPaymentDue.toISOString()}`, kind: "payment", title: left < 0 ? "Payment overdue" : "Payment due soon", body: `₹${Math.round(info.remainingAmount ?? 0).toLocaleString("en-IN")} due ${info.nextPaymentDue.toDateString()}.`, at: new Date(), link: "/membership" });
  }

  const assigned = await db
    .selectFrom("AssignedWorkout as aw")
    .innerJoin("WorkoutPlan as p", "p.id", "aw.workoutPlanId")
    .select(["aw.id", "aw.assignedAt", "aw.assignedBy", "p.name"])
    .where("aw.userId", "=", u.userId)
    .where("aw.status", "=", "PENDING")
    .where("aw.assignedAt", ">=", new Date(Date.now() - 7 * DAY))
    .execute();
  const coaches = await getUsers(assigned.map((a) => a.assignedBy));
  for (const a of assigned) items.push({ id: `assigned-${a.id}`, kind: "workout", title: "New workout assigned", body: `${displayName(coaches.get(a.assignedBy)!)} assigned “${a.name}”.`, at: a.assignedAt, link: `/workout-plan/${a.id}` });

  const part = await db
    .selectFrom("NinetyDayChallengeParticipant as p")
    .innerJoin("NinetyDayChallenge as ch", "ch.id", "p.challengeId")
    .select(["p.challengeId", "ch.title"])
    .where("p.userId", "=", u.userId)
    .where("p.isEnabled", "=", true)
    .where("ch.isActive", "=", true)
    .executeTakeFirst();
  if (part) {
    const posted = await db.selectFrom("NinetyDayChallengePost").select("id").where("userId", "=", u.userId).where("challengeId", "=", part.challengeId).where("date", "=", noonUTC(date)).executeTakeFirst();
    if (!posted) items.push({ id: `post-${date}`, kind: "challenge", title: "Today's check-in is open", body: `Log sleep, meals and mood for ${part.title}.`, at: new Date(), link: `/challenge/${part.challengeId}/post` });
    const myPosts = db.selectFrom("NinetyDayChallengePost").select("id").where("userId", "=", u.userId);
    const reacts = await db.selectFrom("NinetyDayChallengeReaction").select(["id", "userId", "reactionType", "createdAt"]).where("postId", "in", myPosts).where("userId", "!=", u.userId).where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(10).execute();
    const cmts = await db.selectFrom("NinetyDayChallengeComment").select(["id", "userId", "content", "createdAt"]).where("postId", "in", myPosts).where("userId", "!=", u.userId).where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(10).execute();
    const people = await getUsers([...reacts.map((r) => r.userId), ...cmts.map((r) => r.userId)]);
    for (const r of reacts) items.push({ id: `react-${r.id}`, kind: "social", title: `${displayName(people.get(r.userId)!)} reacted to your check-in`, body: r.reactionType.charAt(0) + r.reactionType.slice(1).toLowerCase(), at: r.createdAt, link: `/challenge/${part.challengeId}/feed` });
    for (const r of cmts) items.push({ id: `comment-${r.id}`, kind: "social", title: `${displayName(people.get(r.userId)!)} commented`, body: r.content.slice(0, 120), at: r.createdAt, link: `/challenge/${part.challengeId}/feed` });
  }

  const goal = await db.selectFrom("StepGoal").select(["dailyTarget"]).where("userId", "=", u.userId).where("isActive", "=", true).executeTakeFirst();
  if (goal) {
    const t = await db.selectFrom("StepLog").select(["actualSteps", "targetSteps", "isCompleted"]).where("userId", "=", u.userId).where("date", "=", new Date(`${date}T00:00:00.000Z`)).executeTakeFirst();
    if (!t?.isCompleted) items.push({ id: `steps-${date}`, kind: "steps", title: "Steps goal still open", body: t ? `${Math.max(0, t.targetSteps - t.actualSteps).toLocaleString()} steps to go today.` : `Log today's steps — target ${goal.dailyTarget.toLocaleString()}.`, at: new Date(), link: "/steps" });
  }

  const recipeIds = db.selectFrom("Recipe").select("id").where("createdBy", "=", u.userId);
  const rc = await db.selectFrom("RecipeComment").select(["id", "userId", "content", "createdAt", "recipeId"]).where("recipeId", "in", recipeIds).where("userId", "!=", u.userId).where("createdAt", ">=", since).execute();
  const rcUsers = await getUsers(rc.map((r) => r.userId));
  for (const r of rc) items.push({ id: `rc-${r.id}`, kind: "social", title: `${displayName(rcUsers.get(r.userId)!)} commented on your recipe`, body: r.content.slice(0, 120), at: r.createdAt, link: `/meal/${r.recipeId}` });

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return c.json({ notifications: items });
});

/** Badges computed from real activity. */
engagement.get("/achievements", async (c) => {
  const u = c.get("user");
  const [logs, pbs, posts, steps10k, water, protein] = await Promise.all([
    db.selectFrom("WorkoutLog").select(["createdAt", "date"]).where("userId", "=", u.userId).orderBy("createdAt", "desc").execute(),
    db.selectFrom("UserExercisePB").select(db.fn.countAll<number>().as("n")).where("userId", "=", u.userId).executeTakeFirstOrThrow(),
    db.selectFrom("NinetyDayChallengePost").select(["date"]).where("userId", "=", u.userId).execute(),
    db.selectFrom("StepLog").select(db.fn.countAll<number>().as("n")).where("userId", "=", u.userId).where("actualSteps", ">=", 10000).executeTakeFirstOrThrow(),
    db.selectFrom("WaterLog").select(db.fn.countAll<number>().as("n")).where("userId", "=", u.userId).where("amountMl", ">=", 2000).executeTakeFirstOrThrow(),
    db.selectFrom("MealLog").select(["date", db.fn.sum<number>("protein").as("p")]).where("userId", "=", u.userId).groupBy("date").execute(),
  ]);
  const goal = await db.selectFrom("NutritionGoal").select("protein").where("userId", "=", u.userId).executeTakeFirst();
  const proteinDays = protein.filter((d) => Number(d.p) >= (goal?.protein ?? 120)).length;
  const early = logs.filter((l) => {
    const ist = new Date(l.createdAt.getTime() + 5.5 * 3600000);
    return ist.getUTCHours() < 8;
  }).length;
  const streak = Math.max(workoutStreak(logs.map((l) => l.createdAt)), 0);
  const badge = (id: string, title: string, body: string, value: number, target: number) => ({ id, title, body, progress: Math.min(1, value / target), value: Math.min(value, target), target, earned: value >= target });
  const badges = [
    badge("first-workout", "First Workout", "Complete your first session", logs.length, 1),
    badge("streak-7", "7-Day Streak", "Train 7 days in a row", streak + (logs.length ? 1 : 0), 7),
    badge("early-bird", "Early Bird", "5 workouts before 8am", early, 5),
    badge("pb-breaker", "PB Breaker", "Set 10 personal bests", pbs.n, 10),
    badge("10k-steps", "10K Club", "Hit 10,000 steps on 10 days", steps10k.n, 10),
    badge("consistency-90", "Iron Will", "Log 90 challenge check-ins", posts.length, 90),
    badge("hydration-hero", "Hydration Hero", "Drink 2L on 30 days", water.n, 30),
    badge("protein-pro", "Protein Pro", "Hit your protein goal 21 times", proteinDays, 21),
    badge("community-star", "Century", "Complete 100 workouts", logs.length, 100),
  ];
  const earned = badges.filter((b) => b.earned).length;
  const xp = logs.length * 50 + pbs.n * 25 + posts.length * 20 + steps10k.n * 10;
  return c.json({ badges, earned, total: badges.length, xp, level: Math.floor(xp / 500) + 1, xpIntoLevel: xp % 500, xpForLevel: 500 });
});

/** Streak overview with a 35-day activity calendar (workout / steps goal met / check-in). */
engagement.get("/streaks", async (c) => {
  const u = c.get("user");
  const { date } = query(c, z.object({ date: ymdSchema }));
  const end = new Date(`${date}T00:00:00.000Z`);
  const start = new Date(end.getTime() - 34 * DAY);
  const [logs, stepLogs, posts, allLogs] = await Promise.all([
    db.selectFrom("WorkoutLog").select(["date"]).where("userId", "=", u.userId).where("date", ">=", start).execute(),
    db.selectFrom("StepLog").select(["date", "isCompleted"]).where("userId", "=", u.userId).where("date", ">=", start).execute(),
    db.selectFrom("NinetyDayChallengePost").select(["date"]).where("userId", "=", u.userId).where("date", ">=", start).execute(),
    db.selectFrom("WorkoutLog").select(["createdAt"]).where("userId", "=", u.userId).orderBy("createdAt", "desc").limit(400).execute(),
  ]);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const days = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const k = key(d);
    days.push({
      date: k,
      workout: logs.some((l) => key(l.date) === k),
      steps: stepLogs.some((l) => key(l.date) === k && l.isCompleted),
      checkIn: posts.some((p) => key(p.date) === k),
    });
  }
  let activeStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.workout || d.steps || d.checkIn) activeStreak++;
    else if (i === days.length - 1) continue; // today not done yet doesn't break the streak
    else break;
  }
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.workout || d.steps || d.checkIn ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return c.json({
    activeStreak,
    bestStreak: best,
    workoutStreak: workoutStreak(allLogs.map((l) => l.createdAt)),
    stepStreak: await stepStreak(u.userId, end),
    thisWeek: days.slice(-7).filter((d) => d.workout || d.steps || d.checkIn).length,
    days,
  });
});
