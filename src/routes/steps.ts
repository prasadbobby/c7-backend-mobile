import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { badRequest, body, query, ymdSchema } from "../lib/http.js";
import { midnightUTC, now, uuid } from "../lib/util.js";

type StepLog = { date: Date; actualSteps: number; targetSteps: number; isCompleted: boolean; carryOverSteps: number; excessSteps: number };

/** Exact port of FitForge app/api/user/step-logs calculateDailyTarget (server TZ = UTC). */
async function calculateDailyTarget(userId: string, date: Date, baseDailyTarget: number) {
  const currentWeekStart = new Date(date);
  const dayOfWeek = currentWeekStart.getDay();
  currentWeekStart.setDate(currentWeekStart.getDate() - dayOfWeek);
  currentWeekStart.setHours(0, 0, 0, 0);
  const weekLogs = await db
    .selectFrom("StepLog")
    .select(["actualSteps"])
    .where("userId", "=", userId)
    .where("date", ">=", currentWeekStart)
    .where("date", "<", date)
    .orderBy("date", "asc")
    .execute();
  const daysElapsed = weekLogs.length;
  const totalWeeklyTarget = baseDailyTarget * 7;
  const expectedStepsByNow = baseDailyTarget * daysElapsed;
  const actualStepsThisWeek = weekLogs.reduce((s, l) => s + l.actualSteps, 0);
  const weeklyDeficit = Math.max(0, expectedStepsByNow - actualStepsThisWeek);
  const weeklyCredit = Math.max(0, actualStepsThisWeek - expectedStepsByNow);
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousLog = await db.selectFrom("StepLog").select(["actualSteps", "targetSteps"]).where("userId", "=", userId).where("date", "=", previousDate).executeTakeFirst();
  let dailyCarryOver = 0;
  let dailyCredit = 0;
  if (previousLog) {
    if (previousLog.actualSteps < previousLog.targetSteps) dailyCarryOver = previousLog.targetSteps - previousLog.actualSteps;
    else if (previousLog.actualSteps > previousLog.targetSteps) dailyCredit = previousLog.actualSteps - previousLog.targetSteps;
  }
  const remainingDaysInWeek = 7 - daysElapsed - 1;
  const isLastDayOfWeek = remainingDaysInWeek === 0;
  let targetSteps = baseDailyTarget;
  let carryOverSteps = 0;
  let excessSteps = 0;
  if (isLastDayOfWeek) {
    const remainingWeeklyTarget = totalWeeklyTarget - actualStepsThisWeek;
    targetSteps = Math.max(remainingWeeklyTarget, baseDailyTarget);
    carryOverSteps = Math.max(0, remainingWeeklyTarget - baseDailyTarget);
  } else {
    const weeklyDeficitPerDay = remainingDaysInWeek > 0 ? Math.ceil(weeklyDeficit / (remainingDaysInWeek + 1)) : 0;
    carryOverSteps = Math.max(dailyCarryOver, weeklyDeficitPerDay);
    excessSteps = Math.min(dailyCredit, weeklyCredit / (remainingDaysInWeek + 1));
    targetSteps = Math.max(baseDailyTarget + carryOverSteps - excessSteps, Math.floor(baseDailyTarget * 0.3));
  }
  return {
    targetSteps: Math.round(targetSteps),
    carryOverSteps: Math.round(carryOverSteps),
    excessSteps: Math.round(excessSteps),
    weeklyProgress: { totalWeeklyTarget, actualStepsThisWeek, remainingDaysInWeek: remainingDaysInWeek + 1, isLastDayOfWeek },
  };
}

async function activeGoalFor(userId: string) {
  let goal = await db.selectFrom("StepGoal").selectAll().where("userId", "=", userId).where("isActive", "=", true).executeTakeFirst();
  if (goal && goal.endDate && new Date() > goal.endDate) {
    await db.updateTable("StepGoal").set({ isActive: false, updatedAt: now() }).where("id", "=", goal.id).execute();
    goal = undefined;
  }
  return goal ?? null;
}

export async function stepStreak(userId: string, todayUTC: Date): Promise<number> {
  const logs = await db
    .selectFrom("StepLog")
    .select(["date", "isCompleted"])
    .where("userId", "=", userId)
    .where("date", "<=", todayUTC)
    .where("date", ">=", new Date(todayUTC.getTime() - 366 * 86400000))
    .execute();
  const byDay = new Map(logs.map((l) => [l.date.getTime(), l.isCompleted]));
  let streak = 0;
  const d = new Date(todayUTC);
  while (byDay.get(d.getTime()) === true && streak <= 365) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export const steps = new Hono<AppEnv>();

/** Mirrors GET /api/user/step-dashboard. */
steps.get("/dashboard", async (c) => {
  const u = c.get("user");
  const activeGoal = await activeGoalFor(u.userId);
  // The member's calendar day (their device date) — server UTC can already be "yesterday" for IST evenings.
  const { date } = query(c, z.object({ date: ymdSchema.optional() }));
  const t = new Date();
  const todayUTC = date ? midnightUTC(date) : new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  const thirtyAgo = new Date(todayUTC);
  thirtyAgo.setDate(thirtyAgo.getDate() - 29);
  const monthlyLogs: StepLog[] = await db
    .selectFrom("StepLog")
    .select(["date", "actualSteps", "targetSteps", "isCompleted", "carryOverSteps", "excessSteps"])
    .where("userId", "=", u.userId)
    .where("date", ">=", thirtyAgo)
    .where("date", "<=", todayUTC)
    .orderBy("date", "asc")
    .execute();
  const sevenAgo = new Date(todayUTC);
  sevenAgo.setDate(sevenAgo.getDate() - 6);
  const weeklyLogs = monthlyLogs.filter((l) => l.date >= sevenAgo);
  const todayLog = monthlyLogs.find((l) => l.date.getTime() === todayUTC.getTime()) ?? null;
  const sum = (a: StepLog[]) => a.reduce((s, l) => s + l.actualSteps, 0);
  const done = (a: StepLog[]) => a.filter((l) => l.isCompleted).length;
  const stats = {
    totalStepsMonth: sum(monthlyLogs),
    totalStepsWeek: sum(weeklyLogs),
    avgStepsMonth: monthlyLogs.length ? Math.round(sum(monthlyLogs) / monthlyLogs.length) : 0,
    avgStepsWeek: weeklyLogs.length ? Math.round(sum(weeklyLogs) / weeklyLogs.length) : 0,
    completionRateMonth: monthlyLogs.length ? Math.round((done(monthlyLogs) / monthlyLogs.length) * 100) : 0,
    completionRateWeek: weeklyLogs.length ? Math.round((done(weeklyLogs) / weeklyLogs.length) * 100) : 0,
    completedDaysMonth: done(monthlyLogs),
    completedDaysWeek: done(weeklyLogs),
    maxStepsDay: monthlyLogs.length ? Math.max(...monthlyLogs.map((l) => l.actualSteps)) : 0,
    currentTarget: activeGoal?.dailyTarget || 0,
  };
  const weekStart = new Date(todayUTC);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const currentWeekLogs = monthlyLogs.filter((l) => l.date >= weekStart);
  const weeklyProgress = activeGoal
    ? {
        totalWeeklyTarget: activeGoal.dailyTarget * 7,
        actualStepsThisWeek: sum(currentWeekLogs),
        targetStepsThisWeek: currentWeekLogs.reduce((s, l) => s + l.targetSteps, 0),
        daysCompleted: done(currentWeekLogs),
        remainingDays: 7 - currentWeekLogs.length,
        isOnTrack: sum(currentWeekLogs) >= activeGoal.dailyTarget * currentWeekLogs.length,
        currentWeekLogs,
      }
    : null;
  const fitbit = await db.selectFrom("FitbitConnection").select(["isConnected", "lastSyncAt", "syncEnabled"]).where("userId", "=", u.userId).executeTakeFirst();
  return c.json({
    activeGoal,
    todayLog,
    weeklyLogs,
    monthlyLogs,
    stats,
    streak: await stepStreak(u.userId, todayUTC),
    weeklyProgress,
    today: todayUTC.toISOString().slice(0, 10),
    fitbit: fitbit ?? { isConnected: false, lastSyncAt: null, syncEnabled: false },
  });
});

steps.get("/logs", async (c) => {
  const u = c.get("user");
  const { days } = query(c, z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }));
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  const stepLogs = await db.selectFrom("StepLog").selectAll().where("userId", "=", u.userId).where("date", ">=", start).orderBy("date", "desc").execute();
  return c.json({ stepLogs, activeGoal: await activeGoalFor(u.userId) });
});

/** Mirrors POST /api/user/step-logs (manual entry), including carry-over/excess targets. */
steps.post("/logs", async (c) => {
  const u = c.get("user");
  const b = await body(c, z.object({ steps: z.number().int().min(1).max(200000), date: ymdSchema }));
  const logDate = midnightUTC(b.date);
  if (logDate.getTime() > Date.now() + 86400000) throw badRequest("You can't log steps for a future date");
  const goalRow = await db.selectFrom("StepGoal").selectAll().where("userId", "=", u.userId).where("isActive", "=", true).executeTakeFirst();
  if (goalRow && goalRow.endDate && new Date() > goalRow.endDate) {
    await db.updateTable("StepGoal").set({ isActive: false, updatedAt: now() }).where("id", "=", goalRow.id).execute();
    throw badRequest("Step goal has expired. Please contact your trainer for a new goal.");
  }
  const base = goalRow?.dailyTarget || 10000;
  const { targetSteps, carryOverSteps, excessSteps, weeklyProgress } = await calculateDailyTarget(u.userId, logDate, base);
  const values = { actualSteps: b.steps, targetSteps, carryOverSteps, excessSteps, isCompleted: b.steps >= targetSteps, lastUpdated: now(), updatedAt: now() };
  await db
    .insertInto("StepLog")
    .values({ id: uuid(), userId: u.userId, stepGoalId: goalRow?.id ?? null, date: logDate, dataSource: "MANUAL", ...values })
    .onConflict((oc) => oc.columns(["userId", "date"]).doUpdateSet(values))
    .execute();
  const stepLog = await db.selectFrom("StepLog").selectAll().where("userId", "=", u.userId).where("date", "=", logDate).executeTakeFirstOrThrow();
  return c.json({
    stepLog,
    weeklyProgress,
    message: weeklyProgress.isLastDayOfWeek ? "Last day of the week! Complete your weekly target today!" : `${weeklyProgress.remainingDaysInWeek} days remaining this week`,
  });
});
