import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();
// Behind OpenLiteSpeed in production: bind to loopback so only the proxy can reach it.
const hostname = process.env.HOST ?? (env.nodeEnv === "production" ? "127.0.0.1" : "0.0.0.0");
serve({ fetch: app.fetch, port: env.port, hostname }, (info) => {
  console.log(`c7-backend listening on ${hostname}:${info.port} (auth: ${env.authMode})`);
});
