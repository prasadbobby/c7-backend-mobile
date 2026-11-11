import { verifyToken } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { HttpError, forbidden } from "./http.js";
import { getUser, type PublicUser } from "./users.js";
import { now, uuid } from "./util.js";

export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
export interface AuthUser extends PublicUser {
  role: Role;
  userInfoId: string;
  locked: boolean;
}
export type AppEnv = { Variables: { user: AuthUser } };

async function userIdFromToken(token: string): Promise<string> {
  if (env.authMode === "test") {
    // Test tokens: "test_<clerkUserId>". Refused outright outside AUTH_MODE=test (see env.ts).
    if (!token.startsWith("test_")) throw new HttpError(401, "UNAUTHENTICATED", "Invalid test token");
    return token.slice(5);
  }
  try {
    const claims = await verifyToken(token, env.clerkJwtKey ? { jwtKey: env.clerkJwtKey } : { secretKey: env.clerkSecretKey });
    if (!claims.sub) throw new Error("no sub");
    return claims.sub;
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "Session expired. Please sign in again.");
  }
}

/**
 * Mirrors FitForge utils/adminAuth.ts: a member's UserInfo row is created on
 * first visit, with the role from their PendingInvitation (or SUPER_ADMIN for the configured owner email).
 */
export async function ensureUserInfo(userId: string, email?: string) {
  const existing = await db.selectFrom("UserInfo").select(["id", "role", "locked"]).where("userId", "=", userId).executeTakeFirst();
  if (existing) return existing;
  let role: Role = "USER";
  if (email && env.superAdminEmail && email === env.superAdminEmail) role = "SUPER_ADMIN";
  else if (email) {
    const inv = await db.selectFrom("PendingInvitation").select(["role"]).where("email", "=", email).executeTakeFirst();
    if (inv) {
      role = inv.role as Role;
      await db.deleteFrom("PendingInvitation").where("email", "=", email).execute();
    }
  }
  const row = { id: uuid(), userId, role, locked: false, updatedAt: now() };
  await db.insertInto("UserInfo").values(row).onConflict((oc) => oc.column("userId").doNothing()).execute();
  return (await db.selectFrom("UserInfo").select(["id", "role", "locked"]).where("userId", "=", userId).executeTakeFirstOrThrow());
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  const userId = await userIdFromToken(token);
  const profile = await getUser(userId);
  const info = await ensureUserInfo(userId, profile.email);
  if (info.locked) throw new HttpError(423, "ACCOUNT_LOCKED", "Your account is locked. Please contact your gym.");
  c.set("user", { ...profile, role: info.role as Role, userInfoId: info.id, locked: info.locked });
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get("user");
  if (u.role !== "ADMIN" && u.role !== "SUPER_ADMIN") throw forbidden("Admin access required");
  await next();
};

export const isAdminRole = (r: Role) => r === "ADMIN" || r === "SUPER_ADMIN";
