/** Saves every member's Clerk name/email/photo into "UserProfile" so names show everywhere. Safe to re-run. */
import { db } from "../src/db/index.js";
import { getUsers, rememberProfile } from "../src/lib/users.js";

const ids = (await db.selectFrom("UserInfo").select("userId").execute()).map((r) => r.userId);
const users = await getUsers(ids);
let named = 0;
for (const u of users.values()) {
  if (u.firstName === "Unknown" && u.lastName === "User") continue;
  await rememberProfile(u, true);
  named++;
}
console.log(`profiles: ${named}/${ids.length} members have a name${named < ids.length ? " (the rest aren't in any configured Clerk instance)" : ""}`);
await db.destroy();
