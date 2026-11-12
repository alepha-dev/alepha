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

If the app uses the ORM, give the server a database as well. In production mode the SQLite driver refuses to boot without `DATABASE_URL`, because its fallback (`node_modules/.alepha/sqlite.db`) is the development scratch file. Point `DATABASE_URL` at a database the suite owns, never at the one `alepha dev` uses.

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

The registry maps each suite to a slot, its offset inside a stride. The default band has a stride of 10, so slots run from 0 to 9; pass a second argument (`{ start, end, stride }`, each optional) to move the band or widen the stride.

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

How the allocator answers:

| Situation               | Port returned                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_PORT` is set       | That port, for every suite. `worker()` adds the worker index to it.                                                                 |
| `E2E_PORT_<APP>` is set | That port. The first allocation writes it (`E2E_PORT_WEB` here), so a global setup calling `e2ePort("web")` agrees with the config. |
| Otherwise               | The first free candidate for this checkout. If the preferred one is busy, a line on stderr says which port was used instead.        |

`e2ePort.worker(app, workerIndex)` gives each Playwright worker its own port when every worker boots its own server (for example on its own in-memory database, so specs can run `fullyParallel`). Workers walk disjoint subsets of the same candidate list, and the answer is deliberately not memoised. `e2ePort.candidates(root, app)` and `e2ePort.root()` expose the list the allocator walks, for a test that wants to assert on it.

## Accessibility

`expectPageAccessible(page)` from `alepha/testing/playwright` runs [axe](https://github.com/dequelabs/axe-core) on the page with the WCAG 2.0, 2.1 and 2.2 A and AA rules and fails with every violation: the rule id, its help URL, and the selector and HTML of each node. Same-origin iframes are scanned too. It needs `@axe-core/playwright`:

```bash
npm install -D @axe-core/playwright
```

```typescript
import { test } from "@playwright/test";
import { expectPageAccessible } from "alepha/testing/playwright";

test("the home page is accessible", async ({ page }) => {
  await page.goto("/");
  await expectPageAccessible(page, { exclude: ["#third-party-widget"] });
});
```

Options: `disable` (rule ids switched off for this call), `include` and `exclude` (CSS selectors). In a real browser the page is styled and laid out, so contrast and target size are measured here, unlike under jsdom.

`scanPageAccessibility(page, options?)` returns the same findings as data instead of failing, one item per rule and node (`rule`, `help`, `helpUrl`, `selector`, `html`), to compare against a checked-in list of known findings.

A pass is a floor: axe finds roughly half of real issues by its own figure, and it has no rule for non-text contrast (a field's border, a focus ring).

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

`--reporter=html` writes the report to `playwright-report/`; without a `reporter` in the config, Playwright prints a plain list (`dot` on CI). Configure reporters in `playwright.config.ts` to match your CI system, for example `reporter: process.env.CI ? "list" : "html"`.
