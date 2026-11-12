import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TEST_DB, USERS } from "./fixtures";

/** Fresh database per run: FitForge schema + C7 migrations + seed + scenario data. */
export default async function globalSetup() {
  const admin = new pg.Client({ connectionString: TEST_DB.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS c7test WITH (FORCE)`);
  await admin.end();
  execSync(`npx tsx scripts/db-setup.ts --seed`, { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "inherit" });

  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const day = 86400000;

  // Members (UserInfo) — the admin and members exist; the "newbie" has only a pending invitation.
  for (const [k, u] of Object.entries(USERS)) {
    if (k === "newbie" || k === "guest") continue;
    await q(`INSERT INTO "UserInfo"(id,"userId","c7UserId",role,locked,age,height,weight,"membershipStartDate","membershipEndDate","membershipDuration","membershipStatus","packagePrice","discountedPrice","totalAmountPaid","remainingAmount","nextPaymentDue","updatedAt")
             VALUES ($1,$2,$3,$4,$5,34,168,49,$6,$7,90,'ACTIVE',45000,40000,30000,10000,$8,now())`, [
      randomUUID(), u.userId, `C7${String(Object.keys(USERS).indexOf(k) + 1).padStart(4, "0")}`, k === "admin" ? "SUPER_ADMIN" : "USER", k === "locked",
      new Date(Date.now() - 85 * day), new Date(Date.now() + (k === "expired" ? -2 : 5) * day), new Date(Date.now() + 2 * day),
    ]);
  }
  await q(`INSERT INTO "PendingInvitation"(id,email,role,"updatedAt") VALUES ($1,'invited@c7.test','USER',now())`, [randomUUID()]);
  const memberInfo = (await q(`SELECT id FROM "UserInfo" WHERE "userId"=$1`, [USERS.member.userId])).rows[0].id;
  await q(`INSERT INTO "PaymentLog"(id,"userInfoId",amount,"paymentDate","paymentMethod","recordedBy","updatedAt") VALUES ($1,$2,30000,now() - interval '80 days','UPI',$3,now())`, [randomUUID(), memberInfo, USERS.admin.userId]);
  await q(`INSERT INTO "MembershipLog"(id,"userInfoId","changeType","newStatus","changeDate","recordedBy","updatedAt") VALUES ($1,$2,'INITIAL_SETUP','ACTIVE',now() - interval '85 days',$3,now())`, [randomUUID(), memberInfo, USERS.admin.userId]);

  // Assigned workout (system plan) for the member.
  const plan = (await q(`SELECT id FROM "WorkoutPlan" WHERE name='Full Body Foundations'`)).rows[0].id;
  await q(`INSERT INTO "AssignedWorkout"(id,"userId","workoutPlanId","assignedBy",status,notes) VALUES ('assign_1',$1,$2,$3,'PENDING','Focus on depth')`, [USERS.member.userId, plan, USERS.admin.userId]);
  await q(`INSERT INTO "RestTimer"(id,"workoutPlanId","defaultRestSeconds") VALUES ($1,$2,75)`, [randomUUID(), plan]);

  // Step goal for the member.
  await q(`INSERT INTO "StepGoal"(id,"userId","assignedBy","dailyTarget","updatedAt") VALUES ($1,$2,$3,8000,now())`, [randomUUID(), USERS.member.userId, USERS.admin.userId]);

  // 90-day challenge: member + buddy enabled, buddy has a post with a photo yesterday.
  const ch = (await q(`SELECT id FROM "NinetyDayChallenge" LIMIT 1`)).rows[0].id;
  await q(`INSERT INTO "NinetyDayChallengeParticipant"(id,"userId","challengeId","isEnabled","joinedAt") VALUES ('part_member',$1,$2,true,now() - interval '6 days'),('part_buddy',$3,$2,true,now() - interval '6 days')`, [USERS.member.userId, ch, USERS.buddy.userId]);
  const y = new Date(Date.now() - day);
  const yNoon = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 12));
  await q(`INSERT INTO "NinetyDayChallengePost"(id,"userId","challengeId","participantId",date,"sleepHours","sleepQuality",mood,energy,"dayDescription",photos,"updatedAt")
           VALUES ('post_buddy_1',$1,$2,'part_buddy',$3,8,'GOOD','GOOD','HIGH','Leg day done',ARRAY['data:image/png;base64,iVBORw0KGgo='],now())`, [USERS.buddy.userId, ch, yNoon]);

  // Nutrition goal assigned by admin.
  await q(`INSERT INTO "NutritionGoal"(id,"userId",kcal,protein,carbs,fat,"waterMl","assignedBy") VALUES ($1,$2,1800,110,200,60,2500,$3)`, [randomUUID(), USERS.member.userId, USERS.admin.userId]);
  await c.end();
}
