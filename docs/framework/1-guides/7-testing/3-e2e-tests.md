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

- `env.APP_SECRET`: the built server runs in production mode, and `SecretProvider` refuses to boot on the built-in default secret in production. Without a value here the server never starts.
- `reuseExistingServer: false`: Playwright's default (`!process.env.CI`) will happily adopt a running `alepha dev` server, and the suite then reports green against hot-reloaded sources and the dev database instead of the build.

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

## With Bun

If your production server runs on Bun, adjust the `webServer` command:

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
