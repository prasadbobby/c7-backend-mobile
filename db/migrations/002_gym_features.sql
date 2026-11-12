-- C7 mobile: packages & guest accounts, invoices, attendance, announcements,
-- medical reports, workout videos, progress photos and check-up schedules.
-- Prisma-style naming so FitForge's schema.prisma models the same tables. Idempotent.
-- Only NEW tables (plus a column on the C7-owned MealLog) — FitForge's existing tables are untouched.

-- Self-signed-up ("normal") users. Members invited by the gym have no row here.
CREATE TABLE IF NOT EXISTS "AppAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountType" TEXT NOT NULL DEFAULT 'GUEST',
  "source" TEXT NOT NULL DEFAULT 'SELF_SIGNUP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "convertedAt" TIMESTAMP(3),
  "convertedBy" TEXT,
  CONSTRAINT "AppAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppAccount_type_check" CHECK ("accountType" IN ('GUEST','MEMBER'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppAccount_userId_key" ON "AppAccount"("userId");

CREATE TABLE IF NOT EXISTS "Package" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'OFFLINE',
  "durationDays" INTEGER NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "offerPrice" DOUBLE PRECISION,
  "description" TEXT,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "imageUrl" TEXT,
  "highlight" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Package_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Package_mode_check" CHECK ("mode" IN ('ONLINE','OFFLINE'))
);
CREATE INDEX IF NOT EXISTS "Package_isActive_sortOrder_idx" ON "Package"("isActive", "sortOrder");

CREATE TABLE IF NOT EXISTS "PackageEnquiry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "phone" TEXT,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "handledBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageEnquiry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackageEnquiry_status_check" CHECK ("status" IN ('NEW','CONTACTED','CONVERTED','CLOSED'))
);
CREATE INDEX IF NOT EXISTS "PackageEnquiry_status_idx" ON "PackageEnquiry"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PackageEnquiry_userId_idx" ON "PackageEnquiry"("userId");

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentLogId" TEXT,
  "packageId" TEXT REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "description" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "subtotal" DOUBLE PRECISION NOT NULL,
  "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL,
  "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DUE',
  "paymentMethod" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_status_check" CHECK ("status" IN ('DUE','PAID','PARTIAL','VOID'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_paymentLogId_key" ON "Invoice"("paymentLogId");
CREATE INDEX IF NOT EXISTS "Invoice_userId_issuedAt_idx" ON "Invoice"("userId", "issuedAt");

CREATE TABLE IF NOT EXISTS "Attendance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PRESENT',
  "checkInAt" TIMESTAMP(3),
  "markedBy" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Attendance_status_check" CHECK ("status" IN ('PRESENT','ABSENT','LEAVE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_userId_date_key" ON "Attendance"("userId", "date");
CREATE INDEX IF NOT EXISTS "Attendance_date_idx" ON "Attendance"("date");

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'GENERAL',
  "imageUrl" TEXT,
  "audience" TEXT NOT NULL DEFAULT 'MEMBERS',
  "targetUserId" TEXT,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Announcement_audience_check" CHECK ("audience" IN ('ALL','MEMBERS','GUESTS','USER')),
  CONSTRAINT "Announcement_kind_check" CHECK ("kind" IN ('GENERAL','EVENT','OFFER','PAYMENT','CLOSURE'))
);
CREATE INDEX IF NOT EXISTS "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");
CREATE INDEX IF NOT EXISTS "Announcement_targetUserId_idx" ON "Announcement"("targetUserId");

CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementRead_userId_announcementId_key" ON "AnnouncementRead"("userId", "announcementId");

CREATE TABLE IF NOT EXISTS "MedicalReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "fileUrl" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicalReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicalReport_category_check" CHECK ("category" IN ('BLOOD','SCAN','PRESCRIPTION','FITNESS','OTHER'))
);
CREATE INDEX IF NOT EXISTS "MedicalReport_userId_reportDate_idx" ON "MedicalReport"("userId", "reportDate");

CREATE TABLE IF NOT EXISTS "WorkoutVideo" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'strength',
  "videoUrl" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "durationSec" INTEGER NOT NULL DEFAULT 0,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "exerciseId" TEXT,
  "isAnimated" BOOLEAN NOT NULL DEFAULT false,
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkoutVideo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutVideo_category_check" CHECK ("category" IN ('warmup','cardio','strength','mobility','core','other'))
);
CREATE INDEX IF NOT EXISTS "WorkoutVideo_published_idx" ON "WorkoutVideo"("isPublished", "sortOrder");
CREATE INDEX IF NOT EXISTS "WorkoutVideo_exerciseId_idx" ON "WorkoutVideo"("exerciseId");

CREATE TABLE IF NOT EXISTS "ProgressPhoto" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "pose" TEXT NOT NULL DEFAULT 'FRONT',
  "takenAt" TIMESTAMP(3) NOT NULL,
  "weight" DOUBLE PRECISION,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressPhoto_pose_check" CHECK ("pose" IN ('FRONT','SIDE','BACK'))
);
CREATE INDEX IF NOT EXISTS "ProgressPhoto_userId_takenAt_idx" ON "ProgressPhoto"("userId", "takenAt");

-- Next BMI / measurement check-up, set by the coach (or defaulted to monthly).
CREATE TABLE IF NOT EXISTS "CheckupSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "intervalDays" INTEGER NOT NULL DEFAULT 30,
  "nextDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "setBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckupSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CheckupSchedule_userId_key" ON "CheckupSchedule"("userId");

ALTER TABLE "MealLog" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
