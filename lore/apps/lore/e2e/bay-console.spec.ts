import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import WebSocket from "ws";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Bay console, in a real browser, over a real inventory (#E37).
 *
 * A jsdom spec proves a component; it does not prove a page. Folio #F1208 is
 * what that cost once: a unit spec returned the right options while the real
 * filter discarded them. Everything the console draws is derived from one
 * stored frame, and this is the only place that derivation is exercised
 * through a router, a layout and a table.
 *
 * ## How the estate gets an inventory with no machine
 *
 * There is no seed endpoint and nothing writes the row directly. The spec
 * plays the machine: it opens `/ws/estates` with the estate secret as a
 * bearer, says `hello`, waits for the `welcome`, sends **the wire-v1
 * `inventory.json` fixture** - the same bytes `wire_test.go` and
 * `estate-wire-format.spec.ts` both pin - and closes. The frame therefore
 * lands through `EstateSocketController` exactly as Bay's would, and the
 * close leaves the estate OFFLINE, which is the state most of these
 * assertions want: a queued command that says it will run when the machine
 * reconnects is only truthful about an offline estate.
 *
 * `ws` rather than Node's global `WebSocket`: the handshake carries the
 * secret in an `Authorization` header, and the WHATWG API cannot set one.
 *
 * ## The reconciliation needs both sides
 *
 * The fixture reports four instances and knows nothing about projects. Two
 * app instances are created against this estate before the walk: `lore`,
 * which the fixture also reports (matched), and `ghost`, which it does not
 * (expected here, not running). The other three reported apps are tracked
 * nowhere, which is the third state. All three are on screen in one run.
 *
 * ⚠️ Every `$action` the SPA calls goes through `POST /api/_batch`, so a wait
 * on a named response hangs. Assertions are on rendered state, which only
 * changes once the server has answered. The one click that saves outside a
 * batch is armed with `waitForResponse` before it happens.
 */
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../bay/internal/connector/testdata/wire-v1",
);

const inventoryFrame = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURE, "inventory.json"), "utf8"));

/**
 * Base UI leaves `pointer-events: none` on `<body>` after a dialog closes,
 * and the next click then lands on nothing. Same helper `estates.spec.ts`
 * carries, for the same reason.
 */
const releasePointerEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.style.pointerEvents = "";
  });
};

/**
 * Create an estate and keep its secret.
 *
 * The reveal dialog is the only moment the cleartext exists - the column
 * stores a hash - so it is read here rather than looked up later.
 */
const createEstateAndReadSecret = async (
  page: Page,
  slug: string,
): Promise<string> => {
  await page.goto("/account/estates");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("estate-create-open").click();
  await page.getByTestId("estate-create-slug").fill(slug);
  await page.getByTestId("estate-create-submit").click();

  const reveal = page.getByTestId("my-estate-secret-dialog");
  await expect(reveal).toBeVisible({ timeout: 15_000 });
  const secret = await reveal.getByText(/est_[A-Za-z0-9_-]{16,}/).innerText();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await releasePointerEvents(page);
  return secret.trim();
};

/**
 * Call one `$action` by NAME, over the page's own session.
 *
 * By name rather than by path for the reason `bay.e2e.spec.ts` does it: the
 * registry the SPA itself reads is the source, so a moved route fails as "no
 * such action" instead of as a 404 to interpret. `apiPost` in `_helpers.ts`
 * only speaks POST, and pointing an instance at an estate is a PATCH.
 */
const apiCall = async <T>(
  page: Page,
  action: string,
  method: string,
  path: Record<string, string | number>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(path)) {
    url = url.replace(`:${key}`, String(value));
  }
  return (await page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    },
    { url, method, body },
  )) as T;
};

/**
 * Play the machine once: hello, welcome, one inventory, close.
 *
 * Resolved only after the socket has closed, so the estate is offline by the
 * time the walk starts and the row is already written: `record` runs inside
 * the message handler, and closing before it returned would race the read.
 */
const pushInventory = async (
  baseURL: string,
  secret: string,
  frame: Record<string, unknown>,
): Promise<void> => {
  const url = `${baseURL.replace(/^http/, "ws")}/ws/estates`;
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${secret}` },
  });

  await new Promise<void>((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error("the fake machine never completed its handshake")),
      20_000,
    );
    socket.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    socket.on("open", () => socket.send(JSON.stringify({ type: "hello" })));
    socket.on("message", (raw) => {
      // `ws` hands over a Buffer, an ArrayBuffer or a list of Buffers
      // depending on how the frame arrived, and only the first of the three
      // stringifies to anything useful on its own.
      const text = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : Buffer.from(raw).toString("utf8");
      const message = JSON.parse(text) as { type?: string };
      if (message.type !== "welcome") return;
      socket.send(JSON.stringify(frame));
      // Closed from this side once the frame is on the wire. The server
      // stamps `disconnectedAt` in `onDisconnect`, which is what leaves the
      // estate offline with an inventory - the state the console is written
      // for and the one no other test produces.
      socket.close();
    });
    socket.on("close", () => {
      clearTimeout(timer);
      done();
    });
  });
};

test.describe("The Bay console", () => {
  test("renders a machine's inventory, all three reconciliation states, and queues a command", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await registerAndVerify(
      page,
      `bay-console-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );

    const secret = await createEstateAndReadSecret(page, "ovh-console");

    // The row routes to the console for a `bay` estate rather than opening
    // the drawer, and the URL is where the id comes from: nothing on the
    // page prints it, and reading it here proves that routing at the same
    // time.
    await page.getByTestId("my-estate-row").click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const estateId = new URL(page.url()).pathname.split("/")[2];
    expect(estateId).toBeTruthy();

    // Both sides of the reconciliation. The estate is lent to the project
    // first: `AppService.setEstate` refuses a reference the project has no
    // grant for, which is validation of the reference and not of the caller.
    const project = await createProjectViaWizard(page, "Bay Console");
    await apiCall(
      page,
      "attachEstate",
      "POST",
      { projectId: project.id },
      {
        estateId,
      },
    );
    for (const app of ["lore", "ghost"]) {
      await apiCall(
        page,
        "createApp",
        "POST",
        { projectId: project.id },
        {
          app,
          env: "production",
        },
      );
      await apiCall(
        page,
        "updateApp",
        "PATCH",
        { projectId: project.id, app, env: "production" },
        { estateId },
      );
    }

    await pushInventory(baseURL ?? "", secret, inventoryFrame());

    // -- Overview -----------------------------------------------------------
    await page.goto(`/bay/${estateId}`);
    await page.waitForLoadState("networkidle");

    // The gauges come from the frame's host block, and the units are the
    // shared formatter's: 8232062976 bytes reads as 7.7 GB, not as 8 GB and
    // not as a byte count.
    await expect(page.getByText("Memory", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Disk", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/[\d.]+ GB of [\d.]+ GB/).first(),
    ).toBeVisible();
    // Cores and load are absolutes the machine reported, so neither may read
    // "not reported" here.
    await expect(page.getByText("Cores", { exact: true })).toBeVisible();
    await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("0.52")).toBeVisible();
    await expect(page.getByText("Bay 0.31.0")).toBeVisible();
    // The socket was closed after the frame, so the machine is gone and the
    // inventory it left is still readable. Both halves matter: an offline
    // estate showing no inventory would be indistinguishable from one that
    // never connected.
    // Said twice on this page, by the header badge and by the Connection
    // card, so the count is asserted rather than the first match: one of the
    // two disappearing is exactly the kind of regression a `.first()` hides.
    await expect(page.getByText("offline", { exact: true })).toHaveCount(2);

    // -- Apps, and the three reconciliation states --------------------------
    await page.getByRole("link", { name: "Apps", exact: true }).click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}\/apps/, { timeout: 15_000 });

    // Four reported plus one Lore expected and did not get.
    await expect(page.getByText("docs", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("shop", { exact: true })).toBeVisible();
    await expect(page.getByText("api", { exact: true })).toBeVisible();

    // matched: reported AND tracked, so it carries the project title and
    // neither badge.
    await expect(page.getByText("Bay Console").first()).toBeVisible();
    // untracked: running here, tracked nowhere. Three of them.
    await expect(page.getByText("not in Lore")).toHaveCount(3);
    // missing: the state that earns the table. `ghost` points at this estate
    // and the machine did not report it.
    await expect(page.getByText("expected here, not running")).toHaveCount(1);
    await expect(page.getByText("ghost", { exact: true })).toBeVisible();

    /*
     * The process states are a second vocabulary on the same rows, and the
     * fixture carries four different ones on purpose: a healthy app, a static
     * site that is `running: false` forever and fine, a stop somebody owns,
     * and a crash past the restart limit.
     *
     * Scoped to the BADGES rather than to the page. `static` is also a
     * runtime, and `stopped` is a word the fixture could grow elsewhere, so
     * a bare text match reads a value out of another column and calls it a
     * state. One of each, because two would mean a row landed in the wrong
     * bucket.
     */
    const stateBadge = (label: string) =>
      page
        .locator('[data-slot="badge"]')
        .filter({ hasText: new RegExp(`^${label}$`) });
    await expect(stateBadge("running")).toHaveCount(1);
    await expect(stateBadge("static")).toHaveCount(1);
    await expect(stateBadge("stopped")).toHaveCount(1);
    await expect(stateBadge("crashed")).toHaveCount(1);
    // Bay's own words, verbatim and untranslated, beside Lore's badges.
    await expect(page.getByText("backup is stale")).toBeVisible();

    /*
     * -- One instance ------------------------------------------------------
     *
     * A matched row has TWO destinations and they are not the same page. The
     * app NAME links out to that project's own app page; the row itself opens
     * this console's instance page. Asserting the link by href rather than by
     * following it, because the value is the trap: `router.path` merges the
     * current route's params by name, and this route holds `estateId` and
     * nothing else - so an implicit `projectSlug` renders the literal
     * `:projectSlug` and the link goes nowhere.
     */
    await expect(
      page.getByRole("link", { name: "lore", exact: true }).first(),
      // Trailing slash: `app` is the index child of `projectApp`, so the
      // dashboard's own path ends there. Matched exactly anyway - the thing
      // being proved is that every segment is substituted.
    ).toHaveAttribute("href", `/${project.slug}/apps/lore/production/`);

    // Clicked on the release cell rather than on the row's own name, which is
    // that link. Any other cell reaches `onRowClick`.
    await page.getByText("r-2026-09-06-1").click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}\/apps\/lore\/production/, {
      timeout: 15_000,
    });
    await expect(page.getByText("r-2026-09-06-1")).toBeVisible({
      timeout: 20_000,
    });
    // Both domains, because the fixture carries two and a page that rendered
    // only the first would look right with one.
    await expect(
      page.getByText("lore.alepha.dev", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("www.lore.alepha.dev", { exact: true }),
    ).toBeVisible();

    // -- An action queues, and lands on Commands ----------------------------
    //
    // Armed BEFORE the click: the button is optimistic, so its own state
    // changes before the request is sent, and asserting on that would pass
    // roughly 3 ms early. This is the race a green CI over a red local run
    // is made of.
    const queued = page.waitForResponse(
      (response) =>
        response.url().includes("/api/") &&
        response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByTestId("bay-action-restart").click();
    await queued;

    await page.goto(`/bay/${estateId}/commands`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("restart", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // Pending, not failed: no machine holds the socket, so the command waits
    // for the next hello rather than being refused.
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
  });
});
