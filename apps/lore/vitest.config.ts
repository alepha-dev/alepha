import { defineConfig } from "vitest/config";

export default defineConfig({
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
      {
        extends: true,
        test: {
          include: ["**/*.browser.spec.{ts,tsx}"],
          name: { label: "jsdom", color: "cyan" },
          environment: "jsdom",
        },
        resolve: {
          conditions: ["browser", "module", "import", "default"],
          mainFields: ["browser", "module", "main"],
        },
      },
    ],
  },
});
