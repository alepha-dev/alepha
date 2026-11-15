import * as fs from "node:fs";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  emailDirOf,
  registerAndVerify,
  signIn,
} from "./_helpers.ts";

/**
 * Table folios end to end (#E144, #Q3522), on the built server: a table made
 * and filled from the browser, read back after a reload, moved on the
 * calendar, round-tripped through CSV, placed on the dashboard, and written
 * by two people at once.
 */

/**
 * A CSV already in the form Lore writes (byte order mark, CRLF, a field
 * quoted only when it must be), so its export can be compared byte for
 * byte. Dates sit in 2030: the dashboard card shows what comes next.
 */
const FIXTURE = [
  "\uFEFFName,Budget,Due,Approved",
  '"Venue, hall A",4200,2030-01-04,true',
  "Catering,1850.5,2030-01-09,false",
  "Speakers,3000,2030-01-21,true",
  "Badges,240,,false",
  "",
].join("\r\n");

const grid = (page: Page): Locator => page.getByRole("grid");

const cell = (page: Page, row: number, column: string): Locator =>
  page.getByRole("gridcell", { name: `${column}, row ${row}`, exact: true });

const modal = (page: Page): Locator =>
  page.locator("[role=dialog],[role=alertdialog]").last();

const prompt = async (page: Page, value: string) => {
  const dialog = modal(page);
  await dialog.locator("input").fill(value);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
};

const columnMenu = (page: Page, name: string): Locator =>
  page
    .getByRole("columnheader", { name: new RegExp(`^${name}`) })
    .getByRole("button");

const retype = async (page: Page, name: string, type: string) => {
  await columnMenu(page, name).click();
  await page.getByRole("menuitem", { name: "Change type" }).click();
  await page.getByRole("menuitem", { name: type, exact: true }).click();
  await modal(page).getByRole("button", { name: "Change type" }).click();
};

test.describe("table folios", () => {
  test.beforeEach(() => {
    fs.mkdirSync(emailDirOf(), { recursive: true });
  });

  test("is made from the tree and typed by keyboard, and survives a reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await registerAndVerify(page, "ana@acme.example", "Acme-Password-1");
    const project = await createProjectViaWizard(page, "Acme");
    await page.goto(`/${project.slug}/folios`);

    await page
      .locator("[data-slot=folio-tree]")
      .getByRole("button", { name: "New folio" })
      .click();
    await page.getByRole("menuitem", { name: "Table", exact: true }).click();
    await expect(grid(page)).toBeVisible();

    await page.getByRole("button", { name: "Add column" }).click();
    await prompt(page, "Due");
    await retype(page, "Due", "date");
    await page.getByRole("button", { name: "Add column" }).click();
    await prompt(page, "Owner");
    await retype(page, "Owner", "select");
    await columnMenu(page, "Owner").click();
    await page.getByRole("menuitem", { name: "Edit options…" }).click();
    await prompt(page, "Ana, Ben");

    const addRow = page.getByRole("button", { name: "Add row" });
    for (const count of [2, 3, 4]) {
      await expect(addRow).toBeEnabled();
      await addRow.focus();
      await page.keyboard.press("Enter");
      await expect(grid(page).getByRole("row")).toHaveCount(count);
    }

    const rows = [
      ["Brief", "2026-11-20", "Ana"],
      ["Draft", "2026-11-05", "Ben"],
      ["Launch", "2026-11-26", "Ana"],
    ];
    // Name and Owner typed cell by cell, the dates pasted as one column:
    // a date is picked, never typed, and a pasted range is the keyboard's
    // way to fill several.
    await grid(page).focus();
    for (const [index, [name, , owner]] of rows.entries()) {
      await expect(cell(page, index + 1, "Name")).toHaveClass(/ring-2/);
      await page.keyboard.type(name);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("option", { name: owner })).toBeVisible();
      const highlighted = page.locator("[role=option][data-highlighted]");
      for (let step = 0; step < 4; step++) {
        if (
          (await highlighted.count()) === 1 &&
          (await highlighted.textContent()) === owner
        ) {
          break;
        }
        await page.keyboard.press("ArrowDown");
      }
      await expect(highlighted).toHaveText(owner);
      await page.keyboard.press("Enter");
      await expect(cell(page, index + 1, "Owner")).toHaveText(owner);
      await expect(cell(page, index + 1, "Name")).toHaveText(name);
      await grid(page).focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(cell(page, 1, "Due")).toHaveClass(/ring-2/);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      (text) => navigator.clipboard.writeText(text),
      rows.map(([, due]) => due).join("\n"),
    );
    await page.keyboard.press("ControlOrMeta+V");
    await expect(cell(page, 3, "Due")).not.toBeEmpty();

    await page.reload();
    for (const [index, [name, , owner]] of rows.entries()) {
      await expect(cell(page, index + 1, "Name")).toHaveText(name);
      await expect(cell(page, index + 1, "Owner")).toHaveText(owner);
    }
    await expect(cell(page, 1, "Due")).toContainText("2026");
    await expect(columnMenu(page, "Due")).toBeVisible();
  });

  test("round-trips a CSV byte for byte, moves on the calendar, and shows on the dashboard", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await registerAndVerify(page, "ben@acme.example", "Acme-Password-1");
    const project = await createProjectViaWizard(page, "Acme Events");
    await page.goto(`/${project.slug}/folios`);

    const file = testInfo.outputPath("event-budget.csv");
    fs.writeFileSync(file, FIXTURE);
    await page
      .locator("[data-slot=folio-tree]")
      .getByRole("button", { name: "New folio" })
      .click();
    await page.getByRole("menuitem", { name: "Import CSV…" }).click();
    const importer = modal(page);
    await importer.locator('input[type="file"]').setInputFiles(file);
    await importer.getByRole("button", { name: "Import 4 rows" }).click();
    await expect(cell(page, 1, "Name")).toHaveText("Venue, hall A");
    await expect(cell(page, 4, "Name")).toHaveText("Badges");

    await page.getByRole("menuitem", { name: "Folio" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as .csv" }).click();
    const exported = fs.readFileSync((await (await download).path())!);
    expect(exported.equals(Buffer.from(FIXTURE, "utf8"))).toBe(true);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/view") && r.request().method() === "POST",
    );
    await page.getByRole("tab", { name: "Calendar" }).click();
    expect((await saved).ok()).toBe(true);
    const url = new URL(page.url());
    url.searchParams.set("month", "2030-01");
    await page.goto(url.toString());
    const calendar = page.locator("[data-slot=folio-calendar]");
    await calendar
      .locator("[data-day] [data-row-number='1']")
      .dragTo(calendar.locator("[data-day='2030-01-15']"));
    await expect(
      calendar.locator("[data-day='2030-01-15'] [data-row-number='1']"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Grid" }).click();
    await expect(cell(page, 1, "Due")).toContainText("15");

    await page.getByRole("menuitem", { name: "Folio" }).click();
    await page.getByRole("menuitem", { name: "Add to dashboard…" }).click();
    await modal(page).getByRole("button", { name: "Dashboard" }).click();
    await expect(
      page.getByText(/^(Added to Dashboard\.|Dashboard was customized)/),
    ).toBeVisible();
    await page.goto(`/${project.slug}`);
    await expect(page.getByText("Catering").first()).toBeVisible();
  });

  test("lets two writers edit two rows at once, and keeps what the second typed in one cell", async ({
    page,
    browser,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await registerAndVerify(page, "chloe@acme.example", "Acme-Password-1");
    const project = await createProjectViaWizard(page, "Acme Ops");
    await page.goto(`/${project.slug}/folios`);
    await page
      .locator("[data-slot=folio-tree]")
      .getByRole("button", { name: "New folio" })
      .click();
    await page.getByRole("menuitem", { name: "Table", exact: true }).click();
    const addRow = page.getByRole("button", { name: "Add row" });
    for (const count of [2, 3]) {
      await expect(addRow).toBeEnabled();
      await addRow.click();
      await expect(grid(page).getByRole("row")).toHaveCount(count);
    }
    const folioUrl = page.url();

    const other = await browser.newContext({ baseURL });
    const second = await other.newPage();
    await second.setViewportSize({ width: 1600, height: 900 });
    expect(await signIn(second, "chloe@acme.example", "Acme-Password-1")).toBe(
      true,
    );
    await second.goto(folioUrl);
    await expect(cell(second, 2, "Name")).toBeVisible();

    const write = async (on: Page, row: number, text: string) => {
      await cell(on, row, "Name").dblclick();
      await on.keyboard.press("ControlOrMeta+A");
      await on.keyboard.type(text);
      await on.keyboard.press("Enter");
    };

    await Promise.all([write(page, 1, "First"), write(second, 2, "Second")]);
    await expect(cell(page, 1, "Name")).toHaveText("First");
    await expect(cell(second, 2, "Name")).toHaveText("Second");
    await expect(page.getByText("This row changed elsewhere")).toHaveCount(0);
    await expect(second.getByText("This row changed elsewhere")).toHaveCount(0);

    // The same cell, both writers on the row as it stands: the first write
    // lands, the second is told and keeps what it typed, marked, until it
    // writes it again.
    await page.reload();
    await expect(cell(page, 2, "Name")).toHaveText("Second");
    await write(page, 2, "Mine");
    await expect(cell(page, 2, "Name")).toHaveText("Mine");
    await write(second, 2, "Theirs");
    await expect(
      second.getByText(/This row changed elsewhere/).first(),
    ).toBeVisible();
    await expect(cell(second, 2, "Name")).toContainText("Theirs");
    await second.reload();
    await expect(cell(second, 2, "Name")).toHaveText("Mine");
    await other.close();
  });
});
