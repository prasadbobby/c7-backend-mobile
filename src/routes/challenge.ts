import { Hono } from "hono";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db/index.js";
import { isAdminRole, type AppEnv, type AuthUser } from "../lib/auth.js";
import { HttpError, badRequest, body, forbidden, notFound, query, ymdSchema } from "../lib/http.js";
import { getUsers, type PublicUser } from "../lib/users.js";
import { noonUTC, now, uuid } from "../lib/util.js";
import { calculateChallengeScore, calculateParticipantMetrics } from "../scoring/challengeScoring.js";
import { calculateWeeklyMetrics, calculateWeeklyScore, getChallengeWeeks, getCurrentWeek, getLastCompletedWeek } from "../scoring/weeklyScoring.js";

const REACTIONS = ["LIKE", "LOVE", "SUPPORT", "STRONG", "FIRE", "CLAP"] as const;
const SLEEP = ["POOR", "FAIR", "GOOD", "VERY_GOOD", "EXCELLENT"] as const;
const MOOD = ["VERY_LOW", "LOW", "NEUTRAL", "GOOD", "VERY_GOOD", "EXCELLENT"] as const;
const ENERGY = ["VERY_LOW", "LOW", "MODERATE", "HIGH", "VERY_HIGH"] as const;
const MAX_PHOTOS = 10;
const MAX_PHOTO_CHARS = 7 * 1024 * 1024;

/** Participant gate used by every FitForge challenge route: enabled + challenge active. */
async function participantFor(user: AuthUser, challengeId: string) {
  const p = await db
    .selectFrom("NinetyDayChallengeParticipant as p")
    .innerJoin("NinetyDayChallenge as c", "c.id", "p.challengeId")
    .select(["p.id", "p.joinedAt", "p.isEnabled", "p.completedDays", "c.id as challengeId", "c.title", "c.description", "c.startDate", "c.endDate", "c.isActive"])
    .where("p.userId", "=", user.userId)
    .where("p.challengeId", "=", challengeId)
    .executeTakeFirst();
  return p && p.isEnabled && p.isActive ? p : null;
}

async function requireAccess(user: AuthUser, challengeId: string) {
  const p = await participantFor(user, challengeId);
  if (p) return p;
  if (isAdminRole(user.role)) {
    const ch = await db.selectFrom("NinetyDayChallenge").selectAll().where("id", "=", challengeId).executeTakeFirst();
    if (ch) return null; // admins may read any challenge
  }
  throw forbidden("No access to this challenge");
}

const authorOf = (m: Map<string, PublicUser>, id: string, roles: Map<string, string>) => {
  const u = m.get(id)!;
  return { userId: id, firstName: u.firstName, lastName: u.lastName, imageUrl: u.imageUrl, username: u.username, isAdmin: roles.get(id) === "ADMIN" || roles.get(id) === "SUPER_ADMIN" };
};

async function rolesFor(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.selectFrom("UserInfo").select(["userId", "role"]).where("userId", "in", [...new Set(ids)]).execute();
  return new Map(rows.map((r) => [r.userId, r.role as string]));
}

/** Challenge stats — exact port of /api/ninety-day-challenge/stats (server TZ UTC). */
async function statsFor(userId: string, ch: { id: string; startDate: Date; endDate: Date }) {
  const n = new Date();
  const totalDays = Math.ceil((ch.endDate.getTime() - ch.startDate.getTime()) / 86400000);
  const daysPassed = Math.max(0, Math.ceil((n.getTime() - ch.startDate.getTime()) / 86400000));
  const daysRemaining = Math.max(0, Math.ceil((ch.endDate.getTime() - n.getTime()) / 86400000));
  const posts = await db.selectFrom("NinetyDayChallengePost").select(["date"]).where("userId", "=", userId).where("challengeId", "=", ch.id).orderBy("date", "desc").execute();
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const postDays = new Set(posts.map((p) => {
    const d = new Date(p.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }));
  for (let i = 0; i < daysPassed; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (postDays.has(d.getTime())) streak++;
    else break;
  }
  const totalParticipants = await db.selectFrom("NinetyDayChallengeParticipant").select(db.fn.countAll<number>().as("n")).where("challengeId", "=", ch.id).where("isEnabled", "=", true).executeTakeFirstOrThrow();
  return { totalDays, daysPassed, daysRemaining, completedDays: posts.length, streak, totalParticipants: totalParticipants.n, isCompleted: n > ch.endDate };
}

/** Overall + weekly leaderboard, computed with FitForge's own scoring modules (admins excluded, posts after join only). */
async function leaderboard(challengeId: string, weekNumber?: number) {
  const ch = await db.selectFrom("NinetyDayChallenge").select(["id", "startDate", "endDate"]).where("id", "=", challengeId).executeTakeFirstOrThrow();
  const parts = await db.selectFrom("NinetyDayChallengeParticipant").select(["id", "userId", "joinedAt"]).where("challengeId", "=", challengeId).where("isEnabled", "=", true).execute();
  const roles = await rolesFor(parts.map((p) => p.userId));
  const members = parts.filter((p) => !["ADMIN", "SUPER_ADMIN"].includes(roles.get(p.userId) ?? ""));
  const posts = members.length
    ? await db
        .selectFrom("NinetyDayChallengePost")
        .select(["participantId", "date", "sleepHours", "sleepQuality", "mood", "energy", "isFasting", "createdAt", sql<number>`coalesce(array_length(photos, 1), 0)`.as("photoCount")])
        .where("challengeId", "=", challengeId)
        .where("participantId", "in", members.map((m) => m.id))
        .execute()
    : [];
  const users = await getUsers(members.map((m) => m.userId));
  const weeks = getChallengeWeeks(ch.startDate.toISOString(), ch.endDate.toISOString());
  const startIso = ch.startDate.toISOString();
  const selectedWeek = weekNumber ? weeks.find((w) => w.weekNumber === weekNumber) : getCurrentWeek(startIso) || getLastCompletedWeek(startIso) || weeks[0];
  const rank = <T extends { score: number }>(arr: T[]) => arr.sort((a, b) => b.score - a.score).map((e, i) => ({ ...e, rank: i + 1 }));
  const base = members.map((m) => {
    const mine = posts
      .filter((p) => p.participantId === m.id && new Date(p.createdAt) >= new Date(m.joinedAt))
      .map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), date: p.date.toISOString(), photos: null as string[] | null }));
    const u = users.get(m.userId)!;
    return { m, mine, user: { userId: m.userId, firstName: u.firstName, lastName: u.lastName, imageUrl: u.imageUrl } };
  });
  const overall = rank(
    base.map(({ m, mine, user }) => {
      const metrics = calculateParticipantMetrics(mine, m.joinedAt.toISOString());
      const n = new Date();
      const nowUTC = new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
      const j = new Date(m.joinedAt);
      const joinedUTC = new Date(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate());
      const daysElapsed = Math.max(1, Math.ceil((nowUTC.getTime() - joinedUTC.getTime()) / 86400000));
      return { ...user, score: Math.round(calculateChallengeScore(metrics, daysElapsed)), totalPosts: metrics.totalPosts, consistency: Math.round(metrics.consistency), daysElapsed };
    }),
  );
  const weekly = selectedWeek
    ? rank(
        base.map(({ m, mine, user }) => {
          const wm = calculateWeeklyMetrics(mine, selectedWeek, m.joinedAt.toISOString());
          return { ...user, score: calculateWeeklyScore(wm), totalPosts: wm.totalPosts, consistency: Math.round(wm.consistency), daysElapsed: wm.totalEligibleDays };
        }),
      )
    : [];
  return {
    overall,
    weekly,
    weeks: weeks.map((w) => ({ weekNumber: w.weekNumber, startDate: w.startDate, endDate: w.endDate, isCurrentWeek: w.isCurrentWeek, isCompleted: w.isCompleted })),
    selectedWeek: selectedWeek ? selectedWeek.weekNumber : null,
  };
}

export const challenges = new Hono<AppEnv>();

/** All active challenges with this member's access state (enabled / requested / none). */
challenges.get("/", async (c) => {
  const u = c.get("user");
  const rows = await db
    .selectFrom("NinetyDayChallenge as c")
    .leftJoin("NinetyDayChallengeParticipant as p", (j) => j.onRef("p.challengeId", "=", "c.id").on("p.userId", "=", u.userId))
    .select([
      "c.id", "c.title", "c.description", "c.startDate", "c.endDate", "c.isActive", "p.isEnabled", "p.completedDays", "p.joinedAt",
      sql<number>`(select count(*) from "NinetyDayChallengeParticipant" x where x."challengeId" = c.id and x."isEnabled")`.as("participants"),
    ])
    .where("c.isActive", "=", true)
    .orderBy("c.startDate", "desc")
    .execute();
  const out = await Promise.all(
    rows.map(async (r) => {
      const access = r.isEnabled ? "enabled" : r.joinedAt ? "requested" : "none";
      const stats = access === "enabled" ? await statsFor(u.userId, r) : null;
      return { id: r.id, title: r.title, description: r.description, startDate: r.startDate, endDate: r.endDate, participants: r.participants, access, stats };
    }),
  );
  return c.json({ challenges: out });
});

/** Ask the gym to enable you: creates a disabled participant row that admins see in FitForge's participant manager. */
challenges.post("/:id/request-access", async (c) => {
  const u = c.get("user");
  const ch = await db.selectFrom("NinetyDayChallenge").select(["id", "isActive"]).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!ch || !ch.isActive) throw notFound("Challenge not found");
  await db
    .insertInto("NinetyDayChallengeParticipant")
    .values({ id: uuid(), userId: u.userId, challengeId: ch.id, isEnabled: false })
    .onConflict((oc) => oc.columns(["userId", "challengeId"]).doNothing())
    .execute();
  return c.json({ success: true, access: "requested" });
});

challenges.get("/:id", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await requireAccess(u, id);
  const ch = await db.selectFrom("NinetyDayChallenge").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const lb = await leaderboard(id);
  const mine = lb.overall.find((e) => e.userId === u.userId);
  return c.json({
    challenge: { id: ch.id, title: ch.title, description: ch.description, startDate: ch.startDate, endDate: ch.endDate },
    stats: await statsFor(u.userId, ch),
    rank: mine ? { rank: mine.rank, score: mine.score, of: lb.overall.length } : null,
  });
});

/** Mirrors /posts/calendar (month/year in server time). */
challenges.get("/:id/calendar", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await requireAccess(u, id);
  const { month, year } = query(c, z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100) }));
  const posts = await db
    .selectFrom("NinetyDayChallengePost")
    .select(["id", "date", "mood", "energy"])
    .where("userId", "=", u.userId)
    .where("challengeId", "=", id)
    .where("date", ">=", new Date(year, month - 1, 1))
    .where("date", "<=", new Date(year, month, 0, 23, 59, 59, 999))
    .execute();
  return c.json({ posts: posts.map((p) => ({ id: p.id, date: p.date.toISOString(), hasPost: true, mood: p.mood, energy: p.energy })) });
});

/** Mirrors /posts/today?date=YYYY-MM-DD. */
challenges.get("/:id/posts/today", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await requireAccess(u, id);
  const { date } = query(c, z.object({ date: ymdSchema }));
  const post = await db.selectFrom("NinetyDayChallengePost").selectAll().where("userId", "=", u.userId).where("challengeId", "=", id).where("date", "=", noonUTC(date)).executeTakeFirst();
  return c.json({ post: post ?? null });
});

const postFields = z.object({
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  sleepQuality: z.enum(SLEEP).nullable().optional(),
  mealTracking: z.string().max(4000).nullable().optional(),
  dayDescription: z.string().max(4000).nullable().optional(),
  mood: z.enum(MOOD).nullable().optional(),
  energy: z.enum(ENERGY).nullable().optional(),
  achievements: z.string().max(4000).nullable().optional(),
  challenges: z.string().max(4000).nullable().optional(),
  isFasting: z.boolean().optional(),
  photos: z.array(z.string().max(MAX_PHOTO_CHARS)).max(MAX_PHOTOS).optional(),
});

/** Create the daily post — mirrors POST /api/ninety-day-challenge/posts (one per day for members; noon-UTC date). */
challenges.post("/:id/posts", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const b = await body(c, postFields.extend({ date: ymdSchema }));
  const admin = isAdminRole(u.role);
  let participant = await participantFor(u, id);
  if (!participant) {
    if (!admin) throw forbidden("No access to this challenge");
    const ch = await db.selectFrom("NinetyDayChallenge").select("id").where("id", "=", id).executeTakeFirst();
    if (!ch) throw notFound("Challenge not found");
    await db
      .insertInto("NinetyDayChallengeParticipant")
      .values({ id: uuid(), userId: u.userId, challengeId: id, isEnabled: true })
      .onConflict((oc) => oc.columns(["userId", "challengeId"]).doUpdateSet({ isEnabled: true }))
      .execute();
    participant = await participantFor(u, id);
  }
  const postDate = noonUTC(b.date);
  if (!admin) {
    const exists = await db.selectFrom("NinetyDayChallengePost").select("id").where("userId", "=", u.userId).where("challengeId", "=", id).where("date", "=", postDate).executeTakeFirst();
    if (exists) throw new HttpError(409, "POST_EXISTS", "Post already exists for this date");
  } else {
    const [y, m, d] = b.date.split("-").map(Number) as [number, number, number];
    const sameDay = await db
      .selectFrom("NinetyDayChallengePost")
      .select(db.fn.countAll<number>().as("n"))
      .where("userId", "=", u.userId)
      .where("challengeId", "=", id)
      .where("date", ">=", new Date(Date.UTC(y, m - 1, d)))
      .where("date", "<", new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)))
      .executeTakeFirstOrThrow();
    postDate.setSeconds(sameDay.n);
  }
  const postId = uuid();
  await db
    .insertInto("NinetyDayChallengePost")
    .values({
      id: postId,
      userId: u.userId,
      challengeId: id,
      participantId: participant!.id,
      date: postDate,
      sleepHours: b.sleepHours ?? null,
      sleepQuality: b.sleepQuality ?? null,
      mealTracking: b.mealTracking ?? null,
      dayDescription: b.dayDescription ?? null,
      mood: b.mood ?? null,
      energy: b.energy ?? null,
      achievements: b.achievements ?? null,
      challenges: b.challenges ?? null,
      isFasting: b.isFasting ?? false,
      photos: b.photos ?? [],
      updatedAt: now(),
    })
    .execute();
  await db
    .updateTable("NinetyDayChallengeParticipant")
    .set((eb) => ({ lastActiveDate: now(), ...(admin ? {} : { completedDays: eb("completedDays", "+", 1) }) }))
    .where("id", "=", participant!.id)
    .execute();
  const post = await db.selectFrom("NinetyDayChallengePost").selectAll().where("id", "=", postId).executeTakeFirstOrThrow();
  return c.json({ post }, 201);
});

/** Community feed — mirrors /community-feed (pinned first, threaded comments, reaction counts, my reaction). */
challenges.get("/:id/feed", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await requireAccess(u, id);
  const q = query(c, z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(30).default(10), date: ymdSchema.optional() }));
  let w = db.selectFrom("NinetyDayChallengePost").where("challengeId", "=", id);
  if (q.date) {
    const [y, m, d] = q.date.split("-").map(Number) as [number, number, number];
    w = w.where("date", ">=", new Date(y, m - 1, d, 0, 0, 0, 0)).where("date", "<=", new Date(y, m - 1, d, 23, 59, 59, 999));
  }
  const [posts, total] = await Promise.all([
    w
      .selectAll()
      .orderBy("isPinned", "desc")
      .orderBy(sql`"pinnedAt" desc nulls last`)
      .orderBy("updatedAt", "desc")
      .offset((q.page - 1) * q.limit)
      .limit(q.limit)
      .execute(),
    w.select(db.fn.countAll<number>().as("n")).executeTakeFirstOrThrow(),
  ]);
  const postIds = posts.map((p) => p.id);
  const [reactions, comments, views] = postIds.length
    ? await Promise.all([
        db.selectFrom("NinetyDayChallengeReaction").selectAll().where("postId", "in", postIds).execute(),
        db.selectFrom("NinetyDayChallengeComment").selectAll().where("postId", "in", postIds).orderBy("createdAt", "asc").execute(),
        db.selectFrom("NinetyDayChallengePostView").select(["postId", db.fn.countAll<number>().as("n")]).where("postId", "in", postIds).groupBy("postId").execute(),
      ])
    : [[], [], []];
  const commentIds = comments.map((x) => x.id);
  const cReactions = commentIds.length ? await db.selectFrom("NinetyDayChallengeCommentReaction").selectAll().where("commentId", "in", commentIds).execute() : [];
  const ids = [...posts.map((p) => p.userId), ...comments.map((x) => x.userId), ...reactions.map((r) => r.userId)];
  const [users, roles] = await Promise.all([getUsers(ids), rolesFor(ids)]);
  const counts = <T extends { reactionType: string }>(rs: T[]) => rs.reduce((a, r) => ((a[r.reactionType] = (a[r.reactionType] || 0) + 1), a), {} as Record<string, number>);
  const shapeComment = (x: (typeof comments)[number]) => {
    const rs = cReactions.filter((r) => r.commentId === x.id);
    const mine = rs.find((r) => r.userId === u.userId);
    return { id: x.id, content: x.content, createdAt: x.createdAt, parentCommentId: x.parentCommentId, author: authorOf(users, x.userId, roles), reactionCounts: counts(rs), userReaction: mine ? { id: mine.id, type: mine.reactionType } : null };
  };
  return c.json({
    posts: posts.map((p) => {
      const rs = reactions.filter((r) => r.postId === p.id);
      const mine = rs.find((r) => r.userId === u.userId);
      const top = comments.filter((x) => x.postId === p.id && !x.parentCommentId);
      return {
        ...p,
        author: authorOf(users, p.userId, roles),
        reactionCounts: counts(rs),
        userReaction: mine ? { id: mine.id, type: mine.reactionType } : null,
        commentCount: comments.filter((x) => x.postId === p.id).length,
        viewCount: views.find((v) => v.postId === p.id)?.n ?? 0,
        comments: top.map((x) => ({ ...shapeComment(x), replies: comments.filter((r) => r.parentCommentId === x.id).map(shapeComment) })),
      };
    }),
    totalCount: total.n,
    totalPages: Math.ceil(total.n / q.limit),
    currentPage: q.page,
    currentUserId: u.userId,
  });
});

challenges.get("/:id/leaderboard", async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await requireAccess(u, id);
  const { week } = query(c, z.object({ week: z.coerce.number().int().min(1).max(60).optional() }));
  const lb = await leaderboard(id, week);
  return c.json({ ...lb, me: { overall: lb.overall.find((e) => e.userId === u.userId) ?? null, weekly: lb.weekly.find((e) => e.userId === u.userId) ?? null } });
});

/* ------------------------------------------------------------- posts ---- */

export const posts = new Hono<AppEnv>();

async function loadPost(postId: string) {
  const p = await db.selectFrom("NinetyDayChallengePost").selectAll().where("id", "=", postId).executeTakeFirst();
  if (!p) throw notFound("Post not found");
  return p;
}

/** Mirrors PUT /posts/[id] (owner or admin). JSON body; photos replace the list. */
posts.put("/:postId", async (c) => {
  const u = c.get("user");
  const p = await loadPost(c.req.param("postId"));
  if (!isAdminRole(u.role) && p.userId !== u.userId) throw forbidden("Unauthorized to edit this post");
  const b = await body(c, postFields);
  const patch = { ...b, isFasting: b.isFasting ?? p.isFasting, photos: b.photos ?? p.photos, updatedAt: now() };
  await db.updateTable("NinetyDayChallengePost").set(patch).where("id", "=", p.id).execute();
  return c.json({ post: await loadPost(p.id) });
});

posts.delete("/:postId", async (c) => {
  const u = c.get("user");
  const p = await loadPost(c.req.param("postId"));
  if (!isAdminRole(u.role) && p.userId !== u.userId) throw forbidden("Unauthorized to delete this post");
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("NinetyDayChallengeReaction").where("postId", "=", p.id).execute();
    await trx.deleteFrom("NinetyDayChallengeComment").where("postId", "=", p.id).execute();
    await trx.deleteFrom("NinetyDayChallengePost").where("id", "=", p.id).execute();
  });
  return c.json({ message: "Post deleted successfully" });
});

/** Mirrors /reactions: one reaction per user per post; same type toggles off, other type switches. */
posts.post("/:postId/reactions", async (c) => {
  const u = c.get("user");
  const p = await loadPost(c.req.param("postId"));
  await requireAccess(u, p.challengeId);
  const { type } = await body(c, z.object({ type: z.enum(REACTIONS) }));
  const existing = await db.selectFrom("NinetyDayChallengeReaction").selectAll().where("userId", "=", u.userId).where("postId", "=", p.id).executeTakeFirst();
  if (existing) {
    if (existing.reactionType === type) {
      await db.deleteFrom("NinetyDayChallengeReaction").where("id", "=", existing.id).execute();
      return c.json({ success: true, action: "removed" });
    }
    await db.updateTable("NinetyDayChallengeReaction").set({ reactionType: type }).where("id", "=", existing.id).execute();
    return c.json({ success: true, action: "updated" });
  }
  await db.insertInto("NinetyDayChallengeReaction").values({ id: uuid(), userId: u.userId, postId: p.id, reactionType: type }).execute();
  return c.json({ success: true, action: "created" });
});

posts.post("/:postId/views", async (c) => {
  const u = c.get("user");
  const p = await loadPost(c.req.param("postId"));
  if (p.userId !== u.userId) {
    await db.insertInto("NinetyDayChallengePostView").values({ id: uuid(), userId: u.userId, postId: p.id }).onConflict((oc) => oc.columns(["userId", "postId"]).doNothing()).execute();
  }
  return c.json({ success: true });
});

/** Mirrors POST /comments (participants of the post's challenge, or admins; replies must belong to the same post). */
posts.post("/:postId/comments", async (c) => {
  const u = c.get("user");
  const p = await loadPost(c.req.param("postId"));
  const b = await body(c, z.object({ content: z.string().trim().min(1).max(2000), parentCommentId: z.string().optional() }));
  if (b.parentCommentId) {
    const parent = await db.selectFrom("NinetyDayChallengeComment").select(["postId"]).where("id", "=", b.parentCommentId).executeTakeFirst();
    if (!parent) throw notFound("Parent comment not found");
    if (parent.postId !== p.id) throw badRequest("Parent comment does not belong to this post");
  }
  const participant = await db.selectFrom("NinetyDayChallengeParticipant").select("id").where("userId", "=", u.userId).where("challengeId", "=", p.challengeId).where("isEnabled", "=", true).executeTakeFirst();
  if (!isAdminRole(u.role) && !participant) throw forbidden("Access denied");
  const id = uuid();
  await db
    .insertInto("NinetyDayChallengeComment")
    .values({ id, postId: p.id, userId: u.userId, participantId: participant?.id ?? null, content: b.content, parentCommentId: b.parentCommentId ?? null, updatedAt: now() })
    .execute();
  return c.json({ comment: { id, content: b.content, parentCommentId: b.parentCommentId ?? null, createdAt: now(), author: { userId: u.userId, firstName: u.firstName, lastName: u.lastName, imageUrl: u.imageUrl }, reactionCounts: {}, userReaction: null, replies: [] } }, 201);
});

export const comments = new Hono<AppEnv>();

/** Mirrors DELETE /comments/[commentId] (owner or ADMIN). */
comments.delete("/:id", async (c) => {
  const u = c.get("user");
  const cm = await db.selectFrom("NinetyDayChallengeComment").select(["id", "userId"]).where("id", "=", c.req.param("id")).executeTakeFirst();
  if (!cm) throw notFound("Comment not found");
  if (cm.userId !== u.userId && u.role !== "ADMIN" && u.role !== "SUPER_ADMIN") throw forbidden("Access denied");
  await db.deleteFrom("NinetyDayChallengeComment").where("id", "=", cm.id).execute();
  return c.json({ message: "Comment deleted successfully" });
});

comments.post("/:id/reactions", async (c) => {
  const u = c.get("user");
  const cm = await db
    .selectFrom("NinetyDayChallengeComment as cm")
    .innerJoin("NinetyDayChallengePost as p", "p.id", "cm.postId")
    .select(["cm.id", "p.challengeId"])
    .where("cm.id", "=", c.req.param("id"))
    .executeTakeFirst();
  if (!cm) throw notFound("Comment not found");
  await requireAccess(u, cm.challengeId);
  const { type } = await body(c, z.object({ type: z.enum(REACTIONS) }));
  const existing = await db.selectFrom("NinetyDayChallengeCommentReaction").selectAll().where("userId", "=", u.userId).where("commentId", "=", cm.id).executeTakeFirst();
  if (existing) {
    if (existing.reactionType === type) {
      await db.deleteFrom("NinetyDayChallengeCommentReaction").where("id", "=", existing.id).execute();
      return c.json({ success: true, action: "removed" });
    }
    await db.updateTable("NinetyDayChallengeCommentReaction").set({ reactionType: type }).where("id", "=", existing.id).execute();
    return c.json({ success: true, action: "updated" });
  }
  await db.insertInto("NinetyDayChallengeCommentReaction").values({ id: uuid(), userId: u.userId, commentId: cm.id, reactionType: type }).execute();
  return c.json({ success: true, action: "created" });
});

export { statsFor, participantFor, leaderboard };
