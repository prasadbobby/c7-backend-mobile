import { daysAgo, today } from "../fixtures";
import { expect, test } from "./_setup";

test.describe.serial("step tracking (FitForge carry-over rules)", () => {
  test("dashboard shows the admin-assigned goal and no logs yet", async ({ as }) => {
    const d = await (await (await as("member")).get("/v1/steps/dashboard")).json();
    expect(d.activeGoal.dailyTarget).toBe(8000);
    expect(d.todayLog).toBeNull();
    expect(d.streak).toBe(0);
    expect(d.fitbit.isConnected).toBe(false);
  });

  test("first day of a week targets the base goal; a shortfall carries over", async ({ as }) => {
    const api = await as("member");
    // Use two consecutive days inside the same Sun–Sat week.
    const ref = new Date();
    const sun = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - ref.getUTCDay() - 7));
    const d1 = sun.toISOString().slice(0, 10);
    const d2 = new Date(sun.getTime() + 86400000).toISOString().slice(0, 10);
    const a = await (await api.post("/v1/steps/logs", { data: { steps: 6000, date: d1 } })).json();
    expect(a.stepLog).toMatchObject({ actualSteps: 6000, targetSteps: 8000, isCompleted: false });
    const b = await (await api.post("/v1/steps/logs", { data: { steps: 11000, date: d2 } })).json();
    expect(b.stepLog.carryOverSteps).toBe(2000);
    expect(b.stepLog.targetSteps).toBe(10000);
    expect(b.stepLog.isCompleted).toBe(true);
  });

  test("logging today counts toward streak; re-logging updates the same day", async ({ as }) => {
    const api = await as("member");
    await api.post("/v1/steps/logs", { data: { steps: 3000, date: today() } });
    await api.post("/v1/steps/logs", { data: { steps: 20000, date: today() } });
    const d = await (await api.get("/v1/steps/dashboard")).json();
    expect(d.todayLog.actualSteps).toBe(20000);
    expect(d.streak).toBe(1);
    const logs = await (await api.get("/v1/steps/logs?days=30")).json();
    expect(logs.stepLogs.filter((l: { date: string }) => l.date.startsWith(today()))).toHaveLength(1);
  });

  test("validation: future date and bad input are rejected", async ({ as }) => {
    const api = await as("member");
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    expect((await api.post("/v1/steps/logs", { data: { steps: 100, date: future } })).status()).toBe(400);
    expect((await api.post("/v1/steps/logs", { data: { steps: -5, date: today() } })).status()).toBe(400);
    expect((await api.post("/v1/steps/logs", { data: { steps: 100, date: "12/11/2026" } })).status()).toBe(400);
  });
});

test.describe.serial("body measurements", () => {
  test("add, upsert same day, latest per type, profile weight sync", async ({ as }) => {
    const api = await as("member");
    expect((await api.post("/v1/measurements", { data: { measurementType: "WEIGHT", value: 52, unit: "kg", recordedDate: daysAgo(14) } })).status()).toBe(201);
    await api.post("/v1/measurements", { data: { measurementType: "WEIGHT", value: 50, unit: "kg", recordedDate: today() } });
    await api.post("/v1/measurements", { data: { measurementType: "WEIGHT", value: 49.5, unit: "kg", recordedDate: today() } });
    await api.post("/v1/measurements", { data: { measurementType: "WAIST", value: 64, unit: "cm", recordedDate: today() } });
    const j = await (await api.get("/v1/measurements")).json();
    expect(j.measurements.filter((m: { measurementType: string }) => m.measurementType === "WEIGHT")).toHaveLength(2);
    expect(j.latest.WEIGHT.value).toBe(49.5);
    expect(j.latest.WAIST.value).toBe(64);
    expect((await (await api.get("/v1/me")).json()).user.weight).toBe(49.5);
    expect((await api.post("/v1/measurements", { data: { measurementType: "TAIL", value: 1, unit: "cm", recordedDate: today() } })).status()).toBe(400);
  });

  test("measurement goals", async ({ as }) => {
    const api = await as("member");
    expect((await api.put("/v1/measurements/goals", { data: { measurementType: "WEIGHT", targetValue: 47 } })).ok()).toBeTruthy();
    const j = await (await api.get("/v1/measurements")).json();
    expect(j.goals[0]).toMatchObject({ measurementType: "WEIGHT", targetValue: 47, currentValue: 49.5 });
  });
});
