import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { InspectorDispatcher } from "../services/InspectorDispatcher.ts";

/**
 * `alepha build --inspect` with `ALEPHA_INSPECT=1` opens the inspector in
 * production, so "the socket is closed in production" guards nothing here:
 * the route carries its own check.
 */
describe("POST /actions/:name/call in production", () => {
  it("refuses with 403 even when ALEPHA_INSPECT=1 opened the inspector", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        ALEPHA_INSPECT: "1",
        LOG_LEVEL: "error",
      },
    }).with(AlephaInspector);
    expect(alepha.isProduction()).toBe(true);

    const res = await alepha.inject(InspectorDispatcher).dispatch({
      method: "POST",
      path: "/actions/anything/call",
      body: { as: { roles: ["admin"] } },
    });

    expect(res.status).toBe(403);
    expect((res.body as { message: string }).message).toMatch(
      /refused in production, whatever ALEPHA_INSPECT says/,
    );
  });
});
