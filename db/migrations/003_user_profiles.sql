-- Name/email/photo snapshot of every person who uses C7 (mobile app or admin), keyed by Clerk user id.
-- Clerk user ids belong to one Clerk instance; this lets names still show when a database is read
-- through a different instance (e.g. local development against staging data) or a user is deleted in Clerk.
CREATE TABLE IF NOT EXISTS "UserProfile" (
  "userId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL DEFAULT '',
  "lastName" TEXT NOT NULL DEFAULT '',
  "username" TEXT NOT NULL DEFAULT '',
  "email" TEXT,
  "imageUrl" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);
CREATE INDEX IF NOT EXISTS "UserProfile_email_idx" ON "UserProfile"("email");
