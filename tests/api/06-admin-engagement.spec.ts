import { USERS, today } from "../fixtures";
import { expect, test } from "./_setup";

test.describe.serial("admin nutrition API (used by FitForge)", () => {
  let id = "";
  test("members cannot use admin endpoints", async ({ as }) => {
    expect((await (await as("member")).get("/v1/admin/recipes")).status()).toBe(403);
  });

  test("admin creates, edits, unpublishes and deletes a recipe; members see changes", async ({ as }) => {
    const admin = await as("admin");
    const member = await as("member");
    const r = await admin.post("/v1/admin/recipes", { data: { title: "Paneer Tikka Bowl", category: "vegetarian", kcal: 450, protein: 32, carbs: 30, fat: 20, minutes: 25, ingredients: ["Paneer", "Yogurt", "Spices"], steps: ["Marinate", "Grill"] } });
    expect(r.status()).toBe(201);
    id = (await r.json()).recipe.id;
    expect((await (await member.get("/v1/recipes?search=paneer")).json()).recipes[0]).toMatchObject({ title: "Paneer Tikka Bowl", author: { name: "Coach Prasad" } });
    await admin.put(`/v1/admin/recipes/${id}`, { data: { title: "Paneer Tikka Bowl", category: "vegetarian", kcal: 470, protein: 34, carbs: 30, fat: 20, minutes: 25, isPublished: false } });
    expect((await (await member.get("/v1/recipes?search=paneer")).json()).total).toBe(0);
    expect((await member.get(`/v1/recipes/${id}`)).status()).toBe(404);
    expect((await admin.post("/v1/admin/recipes", { data: { title: "x" } })).status()).toBe(400);
    expect((await admin.delete(`/v1/admin/recipes/${id}`)).ok()).toBeTruthy();
    const list = await (await admin.get("/v1/admin/recipes")).json();
    expect(list.recipes.some((x: { id: string }) => x.id === id)).toBe(false);
  });

  test("admin sets a member's nutrition goal → member app reflects it", async ({ as }) => {
    const admin = await as("admin");
    const m = await (await admin.get(`/v1/admin/members?date=${today()}`)).json();
    expect(m.members.find((x: { userId: string }) => x.userId === USERS.member.userId).goal.kcal).toBe(1800);
    expect((await admin.put(`/v1/admin/members/${USERS.buddy.userId}/nutrition-goal`, { data: { kcal: 2400, protein: 160, carbs: 260, fat: 70, waterMl: 3000, notes: "Bulk phase" } })).ok()).toBeTruthy();
    const s = await (await (await as("buddy")).get(`/v1/nutrition/summary?date=${today()}`)).json();
    expect(s.goal).toMatchObject({ kcal: 2400, protein: 160, waterMl: 3000, assigned: true, notes: "Bulk phase" });
    await admin.delete(`/v1/admin/members/${USERS.buddy.userId}/nutrition-goal`);
    expect((await (await (await as("buddy")).get(`/v1/nutrition/summary?date=${today()}`)).json()).goal.assigned).toBe(false);
    expect((await admin.put(`/v1/admin/members/nobody/nutrition-goal`, { data: { kcal: 2000, protein: 1, carbs: 1, fat: 1, waterMl: 2000 } })).status()).toBe(404);
  });
});

test.describe("engagement", () => {
  test("notifications are derived from live data", async ({ as }) => {
    const n = (await (await (await as("buddy")).get(`/v1/notifications?date=${today()}`)).json()).notifications;
    const kinds = n.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("membership"); // ends in 5 days
    expect(kinds).toContain("payment"); // due in 2 days
    expect(kinds).toContain("challenge"); // no check-in today
    expect(n.some((x: { title: string }) => /reacted|commented/.test(x.title))).toBe(true); // member reacted/commented on buddy's post
  });

  test("achievements and XP come from real activity", async ({ as }) => {
    const a = await (await (await as("member")).get("/v1/achievements")).json();
    const first = a.badges.find((b: { id: string }) => b.id === "first-workout");
    expect(first.earned).toBe(true);
    expect(a.xp).toBeGreaterThan(0);
    expect(a.level).toBeGreaterThanOrEqual(1);
  });

  test("streak calendar marks workout, steps and check-in days", async ({ as }) => {
    const s = await (await (await as("member")).get(`/v1/streaks?date=${today()}`)).json();
    expect(s.days).toHaveLength(35);
    const t = s.days[34];
    expect(t.date).toBe(today());
    expect(t.workout).toBe(true);
    expect(t.steps).toBe(true);
    expect(s.activeStreak).toBeGreaterThanOrEqual(1);
  });
});
