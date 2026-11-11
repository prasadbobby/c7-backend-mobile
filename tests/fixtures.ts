export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/c7test";
export const USERS = {
  member: { userId: "user_member_1", firstName: "Emma", lastName: "Richardson", email: "emma@c7.test" },
  buddy: { userId: "user_member_2", firstName: "Regina", lastName: "Fly", email: "regina@c7.test" },
  admin: { userId: "user_admin_1", firstName: "Coach", lastName: "Prasad", email: "coach@c7.test" },
  newbie: { userId: "user_new_1", firstName: "Nina", lastName: "New", email: "invited@c7.test" },
  locked: { userId: "user_locked_1", firstName: "Lou", lastName: "Locked", email: "locked@c7.test" },
} as const;
export const token = (k: keyof typeof USERS) => `test_${USERS[k].userId}`;
export const auth = (k: keyof typeof USERS) => ({ Authorization: `Bearer ${token(k)}` });
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
