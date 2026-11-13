import { createClerkClient, type User } from "@clerk/backend";
import { db } from "../db/index.js";
import { env } from "../env.js";

/** Public profile of any member, as shown in feeds/leaderboards. Names live in Clerk, not Postgres. */
export interface PublicUser {
  userId: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  username: string;
  email?: string;
}

const clerk = env.clerkSecretKey ? createClerkClient({ secretKey: env.clerkSecretKey }) : null;
const directories = env.clerkDirectoryKeys.filter((k) => k !== env.clerkSecretKey).map((secretKey) => createClerkClient({ secretKey }));
const cache = new Map<string, { at: number; user: PublicUser }>();
const TTL = 5 * 60 * 1000;

// Test-mode directory (AUTH_MODE=test only).
const testUsers = new Map<string, PublicUser>();
export function registerTestUser(u: PublicUser) {
  if (env.authMode !== "test") throw new Error("test users only in AUTH_MODE=test");
  testUsers.set(u.userId, u);
  cache.delete(u.userId);
}
export function findTestUserByEmail(email: string) {
  if (env.authMode !== "test") return undefined;
  return [...testUsers.values()].find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

function fromClerk(u: User): PublicUser {
  return {
    userId: u.id,
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    imageUrl: u.imageUrl || "",
    username: u.username || u.firstName || "",
    email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress,
  };
}

const unknown = (userId: string): PublicUser =>
  userId === "system"
    ? { userId, firstName: "C7", lastName: "Coaching", imageUrl: "", username: "c7" }
    : { userId, firstName: "Unknown", lastName: "User", imageUrl: "", username: "Unknown" };

export async function getUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (id === "system") {
      out.set(id, unknown(id));
      continue;
    }
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL) out.set(id, hit.user);
    else missing.push(id);
  }
  if (missing.length) {
    if (env.authMode === "test") {
      for (const id of missing) out.set(id, testUsers.get(id) ?? unknown(id));
    } else {
      // This instance first, then any other Clerk instances whose users share this database.
      for (const c of [clerk, ...directories]) {
        if (!c) continue;
        const todo = missing.filter((id) => !out.has(id));
        for (let i = 0; i < todo.length; i += 100) {
          try {
            const list = await c.users.getUserList({ userId: todo.slice(i, i + 100), limit: 100 });
            for (const u of list.data) {
              const pu = fromClerk(u);
              out.set(u.id, pu);
              cache.set(u.id, { at: Date.now(), user: pu });
              void rememberProfile(pu);
            }
          } catch {
            /* try the next directory / fall back to the saved profile */
          }
        }
      }
    }
    // Not in this Clerk instance (other environment, or deleted): use the last profile we saw.
    const still = missing.filter((id) => !out.has(id));
    if (still.length) {
      const rows = await db.selectFrom("UserProfile").selectAll().where("userId", "in", still).execute().catch(() => []);
      for (const r of rows) if (r.firstName || r.lastName || r.username || r.email) out.set(r.userId, { userId: r.userId, firstName: r.firstName, lastName: r.lastName, username: r.username || r.firstName, imageUrl: r.imageUrl, email: r.email ?? undefined });
    }
    for (const id of missing) if (!out.has(id)) out.set(id, unknown(id));
  }
  return out;
}

const remembered = new Map<string, number>();
/** Saves the signed-in person's Clerk profile in Postgres (at most every 30 min per user). */
export async function rememberProfile(u: PublicUser, force = false) {
  if ((!u.firstName && !u.lastName && !u.email) || (u.firstName === "Unknown" && u.lastName === "User")) return;
  if (!force && Date.now() - (remembered.get(u.userId) ?? 0) < 30 * 60 * 1000) return;
  remembered.set(u.userId, Date.now());
  const v = { firstName: u.firstName, lastName: u.lastName, username: u.username ?? "", email: u.email ?? null, imageUrl: u.imageUrl ?? "", updatedAt: new Date() };
  await db.insertInto("UserProfile").values({ userId: u.userId, ...v }).onConflict((oc) => oc.column("userId").doUpdateSet(v)).execute().catch(() => {});
}

export async function getUser(id: string): Promise<PublicUser> {
  return (await getUsers([id])).get(id)!;
}

export async function updateClerkUser(id: string, data: { firstName?: string; lastName?: string; username?: string }) {
  if (env.authMode === "test") {
    const u = testUsers.get(id) ?? unknown(id);
    testUsers.set(id, { ...u, ...data });
    cache.delete(id);
    await rememberProfile(testUsers.get(id)!, true);
    return;
  }
  await clerk!.users.updateUser(id, data);
  cache.delete(id);
  await rememberProfile(await getUser(id), true);
}

export const displayName = (u: PublicUser) => `${u.firstName} ${u.lastName}`.trim() || u.username || "Member";
