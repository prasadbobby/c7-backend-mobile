import "dotenv/config";

// Every date computation in FitForge runs on UTC servers (Vercel). Pin the
// process to UTC so day boundaries match the web app exactly.
process.env.TZ = "UTC";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const authMode = (process.env.AUTH_MODE ?? "clerk") as "clerk" | "test";

if (authMode === "test" && nodeEnv === "production") {
  throw new Error("AUTH_MODE=test is not allowed when NODE_ENV=production");
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  authMode,
  clerkSecretKey: authMode === "clerk" ? required("CLERK_SECRET_KEY") : process.env.CLERK_SECRET_KEY ?? "",
  clerkJwtKey: process.env.CLERK_JWT_KEY, // optional: PEM public key for networkless verification
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
  /** FitForge web origin — exercise images live under its /public folder. */
  webAssetBaseUrl: (process.env.WEB_ASSET_BASE_URL ?? "https://c7personalfitness.com").replace(/\/$/, ""),
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
};
