import { expect, test } from "@playwright/test";

/**
 * The showcase's contract is that every block page renders the real component
 * with real content. Two things can break that silently, and both have already
 * happened once during this app's construction:
 *
 *   - the data path resolving to nothing, which renders an empty table and a
 *     toast rather than a failure;
 *   - a component that hides itself when unconfigured, which renders an empty
 *     box that reads as a broken build.
 *
 * So these specs assert CONTENT, never just that a page returned 200.
 */
test.describe("shell", () => {
  test("home lists both subjects in the sidebar", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "Every component, with its variants.",
      }),
    ).toBeVisible();

    // Home sits in an unlabelled group, so these two are the only headings
    // the sidebar draws.
    const nav = page.locator('[data-sidebar="group-label"]');
    await expect(nav.filter({ hasText: "Blocks" })).toBeVisible();
    await expect(nav.filter({ hasText: "Pages" })).toBeVisible();
  });

  test("the top bar carries a working colour-mode control", async ({
    page,
  }) => {
    await page.goto("/");

    // Regression guard: this was `ButtonTheme`, which renders NOTHING until
    // `uiThemeListAtom` holds two entries, so the top bar silently had no
    // control at all.
    await expect(
      page.getByRole("button", { name: /toggle color mode/i }).first(),
    ).toBeVisible();
  });
});

test.describe("Showcase", () => {
  test("the props panel collapses and the viewport control narrows the preview", async ({
    page,
  }) => {
    await page.goto("/blocks/control/select");

    // The panel is open by default, so its first knob is on screen.
    await expect(page.getByLabel("How many items")).toBeVisible();

    await page.getByRole("button", { name: "Hide props" }).click();
    await expect(page.getByLabel("How many items")).toHaveCount(0);

    await page.getByRole("button", { name: "Show props" }).click();
    await expect(page.getByLabel("How many items")).toBeVisible();

    // The viewport control constrains the preview rather than the window, so
    // the proof is the preview's own box.
    const preview = page.getByTestId("showcase-preview");
    const full = (await preview.boundingBox())!.width;

    await page.getByRole("radio", { name: "Mobile" }).click();
    await expect(preview).toHaveAttribute("data-viewport", "mobile");
    const mobile = (await preview.boundingBox())!.width;

    expect(mobile).toBeLessThanOrEqual(375);
    expect(mobile).toBeLessThan(full);

    // A page with no knobs still gets the viewport control, and nothing to
    // toggle the panel with. `Segmented` is a radiogroup, not a row of
    // buttons - its segments answer to `radio`.
    await page.goto("/pages/admin/jobs");
    await expect(page.getByRole("radio", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide props" })).toHaveCount(
      0,
    );
  });

  test("a simulated viewport is a real one, not a narrow div", async ({
    page,
  }) => {
    // The whole reason the preview is an iframe. Narrowing a div changes no
    // media query: Tailwind's `sm:` and `useIsMobile()` both ask the WINDOW,
    // so at 375px of preview width inside a 1280px window every component
    // still took its desktop branch. `AlephaTable` kept its filters inline
    // instead of folding them behind the button it has for exactly that case,
    // and every assertion about the page passed while it did.
    await page.setViewportSize({ width: 1440, height: 820 });
    await page.goto("/blocks/table");

    await page.getByRole("radio", { name: "Mobile" }).click();

    const frame = page.frameLocator('[data-testid="showcase-frame"]');
    // Content proves the frame booted the app rather than just existing.
    await expect(frame.getByText("Ada Lovelace")).toBeVisible();

    const inner = await page.locator('[data-testid="showcase-frame"]').evaluate(
      (el) =>
        new Promise<{ width: number; isMobile: boolean; sm: boolean }>(
          (resolve) => {
            const w = (el as HTMLIFrameElement).contentWindow!;
            resolve({
              width: w.innerWidth,
              isMobile: w.matchMedia("(max-width: 767px)").matches,
              sm: w.matchMedia("(min-width: 40rem)").matches,
            });
          },
        ),
    );

    // 375 has to mean 375: padding or a border inside the frame would hand the
    // page a narrower window than the label promises.
    expect(inner.width).toBe(375);
    // `useIsMobile`'s own query, and a Tailwind breakpoint, both answering for
    // the frame rather than for the window around it.
    expect(inner.isMobile).toBe(true);
    expect(inner.sm).toBe(false);
  });

  test("a props row keeps its label off its input", async ({ page }) => {
    // `Control` in row layout gives a text input a flat 256px, and this panel's
    // rows are 293px: the label column collapsed to 9px and its text rendered
    // ON TOP of the input. Nothing that asserts content can see that - the
    // label was present, visible, and had an accessible name throughout.
    await page.goto("/blocks/toast");

    const boxes = await page.evaluate(() => {
      const input = document.querySelector<HTMLElement>(
        '.showcase-props input[name="message"]',
      );
      const label = input
        ?.closest("div[class*='grid-cols-']")
        ?.querySelector<HTMLElement>("label");
      if (!input || !label) return null;
      const i = input.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      return { labelRight: l.right, labelWidth: l.width, inputLeft: i.left };
    });

    expect(boxes).not.toBeNull();
    // A label squeezed to nothing is the failure, and it overflows silently.
    expect(boxes!.labelWidth).toBeGreaterThan(40);
    expect(boxes!.labelRight).toBeLessThanOrEqual(boxes!.inputLeft);
  });

  test("only the preview scrolls, never the document", async ({ page }) => {
    // The regression this guards is one `fill` prop on `AppShell`. Without it
    // the shell's `<main>` is `flex-1 overflow-auto`, nothing bounds the
    // height, and the DOCUMENT becomes the only scroller - taking the header
    // bar and the props panel out of view with the preview.
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto("/blocks/control/text");

    // The SCROLLER, not `showcase-preview` - that one is the width wrapper
    // inside it and never scrolls on its own.
    const scroller = page.getByTestId("showcase-scroll");
    await expect(scroller).toBeVisible();

    const overflow = await page.evaluate(() => ({
      doc:
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
      body: document.body.scrollHeight - document.body.clientHeight,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(1);
    expect(overflow.body).toBeLessThanOrEqual(1);

    // And the preview is the one that does scroll, so the content is reachable.
    const previewOverflow = await scroller.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(previewOverflow).toBeGreaterThan(0);

    // The header bar stays put while the preview moves under it.
    const before = await page
      .getByRole("radio", { name: "Full" })
      .boundingBox();
    await scroller.evaluate((el) => el.scrollTo(0, 300));
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    const after = await page.getByRole("radio", { name: "Full" }).boundingBox();
    expect(after!.y).toBe(before!.y);
  });
});

test.describe("AlephaTable", () => {
  test("renders rows fetched through the action registry", async ({ page }) => {
    await page.goto("/blocks/table");

    // Real content, not a row count: an empty table also has a tbody.
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("ada.lovelace@alepha.dev")).toBeVisible();
    await expect(page.getByText("No results.")).toHaveCount(0);
  });

  test("filters on the server", async ({ page }) => {
    await page.goto("/blocks/table");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    await page.getByPlaceholder("Search members").fill("turing");

    await expect(page.getByText("Alan Turing")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toHaveCount(0);
  });
});

test.describe("blocks", () => {
  test("a toast is raised on demand", async ({ page }) => {
    await page.goto("/blocks/toast");
    await page.getByRole("button", { name: "Success", exact: true }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    await expect(page.getByText("Settings saved")).toBeVisible();
  });

  test("a dialog resolves with the reader's answer", async ({ page }) => {
    await page.goto("/blocks/dialog");
    await page.getByRole("button", { name: "confirm", exact: true }).click();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("confirmed")).toBeVisible();
  });

  test("AutoForm reveals its conditional field", async ({ page }) => {
    await page.goto("/blocks/auto-form/basic");

    await expect(page.getByLabel("Api Token")).toHaveCount(0);
    // Filter on the CURRENT value, not on "Select": `role` defaults to
    // "viewer", so a "Select" filter matches the Region combobox instead and
    // opens a dropdown with no `admin` option in it.
    await page.getByRole("combobox").filter({ hasText: "viewer" }).click();
    await page.getByRole("option", { name: "admin" }).click();

    await expect(page.getByLabel("Api Token")).toBeVisible();
  });

  test("Control is one page per kind of value", async ({ page }) => {
    await page.goto("/blocks/control/text");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Bio")).toBeVisible();

    await page.goto("/blocks/control/number");
    await expect(page.getByLabel("Age")).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Newsletter" }),
    ).toBeVisible();

    await page.goto("/blocks/control/date");
    await expect(page.getByLabel("Birthday")).toBeVisible();
    await expect(page.getByLabel("Alarm")).toBeVisible();
  });

  test("AutoForm splits objects from arrays", async ({ page }) => {
    await page.goto("/blocks/auto-form/object");
    await expect(page.getByText("Billing").first()).toBeVisible();

    // An object group starts CLOSED - an optional one is genuinely absent from
    // the payload until opened, and a nested one is not in the DOM at all. So
    // the second level only exists once the first is opened, which is the
    // behaviour worth asserting rather than working around.
    await expect(page.getByText("Address")).toHaveCount(0);
    // Contact, Billing, Preferences - every object group starts uninitialised
    // behind an "Initialize" button, required ones included. Billing is the
    // second.
    await page.getByRole("button", { name: "Initialize" }).nth(1).click();

    await expect(page.getByText("Address").first()).toBeVisible();
    await expect(page.getByLabel("Company")).toBeVisible();

    await page.goto("/blocks/auto-form/array");
    // An array of objects is a repeated GROUP, not a tag list, so the seeded
    // rows render their own fields.
    await expect(page.getByText("Members").first()).toBeVisible();
    // The seeded rows, read off the controls they populate.
    await expect(page.locator('input[name$="email"]').first()).toHaveValue(
      "ada@alepha.dev",
    );
    await expect(page.getByText("owner").first()).toBeVisible();
  });

  test("the select page offers every shape of the control", async ({
    page,
  }) => {
    await page.goto("/blocks/control/select");

    // The knob-driven control, then the ones the schema decides on its own.
    await expect(page.getByText("Driven by the knobs")).toBeVisible();
    await expect(page.getByLabel("Fruit (a bare enum)")).toBeVisible();
    await expect(page.getByText("Clearable", { exact: true })).toBeVisible();
  });

  test("buttons render every shape", async ({ page }) => {
    await page.goto("/blocks/buttons");
    await expect(page.getByText("Common shapes")).toBeVisible();
  });
});

/**
 * Auth and Account are five pages each, not one page with a dropdown, because
 * that is what they are in an application that mounts them. Each entry below
 * is a route AND a sidebar link, and both have been wrong before.
 */
const PAGE_SCREENS = [
  { path: "/pages/auth/login", content: "Continue with Github" },
  { path: "/pages/auth/register", content: "Cancel" },
  { path: "/pages/auth/reset", content: "Email" },
  { path: "/pages/auth/verify", content: "Sign in" },
  { path: "/pages/auth/mfa", content: "a•••@alepha.dev" },
  { path: "/pages/account/profile", content: "ada@alepha.dev" },
  { path: "/pages/account/security", content: "Sign-in methods" },
  { path: "/pages/account/sessions", content: "Chrome" },
  { path: "/pages/account/keys", content: "CLI on my laptop" },
  { path: "/pages/account/connections", content: "Lore MCP" },
] as const;

test.describe("page showcases", () => {
  for (const screen of PAGE_SCREENS) {
    test(`${screen.path} renders its own screen`, async ({ page }) => {
      await page.goto(screen.path);

      await expect(page.getByText(screen.content).first()).toBeVisible();

      // A failed action is reported to the READER, not the console, so a page
      // can 200 with every assertion green while telling its visitor an action
      // was not found. `/pages/account/security` did exactly that.
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    });
  }
});
