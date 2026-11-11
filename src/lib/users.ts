import { createClerkClient, type User } from "@clerk/backend";
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
    } else if (clerk) {
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        try {
          const list = await clerk.users.getUserList({ userId: chunk, limit: 100 });
          for (const u of list.data) {
            const pu = fromClerk(u);
            out.set(u.id, pu);
            cache.set(u.id, { at: Date.now(), user: pu });
          }
        } catch {
          /* fall through to unknown */
        }
      }
    }
    for (const id of missing) if (!out.has(id)) out.set(id, unknown(id));
  }
  return out;
}

export async function getUser(id: string): Promise<PublicUser> {
  return (await getUsers([id])).get(id)!;
}

export async function updateClerkUser(id: string, data: { firstName?: string; lastName?: string; username?: string }) {
  if (env.authMode === "test") {
    const u = testUsers.get(id) ?? unknown(id);
    testUsers.set(id, { ...u, ...data });
    cache.delete(id);
    return;
  }
  await clerk!.users.updateUser(id, data);
  cache.delete(id);
}

export const displayName = (u: PublicUser) => `${u.firstName} ${u.lastName}`.trim() || u.username || "Member";
