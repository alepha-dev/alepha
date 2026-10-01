import { defineConfig } from "vitest/config";

/**
 * The end-to-end suites that drive built artefacts: the packed `lore` binary,
 * and the real Bay against a real Lore. Out of the root `yarn test` on
 * purpose, and run through `yarn e2e-cli` after `yarn build`.
 */
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 600_000, // 10 minutes
  },
});
