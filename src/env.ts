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
  clerkJwtKey: process.env.CLERK_JWT_KEY,
  /** Other Clerk instances whose users appear in this database (e.g. production users while developing locally). Names only — never used to verify sign-ins. */
  clerkDirectoryKeys: (process.env.CLERK_DIRECTORY_SECRET_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean), // optional: PEM public key for networkless verification
  // Tolerates quotes, spaces, trailing slashes and ";" separators from hand-edited .env files.
  corsOrigins: (process.env.CORS_ORIGINS ?? "*")
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "").toLowerCase())
    .filter(Boolean),
  /** Local Expo / Next dev servers may call this API (auth is a bearer token, never cookies). */
  allowLocalhost: (process.env.CORS_ALLOW_LOCALHOST ?? "true") !== "false",
  /** FitForge web origin — exercise images live under its /public folder. */
  webAssetBaseUrl: (process.env.WEB_ASSET_BASE_URL ?? "https://c7personalfitness.com").replace(/\/$/, ""),
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
};
