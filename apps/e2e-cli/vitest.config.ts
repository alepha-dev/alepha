import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Removing packed-consumer dependency trees can exceed the default 10 seconds in CI.
    hookTimeout: 60_000,
    testTimeout: 600_000, // 10 minutes
  },
});
