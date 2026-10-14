# End-to-End Tests

End-to-end tests run against the built production version of your Alepha application. Use Playwright to drive a real browser and test the full stack.

## Setup

Install Playwright:

```bash
npm install -D @playwright/test
npx playwright install
```

Create a Playwright configuration:

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "node dist",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: { APP_SECRET: "e2e-test-secret" },
  },
});
```

The `webServer` option starts the production server before tests run and tears it down after. Two lines in it earn their place:

- `env.APP_SECRET`: the built server runs in production mode, and an app that signs anything (sessions, tokens, signed cookies) refuses to boot there on the built-in default secret. Without a value here such a server never starts.
- `reuseExistingServer: false`: Playwright's default (`!process.env.CI`) will happily adopt a running `alepha dev` server, and the suite then reports green against hot-reloaded sources and the dev database instead of the build.

The built server listens on `SERVER_PORT` (3000 when unset). A fixed port is fine for one suite on one machine; see [Picking a port](#picking-a-port) once several checkouts or suites run at the same time.

## Build and Test

Always build before running e2e tests. The tests execute against the `dist/` output, not the dev server.

```bash
alepha build
npx playwright test
```

## Writing Tests

Place test files in the `e2e/` directory:

```typescript check
// e2e/home.spec.ts
import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/My App/);
});

test("API returns data", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.ok()).toBeTruthy();
});
```

## Picking a port

`createE2ePortAllocator` from `alepha/testing/playwright` hands each suite a port from a band of its own (4300-4999 by default, never a dev port), derived from a hash of the checkout path so two worktrees never pick the same one, and bind-tested free before it is returned. A busy candidate is skipped a whole stride at a time. Keep the registry of suites in your repository: a suite missing from it does not typecheck.

```typescript check
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import { createE2ePortAllocator } from "alepha/testing/playwright";

const e2ePort = createE2ePortAllocator({ web: 0, admin: 1 } as const);
const port = e2ePort("web");

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "node dist",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: { APP_SECRET: "e2e-test-secret", SERVER_PORT: String(port) },
  },
});
```

The answer is memoised in `E2E_PORT_<APP>`, so a global setup file calling `e2ePort("web")` again gets the same port. `E2E_PORT` overrides everything, and `e2ePort.worker(app, workerIndex)` gives each Playwright worker its own port when every worker boots its own server.

## With Bun

If your production server runs on Bun, build the Bun slice (`alepha build --runtime bun`) and adjust the `webServer` command:

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "bun dist",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: { APP_SECRET: "e2e-test-secret" },
  },
});
```

## CI Integration

In CI, run the full pipeline:

```bash
alepha build
npx playwright test --reporter=html
```

Playwright generates an HTML report by default. Configure reporters in `playwright.config.ts` to match your CI system.
