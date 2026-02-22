import { defineConfig } from "alepha/cli";

export default defineConfig({
  // ─────────────────────────────────────────────────────────────────────────────
  // Entry Points
  // Override default entry points (auto-detected from src/main.*.ts)
  // ─────────────────────────────────────────────────────────────────────────────
  // entry: {
  //   server: "src/main.server.ts",
  //   browser: "src/main.browser.ts",
  //   style: "src/main.css",
  // },
  // ─────────────────────────────────────────────────────────────────────────────
  // Build Configuration
  // ─────────────────────────────────────────────────────────────────────────────
  // build: {
  //   target: "docker",              // "bare" | "docker" | "vercel" | "cloudflare"
  //   runtime: "node",               // "node" | "bun" | "workerd"
  //   sitemap: { hostname: "https://example.com" },
  // },
  // ─────────────────────────────────────────────────────────────────────────────
  // Custom CLI Commands
  // Add command classes to extend `alepha <command>`
  // ─────────────────────────────────────────────────────────────────────────────
  // services: [MyCommand, DeployCommand],
  // ─────────────────────────────────────────────────────────────────────────────
  // Environment Variables
  // Inject dynamic values (prefer .env for static values)
  // VITE_ prefix exposes to browser
  // ─────────────────────────────────────────────────────────────────────────────
  // env: {
  //   VITE_BUILD_DATE: new Date().toISOString(),
  //   VITE_VERSION: pkg.version,
  // },
});
