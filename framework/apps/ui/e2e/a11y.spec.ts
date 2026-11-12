import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Page, expect, test } from "@playwright/test";
import {
  type AccessibilityFinding,
  scanPageAccessibility,
} from "alepha/testing/playwright";

import {
  A11Y_BASELINE,
  type A11yBaselineEntry,
  type A11yMode,
} from "./a11y-baseline.ts";

/**
 * axe on every page of the showcase, in Chromium, in four token sets (#Q3349).
 *
 * This is the layer that measures what the kit's jsdom specs cannot: the page
 * is styled and laid out, so `color-contrast` and `target-size` are real.
 * It blocks: a finding missing from `a11y-baseline.ts` fails, and so does an
 * entry no finding matches any more.
 *
 * Colour is read without the three traps already paid for here:
 *   - the colour mode and the vision mode are stored in the `alepha-ui`
 *     cookie BEFORE navigation, so the boot script paints them before first
 *     paint; nothing is toggled on a loaded page;
 *   - transitions and animations are switched off by an injected style, so no
 *     scan reads a blend of two palettes or an overlay half faded in;
 *   - every page is loaded cold in its mode, never re-themed in place.
 */

const MODES: readonly A11yMode[] = ["light", "dark", "light-cvd", "dark-cvd"];

const ROUTER_FILE = fileURLToPath(
  new URL("../src/web/AppRouter.tsx", import.meta.url),
);

/**
 * Every `path` the router declares, read off its source so that a page added
 * later is scanned without anyone remembering to list it here.
 */
const routerPaths = (): string[] =>
  [...readFileSync(ROUTER_FILE, "utf8").matchAll(/\bpath: "([^"]+)"/g)].map(
    (m) => m[1],
  );

/**
 * How to reach a route the router cannot list as a URL: a param route, and
 * the shell-less preview frame. A route with a param missing here fails the
 * coverage test below rather than being skipped.
 */
const ROUTE_URLS: Record<string, string> = {
  "/admin/users/:userId": "",
  "/admin/jobs/:jobName": "/admin/jobs/digests.send-weekly",
  "/preview": "/preview?p=blocks/Buttons",
};

/**
 * A state that exists only after an interaction, scanned on its own page
 * under `<path>#<name>`.
 */
interface OpenState {
  path: string;
  name: string;
  open: (page: Page) => Promise<void>;
}

const OPEN_STATES: OpenState[] = [
  {
    path: "/blocks/dialog",
    name: "confirm",
    open: async (page) => {
      await page.getByRole("button", { name: "confirm", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    path: "/blocks/primitives",
    name: "menu",
    open: async (page) => {
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    path: "/blocks/primitives",
    name: "tooltip",
    open: async (page) => {
      await page.getByTestId("primitives-tooltip").hover();
      await expect(
        page.getByText("Opens after the provider's delay"),
      ).toBeVisible();
    },
  },
  {
    path: "/blocks/control/select",
    name: "open",
    open: async (page) => {
      await page.locator('[data-slot="combobox-trigger"]').first().click();
      await expect(page.getByRole("listbox")).toBeVisible();
    },
  },
  {
    path: "/blocks/control/date",
    name: "popover",
    open: async (page) => {
      await page.locator('[data-slot="date-trigger"]').first().click();
      await expect(page.getByRole("grid").first()).toBeVisible();
    },
  },
  {
    path: "/blocks/buttons",
    name: "palette",
    open: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    path: "/blocks/toast",
    name: "toast",
    open: async (page) => {
      await page.getByRole("button", { name: "Success", exact: true }).click();
      await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    },
  },
  {
    path: "/pages/auth/register",
    name: "error",
    open: async (page) => {
      await page.locator("form button[type=submit]").first().click();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  },
];

const NO_MOTION = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  caret-color: transparent !important;
}`;

/**
 * Store the colour and vision mode where the boot script reads them, before
 * the page is requested.
 */
const storeMode = async (page: Page, mode: A11yMode) => {
  const value = {
    mode: mode.startsWith("dark") ? "dark" : "light",
    theme: "default",
    vision: mode.endsWith("cvd") ? "cvd" : "normal",
    sidebar: { collapsed: false },
  };
  const baseURL = test.info().project.use.baseURL!;
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "alepha-ui",
      value: encodeURIComponent(JSON.stringify(value)),
      url: baseURL,
    },
  ]);
};

/**
 * Load a URL cold in one mode, settled and motionless, and check the boot
 * script painted the mode asked for.
 */
const load = async (page: Page, url: string, mode: A11yMode) => {
  await storeMode(page, mode);
  // The showcase draws its shortcut hint as "⌘" on a Mac and "Ctrl"
  // elsewhere, two different nodes to axe. Pinned to CI's platform so a
  // laptop finds what CI finds.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Linux x86_64",
    });
  });
  await page.goto(url);
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForLoadState("networkidle");
  const html = page.locator("html");
  if (mode.startsWith("dark")) await expect(html).toHaveClass(/\bdark\b/);
  else await expect(html).not.toHaveClass(/\bdark\b/);
  await expect(html).toHaveAttribute(
    "data-vision",
    mode.endsWith("cvd") ? "cvd" : "normal",
  );
};

interface SeenFinding extends AccessibilityFinding {
  mode: A11yMode;
}

/**
 * Compare one page's findings with the baseline entries for that page, both
 * ways: a finding no entry lists, and an entry mode no finding matches.
 */
const compare = (page: string, findings: SeenFinding[]) => {
  const entries = A11Y_BASELINE.filter((e) => e.page === page);
  const selects = (e: A11yBaselineEntry, selector: string) =>
    Array.isArray(e.selector)
      ? e.selector.includes(selector)
      : e.selector === selector;
  const known = (f: SeenFinding) =>
    entries.some(
      (e) =>
        e.rule === f.rule &&
        selects(e, f.selector) &&
        e.modes.includes(f.mode),
    );

  const unknown = findings.filter((f) => !known(f));
  const stale: string[] = [];
  for (const entry of entries) {
    for (const mode of entry.modes) {
      const seen = findings.some(
        (f) =>
          f.mode === mode &&
          f.rule === entry.rule &&
          selects(entry, f.selector),
      );
      if (!seen) {
        stale.push(
          `${entry.page} [${mode}] ${entry.rule} ${entry.selector}: no finding matches this entry any more. Delete it, or this mode from it.`,
        );
      }
    }
  }

  // One entry per (rule, selector), with every mode it was seen in: the
  // shape a hand-written baseline entry takes.
  const grouped = new Map<
    string,
    { finding: SeenFinding; modes: A11yMode[] }
  >();
  for (const f of unknown) {
    const key = `${f.rule}\u0000${f.selector}`;
    const group = grouped.get(key);
    if (group) group.modes.push(f.mode);
    else grouped.set(key, { finding: f, modes: [f.mode] });
  }
  const proposals = [...grouped.values()].map(
    ({ finding, modes }) =>
      `${finding.help} (${finding.helpUrl})\n    ${finding.html}\n  ${JSON.stringify(
        {
          page,
          modes,
          rule: finding.rule,
          selector: finding.selector,
          reason:
            "TODO: why this is not fixed here, and the quest that tracks it",
        } satisfies A11yBaselineEntry,
      )},`,
  );

  const problems: string[] = [];
  if (proposals.length) {
    problems.push(
      `${proposals.length} finding(s) not in e2e/a11y-baseline.ts. Fix them, or copy each entry into the baseline with a real reason:\n\n  ${proposals.join("\n\n  ")}`,
    );
  }
  if (stale.length) problems.push(stale.join("\n"));
  expect(problems.length, problems.join("\n\n")).toBe(0);
};

test.describe("accessibility of the showcase", () => {
  test("every router path is scanned", () => {
    const paths = routerPaths();
    expect(paths.length).toBeGreaterThan(40);
    const unreachable = paths.filter(
      (p) => p.includes(":") && ROUTE_URLS[p] === undefined,
    );
    expect(unreachable, "a param route with no URL in ROUTE_URLS").toEqual([]);
    const known = new Set([
      ...paths,
      ...OPEN_STATES.map((s) => `${s.path}#${s.name}`),
    ]);
    const orphans = A11Y_BASELINE.filter((e) => !known.has(e.page)).map(
      (e) => e.page,
    );
    expect(
      orphans,
      "a baseline entry for a page the scan never visits",
    ).toEqual([]);
    const wildcards = A11Y_BASELINE.filter(
      (e) =>
        !e.page ||
        !e.rule ||
        e.modes.length === 0 ||
        (Array.isArray(e.selector)
          ? e.selector.length === 0 || e.selector.some((s) => !s)
          : !e.selector),
    );
    expect(wildcards, "a baseline entry with an empty field").toEqual([]);
  });

  test("the harness reports a known contrast failure", async ({ page }) => {
    await load(page, "/blocks/buttons", "light");
    // #767676 on white is 4.54:1, the lightest grey that passes AA; #777777
    // is 4.48:1 and must be reported.
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.id = "a11y-canary";
      p.textContent = "Contrast canary";
      p.style.cssText = "color:#777777;background:#ffffff;font-size:14px";
      document.querySelector("main")?.prepend(p);
    });
    const findings = await scanPageAccessibility(page, {
      include: ["#a11y-canary"],
    });
    expect(findings.map((f) => [f.rule, f.selector])).toContainEqual([
      "color-contrast",
      "#a11y-canary",
    ]);
  });

  for (const path of routerPaths()) {
    const url = ROUTE_URLS[path] ?? path;
    test(`${path} in every mode`, async ({ page }) => {
      const findings: SeenFinding[] = [];
      for (const mode of MODES) {
        if (url === "") {
          await load(page, "/pages/admin/users", mode);
          await page.getByText("ada@alepha.dev").first().click();
          await expect(page).toHaveURL(/\/admin\/users\//);
          await page.waitForLoadState("networkidle");
          await page.addStyleTag({ content: NO_MOTION });
        } else {
          await load(page, url, mode);
        }
        for (const f of await scanPageAccessibility(page)) {
          findings.push({ ...f, mode });
        }
      }
      compare(path, findings);
    });
  }

  for (const state of OPEN_STATES) {
    const key = `${state.path}#${state.name}`;
    test(`${key} in every mode`, async ({ page }) => {
      const findings: SeenFinding[] = [];
      for (const mode of MODES) {
        await load(page, state.path, mode);
        // What the page shows closed is its own route's to baseline: keep
        // only what opening the state adds, so one finding has one entry.
        const closed = new Set(
          (await scanPageAccessibility(page)).map(
            (f) => `${f.rule}\u0000${f.selector}`,
          ),
        );
        await state.open(page);
        for (const f of await scanPageAccessibility(page)) {
          if (!closed.has(`${f.rule}\u0000${f.selector}`)) {
            findings.push({ ...f, mode });
          }
        }
      }
      compare(key, findings);
    });
  }
});
