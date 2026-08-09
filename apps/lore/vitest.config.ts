import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { jsdomProject } from "../../vitest.jsdom.ts";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json. Vitest inherits its root
    // from the repo-level config, so without this any spec that reaches web
    // code — which imports atoms and schemas through `@/` — fails to resolve at
    // import time rather than failing an assertion.
    alias: [{ find: /^@\//, replacement: `${resolve(appRoot, "src")}/` }],
  },
  test: {
    testTimeout: 10000,
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: { label: "node", color: "green" },
          environment: "node",
          exclude: [
            "**/*.browser.spec.{ts,tsx}",
            "**/*.bun.spec.{ts,tsx}",
            "**/node_modules/**",
            "**/e2e/**",
          ],
        },
      },
      jsdomProject(["**/*.browser.spec.{ts,tsx}"]),
    ],
  },
});
