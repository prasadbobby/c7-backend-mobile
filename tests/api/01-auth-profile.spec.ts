import pg from "pg";
import { TEST_DB, USERS } from "../fixtures";
import { expect, test } from "./_setup";

test.describe("auth", () => {
  test("health is public and reports test auth mode", async ({ request }) => {
    const r = await request.get("/health");
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).authMode).toBe("test");
  });

  test("API rejects missing and malformed tokens", async ({ request }) => {
    expect((await request.get("/v1/me")).status()).toBe(401);
    expect((await request.get("/v1/me", { headers: { Authorization: "Bearer nope" } })).status()).toBe(401);
  });

  test("locked members get 423", async ({ as }) => {
    const r = await (await as("locked")).get("/v1/me");
    expect(r.status()).toBe(423);
    expect((await r.json()).code).toBe("ACCOUNT_LOCKED");
  });

  test("first sign-in creates UserInfo with the invited role and consumes the invitation (FitForge adminAuth rule)", async ({ as }) => {
    const r = await (await as("newbie")).get("/v1/me");
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).user.role).toBe("USER");
    const c = new pg.Client({ connectionString: TEST_DB });
    await c.connect();
    const inv = await c.query(`SELECT 1 FROM "PendingInvitation" WHERE email = 'invited@c7.test'`);
    await c.end();
    expect(inv.rowCount).toBe(0);
  });
});

test.describe("profile", () => {
  test("me returns Clerk profile + FitForge UserInfo", async ({ as }) => {
    const j = await (await (await as("member")).get("/v1/me")).json();
    expect(j.user).toMatchObject({ id: USERS.member.userId, firstName: "Emma", lastName: "Richardson", age: 34, height: 168, weight: 49, role: "USER" });
    expect(j.user.memberId).toMatch(/^C7\d{4}$/);
  });

  test("update details and body metrics", async ({ as }) => {
    const api = await as("member");
    expect((await api.patch("/v1/me", { data: { firstName: "Emma", lastName: "R.", age: 35, height: 169, weight: 50.5 } })).ok()).toBeTruthy();
    const j = await (await api.get("/v1/me")).json();
    expect(j.user).toMatchObject({ lastName: "R.", age: 35, height: 169, weight: 50.5 });
    expect((await api.patch("/v1/me", { data: { age: 3 } })).status()).toBe(400);
  });

  test("equipment set replaces the previous selection", async ({ as }) => {
    const api = await as("member");
    await api.put("/v1/me/equipment", { data: { equipment: ["dumbbell", "barbell"] } });
    await api.put("/v1/me/equipment", { data: { equipment: ["dumbbell", "body only"] } });
    expect((await (await api.get("/v1/me")).json()).equipment.sort()).toEqual(["body only", "dumbbell"]);
    expect((await api.put("/v1/me/equipment", { data: { equipment: ["spaceship"] } })).status()).toBe(400);
  });

  test("preferences + onboarding completion persist", async ({ as }) => {
    const api = await as("member");
    await api.patch("/v1/me/preferences", { data: { fitnessGoal: "muscle", experienceLevel: "Advanced", completeOnboarding: true, hapticsEnabled: false } });
    const p = (await (await api.get("/v1/me")).json()).preferences;
    expect(p).toMatchObject({ fitnessGoal: "muscle", experienceLevel: "Advanced", onboardingCompleted: true, hapticsEnabled: false });
  });

  test("membership mirrors FitForge (days remaining, active)", async ({ as }) => {
    const m = (await (await (await as("member")).get("/v1/me/membership")).json()).membership;
    expect(m.status).toBe("ACTIVE");
    expect(m.isActive).toBe(true);
    expect(m.daysRemaining).toBeGreaterThanOrEqual(4);
    expect(m.daysRemaining).toBeLessThanOrEqual(6);
  });

  test("payments include logs with the recording coach's name", async ({ as }) => {
    const j = await (await (await as("member")).get("/v1/me/payments")).json();
    expect(j.paymentInfo).toMatchObject({ packagePrice: 45000, totalAmountPaid: 30000, remainingAmount: 10000 });
    expect(j.paymentLogs[0]).toMatchObject({ amount: 30000, paymentMethod: "UPI", recordedByName: "Coach" });
  });

  test("membership history", async ({ as }) => {
    const j = await (await (await as("member")).get("/v1/me/membership-history")).json();
    expect(j.membershipLogs[0].changeType).toBe("INITIAL_SETUP");
  });

  test("image upload returns a data URL; non-images rejected", async ({ as }) => {
    const api = await as("member");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const ok = await api.post("/v1/uploads", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } });
    expect(ok.ok()).toBeTruthy();
    expect((await ok.json()).url).toMatch(/^data:image\/png;base64,/);
    const bad = await api.post("/v1/uploads", { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hi") } } });
    expect(bad.status()).toBe(400);
  });
});
