import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect } from "@playwright/test";

import { e2eWorkerPort } from "../../../playwright.port.ts";
import { ADMIN_EMAIL, ADMIN_PASSWORD, registerAndVerify } from "./_helpers.ts";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * One Lore instance per Playwright worker, each on its own in-memory database.
 *
 * The suite used to share a single server started by `webServer`, which is why
 * `fullyParallel` had to stay off: 133 tests against one database, one realm
 * and one mail directory cannot safely interleave. Per worker, they can, and
 * the price turns out to be small. Measured: `node dist` answers in ~360ms and
 * holds ~168MB, so seven workers cost about a second of startup and 1.2GB.
 *
 * ⚠️ `node dist` directly, never `yarn start`. That script is
 * `yarn build && node dist`, so using it here would rebuild the app once per
 * worker. The build has to have happened already, which for `yarn v` it has.
 */
export interface LoreServer {
  url: string;
  port: number;
  dataDir: string;
}

const waitForServer = async (
  url: string,
  child: ChildProcess,
  log: () => string,
): Promise<void> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Lore exited ${child.exitCode} before listening:\n${log()}`,
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.status > 0) {
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw new Error(`Lore did not answer on ${url} within 60s:\n${log()}`);
};

// biome-ignore lint: Playwright's shape for no extra test-scoped fixtures.
export const test = base.extend<{}, { loreServer: LoreServer }>({
  loreServer: [
    async ({ browser }, use, workerInfo) => {
      const port = e2eWorkerPort("lore", workerInfo.workerIndex);
      const dataDir = mkdtempSync(
        join(tmpdir(), `lore-e2e-w${workerInfo.workerIndex}-`),
      );
      const url = `http://localhost:${port}`;

      // The helpers read verification codes off disk, so they have to look in
      // THIS worker's mail directory rather than the framework default.
      process.env.LORE_E2E_DATA_DIR = dataDir;

      const child = spawn("node", ["dist"], {
        cwd: appRoot,
        env: {
          ...process.env,
          SERVER_PORT: String(port),
          DATABASE_URL: ":memory:",
          DATA_DIR: dataDir,
          APP_SECRET: "e2e-test-secret",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          REGISTRATION_IP_MAX_ATTEMPTS: "1000",
          EMAIL_ENABLED: "true",
          ADMIN_EMAIL,
          LOG_LEVEL: "warn",
          LOG_FORMAT: "json",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      child.stdout?.on("data", (d) => (output += d));
      child.stderr?.on("data", (d) => (output += d));

      await waitForServer(url, child, () => output.slice(-2000));

      // The admin account, once per worker rather than once per run.
      // `global-setup.ts` did this against the single shared server; with a
      // server per worker, the realm that promotes ADMIN_EMAIL is per worker
      // too, so the account has to exist in each. Worker-scoped, so it costs
      // one registration per worker and not one per test.
      const context = await browser.newContext({ baseURL: url });
      const page = await context.newPage();
      await registerAndVerify(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await context.close();

      await use({ url, port, dataDir });

      child.kill("SIGKILL");
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {}
    },
    { scope: "worker" },
  ],

  /**
   * Every spec's `baseURL` points at its own worker's instance.
   *
   * The disable below is a false positive, not a rule being dodged: `use` here
   * is Playwright's fixture callback, and `react-hooks/rules-of-hooks` matches
   * on the identifier's name alone.
   */
  baseURL: async ({ loreServer }, use) => {
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    await use(loreServer.url);
  },
});

export { expect };
