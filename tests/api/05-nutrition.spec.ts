import { USERS, today } from "../fixtures";
import { expect, test } from "./_setup";

test.describe.serial("nutrition", () => {
  let recipeId = "";

  test("summary uses the admin-assigned goal", async ({ as }) => {
    const s = await (await (await as("member")).get(`/v1/nutrition/summary?date=${today()}`)).json();
    expect(s.goal).toMatchObject({ kcal: 1800, protein: 110, waterMl: 2500, assigned: true });
    expect(s.totals).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const other = await (await (await as("buddy")).get(`/v1/nutrition/summary?date=${today()}`)).json();
    expect(other.goal).toMatchObject({ kcal: 2000, assigned: false });
  });

  test("recipe browse: category, search, sort", async ({ as }) => {
    const api = await as("member");
    const all = await (await api.get("/v1/recipes")).json();
    expect(all.total).toBe(7);
    expect(all.recipes[0].author.name).toBe("C7 Coaching");
    const sea = await (await api.get("/v1/recipes?category=seafood")).json();
    expect(sea.recipes.every((r: { category: string }) => r.category === "seafood")).toBe(true);
    const q = await (await api.get("/v1/recipes?search=salmon")).json();
    expect(q.recipes.map((r: { title: string }) => r.title).sort()).toEqual(["Lemon-Herb Butter Salmon", "Salmon Noodle Bowl"]);
    const byKcal = await (await api.get("/v1/recipes?sort=kcal")).json();
    const kcals = byKcal.recipes.map((r: { kcal: number }) => r.kcal);
    expect(kcals).toEqual([...kcals].sort((a: number, b: number) => a - b));
    recipeId = all.recipes.find((r: { title: string }) => r.title === "Power-packed Bowl").id;
  });

  test("log meals from a recipe (scaled by servings) and custom entries", async ({ as }) => {
    const api = await as("member");
    const a = await api.post("/v1/nutrition/meals", { data: { date: today(), slot: "LUNCH", recipeId, servings: 1.5 } });
    expect(a.status()).toBe(201);
    expect((await a.json()).summary.totals).toMatchObject({ kcal: 780, protein: 63 });
    const b = await api.post("/v1/nutrition/meals", { data: { date: today(), slot: "SNACK", name: "Protein shake", kcal: 150, protein: 25, carbs: 5, fat: 2 } });
    const s = (await b.json()).summary;
    expect(s.totals.kcal).toBe(930);
    expect(s.meals.map((m: { slot: string }) => m.slot)).toEqual(["LUNCH", "SNACK"]);
    expect((await api.post("/v1/nutrition/meals", { data: { date: today(), slot: "BRUNCH", name: "x", kcal: 1 } })).status()).toBe(400);
    expect((await api.post("/v1/nutrition/meals", { data: { date: today(), slot: "DINNER" } })).status()).toBe(400);
    const del = await api.delete(`/v1/nutrition/meals/${(await b.json()).id}`);
    expect((await del.json()).summary.totals.kcal).toBe(780);
    expect((await (await as("buddy")).delete(`/v1/nutrition/meals/${(await a.json()).id}`)).status()).toBe(404);
  });

  test("water: add, subtract, clamp at zero", async ({ as }) => {
    const api = await as("member");
    expect((await (await api.post("/v1/nutrition/water", { data: { date: today(), deltaMl: 250 } })).json()).waterMl).toBe(250);
    expect((await (await api.post("/v1/nutrition/water", { data: { date: today(), deltaMl: 500 } })).json()).waterMl).toBe(750);
    expect((await (await api.post("/v1/nutrition/water", { data: { date: today(), deltaMl: -1000 } })).json()).waterMl).toBe(0);
    await api.post("/v1/nutrition/water", { data: { date: today(), amountMl: 1250 } });
    expect((await (await api.get(`/v1/nutrition/summary?date=${today()}`)).json()).waterMl).toBe(1250);
  });

  test("7-day history", async ({ as }) => {
    const h = await (await (await as("member")).get(`/v1/nutrition/history?days=7&to=${today()}`)).json();
    expect(h.days).toHaveLength(7);
    expect(h.days[6]).toMatchObject({ date: today(), kcal: 780 });
  });

  test("likes, saves, comments and saved filter", async ({ as }) => {
    const me = await as("member");
    const buddy = await as("buddy");
    expect(await (await me.post(`/v1/recipes/${recipeId}/like`)).json()).toEqual({ liked: true, likes: 1 });
    expect(await (await buddy.post(`/v1/recipes/${recipeId}/like`)).json()).toEqual({ liked: true, likes: 2 });
    expect(await (await me.post(`/v1/recipes/${recipeId}/like`)).json()).toEqual({ liked: false, likes: 1 });
    expect((await (await me.post(`/v1/recipes/${recipeId}/save`)).json()).saved).toBe(true);
    const saved = await (await me.get("/v1/recipes?saved=true")).json();
    expect(saved.recipes.map((r: { id: string }) => r.id)).toEqual([recipeId]);
    const c = await (await buddy.post(`/v1/recipes/${recipeId}/comments`, { data: { content: "Made this twice!" } })).json();
    const d = await (await me.get(`/v1/recipes/${recipeId}`)).json();
    expect(d.recipe).toMatchObject({ likes: 1, saved: true, liked: false });
    expect(d.recipe.comments[0]).toMatchObject({ content: "Made this twice!", author: { name: "Regina Fly" }, isMine: false });
    expect((await me.delete(`/v1/recipe-comments/${c.comment.id}`)).status()).toBe(403);
    expect((await buddy.delete(`/v1/recipe-comments/${c.comment.id}`)).ok()).toBeTruthy();
  });

  test("follow / unfollow members", async ({ as }) => {
    const me = await as("member");
    expect(await (await me.post(`/v1/users/${USERS.buddy.userId}/follow`)).json()).toEqual({ following: true, followers: 1 });
    expect((await (await (await as("buddy")).get("/v1/me")).json()).social.followers).toBe(1);
    expect(await (await me.post(`/v1/users/${USERS.buddy.userId}/follow`)).json()).toEqual({ following: false, followers: 0 });
    expect((await me.post(`/v1/users/${USERS.member.userId}/follow`)).status()).toBe(400);
  });
});
