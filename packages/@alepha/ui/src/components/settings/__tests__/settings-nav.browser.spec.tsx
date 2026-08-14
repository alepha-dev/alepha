import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SettingsNav, type SettingsNavItem } from "../settings-nav.tsx";

/**
 * The rail's contract is narrow but easy to break silently: it must group by
 * first appearance rather than alphabetically (the caller has already sorted),
 * it must render hrefs verbatim (the reason it takes resolved items at all),
 * and a disabled entry must stop being a link rather than merely look muted.
 */
describe("SettingsNav", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (items: SettingsNavItem[]) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <SettingsNav items={items} />
      </AlephaContext.Provider>,
    );
  };

  const item = (over: Partial<SettingsNavItem> = {}): SettingsNavItem => ({
    name: "profile",
    href: "/account",
    label: "Profile",
    active: false,
    ...over,
  });

  it("renders each entry as a link to its resolved href", async () => {
    await mount([
      item(),
      item({ name: "sessions", href: "/account/sessions", label: "Sessions" }),
    ]);

    expect(
      screen.getByRole("link", { name: "Profile" }).getAttribute("href"),
    ).toBe("/account");
    expect(
      screen.getByRole("link", { name: "Sessions" }).getAttribute("href"),
    ).toBe("/account/sessions");
  });

  it("passes hrefs through untouched instead of resolving them", async () => {
    // The whole reason the component takes resolved items: it must not try to
    // be clever about a pattern it was handed. Garbage in, same garbage out —
    // visible to the caller rather than silently half-substituted.
    await mount([item({ href: "/:projectSlug/settings" })]);

    expect(
      screen.getByRole("link", { name: "Profile" }).getAttribute("href"),
    ).toBe("/:projectSlug/settings");
  });

  it("groups by first appearance, not alphabetically", async () => {
    await mount([
      item({ name: "profile", group: "Account" }),
      item({
        name: "sessions",
        href: "/a/s",
        label: "Sessions",
        group: "Security",
      }),
      item({ name: "keys", href: "/a/k", label: "Keys", group: "Security" }),
    ]);

    const headings = screen
      .getAllByText(/^(Account|Security)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(["Account", "Security"]);
  });

  it("renders ungrouped entries without a heading", async () => {
    const { container } = await mount([
      item(),
      item({ name: "b", label: "B" }),
    ]);

    expect(container.querySelectorAll("nav > div")).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("marks the active entry with aria-current", async () => {
    await mount([
      item({ active: true }),
      item({ name: "sessions", href: "/account/sessions", label: "Sessions" }),
    ]);

    expect(
      screen
        .getByRole("link", { name: "Profile" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Sessions" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders a disabled entry as inert text, not a link", async () => {
    await mount([item({ disabled: true })]);

    expect(screen.queryByRole("link")).toBeNull();
    const entry = screen.getByText("Profile");
    expect(entry.getAttribute("aria-disabled")).toBe("true");
  });
});
