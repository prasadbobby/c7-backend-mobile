import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { query } from "../lib/http.js";
import { stepStreak } from "./steps.js";
import { imageUrl } from "./workouts.js";

const DAY = 86400000;
const dayKey = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** FitForge DashboardCardDailyStreak: consecutive calendar days between successive workouts. */
export function workoutStreak(createdDesc: Date[]): number {
  let streak = 0;
  for (let i = 0; i < createdDesc.length - 1; i++) {
    const diff = Math.round((dayKey(createdDesc[i]!) - dayKey(createdDesc[i + 1]!)) / DAY);
    if (diff === 1) streak++;
    else if (diff > 1) break;
  }
  return streak;
}

function intervals(range: "1W" | "1M" | "3M" | "1Y") {
  const out: { start: Date; end: Date; label: string }[] = [];
  const t = new Date();
  const today = new Date(dayKey(t));
  if (range === "1W") {
    for (let i = 6; i >= 0; i--) {
      const s = new Date(today.getTime() - i * DAY);
      out.push({ start: s, end: new Date(s.getTime() + DAY - 1), label: s.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) });
    }
  } else if (range === "1Y") {
    for (let i = 11; i >= 0; i--) {
      const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1) - 1);
      out.push({ start: s, end: e, label: s.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
    }
  } else {
    const weeks = range === "1M" ? 5 : 13;
    const dow = (today.getUTCDay() + 6) % 7; // Monday-start weeks like FitForge (weekStartsOn: 1)
    const monday = new Date(today.getTime() - dow * DAY);
    for (let i = weeks - 1; i >= 0; i--) {
      const s = new Date(monday.getTime() - i * 7 * DAY);
      out.push({ start: s, end: new Date(s.getTime() + 7 * DAY - 1), label: `${s.getUTCDate()}/${s.getUTCMonth() + 1}` });
    }
  }
  return out;
}

export const dashboard = new Hono<AppEnv>();

/** Dashboard cards: same definitions as FitForge's dashboard cards. */
dashboard.get("/", async (c) => {
  const u = c.get("user");
  const nowMs = Date.now();
  const [logs, assigned, challengesActive, pbsWeek, latestWeight] = await Promise.all([
    db
      .selectFrom("WorkoutLog as l")
      .innerJoin("WorkoutPlan as p", "p.id", "l.workoutPlanId")
      .select(["l.id", "l.createdAt", "l.date", "l.duration", "p.name as planName"])
      .where("l.userId", "=", u.userId)
      .orderBy("l.createdAt", "desc")
      .limit(400)
      .execute(),
    db.selectFrom("AssignedWorkout").select(db.fn.countAll<number>().as("n")).where("userId", "=", u.userId).where("status", "in", ["PENDING", "IN_PROGRESS"]).executeTakeFirstOrThrow(),
    db
      .selectFrom("NinetyDayChallengeParticipant as p")
      .innerJoin("NinetyDayChallenge as c", "c.id", "p.challengeId")
      .select(db.fn.countAll<number>().as("n"))
      .where("p.userId", "=", u.userId)
      .where("p.isEnabled", "=", true)
      .where("c.isActive", "=", true)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("UserExercisePB as pb")
      .innerJoin("WorkoutLog as l", "l.id", "pb.workoutLogId")
      .select(db.fn.countAll<number>().as("n"))
      .where("pb.userId", "=", u.userId)
      .where("l.date", ">=", new Date(nowMs - 7 * DAY))
      .executeTakeFirstOrThrow(),
    db.selectFrom("BodyMeasurement").select(["value", "recordedDate"]).where("userId", "=", u.userId).where("measurementType", "=", "WEIGHT").orderBy("recordedDate", "desc").executeTakeFirst(),
  ]);
  const last30 = logs.filter((l) => l.createdAt.getTime() >= nowMs - 30 * DAY);
  const t = new Date();
  const todayUTC = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  return c.json({
    cards: {
      weeklyWorkouts: logs.filter((l) => l.createdAt.getTime() >= nowMs - 7 * DAY).length,
      avgWorkoutMinutes: last30.length ? Math.round(last30.reduce((a, l) => a + l.duration / 60, 0) / last30.length) : 0,
      dailyStreak: workoutStreak(logs.map((l) => l.createdAt)),
      weeklyPBs: pbsWeek.n,
      activeChallenges: challengesActive.n,
      pendingAssignments: assigned.n,
      stepStreak: await stepStreak(u.userId, todayUTC),
      totalWorkouts: logs.length,
    },
    recentActivity: logs.slice(0, 5).map((l) => ({ id: l.id, planName: l.planName, date: l.date, durationMinutes: Math.round(l.duration / 60) })),
    latestWeight: latestWeight ?? null,
  });
});

/** Workout frequency + volume load per interval (FitForge dashboard charts). */
dashboard.get("/charts", async (c) => {
  const u = c.get("user");
  const { range } = query(c, z.object({ range: z.enum(["1W", "1M", "3M", "1Y"]).default("1W") }));
  const ivs = intervals(range);
  const rows = await db
    .selectFrom("WorkoutLog as l")
    .leftJoin("WorkoutLogExercise as le", "le.workoutLogId", "l.id")
    .leftJoin("SetLog as s", "s.workoutLogExerciseId", "le.id")
    .select(["l.id", "l.date", sql<number>`coalesce(sum(coalesce(s.weight,0) * coalesce(s.reps,0)), 0)`.as("volume")])
    .where("l.userId", "=", u.userId)
    .where("l.date", ">=", ivs[0]!.start)
    .groupBy(["l.id", "l.date"])
    .execute();
  return c.json({
    range,
    points: ivs.map((iv) => {
      const inIv = rows.filter((r) => r.date >= iv.start && r.date <= iv.end);
      return { label: iv.label, start: iv.start, workouts: inIv.length, volume: Math.round(inIv.reduce((a, r) => a + Number(r.volume), 0)) };
    }),
  });
});

/** Top lifts for the stats screen. */
dashboard.get("/records", async (c) => {
  const u = c.get("user");
  const rows = await db
    .selectFrom("UserExercisePB as pb")
    .innerJoin("Exercise as e", "e.id", "pb.exerciseId")
    .select(["pb.exerciseId", "pb.weight", "pb.reps", "pb.exerciseDuration", "pb.createdAt", "e.name", "e.image"])
    .where("pb.userId", "=", u.userId)
    .orderBy("pb.weight", "desc")
    .limit(20)
    .execute();
  return c.json({ records: rows.map((r) => ({ ...r, image: imageUrl(r.image) })) });
});
