import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { USERS, auth } from "../fixtures";

type Who = keyof typeof USERS;
export const test = base.extend<{ as: (who: Who) => Promise<APIRequestContext> }>({
  as: async ({ playwright, baseURL }, use) => {
    const ctxs: APIRequestContext[] = [];
    await use(async (who) => {
      const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: auth(who) });
      // Register every Clerk-side profile (names/emails) in the server's test directory.
      for (const u of Object.values(USERS)) {
        await ctx.post("/__test/users", { data: { userId: u.userId, firstName: u.firstName, lastName: u.lastName, email: u.email } });
      }
      ctxs.push(ctx);
      return ctx;
    });
    for (const c of ctxs) await c.dispose();
  },
});
export { expect };
