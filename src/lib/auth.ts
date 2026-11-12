import { verifyToken } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { HttpError, forbidden } from "./http.js";
import { getUser, type PublicUser } from "./users.js";
import { daysRemainingIST, now, uuid } from "./util.js";

export type Role = "USER" | "ADMIN" | "SUPER_ADMIN";
/** MEMBER: full app. GUEST: self-signed-up, packages only. EXPIRED: member whose package ended — renew-only. */
export type Access = "MEMBER" | "GUEST" | "EXPIRED";
export interface AuthUser extends PublicUser {
  role: Role;
  userInfoId: string;
  locked: boolean;
  access: Access;
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
const INFO_COLS = ["id", "role", "locked", "membershipStatus", "membershipEndDate"] as const;

export async function ensureUserInfo(userId: string, email?: string) {
  const existing = await db.selectFrom("UserInfo").select(INFO_COLS).where("userId", "=", userId).executeTakeFirst();
  if (existing) return existing;
  let role: Role = "USER";
  let invited = false;
  if (email && env.superAdminEmail && email === env.superAdminEmail) (role = "SUPER_ADMIN"), (invited = true);
  else if (email) {
    const inv = await db.selectFrom("PendingInvitation").select(["role"]).where("email", "=", email).executeTakeFirst();
    if (inv) {
      role = inv.role as Role;
      invited = true;
      await db.deleteFrom("PendingInvitation").where("email", "=", email).execute();
    }
  }
  const row = { id: uuid(), userId, role, locked: false, updatedAt: now() };
  await db.insertInto("UserInfo").values(row).onConflict((oc) => oc.column("userId").doNothing()).execute();
  // Anyone who signs up without a gym invitation is a guest until the gym converts them.
  if (!invited) await db.insertInto("AppAccount").values({ id: uuid(), userId }).onConflict((oc) => oc.column("userId").doNothing()).execute();
  return (await db.selectFrom("UserInfo").select(INFO_COLS).where("userId", "=", userId).executeTakeFirstOrThrow());
}

const LIVE = ["ACTIVE", "PAUSED", "UPCOMING"];

/** Works out what the signed-in person may use. Admins always get the full app. */
export async function accessFor(userId: string, role: Role, info: { membershipStatus: string; membershipEndDate: Date | null }): Promise<Access> {
  if (isAdminRole(role)) return "MEMBER";
  const acct = await db.selectFrom("AppAccount").select("accountType").where("userId", "=", userId).executeTakeFirst();
  if (acct?.accountType === "GUEST" && !LIVE.includes(info.membershipStatus)) return "GUEST";
  if (info.membershipStatus === "EXPIRED" || info.membershipStatus === "CANCELLED") return "EXPIRED";
  if (info.membershipStatus === "ACTIVE" && info.membershipEndDate && daysRemainingIST(info.membershipEndDate) === 0 && info.membershipEndDate.getTime() < Date.now()) return "EXPIRED";
  return "MEMBER";
}

/** Paths a guest / expired member can still use (profile, packages, renewals, invoices, announcements). */
const OPEN_PATHS = [/^\/v1\/me(\/|$)/, /^\/v1\/packages(\/|$)/, /^\/v1\/enquiries(\/|$)/, /^\/v1\/announcements(\/|$)/, /^\/v1\/invoices(\/|$)/, /^\/v1\/uploads$/];

export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get("user");
  if (u.access !== "MEMBER" && !OPEN_PATHS.some((r) => r.test(c.req.path))) {
    if (u.access === "GUEST") throw new HttpError(403, "MEMBERS_ONLY", "Join a C7 package to unlock this.");
    throw new HttpError(423, "MEMBERSHIP_EXPIRED", "Your package has ended. Renew to continue.");
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  const userId = await userIdFromToken(token);
  const profile = await getUser(userId);
  const info = await ensureUserInfo(userId, profile.email);
  if (info.locked) throw new HttpError(423, "ACCOUNT_LOCKED", "Your account is locked. Please contact your gym.");
  const access = await accessFor(userId, info.role as Role, info);
  c.set("user", { ...profile, role: info.role as Role, userInfoId: info.id, locked: info.locked, access });
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get("user");
  if (u.role !== "ADMIN" && u.role !== "SUPER_ADMIN") throw forbidden("Admin access required");
  await next();
};

export const isAdminRole = (r: Role) => r === "ADMIN" || r === "SUPER_ADMIN";
