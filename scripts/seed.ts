/** Starter content for a fresh database: exercise library, system workout plans, a 90-day challenge and recipes. Idempotent. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MUSCLES = new Set(["abdominals", "hamstrings", "adductors", "quadriceps", "biceps", "shoulders", "chest", "middle back", "calves", "glutes", "lower back", "lats", "triceps", "traps", "forearms", "neck", "abductors"]);
const EQUIP = new Set(["body only", "machine", "other", "foam roll", "kettlebells", "dumbbell", "cable", "barbell", "bands", "medicine ball", "exercise ball", "e-z curl bar"]);
const CATS = new Set(["strength", "stretching", "plyometrics", "strongman", "powerlifting", "cardio", "olympic weightlifting"]);
const norm = (s: string) => s.toLowerCase().replace(/_/g, " ").trim();

type Ex = { name: string; force?: string; level?: string; mechanic?: string; equipment?: string; primaryMuscles?: string[]; secondaryMuscles?: string[]; instructions?: string[]; category?: string };

export async function seed(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const exercises: Ex[] = JSON.parse(readFileSync(join(root, "db", "seed", "exercises.json"), "utf8"));
    let added = 0;
    for (const e of exercises) {
      const dup = await c.query(`SELECT 1 FROM "Exercise" WHERE name = $1`, [e.name]);
      if (dup.rowCount) continue;
      const muscles = (m?: string[]) => (m ?? []).map(norm).filter((x) => MUSCLES.has(x));
      const equipment = e.equipment && EQUIP.has(norm(e.equipment)) ? norm(e.equipment) : e.equipment ? "other" : null;
      const category = e.category && CATS.has(norm(e.category)) ? norm(e.category) : "strength";
      const level = ["beginner", "intermediate", "expert"].includes(norm(e.level ?? "")) ? norm(e.level!) : "beginner";
      await c.query(
        `INSERT INTO "Exercise"(id, name, aliases, primary_muscles, secondary_muscles, force, level, mechanic, equipment, category, instructions, tips)
         VALUES ($1,$2,'{}',$3::"Muscle"[],$4::"Muscle"[],$5,$6,$7,$8,$9,$10,'{}')`,
        [randomUUID(), e.name, muscles(e.primaryMuscles), muscles(e.secondaryMuscles), ["push", "pull", "static"].includes(norm(e.force ?? "")) ? norm(e.force!) : null, level, ["compound", "isolation"].includes(norm(e.mechanic ?? "")) ? norm(e.mechanic!) : null, equipment, category, e.instructions ?? []],
      );
      added++;
    }
    console.log(`exercises: +${added}`);

    const plans: { name: string; trainingType: string; notes: string; exercises: [string, number, number | null, number | null][] }[] = [
      { name: "Full Body Foundations", trainingType: "FUNCTIONAL", notes: "Three rounds, controlled tempo. Rest 60–90s between sets.", exercises: [["Back Squat", 3, 10, null], ["Front Squat", 3, 8, null], ["Zercher Squat", 2, 8, null]] },
      { name: "Lower Body Strength", trainingType: "STRENGTH", notes: "Heavy compound work. Rest 2–3 minutes.", exercises: [["Back Squat", 5, 5, null], ["Front Squat", 3, 6, null]] },
    ];
    for (const p of plans) {
      const exists = await c.query(`SELECT id FROM "WorkoutPlan" WHERE name = $1 AND "userId" IS NULL`, [p.name]);
      if (exists.rowCount) continue;
      const planId = randomUUID();
      await c.query(`INSERT INTO "WorkoutPlan"(id, name, "userId", notes, "trainingType", "updatedAt") VALUES ($1,$2,NULL,$3,$4,now())`, [planId, p.name, p.notes, p.trainingType]);
      let order = 1;
      for (const [exName, sets, reps, dur] of p.exercises) {
        const ex = await c.query(`SELECT id FROM "Exercise" WHERE name = $1 LIMIT 1`, [exName]);
        if (!ex.rowCount) continue;
        await c.query(`INSERT INTO "WorkoutPlanExercise"(id, "workoutPlanId", "exerciseId", sets, reps, "exerciseDuration", "order", "trackingType") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
          randomUUID(), planId, ex.rows[0].id, sets, reps, dur, order++, dur ? "duration" : "reps",
        ]);
      }
    }
    console.log("workout plans ready");

    const ch = await c.query(`SELECT id FROM "NinetyDayChallenge" WHERE title = '90-Day Transformation'`);
    if (!ch.rowCount) {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - 7);
      const end = new Date(start.getTime() + 90 * 86400000);
      await c.query(`INSERT INTO "NinetyDayChallenge"(id, title, description, "startDate", "endDate", "isActive", "createdBy", "updatedAt") VALUES ($1,$2,$3,$4,$5,true,'system',now())`, [
        randomUUID(), "90-Day Transformation", "Post a daily check-in: sleep, meals, mood, energy and progress photos.", start, end,
      ]);
    }
    console.log("challenge ready");

    const img = (f: string) => `data:image/jpeg;base64,${readFileSync(join(root, "db", "seed", "recipe-images", `${f}.jpg`)).toString("base64")}`;
    const recipes = [
      ["Power-packed Bowl", "high-protein", "meal-bowl", 520, 42, 48, 18, 20, "Quinoa, avocado, grilled chicken and greens with a zesty lime dressing.", ["1 cup cooked quinoa", "150g grilled chicken", "½ avocado", "Cherry tomatoes", "Baby spinach", "Lime & olive oil"], ["Cook quinoa and let it cool slightly.", "Grill the chicken 6 min per side, then slice.", "Assemble greens, quinoa and toppings.", "Whisk lime, oil and salt; drizzle and serve."]],
      ["Spicy Thai Seafood Medley", "seafood", "meal-seafood", 430, 42, 12, 27.5, 25, "Shrimp, mussels, squid and fresh veggies in Thai chili garlic sauce.", ["200g shrimp", "150g mussels", "100g squid rings", "2 Thai chilies", "3 garlic cloves", "Bell peppers, basil"], ["Smash garlic and chilies into a paste.", "Sear squid and shrimp on high heat.", "Add mussels, cover until opened.", "Toss with peppers, sauce and basil."]],
      ["Lemon-Herb Butter Salmon", "seafood", "meal-salmon", 480, 38, 6, 30, 18, "Pan-seared salmon in lemon-herb butter with crisp asparagus.", ["Salmon fillet", "1 tbsp butter", "Lemon", "Dill & parsley", "Asparagus"], ["Pat salmon dry, season well.", "Sear skin-side down 4 min.", "Flip, baste with lemon-herb butter.", "Serve over blistered asparagus."]],
      ["Chickpea Garden Salad", "vegetarian", "meal-vegetarian", 360, 16, 44, 12, 10, "Chickpeas, tomatoes, cucumber and feta with olive oil and herbs.", ["1 can chickpeas", "Tomatoes", "Cucumber", "Feta", "Olive oil", "Fresh herbs"], ["Rinse chickpeas.", "Dice veg.", "Toss everything with oil, salt and herbs."]],
      ["Salmon Noodle Bowl", "high-protein", "meal-protein", 610, 46, 58, 20, 22, "Glazed salmon over sesame noodles with broccoli and carrots.", ["Salmon", "Soba noodles", "Broccoli", "Carrot", "Soy-honey glaze", "Sesame"], ["Boil noodles.", "Glaze and bake salmon 12 min.", "Steam veg.", "Assemble and garnish with sesame."]],
      ["Keto Breakfast Plate", "keto", "meal-keto", 540, 24, 8, 44, 12, "Sunny egg, crispy bacon, avocado and roasted cherry tomatoes.", ["2 eggs", "3 bacon strips", "½ avocado", "Cherry tomatoes"], ["Crisp bacon.", "Fry eggs in the fat.", "Roast tomatoes, plate with avocado."]],
      ["Berry Yogurt Bowl", "breakfast", "meal-yogurt", 290, 18, 36, 8, 5, "Greek yogurt with mixed berries, nuts and chia seeds.", ["Greek yogurt", "Mixed berries", "Walnuts", "Chia seeds", "Honey"], ["Spoon yogurt into a bowl.", "Top with berries, nuts and chia.", "Drizzle honey."]],
    ] as const;
    for (const [title, category, image, kcal, protein, carbs, fat, minutes, description, ingredients, steps] of recipes) {
      const dup = await c.query(`SELECT 1 FROM "Recipe" WHERE title = $1`, [title]);
      if (dup.rowCount) continue;
      await c.query(
        `INSERT INTO "Recipe"(id, title, description, category, "imageUrl", kcal, protein, carbs, fat, minutes, ingredients, steps, "createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'system')`,
        [randomUUID(), title, description, category, img(image), kcal, protein, carbs, fat, minutes, ingredients, steps],
      );
    }
    console.log("recipes ready");
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed(process.env.DATABASE_URL!).then(() => console.log("seed complete"), (e) => (console.error(e), process.exit(1)));
}
