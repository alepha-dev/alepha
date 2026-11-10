import { describe, it } from "vitest";

import { carts } from "../cart/entities/carts.ts";
import { checkoutSessions } from "../checkout/entities/checkoutSessions.ts";
import { downloads } from "../downloads/entities/downloads.ts";

/**
 * Each of these columns is a bearer token: whoever holds the value acts as
 * the customer it belongs to. Marked `secret: true`, they are redacted by
 * anything that reads rows on a model's behalf (`alepha mcp`'s `db_rows`).
 */
describe("commerce secret columns", () => {
  it("marks the anonymous cart handle", ({ expect }) => {
    expect(carts.secretColumns).toEqual(["token"]);
  });

  it("marks the download link's token", ({ expect }) => {
    expect(downloads.secretColumns).toEqual(["token"]);
  });

  it("marks the recovery unsubscribe token", ({ expect }) => {
    expect(checkoutSessions.secretColumns).toEqual(["recoveryToken"]);
  });
});
