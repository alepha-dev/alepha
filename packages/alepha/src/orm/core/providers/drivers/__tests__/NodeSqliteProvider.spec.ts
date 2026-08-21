import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { sql } from "../../../index.ts";
import { NodeSqliteProvider } from "../NodeSqliteProvider.ts";

describe("NodeSqliteProvider connect/close", () => {
  /**
   * `close()` must clear the cached `sqlite` handle and `drizzleDb`
   * instance derived from it, not just close the native connection —
   * otherwise `connect()`'s "already connected" guard (`if (this.sqlite)
   * return;`) sees the stale field, no-ops, and the provider is left
   * holding a closed handle instead of reconnecting.
   *
   * A single connect/close cycle — what `baseline mark` exercises today —
   * cannot catch this; the bug only shows up on a second `connect()`. CLI
   * commands that load an unstarted app (see `baseline-mark.spec.ts`) are
   * exactly the kind of caller that manages this lifecycle by hand, so a
   * future caller performing more than one cycle on the same instance (a
   * plausible shape for `baseline mark --reset`) must not inherit a dead
   * handle.
   */
  it("reconnects and can query again after connect -> close -> connect", async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", DATABASE_SYNC: false },
    });
    const provider = alepha.inject(NodeSqliteProvider);

    await provider.connect();
    await provider.close();

    // Without the fix, this second connect() would no-op (this.sqlite is
    // still the old, closed handle) and the query below would throw
    // against a closed database instead of succeeding against a fresh one.
    await provider.connect();

    const rows = await provider.execute(sql`SELECT 1 AS one`);
    expect(rows).toEqual([{ one: 1 }]);

    await provider.close();
  });
});
