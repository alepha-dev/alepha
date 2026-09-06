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

  test("a stored colour mode does not break hydration", async ({ page }) => {
    // Every page here is `static: true`, so its HTML is built with the DEFAULT
    // preference. `ButtonDark` used to pick one icon from the colour mode
    // during render, so a returning visitor's first render disagreed with the
    // prerendered HTML: React #418 on every cold load, and the prerendered
    // tree thrown away and re-rendered. It renders every icon now and lets CSS
    // reveal one, which is what `apps/docs` had already settled on.
    //
    // ⚠️ Only a visitor who has ALREADY chosen a mode saw it, which is why a
    // cold crawl with empty storage stayed green throughout.
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/blocks/table");
    await page
      .getByRole("button", { name: /toggle color mode/i })
      .first()
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", /.+/);

    errors.length = 0;
    // A different prerendered page, loaded cold with the preference stored.
    await page.goto("/blocks/buttons");
    await expect(
      page.getByRole("button", { name: /toggle color mode/i }).first(),
    ).toBeVisible();

    expect(errors.filter((e) => /#418|#423|[Hh]ydrat/.test(e))).toEqual([]);

    // And exactly one icon shows - the swap must reveal one, not hide all.
    const visible = await page
      .getByRole("button", { name: /toggle color mode/i })
      .first()
      .evaluate(
        (b) =>
          [...b.querySelectorAll("svg")].filter(
            (s) => s.getBoundingClientRect().width > 0,
          ).length,
      );
    expect(visible).toBe(1);
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

  test("a scalar-array control can actually be given a value", async ({
    page,
  }) => {
    // Every one of these rendered, was labelled, and was completely unusable:
    // an array of scalars becomes a MULTI-SELECT, and one with no `items` is a
    // select over an empty list. It opened on "No results." and no value could
    // ever be entered, while the page's own help text called it a tag list.
    // Nothing that asserts a control is PRESENT can see that.
    const cases = [
      ["/blocks/control/text", "Tags", "alepha"],
      ["/blocks/control/number", "Seats", "42"],
      ["/blocks/auto-form/array", "Ports", "8080"],
    ] as const;

    for (const [path, label, typed] of cases) {
      await page.goto(path);
      const combo = page.getByRole("combobox", { name: label }).first();
      await combo.click();

      const search = page.getByRole("combobox", { name: "Search\u2026" });
      await search.fill(typed);

      const create = page.getByRole("option", {
        name: new RegExp(`Create.*${typed}`),
      });
      await expect(create).toBeVisible();
      await create.click();

      await expect(combo).toContainText(typed);
      await page.keyboard.press("Escape");
    }
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
 * The five layout blocks that are shells rather than controls: each one is
 * mostly empty until a caller fills it, so "it rendered" and "it rendered
 * anything" are two different claims. These assert the parts the components
 * themselves own - the frame, the rail, the aside, the tab toolbar, the
 * divided cards - and never a bare 200.
 */
test.describe("layout blocks", () => {
  test("App shell is a second shell, contained and live", async ({ page }) => {
    await page.goto("/blocks/shell");

    // Scoped throughout. There are literally two `AppShell`s on this page and
    // every slot the specimen has, the app's own chrome has too.
    const preview = page.getByTestId("showcase-preview");

    // The four slots a caller fills: brand, nav, breadcrumbs, footer.
    await expect(preview.getByText("Acme")).toBeVisible();
    await expect(preview.getByText("Onboarding")).toBeVisible();
    await expect(preview.getByText("Ada Lovelace")).toBeVisible();

    /**
     * ⚠️ The regression, and it is the same one `/blocks/sidebar` guards.
     * `fill` is what re-anchors the otherwise viewport-fixed rail into the
     * shell's own wrapper; drop it and the specimen renders perfectly while
     * lying across the whole window on top of the page it is nested in.
     */
    await expect(preview.locator('[data-slot="sidebar-container"]')).toHaveCSS(
      "position",
      "absolute",
    );

    // The rail is live rather than decorative: every entry is a link back to
    // this page with a different `?nav=`, which is also what keeps their React
    // keys distinct - `AppShell` keys a nav item by its href, so one shared
    // href is eleven children with the same key.
    await preview.getByRole("link", { name: "Quests" }).click();
    await expect(page).toHaveURL(/nav=quests/);
    await expect(preview.getByRole("link", { name: "Quests" })).toHaveAttribute(
      "data-active",
      "",
    );
  });

  test("Sidebar is a live rail, contained, that collapses to icons", async ({
    page,
  }) => {
    await page.goto("/blocks/sidebar");

    // Scoped throughout: this rail's labels are the same ordinary words as the
    // app's own rail on the left, and half of them appear again in the code
    // block the preview prints beside it.
    const preview = page.getByTestId("showcase-preview");

    // Real content, not a description of it. This page used to be prose.
    await expect(preview.getByText("Acme")).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Projects" }),
    ).toBeVisible();

    /**
     * ⚠️ The regression this exists for, and it is invisible to every
     * assertion above. The desktop rail is `fixed inset-y-0 h-svh`, pinned to
     * the VIEWPORT: without the provider's re-anchoring it renders perfectly,
     * reads perfectly, and lies across the whole window on top of the app.
     */
    await expect(preview.locator('[data-slot="sidebar-container"]')).toHaveCSS(
      "position",
      "absolute",
    );

    const sub = preview.locator('[data-slot="sidebar-menu-sub"]');
    await expect(sub).toContainText("Analytics");

    await preview.locator('[data-slot="sidebar-trigger"]').click();

    await expect(preview.locator('[data-slot="sidebar"]')).toHaveAttribute(
      "data-state",
      "collapsed",
    );
    // Collapsed to icons the sub-menu is unreachable, whatever its own
    // disclosure is set to - which is why AppShell swaps the group for a
    // dropdown at that width.
    await expect(sub).toBeHidden();
  });

  /**
   * The two tab kinds are the point of `PlateLayout`, and the pair is exactly
   * what a rendering assertion cannot tell apart: both draw five underlined
   * words. So this reads the roles, which is where the difference lives.
   */
  test("Plate is a navigation with link tabs and a tablist without", async ({
    page,
  }) => {
    await page.goto("/blocks/plate");

    // The band above the tabs, which the layout owns as a slot.
    await expect(page.getByText("Shipped 4 September 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

    // `tabsTestId` earns its keep here: every tab label is an ordinary word
    // that the tab BODY prints too.
    const bar = page.getByTestId("plate-tabs");
    await expect(bar).toHaveAttribute("role", "navigation");

    // A routed tab has to stay a link. `role="tab"` on an anchor would take it
    // out of `getByRole("link")` and tell a screen reader it swaps a panel
    // when it actually leaves the page.
    await bar.getByRole("link", { name: /Changelog/ }).click();
    await expect(page).toHaveURL(/tab=changelog/);
    await expect(bar.getByRole("link", { name: /Changelog/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The other kind is a panel swap inside one route, so it is a tablist of
    // buttons and the URL does not move.
    await page.getByLabel("Tab kind").click();
    await page.getByRole("option", { name: "buttons" }).click();

    await expect(bar).toHaveAttribute("role", "tablist");
    await bar.getByRole("tab", { name: /Flow/ }).click();
    await expect(bar.getByRole("tab", { name: /Flow/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page).toHaveURL(/tab=changelog/);
  });

  test("Detail draws its aside, its toolbar and the tab body", async ({
    page,
  }) => {
    await page.goto("/blocks/detail");

    // The identity column, which is the half that disappears below `md`.
    await expect(page.getByText("ada@alepha.dev")).toBeVisible();
    // The clipboard behaviour lives in DetailAside so no page reimplements it.
    await expect(page.getByRole("button", { name: "Copy Id" })).toBeVisible();

    // The toolbar: `Segmented` is a radiogroup, and the caller's actions sit
    // at the other end of it.
    await expect(page.getByRole("radio", { name: /Activity/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();

    // A tab switch changes the body and the URL, which is what `useDetailTab`
    // is for: "that user's sessions" has to be a link somebody can send.
    await page.getByRole("radio", { name: /Members/ }).click();
    await expect(page).toHaveURL(/tab=members/);
    await expect(
      page.getByText("Each body renders what it is given"),
    ).toBeVisible();
  });

  test("Settings draws the rail, the cards and the danger zone", async ({
    page,
  }) => {
    await page.goto("/blocks/settings");

    // Scoped to the preview throughout. Every knob in the props panel is
    // named after the thing it switches on, so "Danger zone" alone matches
    // the page description, the section title AND the switch's label.
    const preview = page.getByTestId("showcase-preview");

    // The rail groups by `group`, and an ungrouped entry renders first with no
    // heading above it.
    const rail = preview.getByRole("navigation");
    await expect(rail.getByText("Overview")).toBeVisible();
    await expect(rail.getByText("Account")).toBeVisible();
    // Visible but not reachable: rendered muted and inert rather than hidden.
    await expect(rail.getByText("Billing")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // A row is a label and one control, and the label is a real `<label>` when
    // the row is given an `htmlFor`.
    await expect(preview.getByLabel("Display name")).toHaveValue(
      "Ada Lovelace",
    );
    await expect(
      preview.getByRole("switch", { name: "Weekly digest" }),
    ).toBeVisible();

    // And the boundary between "change your display name" and "delete your
    // account", which is the whole point of the second card.
    await expect(preview.getByText("Danger zone")).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
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
