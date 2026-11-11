import { expect, test } from "./_setup";

test.describe.serial("assigned workouts → live session → history", () => {
  let planId = "";
  let ex: { exerciseId: string; trackingType: "reps" | "duration" }[] = [];
  let logId = "";

  test("member sees the coach's assignment", async ({ as }) => {
    const j = await (await (await as("member")).get("/v1/workouts/assigned")).json();
    expect(j.assignments).toHaveLength(1);
    const a = j.assignments[0];
    expect(a).toMatchObject({ id: "assign_1", status: "PENDING", notes: "Focus on depth", assignedBy: { name: "Coach Prasad" } });
    expect(a.plan.exerciseCount).toBeGreaterThan(0);
    planId = a.plan.id;
  });

  test("plan detail has exercises, rest timer and access control", async ({ as }) => {
    const j = await (await (await as("member")).get(`/v1/workouts/plans/${planId}`)).json();
    expect(j.plan.exercises.length).toBeGreaterThan(0);
    expect(j.plan.exercises[0].rest.defaultRestSeconds).toBe(75);
    expect(j.plan.assignment.id).toBe("assign_1");
    ex = j.plan.exercises.map((e: { exerciseId: string; trackingType: "reps" | "duration" }) => ({ exerciseId: e.exerciseId, trackingType: e.trackingType }));
    expect((await (await as("member")).get(`/v1/workouts/plans/does-not-exist`)).status()).toBe(404);
  });

  test("starting marks the assignment IN_PROGRESS", async ({ as }) => {
    const api = await as("member");
    expect((await api.patch("/v1/workouts/assigned/assign_1", { data: { status: "IN_PROGRESS" } })).ok()).toBeTruthy();
    expect((await (await api.get("/v1/workouts/assigned")).json()).assignments[0].status).toBe("IN_PROGRESS");
    expect((await (await as("buddy")).patch("/v1/workouts/assigned/assign_1", { data: { status: "SKIPPED" } })).status()).toBe(404);
  });

  test("a workout without completed sets is rejected", async ({ as }) => {
    const r = await (await as("member")).post("/v1/workouts/logs", { data: { workoutPlanId: planId, duration: 60, exercises: [] } });
    expect(r.status()).toBe(400);
  });

  test("saving logs sets, creates PBs and completes the assignment", async ({ as }) => {
    const api = await as("member");
    const r = await api.post("/v1/workouts/logs", {
      data: {
        workoutPlanId: planId, assignmentId: "assign_1", duration: 1800, totalRestTime: 420, totalActiveTime: 1380,
        exercises: [{ ...ex[0], sets: [{ weight: 40, reps: 10, restTimeSeconds: 75 }, { weight: 45, reps: 8 }] }],
      },
    });
    expect(r.status()).toBe(201);
    const j = await r.json();
    logId = j.workoutLog.id;
    expect(j.workoutLog).toMatchObject({ setCount: 2, exerciseCount: 1, volume: 40 * 10 + 45 * 8 });
    expect(j.newPBs).toEqual([{ exerciseId: ex[0]!.exerciseId, weight: 45, reps: 8, exerciseDuration: null }]);
    expect((await (await api.get("/v1/workouts/assigned")).json()).assignments).toHaveLength(0);
    const all = await (await api.get("/v1/workouts/assigned?status=all")).json();
    expect(all.assignments[0].status).toBe("COMPLETED");
  });

  test("lighter session does not beat the PB; same weight more reps does", async ({ as }) => {
    const api = await as("member");
    const lighter = await (await api.post("/v1/workouts/logs", { data: { workoutPlanId: planId, duration: 600, exercises: [{ ...ex[0], sets: [{ weight: 30, reps: 12 }] }] } })).json();
    expect(lighter.newPBs).toEqual([]);
    const moreReps = await (await api.post("/v1/workouts/logs", { data: { workoutPlanId: planId, duration: 600, exercises: [{ ...ex[0], sets: [{ weight: 45, reps: 9 }] }] } })).json();
    expect(moreReps.newPBs[0]).toMatchObject({ weight: 45, reps: 9 });
    const plan = await (await api.get(`/v1/workouts/plans/${planId}`)).json();
    expect(plan.plan.exercises[0].pb).toMatchObject({ weight: 45, reps: 9 });
    expect(plan.plan.exercises[0].previous[0]).toMatchObject({ weight: 45, reps: 9 });
  });

  test("history lists sessions and detail shows sets in order", async ({ as }) => {
    const api = await as("member");
    const list = await (await api.get("/v1/workouts/logs")).json();
    expect(list.total).toBe(3);
    const d = await (await api.get(`/v1/workouts/logs/${logId}`)).json();
    expect(d.log.exercises[0].sets.map((s: { order: number; weight: number }) => [s.order, s.weight])).toEqual([[1, 40], [2, 45]]);
    expect((await (await as("buddy")).get(`/v1/workouts/logs/${logId}`)).status()).toBe(404);
  });

  test("exercise history and favourites", async ({ as }) => {
    const api = await as("member");
    const h = await (await api.get(`/v1/exercises/${ex[0]!.exerciseId}/history`)).json();
    expect(h.sessions).toHaveLength(3);
    expect((await (await api.post(`/v1/exercises/${ex[0]!.exerciseId}/favourite`)).json()).isFavourite).toBe(true);
    const favs = await (await api.get("/v1/exercises?favourites=true")).json();
    expect(favs.exercises.map((e: { id: string }) => e.id)).toEqual([ex[0]!.exerciseId]);
    expect((await (await api.post(`/v1/exercises/${ex[0]!.exerciseId}/favourite`)).json()).isFavourite).toBe(false);
  });

  test("goals track progress toward a target weight", async ({ as }) => {
    const api = await as("member");
    expect((await api.post("/v1/goals", { data: { exerciseId: ex[0]!.exerciseId, goalValue: 60 } })).status()).toBe(201);
    const g = (await (await api.get("/v1/goals")).json()).goals[0];
    expect(g).toMatchObject({ goalValue: 60, currentWeight: 45 });
    expect(g.progress).toBeCloseTo(0.75);
    expect((await api.delete(`/v1/goals/${g.id}`)).ok()).toBeTruthy();
  });

  test("deleting a workout removes it", async ({ as }) => {
    const api = await as("member");
    expect((await api.delete(`/v1/workouts/logs/${logId}`)).ok()).toBeTruthy();
    expect((await (await api.get("/v1/workouts/logs")).json()).total).toBe(2);
  });

  test("dashboard cards, charts and records reflect workouts", async ({ as }) => {
    const api = await as("member");
    const d = await (await api.get("/v1/dashboard")).json();
    expect(d.cards.weeklyWorkouts).toBe(2);
    expect(d.cards.totalWorkouts).toBe(2);
    expect(d.cards.activeChallenges).toBe(1);
    expect(d.recentActivity).toHaveLength(2);
    for (const range of ["1W", "1M", "3M", "1Y"]) {
      const c = await (await api.get(`/v1/dashboard/charts?range=${range}`)).json();
      expect(c.points.reduce((a: number, p: { workouts: number }) => a + p.workouts, 0)).toBe(2);
    }
    expect((await (await api.get("/v1/dashboard/records")).json()).records[0].weight).toBe(45);
  });
});

test("exercise library filters", async ({ as }) => {
  const api = await as("member");
  const all = await (await api.get("/v1/exercises?limit=5")).json();
  expect(all.total).toBeGreaterThan(300);
  const squat = await (await api.get("/v1/exercises?search=back%20squat")).json();
  expect(squat.exercises[0].name).toBe("Back Squat");
  const cat = await (await api.get("/v1/exercises?category=cardio&limit=50")).json();
  expect(cat.exercises.every((e: { category: string }) => e.category === "cardio")).toBe(true);
  const quads = await (await api.get("/v1/exercises?muscle=quadriceps&limit=50")).json();
  expect(quads.total).toBeGreaterThan(0);
  const detail = await (await api.get(`/v1/exercises/${squat.exercises[0].id}`)).json();
  expect(detail.exercise.primaryMuscles).toContain("quadriceps");
  expect(detail.exercise.instructions.length).toBeGreaterThan(0);
  await api.put("/v1/me/equipment", { data: { equipment: ["barbell"] } });
  const owned = await (await api.get("/v1/exercises?equipmentOwned=true&limit=60")).json();
  expect(owned.exercises.every((e: { equipment: string }) => e.equipment === "barbell")).toBe(true);
});
