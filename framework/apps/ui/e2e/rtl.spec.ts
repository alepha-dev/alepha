import type { BrowserContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";

/**
 * Right-to-left, measured (#Q3332).
 *
 * jsdom has no layout, so a browser spec can say which classes a component
 * carries and nothing about where it lands. This one reads positions off a
 * real page, once per reading direction, and expects the two to mirror: the
 * left-to-right run is the control group, so a position that is wrong in
 * both directions fails here rather than passing as "unchanged".
 *
 * No catalog of the showcase is right-to-left (they are English and French),
 * so the spec brings its own language: a `lang=ar` cookie. The server takes
 * the cookie as the request's language, writes `<html lang="ar" dir="rtl">`,
 * and the strings fall back to English, which is all a measurement needs.
 */

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  expect(b, "the element has a layout box").not.toBeNull();
  return b!;
};

const centreX = (b: { x: number; width: number }) => b.x + b.width / 2;

const open = async (
  page: Page,
  context: BrowserContext,
  dir: "ltr" | "rtl",
  path: string,
  baseURL: string | undefined,
) => {
  if (dir === "rtl") {
    await context.addCookies([
      {
        // The cookie holds JSON, URI-encoded, as `$cookie` writes it.
        name: "lang",
        value: encodeURIComponent(JSON.stringify("ar")),
        url: baseURL ?? "http://localhost",
      },
    ]);
  }
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
};

for (const dir of ["ltr", "rtl"] as const) {
  const rtl = dir === "rtl";

  test.describe(`reading ${dir}`, () => {
    test("the shell puts its sidebar at the start of the line", async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, context, dir, "/blocks/control/text", baseURL);

      const sidebar = await box(
        page.locator('[data-slot="sidebar-container"]').first(),
      );
      const main = await box(page.locator("main").first());
      if (rtl) {
        expect(sidebar.x, "the sidebar is right of the page").toBeGreaterThan(
          main.x,
        );
      } else {
        expect(sidebar.x, "the sidebar is left of the page").toBeLessThan(
          main.x,
        );
      }

      // The header's actions sit at the END of the bar: the right of a
      // left-to-right page, the left of a right-to-left one.
      const header = await box(page.locator("header").first());
      const theme = await box(page.getByRole("button", { name: "Pick theme" }));
      if (rtl) {
        expect(centreX(theme)).toBeLessThan(centreX(header));
      } else {
        expect(centreX(theme)).toBeGreaterThan(centreX(header));
      }
    });

    test("a field puts its icon and its padding at the start", async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, dir, "/blocks/control/text", baseURL);

      const input = page.locator('input[autocomplete="email"]').first();
      const icon = page
        .locator('div.relative:has(> input[autocomplete="email"]) > svg')
        .first();
      const field = await box(input);
      const glyph = await box(icon);
      if (rtl) {
        expect(centreX(glyph), "the icon is in the right half").toBeGreaterThan(
          centreX(field),
        );
      } else {
        expect(centreX(glyph), "the icon is in the left half").toBeLessThan(
          centreX(field),
        );
      }

      // The room kept for the icon is on the icon's side, so the text never
      // runs under it.
      const padding = await input.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          left: Number.parseFloat(style.paddingLeft),
          right: Number.parseFloat(style.paddingRight),
        };
      });
      if (rtl) {
        expect(padding.right).toBeGreaterThan(padding.left);
      } else {
        expect(padding.left).toBeGreaterThan(padding.right);
      }
    });

    test("an end-aligned dropdown lines up with its trigger's end", async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, context, dir, "/blocks/control/text", baseURL);

      // `ButtonTheme` opens its menu with `align="end"`. Floating UI, under
      // Base UI, resolves an alignment from the element's computed direction
      // on its own, so this holds with or without the `DirectionProvider`:
      // the side, below, is what needs it.
      const button = page.getByRole("button", { name: "Pick theme" });
      await button.click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      // The open animation scales the menu from its origin: wait for it to
      // settle before measuring.
      await expect(menu).not.toHaveAttribute("data-starting-style");
      await page.waitForTimeout(250);

      const trigger = await box(button);
      const popup = await box(menu);
      if (rtl) {
        expect(Math.abs(popup.x - trigger.x)).toBeLessThan(2);
      } else {
        expect(
          Math.abs(popup.x + popup.width - (trigger.x + trigger.width)),
        ).toBeLessThan(2);
      }
    });

    test("a context menu opens toward the end of the line", async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, context, dir, "/blocks/data-table/basic", baseURL);

      // A context menu opens on `side="inline-end"`, which Base UI resolves
      // to a physical side from the `DirectionProvider` the shell mounts, and
      // from nothing else: without it a right-to-left page opens the menu to
      // the RIGHT of the pointer, as a left-to-right one does. A header in
      // the middle of the table, so neither edge of the viewport flips it.
      const headers = page.getByRole("columnheader");
      await expect(headers.nth(2)).toBeVisible();
      const header = await box(headers.nth(2));
      const at = { x: header.width / 2, y: header.height / 2 };
      await headers.nth(2).click({ button: "right", position: at });
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu).not.toHaveAttribute("data-starting-style");
      await page.waitForTimeout(250);

      const pointer = header.x + at.x;
      const popup = await box(menu);
      if (rtl) {
        expect(
          popup.x + popup.width,
          "the menu ends at the pointer",
        ).toBeLessThanOrEqual(pointer + 1);
      } else {
        expect(
          popup.x,
          "the menu starts at the pointer",
        ).toBeGreaterThanOrEqual(pointer - 1);
      }
    });

    test("a sheet with no side opens at the end of the line", async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, context, dir, "/blocks/overlays", baseURL);

      await page.getByRole("button", { name: "Open sheet" }).click();
      const sheet = page.getByRole("dialog", { name: "Filters" });
      await expect(sheet).toBeVisible();
      // The slide-in is a transform: wait for it to settle.
      await expect(sheet).not.toHaveAttribute("data-starting-style");
      await page.waitForTimeout(300);

      const panel = await box(sheet);
      if (rtl) {
        expect(panel.x, "against the left edge").toBeLessThan(1);
      } else {
        expect(panel.x + panel.width, "against the right edge").toBeGreaterThan(
          1279,
        );
      }
    });

    test("a switch moves its thumb toward the end when checked", async ({
      page,
      context,
      baseURL,
    }) => {
      await open(page, context, dir, "/blocks/control/text", baseURL);

      // The page's own options panel draws its booleans as switches; the
      // first one that is off is turned on.
      const switches = page.locator('[data-slot="switch"]');
      await expect(switches.first()).toBeVisible();
      const index = await switches.evaluateAll((els) =>
        els.findIndex((el) => !el.hasAttribute("data-checked")),
      );
      expect(index, "an unchecked switch on the page").toBeGreaterThanOrEqual(
        0,
      );
      const control = switches.nth(index);
      const thumb = control.locator('[data-slot="switch-thumb"]');
      const track = await box(control);
      const before = await box(thumb);
      await control.click();
      await expect(control).toHaveAttribute("data-checked", "");
      // Let the transform finish.
      await page.waitForTimeout(300);
      const after = await box(thumb);

      if (rtl) {
        expect(centreX(after), "checked sits on the left").toBeLessThan(
          centreX(track),
        );
      } else {
        expect(centreX(after), "checked sits on the right").toBeGreaterThan(
          centreX(track),
        );
      }
      // And the thumb stays inside its track.
      expect(after.x).toBeGreaterThanOrEqual(track.x - 1);
      expect(after.x + after.width).toBeLessThanOrEqual(
        track.x + track.width + 1,
      );
      // Unchecked, it started at the other end.
      if (rtl) {
        expect(centreX(before)).toBeGreaterThan(centreX(track));
      } else {
        expect(centreX(before)).toBeLessThan(centreX(track));
      }
    });
  });
}
