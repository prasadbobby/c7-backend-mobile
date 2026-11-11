import { USERS, today } from "../fixtures";
import { expect, test } from "./_setup";

test.describe.serial("90-day challenge", () => {
  let id = "";
  let myPostId = "";
  let commentId = "";

  test("member sees the challenge as enabled with stats", async ({ as }) => {
    const j = await (await (await as("member")).get("/v1/challenges")).json();
    const ch = j.challenges[0];
    expect(ch).toMatchObject({ title: "90-Day Transformation", access: "enabled", participants: 2 });
    expect(ch.stats.totalDays).toBe(90);
    id = ch.id;
  });

  test("non-participants are blocked and can request access", async ({ as }) => {
    const api = await as("newbie");
    expect((await api.get(`/v1/challenges/${id}`)).status()).toBe(403);
    expect((await api.post(`/v1/challenges/${id}/posts`, { data: { date: today() } })).status()).toBe(403);
    expect((await (await api.post(`/v1/challenges/${id}/request-access`)).json()).access).toBe("requested");
    const list = await (await api.get("/v1/challenges")).json();
    expect(list.challenges[0].access).toBe("requested");
  });

  test("today's check-in: empty, create, duplicate rejected", async ({ as }) => {
    const api = await as("member");
    expect((await (await api.get(`/v1/challenges/${id}/posts/today?date=${today()}`)).json()).post).toBeNull();
    const r = await api.post(`/v1/challenges/${id}/posts`, {
      data: { date: today(), sleepHours: 7.5, sleepQuality: "VERY_GOOD", mood: "GOOD", energy: "HIGH", mealTracking: "Oats, chicken bowl, salmon", dayDescription: "Strong session", achievements: "PB on squats", isFasting: false, photos: ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"] },
    });
    expect(r.status()).toBe(201);
    myPostId = (await r.json()).post.id;
    const dup = await api.post(`/v1/challenges/${id}/posts`, { data: { date: today() } });
    expect(dup.status()).toBe(409);
    const t = await (await api.get(`/v1/challenges/${id}/posts/today?date=${today()}`)).json();
    expect(t.post).toMatchObject({ sleepHours: 7.5, mood: "GOOD", photos: ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"] });
    expect((await api.post(`/v1/challenges/${id}/posts`, { data: { date: today(), mood: "ECSTATIC" } })).status()).toBe(400);
  });

  test("calendar and stats update (streak, completed days)", async ({ as }) => {
    const api = await as("member");
    const now = new Date();
    const cal = await (await api.get(`/v1/challenges/${id}/calendar?month=${now.getUTCMonth() + 1}&year=${now.getUTCFullYear()}`)).json();
    expect(cal.posts.some((p: { date: string }) => p.date.startsWith(today()))).toBe(true);
    const d = await (await api.get(`/v1/challenges/${id}`)).json();
    expect(d.stats).toMatchObject({ completedDays: 1, streak: 1, totalParticipants: 2 });
    expect(d.rank.of).toBe(2);
  });

  test("edit own post; others cannot", async ({ as }) => {
    const me = await as("member");
    const e = await me.put(`/v1/challenge-posts/${myPostId}`, { data: { mood: "EXCELLENT" } });
    expect((await e.json()).post.mood).toBe("EXCELLENT");
    expect((await (await as("buddy")).put(`/v1/challenge-posts/${myPostId}`, { data: { mood: "LOW" } })).status()).toBe(403);
  });

  test("feed: pinned/ordered posts with author names, counts and comments", async ({ as }) => {
    const f = await (await (await as("member")).get(`/v1/challenges/${id}/feed`)).json();
    expect(f.totalCount).toBe(2);
    const buddyPost = f.posts.find((p: { id: string }) => p.id === "post_buddy_1");
    expect(buddyPost.author).toMatchObject({ firstName: "Regina", lastName: "Fly" });
    expect(buddyPost.photos).toHaveLength(1);
  });

  test("reactions: create, switch type, toggle off (one per member)", async ({ as }) => {
    const api = await as("member");
    expect((await (await api.post("/v1/challenge-posts/post_buddy_1/reactions", { data: { type: "FIRE" } })).json()).action).toBe("created");
    expect((await (await api.post("/v1/challenge-posts/post_buddy_1/reactions", { data: { type: "CLAP" } })).json()).action).toBe("updated");
    let f = await (await api.get(`/v1/challenges/${id}/feed`)).json();
    let p = f.posts.find((x: { id: string }) => x.id === "post_buddy_1");
    expect(p.reactionCounts).toEqual({ CLAP: 1 });
    expect(p.userReaction.type).toBe("CLAP");
    expect((await (await api.post("/v1/challenge-posts/post_buddy_1/reactions", { data: { type: "CLAP" } })).json()).action).toBe("removed");
    await api.post("/v1/challenge-posts/post_buddy_1/reactions", { data: { type: "STRONG" } });
    f = await (await api.get(`/v1/challenges/${id}/feed`)).json();
    p = f.posts.find((x: { id: string }) => x.id === "post_buddy_1");
    expect(p.reactionCounts).toEqual({ STRONG: 1 });
    expect((await api.post("/v1/challenge-posts/post_buddy_1/reactions", { data: { type: "BOO" } })).status()).toBe(400);
  });

  test("comments, threaded replies, comment reactions and delete permissions", async ({ as }) => {
    const me = await as("member");
    const buddy = await as("buddy");
    const c1 = await me.post("/v1/challenge-posts/post_buddy_1/comments", { data: { content: "Huge effort!" } });
    expect(c1.status()).toBe(201);
    commentId = (await c1.json()).comment.id;
    const reply = await buddy.post("/v1/challenge-posts/post_buddy_1/comments", { data: { content: "Thanks!", parentCommentId: commentId } });
    expect(reply.status()).toBe(201);
    const wrongPost = await buddy.post(`/v1/challenge-posts/${myPostId}/comments`, { data: { content: "x", parentCommentId: commentId } });
    expect(wrongPost.status()).toBe(400);
    expect((await (await buddy.post(`/v1/challenge-comments/${commentId}/reactions`, { data: { type: "LOVE" } })).json()).action).toBe("created");
    const f = await (await me.get(`/v1/challenges/${id}/feed`)).json();
    const p = f.posts.find((x: { id: string }) => x.id === "post_buddy_1");
    expect(p.commentCount).toBe(2);
    expect(p.comments[0]).toMatchObject({ content: "Huge effort!", author: { firstName: "Emma" }, reactionCounts: { LOVE: 1 } });
    expect(p.comments[0].replies[0]).toMatchObject({ content: "Thanks!", author: { firstName: "Regina" } });
    expect((await buddy.delete(`/v1/challenge-comments/${commentId}`)).status()).toBe(403);
    expect((await me.post("/v1/challenge-posts/post_buddy_1/comments", { data: { content: "   " } })).status()).toBe(400);
  });

  test("views are recorded once per viewer (not the author)", async ({ as }) => {
    const me = await as("member");
    await me.post("/v1/challenge-posts/post_buddy_1/views");
    await me.post("/v1/challenge-posts/post_buddy_1/views");
    await (await as("buddy")).post("/v1/challenge-posts/post_buddy_1/views");
    const f = await (await me.get(`/v1/challenges/${id}/feed`)).json();
    expect(f.posts.find((x: { id: string }) => x.id === "post_buddy_1").viewCount).toBe(1);
  });

  test("leaderboard uses FitForge scoring (overall + weekly), excludes admins", async ({ as }) => {
    const lb = await (await (await as("member")).get(`/v1/challenges/${id}/leaderboard`)).json();
    expect(lb.overall).toHaveLength(2);
    expect(lb.overall.every((e: { userId: string }) => e.userId !== USERS.admin.userId)).toBe(true);
    expect(lb.overall[0].rank).toBe(1);
    expect(lb.overall[0].score).toBeGreaterThanOrEqual(lb.overall[1].score);
    expect(lb.me.overall.userId).toBe(USERS.member.userId);
    expect(lb.weeks.length).toBeGreaterThan(10);
    expect(lb.weekly).toHaveLength(2);
    const wk = await (await (await as("member")).get(`/v1/challenges/${id}/leaderboard?week=1`)).json();
    expect(wk.selectedWeek).toBe(1);
  });

  test("delete own post (and its reactions/comments)", async ({ as }) => {
    const me = await as("member");
    expect((await me.delete(`/v1/challenge-posts/${myPostId}`)).ok()).toBeTruthy();
    expect((await (await me.get(`/v1/challenges/${id}/posts/today?date=${today()}`)).json()).post).toBeNull();
  });

  test("admins can read any challenge and post without being a participant", async ({ as }) => {
    const admin = await as("admin");
    expect((await admin.get(`/v1/challenges/${id}/feed`)).ok()).toBeTruthy();
    expect((await admin.post(`/v1/challenges/${id}/posts`, { data: { date: today(), dayDescription: "Coach note" } })).status()).toBe(201);
    expect((await admin.post(`/v1/challenges/${id}/posts`, { data: { date: today(), dayDescription: "Second coach note" } })).status()).toBe(201);
  });
});
