CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ONLINE', 'CARD', 'UPI', 'BANK_TRANSFER', 'CHEQUE');
CREATE TYPE "GoalType" AS ENUM ('WEIGHT');
CREATE TYPE "TrackingType" AS ENUM ('reps', 'duration');
CREATE TYPE "TrainingType" AS ENUM ('ENDURANCE', 'HYPERTROPHY', 'STRENGTH', 'POWER', 'TONING', 'FUNCTIONAL');
CREATE TYPE "CategoryType" AS ENUM ('strength', 'stretching', 'plyometrics', 'strongman', 'powerlifting', 'cardio', 'olympic weightlifting');
CREATE TYPE "EquipmentType" AS ENUM ('body only', 'machine', 'other', 'foam roll', 'kettlebells', 'dumbbell', 'cable', 'barbell', 'bands', 'medicine ball', 'exercise ball', 'e-z curl bar');
CREATE TYPE "ForceType" AS ENUM ('pull', 'push', 'static');
CREATE TYPE "LevelType" AS ENUM ('beginner', 'intermediate', 'expert');
CREATE TYPE "MechanicType" AS ENUM ('compound', 'isolation');
CREATE TYPE "Muscle" AS ENUM ('abdominals', 'hamstrings', 'adductors', 'quadriceps', 'biceps', 'shoulders', 'chest', 'middle back', 'calves', 'glutes', 'lower back', 'lats', 'triceps', 'traps', 'forearms', 'neck', 'abductors');
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED', 'SUSPENDED', 'PAUSED', 'UPCOMING', 'CANCELLED');
CREATE TYPE "MembershipChangeType" AS ENUM ('STATUS_CHANGE', 'DATE_CHANGE', 'DURATION_CHANGE', 'FULL_UPDATE', 'INITIAL_SETUP', 'EXTENSION', 'RENEWAL', 'CANCELLATION', 'PAUSE', 'RESUME', 'EARLY_CANCELLATION', 'REACTIVATION', 'SUSPENSION');
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'ABSENT');
CREATE TYPE "SleepQuality" AS ENUM ('POOR', 'FAIR', 'GOOD', 'VERY_GOOD', 'EXCELLENT');
CREATE TYPE "MoodType" AS ENUM ('VERY_LOW', 'LOW', 'NEUTRAL', 'GOOD', 'VERY_GOOD', 'EXCELLENT');
CREATE TYPE "EnergyLevel" AS ENUM ('VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'LOVE', 'SUPPORT', 'STRONG', 'FIRE', 'CLAP');
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RESTING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ParticipantStatus" AS ENUM ('JOINED', 'WORKING_OUT', 'RESTING', 'ON_BREAK', 'LEFT');
CREATE TYPE "TimerType" AS ENUM ('WORKOUT', 'REST', 'EXERCISE', 'SET');
CREATE TYPE "FitnessDataType" AS ENUM ('STEPS', 'HEART_RATE', 'CALORIES_BURNED', 'DISTANCE', 'SLEEP', 'WEIGHT', 'BODY_FAT', 'ACTIVE_MINUTES', 'WORKOUT_SESSION');
CREATE TYPE "FitnessSyncType" AS ENUM ('MANUAL', 'SCHEDULED', 'INITIAL', 'INCREMENTAL', 'FULL_RESYNC');
CREATE TYPE "FitnessSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "StepDataSource" AS ENUM ('MANUAL', 'GOOGLE_FIT', 'HEALTH_CONNECT', 'FITBIT');
CREATE TYPE "MeasurementType" AS ENUM ('METABOLIC_AGE', 'HEIGHT', 'WEIGHT', 'BODY_FAT_PERCENTAGE', 'VISCERAL_FAT', 'SKELETAL_MUSCLE_MASS', 'FAT_MASS', 'NECK', 'SHOULDERS', 'CHEST', 'UPPER_ARM_RIGHT', 'UPPER_ARM_LEFT', 'FOREARM_RIGHT', 'FOREARM_LEFT', 'WRIST', 'WAIST', 'ABDOMEN', 'HIPS', 'THIGH_RIGHT', 'THIGH_LEFT', 'CALF_RIGHT', 'CALF_LEFT');
CREATE TABLE "UserInfo" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "c7UserId" TEXT,
  "age" INTEGER,
  "height" DOUBLE PRECISION,
  "weight" DOUBLE PRECISION,
  "dateOfBirth" TIMESTAMP(3),
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "membershipStartDate" TIMESTAMP(3),
  "membershipEndDate" TIMESTAMP(3),
  "membershipDuration" INTEGER,
  "membershipStatus" "MembershipStatus" NOT NULL DEFAULT 'INACTIVE',
  "membershipSetBy" TEXT,
  "membershipNotes" TEXT,
  "pausedFrom" TIMESTAMP(3),
  "pausedUntil" TIMESTAMP(3),
  "totalPausedDays" INTEGER DEFAULT 0,
  "pauseReason" TEXT,
  "originalEndDate" TIMESTAMP(3),
  "upcomingStartDate" TIMESTAMP(3),
  "upcomingEndDate" TIMESTAMP(3),
  "upcomingDuration" INTEGER,
  "upcomingNotes" TEXT,
  "packagePrice" DOUBLE PRECISION,
  "initialOfferedPrice" DOUBLE PRECISION,
  "discountedPrice" DOUBLE PRECISION,
  "totalAmountPaid" DOUBLE PRECISION DEFAULT 0,
  "remainingAmount" DOUBLE PRECISION,
  "nextPaymentDue" TIMESTAMP(3),
  "paymentNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserInfo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserInfo_userId_key" ON "UserInfo"("userId");
CREATE UNIQUE INDEX "UserInfo_c7UserId_key" ON "UserInfo"("c7UserId");
CREATE TABLE "PaymentLog" (
  "id" TEXT NOT NULL,
  "userInfoId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "transactionId" TEXT,
  "notes" TEXT,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentLog_userInfoId_paymentDate_idx" ON "PaymentLog"("userInfoId", "paymentDate");
CREATE INDEX "PaymentLog_paymentDate_idx" ON "PaymentLog"("paymentDate");
CREATE TABLE "MembershipLog" (
  "id" TEXT NOT NULL,
  "userInfoId" TEXT NOT NULL,
  "changeType" "MembershipChangeType" NOT NULL,
  "previousStatus" "MembershipStatus",
  "newStatus" "MembershipStatus",
  "previousStartDate" TIMESTAMP(3),
  "newStartDate" TIMESTAMP(3),
  "previousEndDate" TIMESTAMP(3),
  "newEndDate" TIMESTAMP(3),
  "previousDuration" INTEGER,
  "newDuration" INTEGER,
  "changeDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MembershipLog_userInfoId_changeDate_idx" ON "MembershipLog"("userInfoId", "changeDate");
CREATE INDEX "MembershipLog_changeDate_idx" ON "MembershipLog"("changeDate");
CREATE INDEX "MembershipLog_changeType_idx" ON "MembershipLog"("changeType");
CREATE TABLE "PendingInvitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "invitationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PendingInvitation_email_key" ON "PendingInvitation"("email");
CREATE TABLE "AssignedWorkout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workoutPlanId" TEXT NOT NULL,
  "assignedBy" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "dueDate" TIMESTAMP(3),
  CONSTRAINT "AssignedWorkout_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Exercise" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "primary_muscles" "Muscle"[] NOT NULL DEFAULT ARRAY[]::"Muscle"[],
  "secondary_muscles" "Muscle"[] NOT NULL DEFAULT ARRAY[]::"Muscle"[],
  "force" "ForceType",
  "level" "LevelType" NOT NULL,
  "mechanic" "MechanicType",
  "equipment" "EquipmentType",
  "category" "CategoryType" NOT NULL,
  "instructions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "description" TEXT,
  "tips" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "image" TEXT,
  "date_created" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_updated" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FavouriteExercise" (
  "userId" TEXT NOT NULL,
  "favouritedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exerciseId" TEXT NOT NULL,
  CONSTRAINT "FavouriteExercise_pkey" PRIMARY KEY ("userId", "exerciseId")
);
CREATE TABLE "WorkoutPlan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "trainingType" "TrainingType",
  CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkoutPlanExercise" (
  "id" TEXT NOT NULL,
  "workoutPlanId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "sets" INTEGER NOT NULL,
  "reps" INTEGER,
  "exerciseDuration" INTEGER,
  "order" INTEGER,
  "trackingType" "TrackingType" NOT NULL,
  CONSTRAINT "WorkoutPlanExercise_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkoutLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workoutPlanId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "duration" INTEGER NOT NULL,
  "inProgress" BOOLEAN NOT NULL DEFAULT true,
  "totalRestTimeSeconds" INTEGER DEFAULT 0,
  "totalActiveTimeSeconds" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_updated" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkoutLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkoutLogExercise" (
  "id" TEXT NOT NULL,
  "workoutLogId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "trackingType" "TrackingType" NOT NULL,
  CONSTRAINT "WorkoutLogExercise_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SetLog" (
  "id" TEXT NOT NULL,
  "workoutLogExerciseId" TEXT NOT NULL,
  "weight" DOUBLE PRECISION,
  "reps" INTEGER,
  "exerciseDuration" INTEGER,
  "order" INTEGER,
  "isWarmUp" BOOLEAN NOT NULL DEFAULT false,
  "restTimeSeconds" INTEGER,
  "restStartTime" TIMESTAMP(3),
  "restEndTime" TIMESTAMP(3),
  "setStartTime" TIMESTAMP(3),
  "setEndTime" TIMESTAMP(3),
  CONSTRAINT "SetLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UserExercisePB" (
  "userId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "reps" INTEGER,
  "exerciseDuration" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workoutLogId" TEXT,
  CONSTRAINT "UserExercisePB_pkey" PRIMARY KEY ("userId", "exerciseId")
);
CREATE TABLE "UserGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "goalType" "GoalType" NOT NULL,
  "goalValue" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserGoal_userId_exerciseId_goalType_key" ON "UserGoal"("userId", "exerciseId", "goalType");
CREATE TABLE "UserEquipment" (
  "userId" TEXT NOT NULL,
  "equipmentType" "EquipmentType" NOT NULL,
  CONSTRAINT "UserEquipment_pkey" PRIMARY KEY ("userId", "equipmentType")
);
CREATE TABLE "StepGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedBy" TEXT NOT NULL,
  "dailyTarget" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StepGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StepGoal_userId_isActive_idx" ON "StepGoal"("userId", "isActive");
CREATE TABLE "StepLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stepGoalId" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "actualSteps" INTEGER NOT NULL,
  "targetSteps" INTEGER NOT NULL,
  "carryOverSteps" INTEGER NOT NULL DEFAULT 0,
  "excessSteps" INTEGER NOT NULL DEFAULT 0,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "googleFitDataId" TEXT,
  "fitbitConnectionId" TEXT,
  "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StepLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepLog_userId_date_key" ON "StepLog"("userId", "date");
CREATE INDEX "StepLog_userId_date_idx" ON "StepLog"("userId", "date");
CREATE INDEX "StepLog_dataSource_idx" ON "StepLog"("dataSource");
CREATE TABLE "StepChallenge" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "targetSteps" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StepChallenge_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StepChallengeParticipant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalSteps" INTEGER NOT NULL DEFAULT 0,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "StepChallengeParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepChallengeParticipant_userId_challengeId_key" ON "StepChallengeParticipant"("userId", "challengeId");
CREATE INDEX "StepChallengeParticipant_challengeId_totalSteps_idx" ON "StepChallengeParticipant"("challengeId", "totalSteps");
CREATE TABLE "NinetyDayChallenge" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NinetyDayChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NinetyDayChallenge_isActive_startDate_idx" ON "NinetyDayChallenge"("isActive", "startDate");
CREATE TABLE "NinetyDayChallengeParticipant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedDays" INTEGER NOT NULL DEFAULT 0,
  "lastActiveDate" TIMESTAMP(3),
  CONSTRAINT "NinetyDayChallengeParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NinetyDayChallengeParticipant_userId_challengeId_key" ON "NinetyDayChallengeParticipant"("userId", "challengeId");
CREATE INDEX "NinetyDayChallengeParticipant_challengeId_isEnabled_idx" ON "NinetyDayChallengeParticipant"("challengeId", "isEnabled");
CREATE TABLE "NinetyDayChallengePost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "sleepHours" DOUBLE PRECISION,
  "sleepQuality" "SleepQuality",
  "mealTracking" TEXT,
  "dayDescription" TEXT,
  "mood" "MoodType",
  "energy" "EnergyLevel",
  "achievements" TEXT,
  "challenges" TEXT,
  "isFasting" BOOLEAN,
  "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "pinnedAt" TIMESTAMP(3),
  "pinnedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NinetyDayChallengePost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NinetyDayChallengePost_userId_challengeId_date_key" ON "NinetyDayChallengePost"("userId", "challengeId", "date");
CREATE INDEX "NinetyDayChallengePost_challengeId_date_idx" ON "NinetyDayChallengePost"("challengeId", "date");
CREATE INDEX "NinetyDayChallengePost_userId_date_idx" ON "NinetyDayChallengePost"("userId", "date");
CREATE INDEX "NinetyDayChallengePost_challengeId_isPinned_pinnedAt_idx" ON "NinetyDayChallengePost"("challengeId", "isPinned", "pinnedAt");
CREATE TABLE "NinetyDayChallengeReaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "reactionType" "ReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NinetyDayChallengeReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NinetyDayChallengeReaction_userId_postId_reactionType_key" ON "NinetyDayChallengeReaction"("userId", "postId", "reactionType");
CREATE INDEX "NinetyDayChallengeReaction_postId_reactionType_idx" ON "NinetyDayChallengeReaction"("postId", "reactionType");
CREATE TABLE "NinetyDayChallengeComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "participantId" TEXT,
  "content" TEXT NOT NULL,
  "parentCommentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NinetyDayChallengeComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NinetyDayChallengeComment_postId_idx" ON "NinetyDayChallengeComment"("postId");
CREATE INDEX "NinetyDayChallengeComment_userId_idx" ON "NinetyDayChallengeComment"("userId");
CREATE INDEX "NinetyDayChallengeComment_parentCommentId_idx" ON "NinetyDayChallengeComment"("parentCommentId");
CREATE TABLE "NinetyDayChallengeCommentReaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "reactionType" "ReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NinetyDayChallengeCommentReaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NinetyDayChallengeCommentReaction_userId_commentId_reactionType_key" ON "NinetyDayChallengeCommentReaction"("userId", "commentId", "reactionType");
CREATE INDEX "NinetyDayChallengeCommentReaction_commentId_reactionType_idx" ON "NinetyDayChallengeCommentReaction"("commentId", "reactionType");
CREATE TABLE "NinetyDayChallengePostView" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NinetyDayChallengePostView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NinetyDayChallengePostView_userId_postId_key" ON "NinetyDayChallengePostView"("userId", "postId");
CREATE INDEX "NinetyDayChallengePostView_postId_idx" ON "NinetyDayChallengePostView"("postId");
CREATE INDEX "NinetyDayChallengePostView_userId_idx" ON "NinetyDayChallengePostView"("userId");
CREATE TABLE "SuperAdminAuth" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT,
  "otpSecret" TEXT,
  "otpExpiry" TIMESTAMP(3),
  "lastLogin" TIMESTAMP(3),
  "loginAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuperAdminAuth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SuperAdminAuth_userId_key" ON "SuperAdminAuth"("userId");
CREATE UNIQUE INDEX "SuperAdminAuth_email_key" ON "SuperAdminAuth"("email");
CREATE INDEX "SuperAdminAuth_email_idx" ON "SuperAdminAuth"("email");
CREATE INDEX "SuperAdminAuth_userId_idx" ON "SuperAdminAuth"("userId");
CREATE TABLE "UserTrainingProgression" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trainingType" "TrainingType" NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3),
  "targetWeeks" INTEGER NOT NULL DEFAULT 4,
  "actualWeeks" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "assignedBy" TEXT NOT NULL,
  "notes" TEXT,
  "completionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTrainingProgression_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserTrainingProgression_userId_isActive_idx" ON "UserTrainingProgression"("userId", "isActive");
CREATE INDEX "UserTrainingProgression_trainingType_isActive_idx" ON "UserTrainingProgression"("trainingType", "isActive");
CREATE TABLE "WorkoutSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workoutLogId" TEXT,
  "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pausedTime" TIMESTAMP(3),
  "currentExerciseId" TEXT,
  "currentSetIndex" INTEGER NOT NULL DEFAULT 0,
  "restTimerStartTime" TIMESTAMP(3),
  "restTimerDuration" INTEGER,
  "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkoutSession_userId_status_idx" ON "WorkoutSession"("userId", "status");
CREATE INDEX "WorkoutSession_status_lastActivity_idx" ON "WorkoutSession"("status", "lastActivity");
CREATE TABLE "GymSession" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endTime" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "maxParticipants" INTEGER NOT NULL DEFAULT 50,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GymSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GymSession_adminUserId_isActive_idx" ON "GymSession"("adminUserId", "isActive");
CREATE INDEX "GymSession_isActive_startTime_idx" ON "GymSession"("isActive", "startTime");
CREATE TABLE "GymSessionParticipant" (
  "id" TEXT NOT NULL,
  "gymSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workoutSessionId" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "status" "ParticipantStatus" NOT NULL DEFAULT 'JOINED',
  CONSTRAINT "GymSessionParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GymSessionParticipant_gymSessionId_userId_key" ON "GymSessionParticipant"("gymSessionId", "userId");
CREATE INDEX "GymSessionParticipant_gymSessionId_status_idx" ON "GymSessionParticipant"("gymSessionId", "status");
CREATE INDEX "GymSessionParticipant_userId_status_idx" ON "GymSessionParticipant"("userId", "status");
CREATE TABLE "RestTimer" (
  "id" TEXT NOT NULL,
  "exerciseId" TEXT,
  "workoutPlanId" TEXT,
  "defaultRestSeconds" INTEGER NOT NULL DEFAULT 60,
  "minRestSeconds" INTEGER NOT NULL DEFAULT 30,
  "maxRestSeconds" INTEGER NOT NULL DEFAULT 300,
  "autoStart" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestTimer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RestTimer_exerciseId_idx" ON "RestTimer"("exerciseId");
CREATE INDEX "RestTimer_workoutPlanId_idx" ON "RestTimer"("workoutPlanId");
CREATE TABLE "SessionTimer" (
  "id" TEXT NOT NULL,
  "workoutSessionId" TEXT NOT NULL,
  "timerType" "TimerType" NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endTime" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "duration" INTEGER NOT NULL DEFAULT 0,
  "targetDuration" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "exerciseId" TEXT,
  "setNumber" INTEGER,
  CONSTRAINT "SessionTimer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SessionTimer_workoutSessionId_timerType_idx" ON "SessionTimer"("workoutSessionId", "timerType");
CREATE INDEX "SessionTimer_isActive_timerType_idx" ON "SessionTimer"("isActive", "timerType");
CREATE TABLE "GoogleFitnessConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "tokenExpiry" TIMESTAMP(3) NOT NULL,
  "isConnected" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3),
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleFitnessConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleFitnessConnection_userId_key" ON "GoogleFitnessConnection"("userId");
CREATE INDEX "GoogleFitnessConnection_userId_isConnected_idx" ON "GoogleFitnessConnection"("userId", "isConnected");
CREATE TABLE "GoogleFitnessData" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "dataType" "FitnessDataType" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT,
  "startTime" TIMESTAMP(3),
  "endTime" TIMESTAMP(3),
  "sourceAppName" TEXT,
  "sourceDataStreamId" TEXT,
  "isProcessed" BOOLEAN NOT NULL DEFAULT false,
  "rawData" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleFitnessData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleFitnessData_userId_dataType_date_startTime_key" ON "GoogleFitnessData"("userId", "dataType", "date", "startTime");
CREATE INDEX "GoogleFitnessData_userId_dataType_date_idx" ON "GoogleFitnessData"("userId", "dataType", "date");
CREATE INDEX "GoogleFitnessData_connectionId_isProcessed_idx" ON "GoogleFitnessData"("connectionId", "isProcessed");
CREATE TABLE "FitnessDataSync" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "syncType" "FitnessSyncType" NOT NULL,
  "status" "FitnessSyncStatus" NOT NULL DEFAULT 'PENDING',
  "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endTime" TIMESTAMP(3),
  "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "syncPeriodStart" TIMESTAMP(3) NOT NULL,
  "syncPeriodEnd" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FitnessDataSync_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FitnessDataSync_userId_status_idx" ON "FitnessDataSync"("userId", "status");
CREATE INDEX "FitnessDataSync_syncType_status_idx" ON "FitnessDataSync"("syncType", "status");
CREATE TABLE "FitbitConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "tokenExpiry" TIMESTAMP(3) NOT NULL,
  "isConnected" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3),
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FitbitConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FitbitConnection_userId_key" ON "FitbitConnection"("userId");
CREATE INDEX "FitbitConnection_userId_isConnected_idx" ON "FitbitConnection"("userId", "isConnected");
CREATE TABLE "HeartRateData" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "averageHeartRate" DOUBLE PRECISION,
  "maxHeartRate" DOUBLE PRECISION,
  "minHeartRate" DOUBLE PRECISION,
  "restingHeartRate" DOUBLE PRECISION,
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "googleFitDataId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HeartRateData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HeartRateData_userId_date_key" ON "HeartRateData"("userId", "date");
CREATE INDEX "HeartRateData_userId_date_idx" ON "HeartRateData"("userId", "date");
CREATE TABLE "CaloriesData" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "caloriesBurned" DOUBLE PRECISION NOT NULL,
  "activeCalories" DOUBLE PRECISION,
  "restingCalories" DOUBLE PRECISION,
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "googleFitDataId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CaloriesData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaloriesData_userId_date_key" ON "CaloriesData"("userId", "date");
CREATE INDEX "CaloriesData_userId_date_idx" ON "CaloriesData"("userId", "date");
CREATE TABLE "SleepData" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "sleepDuration" DOUBLE PRECISION,
  "deepSleep" DOUBLE PRECISION,
  "lightSleep" DOUBLE PRECISION,
  "remSleep" DOUBLE PRECISION,
  "sleepEfficiency" DOUBLE PRECISION,
  "bedTime" TIMESTAMP(3),
  "wakeTime" TIMESTAMP(3),
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "googleFitDataId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SleepData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SleepData_userId_date_key" ON "SleepData"("userId", "date");
CREATE INDEX "SleepData_userId_date_idx" ON "SleepData"("userId", "date");
CREATE TABLE "DistanceData" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "totalDistance" DOUBLE PRECISION NOT NULL,
  "walkingDistance" DOUBLE PRECISION,
  "runningDistance" DOUBLE PRECISION,
  "cyclingDistance" DOUBLE PRECISION,
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "googleFitDataId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DistanceData_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistanceData_userId_date_key" ON "DistanceData"("userId", "date");
CREATE INDEX "DistanceData_userId_date_idx" ON "DistanceData"("userId", "date");
CREATE TABLE "BodyMeasurement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "measurementType" "MeasurementType" NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "recordedDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "dataSource" "StepDataSource" NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BodyMeasurement_userId_measurementType_recordedDate_key" ON "BodyMeasurement"("userId", "measurementType", "recordedDate");
CREATE INDEX "BodyMeasurement_userId_measurementType_idx" ON "BodyMeasurement"("userId", "measurementType");
CREATE INDEX "BodyMeasurement_userId_recordedDate_idx" ON "BodyMeasurement"("userId", "recordedDate");
CREATE TABLE "MeasurementGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "measurementType" "MeasurementType" NOT NULL,
  "targetValue" DOUBLE PRECISION NOT NULL,
  "currentValue" DOUBLE PRECISION,
  "targetDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeasurementGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MeasurementGoal_userId_measurementType_key" ON "MeasurementGoal"("userId", "measurementType");
CREATE INDEX "MeasurementGoal_userId_isActive_idx" ON "MeasurementGoal"("userId", "isActive");
CREATE TABLE "MonthlyExpense" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "rent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salaries" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "electricity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "internetMaintenance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "miscellaneous" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "customExpenses" JSONB DEFAULT '[]'::jsonb,
  "totalExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonthlyExpense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonthlyExpense_month_year_key" ON "MonthlyExpense"("month", "year");
CREATE INDEX "MonthlyExpense_year_idx" ON "MonthlyExpense"("year");
CREATE INDEX "MonthlyExpense_month_year_idx" ON "MonthlyExpense"("month", "year");
ALTER TABLE "PaymentLog" ADD FOREIGN KEY ("userInfoId") REFERENCES "UserInfo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipLog" ADD FOREIGN KEY ("userInfoId") REFERENCES "UserInfo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignedWorkout" ADD FOREIGN KEY ("userId") REFERENCES "UserInfo"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignedWorkout" ADD FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FavouriteExercise" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlanExercise" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlanExercise" ADD FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutLog" ADD FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutLogExercise" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkoutLogExercise" ADD FOREIGN KEY ("workoutLogId") REFERENCES "WorkoutLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetLog" ADD FOREIGN KEY ("workoutLogExerciseId") REFERENCES "WorkoutLogExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserExercisePB" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserExercisePB" ADD FOREIGN KEY ("workoutLogId") REFERENCES "WorkoutLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGoal" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StepLog" ADD FOREIGN KEY ("stepGoalId") REFERENCES "StepGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepLog" ADD FOREIGN KEY ("fitbitConnectionId") REFERENCES "FitbitConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepChallengeParticipant" ADD FOREIGN KEY ("challengeId") REFERENCES "StepChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeParticipant" ADD FOREIGN KEY ("challengeId") REFERENCES "NinetyDayChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengePost" ADD FOREIGN KEY ("challengeId") REFERENCES "NinetyDayChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengePost" ADD FOREIGN KEY ("participantId") REFERENCES "NinetyDayChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeReaction" ADD FOREIGN KEY ("postId") REFERENCES "NinetyDayChallengePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeComment" ADD FOREIGN KEY ("postId") REFERENCES "NinetyDayChallengePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeComment" ADD FOREIGN KEY ("participantId") REFERENCES "NinetyDayChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeComment" ADD FOREIGN KEY ("parentCommentId") REFERENCES "NinetyDayChallengeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengeCommentReaction" ADD FOREIGN KEY ("commentId") REFERENCES "NinetyDayChallengeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NinetyDayChallengePostView" ADD FOREIGN KEY ("postId") REFERENCES "NinetyDayChallengePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTrainingProgression" ADD FOREIGN KEY ("userId") REFERENCES "UserInfo"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutSession" ADD FOREIGN KEY ("workoutLogId") REFERENCES "WorkoutLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutSession" ADD FOREIGN KEY ("currentExerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GymSessionParticipant" ADD FOREIGN KEY ("gymSessionId") REFERENCES "GymSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymSessionParticipant" ADD FOREIGN KEY ("workoutSessionId") REFERENCES "WorkoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestTimer" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestTimer" ADD FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionTimer" ADD FOREIGN KEY ("workoutSessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionTimer" ADD FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoogleFitnessData" ADD FOREIGN KEY ("connectionId") REFERENCES "GoogleFitnessConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
