import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. 3302 docs, 3303 lore, 3305 shop,
  // 3307 totp, 3308 ui, 3310 devtools, 3311 ssr, so this one takes 3312.
  dev: { port: 3312 },
  // Loom ships as one binary, `dist/loom`, its public/ files inside it: the
  // dogfood of `alepha build --compile`, and the file a login item runs.
  build: { runtime: "bun", compile: "loom" },
});
