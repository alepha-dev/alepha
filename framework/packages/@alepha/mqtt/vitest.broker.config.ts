import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The real broker's half of the MQTT contract suite, and nothing else.
 *
 * `**\/*.broker.spec.{ts,tsx}` is excluded from every workspace project in
 * `scripts/vitest.projects.ts`, as `*.bun.spec` is, so the six `test` shards
 * never collect it; this config is the only one that does, run by the root
 * `yarn test:broker` (in `yarn v`, and the `mqtt-broker` job of
 * `verify.yml`). It needs Mosquitto on 11883 (`docker compose up -d`).
 *
 * ⚠️ A separate project rather than an env-gated `describe.skipIf`: a job
 * that lost its env var would skip every case and go green. Here no broker
 * means ECONNREFUSED, and no files means "No test files found": red both
 * ways.
 */
export default defineConfig({
  test: {
    name: "@alepha/mqtt:broker",
    root: dirname(fileURLToPath(import.meta.url)),
    include: ["src/**/*.broker.spec.{ts,tsx}"],
    environment: "node",
    globals: true,
    testTimeout: 10_000,
    // One file, one broker: no reason to fan out.
    fileParallelism: false,
  },
});
