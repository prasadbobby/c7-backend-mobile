import { defineConfig } from "@playwright/test";

const PORT = 4100;
export default defineConfig({
  testDir: "./tests/api",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: "npx tsx --env-file=.env.test src/server.ts",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
