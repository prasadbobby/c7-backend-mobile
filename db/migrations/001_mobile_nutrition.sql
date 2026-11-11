-- C7 mobile: nutrition, community and preference tables.
-- Naming follows Prisma defaults (quoted PascalCase tables, camelCase columns)
-- so FitForge's schema.prisma can model the same tables. Idempotent.

CREATE TABLE IF NOT EXISTS "Recipe" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'other',
  "imageUrl" TEXT,
  "kcal" INTEGER NOT NULL DEFAULT 0,
  "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "servings" INTEGER NOT NULL DEFAULT 1,
  "ingredients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "steps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Recipe_category_check" CHECK ("category" IN ('vegetarian','seafood','high-protein','keto','vegan','breakfast','snack','other'))
);
CREATE INDEX IF NOT EXISTS "Recipe_category_isPublished_idx" ON "Recipe"("category", "isPublished");

CREATE TABLE IF NOT EXISTS "RecipeLike" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeLike_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeLike_userId_recipeId_key" ON "RecipeLike"("userId", "recipeId");

CREATE TABLE IF NOT EXISTS "RecipeSave" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeSave_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeSave_userId_recipeId_key" ON "RecipeSave"("userId", "recipeId");

CREATE TABLE IF NOT EXISTS "RecipeComment" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecipeComment_recipeId_idx" ON "RecipeComment"("recipeId");

CREATE TABLE IF NOT EXISTS "UserFollow" (
  "followerId" TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("followerId", "followingId")
);

CREATE TABLE IF NOT EXISTS "MealLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "slot" TEXT NOT NULL,
  "recipeId" TEXT REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "kcal" INTEGER NOT NULL DEFAULT 0,
  "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealLog_slot_check" CHECK ("slot" IN ('BREAKFAST','LUNCH','DINNER','SNACK'))
);
CREATE INDEX IF NOT EXISTS "MealLog_userId_date_idx" ON "MealLog"("userId", "date");

CREATE TABLE IF NOT EXISTS "WaterLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "amountMl" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaterLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaterLog_userId_date_key" ON "WaterLog"("userId", "date");

CREATE TABLE IF NOT EXISTS "NutritionGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kcal" INTEGER NOT NULL DEFAULT 2000,
  "protein" INTEGER NOT NULL DEFAULT 120,
  "carbs" INTEGER NOT NULL DEFAULT 220,
  "fat" INTEGER NOT NULL DEFAULT 65,
  "waterMl" INTEGER NOT NULL DEFAULT 2500,
  "assignedBy" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NutritionGoal_userId_key" ON "NutritionGoal"("userId");

CREATE TABLE IF NOT EXISTS "UserPreference" (
  "userId" TEXT NOT NULL,
  "fitnessGoal" TEXT,
  "experienceLevel" TEXT,
  "onboardingCompletedAt" TIMESTAMP(3),
  "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
  "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "hapticsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "metricUnits" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "_c7_migrations" (
  "name" TEXT PRIMARY KEY,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
