import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. 3302 docs, 3303 lore, 3305 shop,
  // 3307 totp, 3308 ui, 3310 devtools, 3311 ssr, so this one takes 3312.
  dev: { port: 3312 },
  // Loom ships as one binary, `dist/loom`, its public/ files inside it: the
  // dogfood of `alepha build --compile`, and the file a login item runs.
  // `yarn w loom deploy` installs it as ~/.alepha/apps/loom/loom: a directory
  // of its own, so files can sit beside the binary. It is copied under a
  // temporary name, then renamed into place. Copying over the old file
  // would rewrite the binary a running Loom is executing, and on Apple
  // Silicon a signed binary rewritten in place gets killed; a rename leaves
  // the running one its own file until it restarts.
  build: { runtime: "bun", compile: "loom" },
});
